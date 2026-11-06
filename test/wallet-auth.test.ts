import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {PGlite} from '@electric-sql/pglite';
import {emptyEnvelope,schemaSql,serveDurableRequest,transaction,type SqlPool} from '../src/server/postgres';
import {walletAddressOf,signedMessageDigest,verifyWalletProof,newWalletChallenge} from '../src/server/walletAuth';
import {createValidNimiqAddress} from '../src/lib/domain';
function identity(){const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519'),pub=publicKey.export({format:'der',type:'spki'}).subarray(-32);return {address:walletAddressOf(pub),publicKey:pub.toString('hex'),sign:(message:string)=>crypto.sign(null,signedMessageDigest(message),privateKey).toString('hex')};}
test('wallet proof matches independent Nimiq Core 2.23.0 address and UTF-8 signed-message vector',()=>{
 const publicKey='d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',address='NQ17 F14S QC29 D05X 3TTN 5TY0 SDP0 2URU 6HJE',message='NimTera authentication test – UTF-8 ✓',signature='420e283b1b9f3e0a4f73cf0b05051801db4a4cf92e6af30b6063829eed281fdc17ef1dac7cb351757a396f5341f02cd0f8ba1c1c24988e5f4fd1535968411404';
 assert.equal(walletAddressOf(Buffer.from(publicKey,'hex')),address);assert.equal(verifyWalletProof(message,address,publicKey,signature),true);
 assert.equal(verifyWalletProof(message+'!',address,publicKey,signature),false);assert.equal(verifyWalletProof(message,createValidNimiqAddress('0'.repeat(32)),publicKey,signature),false);
 for(const bad of ['',null,[],{},'f'.repeat(500)])assert.equal(verifyWalletProof(message,address,publicKey,bad),false);
});
test('authentication challenges separate origin, address, network and purpose without spending authorization',()=>{
 const key=identity();const a=newWalletChallenge({address:key.address,network:'mainnet',purpose:'login',origin:'https://nimtera.store',bindingHash:'browser'});const b=newWalletChallenge({...a,purpose:'link'});
 assert.notEqual(a.id,b.id);for(const part of ['Origin: https://nimtera.store','Action: login','Wallet network: mainnet','does not send NIM',key.address])assert.ok(a.message.includes(part));assert.ok(a.expiresAt>Date.now()&&a.expiresAt<=Date.now()+300000);
});
async function fixture(){
 process.env.NODE_ENV='test';delete process.env.VERCEL;process.env.SESSION_SECRET='wallet-fixture-only-'.repeat(5);
 const {createApp,emptyDatabase,generateTotpCode}=await import('../server');const db=new PGlite();await db.exec(schemaSql);await db.query("INSERT INTO nimtera_testnet_state(id,state) VALUES('testnet',$1::jsonb)",[JSON.stringify(emptyEnvelope(emptyDatabase()))]);
 let tail:Promise<void>=Promise.resolve(),index=0;const pool:SqlPool={connect:async()=>{const prior=tail;let unlock!:()=>void;tail=new Promise<void>(r=>unlock=r);await prior;return {query:(sql,params)=>db.query(sql,params),release:()=>unlock()};}};
 const apps=[await createApp({apiOnly:true,automaticPaymentRpc:async()=>[]}),await createApp({apiOnly:true,automaticPaymentRpc:async()=>[]})];const server=createServer((req,res)=>{void serveDurableRequest(req,res,apps[index++%2],pool);});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as any).port}`;
 function browser(){const jar=new Map<string,string>();return {jar,req:async(path:string,data?:unknown)=>{const response=await fetch(base+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')},...(data?{body:JSON.stringify(data)}:{})});for(const line of response.headers.getSetCookie()){const [k,...v]=line.split(';')[0].split('=');if(v.join('='))jar.set(k,v.join('='));else jar.delete(k);}return {status:response.status,body:await response.json(),headers:response.headers};}};}
 const getState=async()=> (await db.query<{state:any}>("SELECT state FROM nimtera_testnet_state WHERE id='testnet'")).rows[0].state;
 const challenge=async(b:ReturnType<typeof browser>,key:ReturnType<typeof identity>,purpose='login',extra={})=>{const result=await b.req('/api/auth/wallet/challenge',{purpose,address:key.address,network:'mainnet'});assert.equal(result.status,200);return {challengeId:result.body.challengeId,publicKey:key.publicKey,signature:key.sign(result.body.message),...extra};};
 return {browser,challenge,getState,pool,generateTotpCode,close:async()=>{await new Promise<void>(r=>server.close(()=>r()));await db.close();}};
}
const profile={email:'wallet@example.test',storeName:'Wallet shop',storeSlug:'wallet-shop',nimiqAddress:createValidNimiqAddress('0'.repeat(32))};
test('wallet-first registration, login, password setup and email login share one durable account; payments stay testnet',async()=>{
 const f=await fixture(),b=f.browser(),key=identity();try{
 const proof=await f.challenge(b,key,'register');const verified=await b.req('/api/auth/wallet/verify',proof);assert.equal(verified.status,200);assert.equal((await b.req('/api/auth/wallet/verify',proof)).status,401);
 const registered=await b.req('/api/auth/wallet/register',{...profile,registrationTicket:verified.body.registrationTicket});assert.equal(registered.status,201);assert.equal(registered.body.store.activeEnvironment,'testnet');assert.equal(registered.body.store.nimiqAddress,null);assert.equal(registered.body.store.nimiqTestnetAddress,profile.nimiqAddress);
 assert.equal((await b.req('/api/auth/wallet/register',{...profile,registrationTicket:verified.body.registrationTicket})).status,401);
 const security=await b.req('/api/seller/security');assert.equal(security.body.hasPassword,false);assert.equal(security.body.walletAuthAddress,key.address);
 assert.equal((await b.req('/api/seller/wallet-login/unlink',{currentPassword:'bad'})).status,401);
 await b.req('/api/auth/logout',{});assert.equal((await b.req('/api/auth/login',{email:profile.email,password:'NotTheAccountPassword!2026'})).status,401);
 assert.equal((await b.req('/api/auth/wallet/verify',await f.challenge(b,key))).status,200);assert.equal((await b.req('/api/auth/session')).body.store.name,profile.storeName);
 const password='Wallet#EmailPassword!2026';assert.equal((await b.req('/api/auth/wallet/verify',await f.challenge(b,key,'password',{password}))).status,200);
 await b.req('/api/auth/logout',{});assert.equal((await b.req('/api/auth/login',{email:profile.email,password})).status,200);
 const state=await f.getState();assert.equal(state.database.sellers.length,1);assert.equal(state.database.stores.length,1);assert.equal(state.database.stores[0].nimiqTestnetAddress,profile.nimiqAddress);assert.equal(state.database.orders.length,0);
 }finally{await f.close();}
});
test('email accounts link only after password+wallet proof, keep MFA, and safely unlink without changing recipient',async()=>{
 const f=await fixture(),b=f.browser(),key=identity(),password='Email#WalletPassword!2026';try{
 assert.equal((await b.req('/api/auth/register',{...profile,password})).status,201);
 let proof=await f.challenge(b,key,'link',{currentPassword:'wrong'});assert.equal((await b.req('/api/auth/wallet/verify',proof)).status,401);assert.equal((await b.req('/api/auth/wallet/verify',{...proof,currentPassword:password})).status,401);
 proof=await f.challenge(b,key,'link',{currentPassword:password});assert.equal((await b.req('/api/auth/wallet/verify',proof)).status,200);
 const original=(await f.getState()).database.stores[0];assert.equal((await b.req('/api/seller/security')).body.walletAuthAddress,key.address);
 await transaction(f.pool,async state=>{const seller=state.database.sellers[0];seller.totpEnabled=true;seller.totpSecretHex='11'.repeat(20);});
 await b.req('/api/auth/logout',{});assert.equal((await b.req('/api/auth/wallet/verify',await f.challenge(b,key))).status,401);assert.equal((await b.req('/api/auth/session')).status,401);
 const code=f.generateTotpCode('11'.repeat(20));assert.equal((await b.req('/api/auth/wallet/verify',await f.challenge(b,key,'login',{totpCode:code}))).status,200);
 assert.equal((await b.req('/api/seller/wallet-login/unlink',{currentPassword:password})).status,401);
 assert.equal((await b.req('/api/seller/wallet-login/unlink',{currentPassword:password,totpCode:code})).status,200);
 assert.deepEqual((await f.getState()).database.stores[0],original);
 await b.req('/api/auth/logout',{});assert.equal((await b.req('/api/auth/wallet/verify',await f.challenge(b,key,'login',{totpCode:code}))).status,401);assert.equal((await b.req('/api/auth/login',{email:profile.email,password,totpCode:code})).status,200);
 }finally{await f.close();}
});
test('proofs are browser-bound, expiring and one-use across SQL instances; email or wallet collisions never merge accounts',async()=>{
 const f=await fixture(),b=f.browser(),other=f.browser(),key=identity(),different=identity(),password='Collision#Password!2026';try{
 let proof=await f.challenge(b,key,'register');assert.equal((await other.req('/api/auth/wallet/verify',proof)).status,401);
 const bad={...proof,signature:different.sign('wrong message')};assert.equal((await b.req('/api/auth/wallet/verify',bad)).status,401);assert.equal((await b.req('/api/auth/wallet/verify',proof)).status,401);
 proof=await f.challenge(b,key,'register');await transaction(f.pool,async state=>{state.walletChallenges!.get(proof.challengeId).expiresAt=Date.now()-1;});assert.equal((await b.req('/api/auth/wallet/verify',proof)).status,401);
 assert.equal((await other.req('/api/auth/register',{...profile,password})).status,201);
 const valid=await b.req('/api/auth/wallet/verify',await f.challenge(b,key,'register'));assert.equal(valid.status,200);
 assert.equal((await b.req('/api/auth/wallet/register',{...profile,registrationTicket:valid.body.registrationTicket})).status,409);assert.equal((await f.getState()).database.sellers.length,1);assert.equal((await f.getState()).database.sellers[0].walletAuthAddress,undefined);
 assert.equal((await b.req('/api/auth/wallet/register',{...profile,email:'another@example.test',storeSlug:'another-shop',registrationTicket:valid.body.registrationTicket})).status,201);
 assert.equal((await other.req('/api/auth/wallet/verify',await f.challenge(other,key,'link',{currentPassword:password}))).status,409);
 const state=await f.getState();assert.equal(state.database.sellers.length,2);assert.equal(state.database.sellers.filter((s:any)=>s.walletAuthAddress===key.address).length,1);
 assert.equal((await b.req('/api/public/stores/another-shop')).body.store.activeEnvironment,'testnet');
 }finally{await f.close();}
});
