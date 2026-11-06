import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import { once } from 'node:events';
import { requestState, scopedDatabase, scopedMap } from '../src/server/requestState';
import { emptyEnvelope, schemaSql, transaction, serveDurableRequest, parseDatabaseUrl, databaseConnectionConfig, type SqlPool } from '../src/server/postgres';

function initialDatabase(): { sellers: any[]; stores: any[]; products: any[]; orders: any[]; auditLogs: any[]; claimedTransactions: Record<string,string>; orderSequenceByStore: Record<string,number> } { return { sellers: [], stores: [], products: [], orders: [], auditLogs: [], claimedTransactions: {}, orderSequenceByStore: {} }; }
async function fixture() {
  const db = new PGlite();
  await db.exec(schemaSql);
  await db.query("INSERT INTO nimtera_testnet_state(id,state) VALUES ('testnet',$1::jsonb)", [JSON.stringify(emptyEnvelope(initialDatabase()))]);
  let tail: Promise<void> = Promise.resolve();
  let failCommit = false;
  const pool: SqlPool = { connect: async () => {
    const prior = tail; let unlock!: () => void; tail = new Promise<void>(r => { unlock = r; }); await prior;
    return { query: async (sql, params) => {
      if (sql === 'COMMIT' && failCommit) { failCommit = false; throw new Error('Fixture commit failure'); }
      return db.query(sql, params);
    }, release: () => unlock() };
  } };
  return { db, pool, failNextCommit: () => { failCommit = true; }, state: async () => (await db.query<{ state: any }>("SELECT state FROM nimtera_testnet_state WHERE id='testnet'")).rows[0].state };
}

test('PostgreSQL engine: commits state and shared sessions; rollback leaves no partial data', async () => {
  const f = await fixture();
  try {
    await transaction(f.pool, async s => { s.database.stores.push({ slug: 'first' }); s.sessions.set('token', { expiresAt: Date.now() + 100000, sellerId: 'seller' }); });
    const seen = await transaction(f.pool, async s => ({ slug: s.database.stores[0].slug, sellerId: s.sessions.get('token').sellerId }));
    assert.deepEqual(seen, { slug: 'first', sellerId: 'seller' });
    await assert.rejects(transaction(f.pool, async s => { s.database.stores.push({ slug: 'bad' }); throw new Error('reject'); }));
    assert.equal((await f.state()).database.stores.length, 1);
    f.failNextCommit();
    await assert.rejects(transaction(f.pool, async s => { s.database.stores.push({ slug: 'not-durable' }); }));
    assert.equal((await f.state()).database.stores.length, 1);
  } finally { await f.db.close(); }
});

test('PostgreSQL engine: sequential transactions do not lose updates; invalid business response preserves only security counters', async () => {
  const f = await fixture();
  try {
    await Promise.all(Array.from({ length: 8 }, (_,i) => transaction(f.pool, async s => { await new Promise(r => setTimeout(r, 1)); s.database.orders.push({ id: i }); })));
    assert.equal((await f.state()).database.orders.length, 8);
    await transaction(f.pool, async s => { s.database.stores.push({ slug: 'invalid' }); s.loginRateLimits.set('ip:email', { failures: 1, lockedUntilMs: 0, updatedAtMs: Date.now() }); return 400; }, code => code >= 400);
    const state = await f.state(); assert.equal(state.database.stores.length, 0); assert.equal(state.loginRateLimits.length, 1);
  } finally { await f.db.close(); }
});

test('AsyncLocalStorage isolates data and sessions across overlapping request contexts', async () => {
  const fallback = initialDatabase(); const db = scopedDatabase(fallback); const sessions = scopedMap<string,string>('sessions');
  const context = (label: string) => ({ database: { ...initialDatabase(), stores: [{ slug: label }] }, sessions: new Map([['key',label]]), loginRateLimits: new Map(), publicEndpointRateLimits: new Map() });
  const values = await Promise.all(['one','two'].map(label => requestState.run(context(label), async () => { await new Promise(r => setTimeout(r, 5)); return [db.stores[0].slug, sessions.get('key')]; })));
  assert.deepEqual(values, [['one','one'],['two','two']]); assert.equal(fallback.stores.length, 0); assert.equal(sessions.size, 0);
});

test('HTTP responses are released after commit; commit failure returns 503, never fake success', async () => {
  const f = await fixture();
  const app = express(); const db = scopedDatabase(initialDatabase()); const sessions = scopedMap<string, any>('sessions');
  app.post('/write', (_req,res) => { db.stores.push({ slug: 'http' } as never); sessions.set('http-token', { expiresAt: Date.now()+100000 }); res.status(201).json({ ok: true }); });
  app.get('/read', (_req,res) => { res.json({ stores: db.stores.length, session: sessions.has('http-token') }); });
  app.post('/invalid', (_req,res) => { db.stores.push({ slug: 'invalid' } as never); res.status(400).json({ error: 'invalid' }); });
  const http = (await import('node:http')).createServer((req,res) => { void serveDurableRequest(req,res,app,f.pool); });
  http.listen(0,'127.0.0.1'); await once(http,'listening'); const base = `http://127.0.0.1:${(http.address() as any).port}`;
  try {
    assert.equal((await fetch(base+'/write',{method:'POST'})).status, 201);
    assert.deepEqual(await (await fetch(base+'/read')).json(), { stores: 1, session: true });
    assert.equal((await fetch(base+'/invalid',{method:'POST'})).status, 400);
    assert.equal((await f.state()).database.stores.length, 1);
    f.failNextCommit(); const response = await fetch(base+'/write',{method:'POST'}); assert.equal(response.status,503); assert.equal((await response.json()).ok,undefined);
    assert.equal((await f.state()).database.stores.length, 1);
  } finally { await new Promise<void>(r => http.close(() => r())); await f.db.close(); }
});

test('original application: registration, MFA, products and orders survive distinct serverless app instances', async () => {
  process.env.NODE_ENV = 'test'; process.env.SESSION_SECRET = 'fixture-cloud-secret-'.repeat(5);
  delete process.env.TURNSTILE_SECRET_KEY; delete process.env.VITE_TURNSTILE_SITE_KEY; delete process.env.TURNSTILE_ALLOWED_HOSTNAMES;
  const { createApp, generateTotpCode } = await import('../server');
  const { createValidNimiqAddress } = await import('../src/lib/domain');
  const { createServer } = await import('node:http');
  const f = await fixture();
  const appA = await createApp({ apiOnly: true }); let appB = await createApp({ apiOnly: true });
  let alternate = false;
  const http = createServer((req,res) => { alternate = !alternate; void serveDurableRequest(req,res,alternate ? appA : appB,f.pool); });
  http.listen(0,'127.0.0.1'); await once(http,'listening'); const base = `http://127.0.0.1:${(http.address() as any).port}`;
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (url,opts) => { if (String(url).includes('challenges.cloudflare.com')) assert.fail('CAPTCHA must not be contacted'); return nativeFetch(url,opts); };
  const req = async (path: string, body?: unknown, token?: string, method?: string) => {
    const r = await fetch(base+path,{method:method || (body ? 'POST':'GET'), headers:{'Content-Type':'application/json',...(token ? {Authorization:`Bearer ${token}`} : {})},...(body ? {body:JSON.stringify(body)} : {})});
    return { status:r.status, body:await r.json() };
  };
  try {
    const registered = await req('/api/auth/register',{email:'durable@example.test',password:'Fixture#DurablePassword!2026',storeName:'Durable shop',storeSlug:'durable-shop',nimiqAddress:createValidNimiqAddress('00000000000000000000000000000000')});
    assert.equal(registered.status,201); const token = registered.body.token;
    assert.equal((await req('/api/seller/dashboard',undefined,token)).status,403);
    const state = await f.state();
    const code = generateTotpCode(state.database.sellers[0].totpSecretHex);
    assert.equal((await req('/api/auth/mfa/confirm',{totpCode:code},token)).status,200);
    assert.equal((await req('/api/seller/dashboard',undefined,token)).status,200);
    const product = await req('/api/seller/products',{name:'Durable item',priceNimLuna:'100000'},token);
    assert.equal(product.status,201);
    assert.equal((await req(`/api/seller/products/${product.body.product.id}`,{name:'Partial mutation must not stick',priceNimLuna:'0',priceUsdtMicro:'0'},token,'PUT')).status,400);
    const dashboard = await req('/api/seller/dashboard',undefined,token);
    assert.equal(dashboard.body.products[0].name,'Durable item');
    const created = await req('/api/public/stores/durable-shop/orders',{asset:'NIM',environment:'testnet',fulfillmentMode:'pickup',items:[{productId:product.body.product.id,quantity:1}]});
    assert.equal(created.status,201);
    assert.equal((await req(`/api/public/orders/${created.body.order.publicToken}`)).body.order.paymentStatus,'unpaid');
    // Simulate another cold application instance; durable state, not module fallbacks, supplies the account.
    appB = await createApp({apiOnly:true}); alternate = true;
    assert.equal((await req('/api/seller/dashboard',undefined,token)).status,200);
    assert.equal((await f.state()).database.orders.length,1);
    assert.equal((await f.state()).sessions.length,1);
    assert.equal((await req('/api/auth/logout',{},token)).status,200);
    assert.equal((await req('/api/seller/dashboard',undefined,token)).status,401);
  } finally { globalThis.fetch = nativeFetch; await new Promise<void>(r => http.close(() => r())); await f.db.close(); }
});

test('cloud entrypoint fails closed without database configuration and never falls back to local JSON', async () => {
  process.env.NODE_ENV='test'; process.env.VERCEL='1';
  delete process.env.DATABASE_URL; delete process.env.POSTGRES_URL;
  const { default: handler } = await import('../api/index');
  const { createServer } = await import('node:http');
  const http = createServer((req,res) => { void handler(req,res); });
  http.listen(0,'127.0.0.1'); await once(http,'listening'); const base=`http://127.0.0.1:${(http.address() as any).port}`;
  try {
    const health=await fetch(base+'/api/health'); assert.equal(health.status,503); const body=await health.json(); assert.equal(body.ready,false); assert.equal(body.configured.database,false); assert.equal(body.databaseReachable,false);
    const write=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'must-not-persist@example.test'})});
    assert.equal(write.status,503); assert.equal((await write.json()).token,undefined);
    assert.equal((await fetch(base+'/api/auth/security-status')).status,200);
  } finally { await new Promise<void>(r => http.close(() => r())); delete process.env.VERCEL; }
});


test('database URI accepts quoted/env-line paste but rejects keys or password-only values', () => {
  const uri = 'postgresql://fixture:fixture@fixture.invalid:6543/postgres?sslmode=require';
  for (const value of [uri, `"${uri}"`, `DATABASE_URL=${uri}`, `DATABASE_URL="${uri}"`]) assert.equal(parseDatabaseUrl(value).hostname, 'fixture.invalid');
  for (const value of ['just-a-password', 'https://fixture.invalid', 'sb_secret_fixture']) assert.throws(() => parseDatabaseUrl(value));
});


test('Supabase TLS verifies provider CA and hostname; URL parameters cannot disable certificate verification', async () => {
  const { X509Certificate } = await import('node:crypto');
  const { SUPABASE_CA } = await import('../src/server/supabaseCa');
  const root = new X509Certificate(SUPABASE_CA);
  assert.equal(root.ca, true); assert.equal(root.verify(root.publicKey), true);
  assert.ok(Date.parse(root.validTo) > Date.now());
  for (const mode of ['require','verify-ca','verify-full']) {
    const c = databaseConnectionConfig(`postgresql://fixture:fixture@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=${mode}`, true);
    const ssl = c.ssl as any;
    assert.equal(ssl.rejectUnauthorized, true); assert.equal(ssl.ca, SUPABASE_CA);
    assert.equal(ssl.servername, 'aws-0-ap-southeast-1.pooler.supabase.com');
    assert.equal(new URL(c.connectionString!).searchParams.has('sslmode'), false); assert.equal(c.max,1);
  }
  assert.throws(() => databaseConnectionConfig('postgresql://fixture:fixture@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=disable', true));
  assert.equal(databaseConnectionConfig('postgresql://fixture:fixture@example.invalid:5432/postgres?sslmode=verify-full', true).ssl, undefined);
});
