// Isolated real API + PostgreSQL-engine fixture. Never contacts the production database.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { emptyEnvelope, schemaSql, serveDurableRequest, type SqlPool } from '../src/server/postgres';
process.env.NODE_ENV='test'; delete process.env.VERCEL;
process.env.SESSION_SECRET=randomBytes(48).toString('hex');
const dir=mkdtempSync(path.join(tmpdir(),'nimtera-auth-browser-'));
process.env.NIMTERA_DATA_FILE=path.join(dir,'unused-local.json');
const { createApp, emptyDatabase }=await import('../server');
const db=new PGlite(); await db.exec(schemaSql);
await db.query("INSERT INTO nimtera_testnet_state(id,state) VALUES('testnet',$1::jsonb)",[JSON.stringify(emptyEnvelope(emptyDatabase()))]);
let tail:Promise<void>=Promise.resolve();
const pool:SqlPool={connect:async()=>{const prior=tail;let unlock!:()=>void;tail=new Promise<void>(r=>{unlock=r;});await prior;return {query:(sql,params)=>db.query(sql,params),release:()=>unlock()};}};
const apps=[await createApp({apiOnly:true}),await createApp({apiOnly:true})];let index=0;
const app=express();app.use('/api',(req,res)=>{
// Keep fixture suites on independent simulated client IPs without weakening production limits.
if(req.headers['x-nimtera-fixture-client']==='wallet-auth-tests')Object.defineProperty(req,'ip',{value:'fixture-wallet-client',configurable:true});
req.url='/api'+req.url;void serveDurableRequest(req,res,apps[index++%2],pool);});
app.use(express.static(path.resolve('dist')));app.get('*',(_req,res)=>res.sendFile(path.resolve('dist/index.html')));
const server=app.listen(3016,'0.0.0.0',()=>console.log('Isolated cookie-session browser fixture ready'));
process.on('SIGTERM',()=>server.close(()=>{void db.close().finally(()=>{rmSync(dir,{recursive:true,force:true});process.exit(0);});}));
