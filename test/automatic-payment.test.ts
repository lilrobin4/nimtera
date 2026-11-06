import {once} from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import {allocateUniqueAmount,discoverAutomaticPayments,type AutomaticPaymentDatabase} from '../src/server/automaticPayments';
import {createValidNimiqAddress,type OrderSnapshot} from '../src/lib/domain';
const now=Date.now(),recipient=createValidNimiqAddress('0'.repeat(32)),hash='a'.repeat(64),urls={'nimiq-testnet':'https://fixture.invalid'};
function order(extra:Partial<OrderSnapshot>={}):OrderSnapshot{return {id:'auto-1',publicToken:'auto-token',orderNumber:'T001',storeSlug:'one',storeName:'One',asset:'NIM',environment:'testnet',network:'nimiq-testnet',snapshotRecipient:recipient,amountFormatted:'1.00001',amountBase:'100001',subtotalBase:'100000',paymentCodeLuna:'1',matchingMode:'unique-amount-v1',createdAt:new Date(now-10000).toISOString(),expiresAt:new Date(now+300000).toISOString(),paymentStatus:'unpaid',items:[],fulfillmentMode:'pickup',tableOrNote:'',fulfillmentStatus:'new',...extra};}
function db(orders=[order()]):AutomaticPaymentDatabase{return {orders,claimedTransactions:{},auditLogs:[]};}
const receipt={hash,networkId:5,to:recipient,value:100001,recipientData:'',blockNumber:8,confirmations:2,timestamp:now,executionResult:true};
test('reservations include expired/legacy orders across shops; overlapping subtotals and historical amounts never collide',()=>{
 const old=order({matchingMode:undefined,paymentStatus:'expired',storeSlug:'other',amountBase:'101000'});assert.equal(allocateUniqueAmount(100000n,recipient,'nimiq-testnet',[old]).amountBase,'102000');
 assert.equal(allocateUniqueAmount(99999n,recipient,'nimiq-testnet',[old]).amountBase,'102000');
 const retained=Array.from({length:99},(_,i)=>order({id:String(i),amountBase:String(101000+i*1000)}));assert.throws(()=>allocateUniqueAmount(100000n,recipient,'nimiq-testnet',retained),/capacity/);
 assert.throws(()=>allocateUniqueAmount(BigInt(Number.MAX_SAFE_INTEGER),recipient,'nimiq-testnet',[]),/capacity/);
 assert.throws(()=>allocateUniqueAmount(0n,recipient,'nimiq-testnet',[]));assert.throws(()=>allocateUniqueAmount(1n,recipient,'nimiq-mainnet',[]));
 assert.equal(allocateUniqueAmount(100000n,createValidNimiqAddress('1'.repeat(32)),'nimiq-testnet',retained).amountBase,'101000');
});
test('exact incoming payment confirms with no buyer hash, across shops, once; cooldown persists and legacy totals remain immutable',async()=>{
 const legacy=order({id:'legacy',matchingMode:undefined,amountBase:'8000000',storeSlug:'old'}),state=db([order(),order({id:'auto-2',storeSlug:'two',amountBase:'100002',paymentCodeLuna:'2'}),legacy]);let calls=0;
 const call=async(_u:string,m:string,p:unknown[])=>{calls++;assert.equal(m,'getTransactionsByAddress');assert.deepEqual(p,[recipient.replace(/\s/g,''),500,null]);return [receipt,{...receipt,hash:'b'.repeat(64),value:100002}];};
 await discoverAutomaticPayments(state,urls,'one',call,now);assert.equal(state.orders[0].paymentStatus,'confirmed');assert.equal(state.orders[1].paymentStatus,'confirmed');assert.equal(state.orders[0].paymentBinding,'unique-amount');assert.equal(state.orders[2].amountBase,'8000000');assert.equal(state.orders[2].paymentStatus,'unpaid');assert.equal(state.auditLogs.length,2);
 await discoverAutomaticPayments(state,urls,'one',call,now+1);assert.equal(calls,1);assert.equal(state.auditLogs.length,2);
});
test('wrong amounts, recipients, networks, memo, execution and inclusion times never confirm',async()=>{
 for(const change of [{value:100000},{to:createValidNimiqAddress('1'.repeat(32))},{networkId:24},{recipientData:'another invoice'},{executionResult:false},{executionResult:undefined},{confirmations:0},{blockNumber:0},{timestamp:now-20000},{timestamp:now+400000},{hash:'bad'}]){const state=db();await discoverAutomaticPayments(state,urls,undefined,async()=>[{...receipt,...change}],now);assert.notEqual(state.orders[0].paymentStatus,'confirmed',JSON.stringify(change));assert.equal(Object.keys(state.claimedTransactions).length,0);}
});
test('global amount collisions, duplicate transfers and replay require safe non-confirmation',async()=>{
 const collision=db([order(),order({id:'legacy',matchingMode:undefined,storeSlug:'two'})]);await discoverAutomaticPayments(collision,urls,undefined,async()=>[receipt],now);assert.equal(collision.orders[0].paymentStatus,'needs_review');
 const multiple=db();await discoverAutomaticPayments(multiple,urls,undefined,async()=>[receipt,{...receipt,hash:'b'.repeat(64)}],now);assert.equal(multiple.orders[0].paymentStatus,'needs_review');await discoverAutomaticPayments(multiple,urls,undefined,async()=>[receipt],now+10000);assert.equal(multiple.orders[0].paymentStatus,'needs_review');
 const replay=db();replay.claimedTransactions[`nimiq-testnet:${hash}`]='someone-else';await discoverAutomaticPayments(replay,urls,undefined,async()=>[receipt],now);assert.notEqual(replay.orders[0].paymentStatus,'confirmed');assert.equal(replay.auditLogs.length,0);
 const duplicate=db();await discoverAutomaticPayments(duplicate,urls,undefined,async()=>[receipt,receipt],now);assert.equal(duplicate.orders[0].paymentStatus,'confirmed');assert.equal(duplicate.auditLogs.length,1);
});
test('RPC outages, durable cooldown and truncated history are visible; timely transfers can be discovered after expiry',async()=>{
 const state=db();let calls=0;const outage=async()=>{calls++;throw Error('offline');};await discoverAutomaticPayments(state,urls,undefined,outage,now);assert.equal(state.orders[0].autoMatchState,'unavailable');await discoverAutomaticPayments(state,urls,undefined,outage,now+9999);assert.equal(calls,1);
 await discoverAutomaticPayments(state,urls,undefined,async()=>Array(500).fill({...receipt,value:9}),now+10000);assert.equal(state.orders[0].autoMatchState,'limited');assert.notEqual(state.orders[0].paymentStatus,'confirmed');
 await discoverAutomaticPayments(state,urls,undefined,async()=>[receipt],now+400000);assert.equal(state.orders[0].paymentStatus,'confirmed');assert.equal(state.auditLogs.length,1);
 const corrupt=db([order({paymentCodeLuna:'9999'})]);await discoverAutomaticPayments(corrupt,urls,undefined,async()=>{assert.fail('invalid reservation must not scan');},now);
});

test('durable HTTP instances allocate concurrent orders globally, then seller polling alone confirms without hash',async()=>{
 process.env.NODE_ENV='test';delete process.env.VERCEL;process.env.SESSION_SECRET='automatic-fixture-'.repeat(6);
 const {PGlite}=await import('@electric-sql/pglite');const {emptyEnvelope,schemaSql,serveDurableRequest,transaction}=await import('../src/server/postgres');const {createApp,emptyDatabase}=await import('../server');const {createServer}=await import('node:http');const sql=new PGlite();await sql.exec(schemaSql);await sql.query("INSERT INTO nimtera_testnet_state(id,state) VALUES('testnet',$1::jsonb)",[JSON.stringify(emptyEnvelope(emptyDatabase()))]);
 let tail:Promise<void>=Promise.resolve(),index=0,history:any[]=[];const pool={connect:async()=>{const prior=tail;let unlock!:()=>void;tail=new Promise<void>(r=>unlock=r);await prior;return {query:(s:string,p?:any[])=>sql.query(s,p),release:()=>unlock()};}};
 const apps=[await createApp({apiOnly:true,automaticPaymentRpc:async()=>history}),await createApp({apiOnly:true,automaticPaymentRpc:async()=>history})],server=createServer((req,res)=>{void serveDurableRequest(req,res,apps[index++%2],pool);});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as any).port}`;
 const request=async(path:string,body?:unknown,token?:string)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
 try{
 const account={email:'auto@example.test',password:'Automatic#PrivatePassword!2026',storeName:'Automatic Shop',storeSlug:'automatic',nimiqAddress:recipient};const first=await request('/api/auth/register',account),second=await request('/api/auth/register',{...account,email:'auto2@example.test',storeSlug:'automatic-two'});assert.equal(first.status,201);assert.equal(second.status,201);
 const products=await Promise.all([first,second].map(a=>request('/api/seller/products',{name:'Automatic item',priceNimLuna:'100000'},a.body.token)));const cart=(i:number)=>({asset:'NIM',environment:'testnet',fulfillmentMode:'pickup',items:[{productId:products[i].body.product.id,quantity:1}]});
 const created=await Promise.all([request('/api/public/stores/automatic/orders',cart(0)),request('/api/public/stores/automatic-two/orders',cart(1))]);assert.ok(created.every(r=>r.status===201));assert.equal(new Set(created.map(r=>r.body.order.amountBase)).size,2);assert.ok(created.every(r=>r.body.order.subtotalBase==='100000'));const target=created[1].body.order;
 history=[{...receipt,value:Number(target.amountBase),timestamp:Date.now()}];const dash=await request('/api/seller/dashboard',undefined,second.body.token);assert.equal(dash.status,200);assert.equal(dash.body.orders[0].paymentStatus,'confirmed');assert.equal(dash.body.orders[0].paymentBinding,'unique-amount');assert.equal(dash.body.products[0].priceNimLuna,'100000');assert.equal(dash.body.orders.length,1);
 const publicOrder=(await request('/api/public/orders/'+target.publicToken)).body.order;assert.equal(publicOrder.paymentStatus,'confirmed');assert.equal(publicOrder.paymentCodeLuna,target.paymentCodeLuna);assert.equal(publicOrder.deliveryInfo,undefined);
 const stored=(await sql.query<{state:any}>("SELECT state FROM nimtera_testnet_state WHERE id='testnet'")).rows[0].state;assert.equal(stored.database.orders.filter((o:any)=>o.paymentStatus==='confirmed').length,1);assert.equal(stored.database.auditLogs.filter((a:any)=>a.action==='UNIQUE_AMOUNT_PAYMENT_CONFIRMED').length,1);assert.equal(stored.database.claimedTransactions['nimiq-testnet:'+hash],target.id);
 await transaction(pool,async s=>{s.database.paymentScanState={};});await request('/api/seller/dashboard',undefined,second.body.token);const again=(await sql.query<{state:any}>("SELECT state FROM nimtera_testnet_state WHERE id='testnet'")).rows[0].state;assert.equal(again.database.auditLogs.filter((a:any)=>a.action==='UNIQUE_AMOUNT_PAYMENT_CONFIRMED').length,1);
 }finally{await new Promise<void>(r=>server.close(()=>r()));await sql.close();}
});
test('two-decimal invoices reserve .01 increments and retain legacy five-decimal verification',async()=>{
 const first=allocateUniqueAmount(4000000n,recipient,'nimiq-testnet',[]);assert.equal(first.amountBase,'4001000');assert.equal(first.paymentCodeLuna,'1000');assert.equal(first.matchingMode,'unique-amount-v2');
 const state=db([order({...first})]);await discoverAutomaticPayments(state,urls,undefined,async()=>[{...receipt,value:4001000}],now);assert.equal(state.orders[0].paymentStatus,'confirmed');
 const next=allocateUniqueAmount(4000000n,recipient,'nimiq-testnet',state.orders);assert.equal(next.amountBase,'4002000');
 const fine=allocateUniqueAmount(4000001n,recipient,'nimiq-testnet',[]);assert.equal(BigInt(fine.amountBase)%1000n,0n);assert.equal(BigInt(fine.amountBase)-4000001n,BigInt(fine.paymentCodeLuna));
});
