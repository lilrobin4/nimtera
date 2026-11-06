import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {PGlite} from '@electric-sql/pglite';
import {emptyEnvelope,schemaSql,serveDurableRequest,transaction,type SqlPool} from '../src/server/postgres';
import {readAddressPaymentEvidence,readPaymentEvidence,type RpcCall} from '../src/server/payments';
import {createValidNimiqAddress,type OrderSnapshot} from '../src/lib/domain';
const recipient=createValidNimiqAddress('0'.repeat(32)),hash='d'.repeat(64),now=Date.now();
const order={id:'address-1',publicToken:'address-token',orderNumber:'T001',storeSlug:'address-store',storeName:'Address Store',asset:'NIM',network:'nimiq-testnet',environment:'testnet',snapshotRecipient:recipient,amountBase:'100000',amountFormatted:'1 NIM',createdAt:new Date(now-10000).toISOString(),expiresAt:new Date(now+300000).toISOString(),paymentStatus:'unpaid',items:[],fulfillmentMode:'pickup',tableOrNote:'',fulfillmentStatus:'new'} as OrderSnapshot;
const receipt={hash,networkId:5,recipient,value:'100000',recipientData:'',blockNumber:8,confirmations:2,timestamp:now,executionResult:true};
test('empty-memo address transfers are never public auto-confirmations; seller evidence retains all chain/time checks',async()=>{
 const urls={'nimiq-testnet':'https://fixture.invalid'},call:RpcCall=async()=>receipt;
 assert.equal((await readPaymentEvidence(order,hash,urls,call)).executionStatus,'unverified');
 assert.equal((await readAddressPaymentEvidence(order,hash,urls,call)).executionStatus,'confirmed');
 for(const change of [{recipientData:'other invoice'},{networkId:24},{recipient:'wrong'},{timestamp:now-86400000},{timestamp:Date.parse(order.expiresAt)+1},{executionResult:undefined}])assert.equal((await readAddressPaymentEvidence(order,hash,urls,async()=>({...receipt,...change}))).executionStatus,'unverified');
 assert.equal((await readAddressPaymentEvidence(order,hash,urls,async()=>({...receipt,confirmations:0}))).executionStatus,'pending');
 assert.equal((await readAddressPaymentEvidence(order,hash,urls,async()=>({...receipt,executionResult:false}))).executionStatus,'failed');
 assert.equal((await readAddressPaymentEvidence(order,hash,urls,async()=>{throw new DOMException('timeout','TimeoutError');})).executionStatus,'rpc_timeout');
});
test('durable seller review requires tenant ownership, explicit match and enabled MFA; validates amount and prevents transaction replay',async()=>{
 process.env.NODE_ENV='test';delete process.env.VERCEL;process.env.SESSION_SECRET='address-review-fixture-'.repeat(5);
 const {createApp,emptyDatabase,generateTotpCode}=await import('../server');const db=new PGlite();await db.exec(schemaSql);await db.query("INSERT INTO nimtera_testnet_state(id,state) VALUES('testnet',$1::jsonb)",[JSON.stringify(emptyEnvelope(emptyDatabase()))]);
 let tail:Promise<void>=Promise.resolve(),index=0;const pool:SqlPool={connect:async()=>{const prior=tail;let unlock!:()=>void;tail=new Promise<void>(r=>unlock=r);await prior;return {query:(s,p)=>db.query(s,p),release:()=>unlock()};}};
 const apps=[await createApp({apiOnly:true}),await createApp({apiOnly:true})],server=createServer((req,res)=>{void serveDurableRequest(req,res,apps[index++%2],pool);});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as any).port}`,original=globalThis.fetch;let current={...receipt};
 globalThis.fetch=async(input,options)=>String(input).startsWith(base)?original(input,options):new Response(JSON.stringify({result:current}),{status:200});
 const request=async(path:string,body?:unknown,token?:string)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
 const state=async()=> (await db.query<{state:any}>("SELECT state FROM nimtera_testnet_state WHERE id='testnet'")).rows[0].state;
 try{
 const account={email:'address@example.test',password:'Address#PrivatePassword!2026',storeName:'Address Store',storeSlug:'address-store',nimiqAddress:recipient};
 const registered=await request('/api/auth/register',account);assert.equal(registered.status,201);const token=registered.body.token;
 const other=await request('/api/auth/register',{...account,email:'other@example.test',storeSlug:'other-address'});assert.equal(other.status,201);
 await transaction(pool,async s=>{s.database.orders.push(structuredClone(order),{...order,id:'address-2',publicToken:'address-token-2',orderNumber:'T002'});});
 const path='/api/seller/orders/address-1/address-payment',body={txHash:hash,acknowledgeOrderMatch:true};
 assert.equal((await request(path,body)).status,401);assert.equal((await request(path,body,other.body.token)).status,404);assert.equal((await request(path,{txHash:hash},token)).status,400);
 assert.equal((await request('/api/public/orders/address-token/verify',{txHash:hash})).body.order.paymentStatus,'needs_review');assert.equal((await state()).database.claimedTransactions['nimiq-testnet:'+hash],undefined);
 await request('/api/auth/mfa/enrollment',{currentPassword:account.password},token);const secret=(await state()).database.sellers.find((s:any)=>s.email===account.email).totpSecretHex;const totpCode=generateTotpCode(secret);assert.equal((await request('/api/auth/mfa/confirm',{totpCode},token)).status,200);
 assert.equal((await request(path,body,token)).status,401);
 current={...receipt,value:'1'};assert.equal((await request(path,{...body,totpCode},token)).status,409);assert.notEqual((await state()).database.orders[0].paymentStatus,'confirmed');
 current={...receipt};const good=await request(path,{...body,totpCode},token);assert.equal(good.status,200);assert.equal(good.body.order.paymentStatus,'confirmed');assert.equal(good.body.order.paymentBinding,'seller-reviewed-address');
 assert.equal((await request(path,{...body,totpCode},token)).status,200);
 assert.equal((await request('/api/seller/orders/address-2/address-payment',{...body,totpCode},token)).status,409);
 const saved=await state();assert.equal(saved.database.claimedTransactions['nimiq-testnet:'+hash],'address-1');assert.equal(saved.database.auditLogs.filter((a:any)=>a.action==='ADDRESS_PAYMENT_REVIEWED').length,1);assert.equal(saved.database.orders[1].paymentStatus,'unpaid');
 await transaction(pool,async s=>{s.database.orders.push({...order,id:'address-3',publicToken:'address-token-3',orderNumber:'T003',createdAt:new Date(now-200000).toISOString(),expiresAt:new Date(now-10000).toISOString()});});
 const laterHash='e'.repeat(64);current={...receipt,hash:laterHash,timestamp:now-100000};
 assert.equal((await request('/api/seller/orders/address-3/address-payment',{txHash:laterHash,acknowledgeOrderMatch:true,totpCode},token)).status,200);

 }finally{globalThis.fetch=original;await new Promise<void>(r=>server.close(()=>r()));await db.close();}
});
