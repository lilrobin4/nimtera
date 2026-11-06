import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { Wallet } from 'ethers';
import { readPaymentEvidence, rpcCall } from '../src/server/payments';
import { createValidNimiqAddress, paymentIntentMessage, reconcilePaymentVerification, ERC20_TRANSFER_TOPIC, type OrderSnapshot } from '../src/lib/domain';
import { requestNativeNimPayment, requestNativePolygonUsdtPayment } from '../src/lib/nimiqPay';

const recipient = createValidNimiqAddress('00000000000000000000000000000000');
const hash = 'a'.repeat(64);
const now = Date.now();
const order = { id: 'test1', publicToken: 'nt_ord_' + 'b'.repeat(24), orderNumber: '#T001', storeSlug: 'fixture', storeName: 'Fixture', asset: 'NIM', network: 'nimiq-testnet', environment: 'testnet', snapshotRecipient: recipient, amountBase: '100000', createdAt: new Date(now - 5000).toISOString(), expiresAt: new Date(now + 60000).toISOString(), paymentStatus: 'unpaid' } as OrderSnapshot;
const urls = { 'nimiq-testnet': 'https://fixture.invalid', 'polygon-amoy': 'https://fixture.invalid' };
const nim = { hash, networkId: 5, to: recipient, value: '100000', recipientData: Buffer.from('NimTera ' + order.publicToken).toString('hex'), blockNumber: 8, confirmations: 2, timestamp: now, executionResult: true };
// Derive memo from the real builder, avoiding a fixture that silently bypasses invoice binding.
import { buildNimiqPaymentDetails } from '../src/lib/domain';
nim.recipientData = Buffer.from(buildNimiqPaymentDetails({ recipient, amountLuna: order.amountBase, publicToken: order.publicToken, orderNumber: order.orderNumber, network: 'nimiq-testnet' }).memo).toString('hex');

test('NIM RPC validates memo, network, execution, age and exact invoice amount', async () => {
  const valid = await readPaymentEvidence(order, hash, urls, async () => nim);
  assert.equal(valid.executionStatus, 'confirmed'); assert.equal(valid.amountBase, 100000n);
  for (const changed of [{ recipientData: '00' }, { networkId: 24 }, { timestamp: now - 86400000 }, { executionResult: undefined }, { to: 'wrong' }]) {
    assert.equal((await readPaymentEvidence(order, hash, urls, async () => ({ ...nim, ...changed }))).executionStatus, 'unverified');
  }
  assert.equal((await readPaymentEvidence(order, hash, urls, async () => ({ ...nim, executionResult: false }))).executionStatus, 'failed');
  assert.equal((await readPaymentEvidence(order, hash, urls, async () => ({ ...nim, confirmations: 0 }))).executionStatus, 'pending');
  const short = await readPaymentEvidence(order, hash, urls, async () => ({ ...nim, value: '1' }));
  assert.equal(reconcilePaymentVerification({ order, evidence: short, claimedTxOrderMap: new Map() }).paymentStatus, 'needs_review');
});

test('wrapped RPC data is unwrapped, timeout cannot produce success', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ result: { data: nim, metadata: {} } }));
    assert.deepEqual(await rpcCall('https://fixture.invalid', 'getTransactionByHash', [hash]), nim);
  } finally { globalThis.fetch = original; }
  assert.equal((await readPaymentEvidence(order, hash, urls, async () => { throw new DOMException('timeout', 'TimeoutError'); })).executionStatus, 'rpc_timeout');
});

test('mainnet is blocked without any RPC or native send; unknown host cannot send', async () => {
  assert.equal((await readPaymentEvidence({ ...order, environment: 'mainnet' }, hash, urls, async () => { assert.fail('RPC must not run'); })).executionStatus, 'unverified');
  assert.equal((await requestNativeNimPayment({ recipient, amountLuna: '100000', orderNumber: '#T1', publicToken: order.publicToken, network: 'nimiq-mainnet' })).ok, false);
  assert.equal((await requestNativeNimPayment({ recipient, amountLuna: '100000', orderNumber: '#T1', publicToken: order.publicToken, network: 'nimiq-testnet' })).ok, false);
  assert.equal((await requestNativePolygonUsdtPayment({ recipient: '0x' + '1'.repeat(40), amountMicro: '1', network: 'polygon-mainnet', intentMessage: '', authorizeIntent: async () => assert.fail() })).ok, false);
});

test('confirmed is terminal; bad/pending evidence never reserves a hash', () => {
  for (const status of ['pending', 'unverified', 'rpc_timeout', 'failed'] as const) {
    const evidence = { txHash: hash, network: order.network, executionStatus: status, recipient, amountBase: 0n };
    assert.equal(reconcilePaymentVerification({ order: { ...order, paymentStatus: 'confirmed' }, evidence, claimedTxOrderMap: new Map() }).paymentStatus, 'confirmed');
    assert.equal(reconcilePaymentVerification({ order, evidence, claimedTxOrderMap: new Map() }).shouldBindTxHash, false);
  }
});

test('Amoy requires signed payer, canonical block, five confirmations and matching token event', async () => {
  const payer = Wallet.createRandom().address;
  const token = '0x' + '2'.repeat(40), target = '0x' + '3'.repeat(40), txHash = '0x' + hash;
  const o = { ...order, asset: 'USDT', network: 'polygon-amoy', snapshotRecipient: target, snapshotTokenContract: token, payerAddress: payer } as OrderSnapshot;
  const topic = (a: string) => '0x' + a.slice(2).toLowerCase().padStart(64, '0');
  const responses: Record<string, any> = { eth_chainId: '0x13882', eth_blockNumber: '0xe', eth_getBlockByNumber: { hash: 'block', timestamp: '0x' + Math.floor(now / 1000).toString(16) }, eth_getTransactionByHash: { from: payer }, eth_getTransactionReceipt: { transactionHash: txHash, blockNumber: '0xa', blockHash: 'block', status: '0x1', logs: [{ address: token, topics: [ERC20_TRANSFER_TOPIC, topic(payer), topic(target)], data: '0x' + BigInt(order.amountBase).toString(16).padStart(64, '0') }] } };
  const call = async (_url: string, method: string) => responses[method];
  assert.equal((await readPaymentEvidence(o, txHash, urls, call)).executionStatus, 'confirmed');
  assert.equal((await readPaymentEvidence({ ...o, payerAddress: undefined }, txHash, urls, call)).executionStatus, 'unverified');
  responses.eth_blockNumber = '0xc'; assert.equal((await readPaymentEvidence(o, txHash, urls, call)).executionStatus, 'pending');
  responses.eth_blockNumber = '0xe'; responses.eth_getBlockByNumber.hash = 'reorg';
  assert.equal((await readPaymentEvidence(o, txHash, urls, call)).executionStatus, 'unverified');
});

test('HTTP regression: no CAPTCHA dependency, private MFA, malformed bodies, no simulation, isolation and testnet lock', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nimtera-test-'));
  process.env.NODE_ENV = 'test'; process.env.NIMTERA_DATA_FILE = path.join(dir, 'store.json'); process.env.SESSION_SECRET = 'fixture-only-'.repeat(8);
  delete process.env.TURNSTILE_SECRET_KEY; delete process.env.VITE_TURNSTILE_SITE_KEY; delete process.env.TURNSTILE_ALLOWED_HOSTNAMES;
  process.env.POLYGON_AMOY_RPC_URL = 'https://fixture.invalid';
  process.env.POLYGON_AMOY_TEST_TOKEN_CONTRACT = '0x' + '2'.repeat(40);
  const { createApp, generateTotpCode } = await import('../server');
  const app = await createApp(); const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address() as { port: number }; const base = `http://127.0.0.1:${address.port}`;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('challenges.cloudflare.com')) assert.fail('CAPTCHA must not be contacted');
    return original(url, options);
  };
  const req = async (route: string, body?: unknown, token?: string, method?: string) => {
    const response = await fetch(base + route, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  try {
    const account = { email: 'fixture@example.test', password: 'Private#TestPassword!2026', storeName: 'Fixture', storeSlug: 'fixture', nimiqAddress: recipient, polygonAddress: '0x' + '3'.repeat(40) };
    assert.equal((await req('/api/auth/register', { ...account, password: 'short' })).status, 400);
    const registered = await req('/api/auth/register', account);
    assert.equal(registered.status, 201); assert.ok(registered.body.enrollment.uri.startsWith('otpauth://'));
    const session = registered.body.token;
    assert.equal((await req('/api/seller/dashboard', undefined, session)).status, 403);
    const security = await req('/api/auth/security-status'); assert.equal(security.body.demoTotpCurrentCode, undefined); assert.equal(security.body.captchaRequired, false); assert.equal(security.body.turnstileSiteKey, undefined); assert.equal(security.body.domainCanonical, undefined); assert.equal(security.body.emailVerificationConfigured, undefined);
    assert.equal((await req('/api/auth/mfa/enrollment')).status, 401);
    const data = JSON.parse(fs.readFileSync(process.env.NIMTERA_DATA_FILE!, 'utf8'));
    assert.equal((await req('/api/auth/mfa/confirm', { totpCode: generateTotpCode(data.sellers[0].totpSecretHex) }, session)).status, 200);
    assert.equal((await req('/api/seller/dashboard', undefined, session)).status, 200);
    const sharp=(await import('sharp')).default;
    const photoBytes=await sharp({create:{width:40,height:40,channels:3,background:'orange'}}).png().toBuffer();
    const photo=await req('/api/seller/product-images',{imageData:'data:image/png;base64,'+photoBytes.toString('base64')},session);
    assert.equal(photo.status,201);assert.match(photo.body.imageUrl,/^\/api\/product-images\//);
    const logoSaved=await req('/api/seller/store-logo',{logoUrl:photo.body.imageUrl},session,'PATCH');assert.equal(logoSaved.status,200);assert.equal(logoSaved.body.store.logoUrl,photo.body.imageUrl);
    assert.equal((await req('/api/seller/store-logo',{logoUrl:'https://evil.test/logo.svg'},session,'PATCH')).status,400);
    const publicPhoto=await fetch(base+photo.body.imageUrl);assert.equal(publicPhoto.status,200);assert.match(publicPhoto.headers.get('content-type')!,/image\/webp/);
    assert.equal((await req('/api/seller/product-images',{imageData:'data:image/svg+xml;base64,AAAA'},session)).status,400);
    assert.equal((await req('/api/seller/product-images',{imageData:'invalid'})).status,401);
    const product = await req('/api/seller/products', { name: 'Test item', imageUrl:photo.body.imageUrl, priceNimLuna: '100000', priceUsdtMicro: '1000000' }, session);
    assert.equal(product.status, 201);
    assert.equal((await req(`/api/seller/products/${product.body.product.id}`, { name: 'Rejected mutation', priceNimLuna: '0', priceUsdtMicro: '0' }, session, 'PUT')).status, 400);
    assert.equal((await req('/api/seller/dashboard', undefined, session)).body.products[0].name, 'Test item');
    const cart = { asset: 'NIM', items: [{ productId: product.body.product.id, quantity: 1 }], fulfillmentMode: 'pickup' };
    assert.equal((await req('/api/public/stores/fixture/orders', { ...cart, environment: 'mainnet' })).status, 403);
    const created = await req('/api/public/stores/fixture/orders', { ...cart, environment: 'testnet' }); assert.equal(created.status, 201);
    const verifyPath = `/api/public/orders/${created.body.order.publicToken}/verify`;
    assert.equal((await req(verifyPath, { txHash: hash, sandboxSimulation: { executionStatus: 'confirmed' } })).status, 400);
    assert.equal((await req(verifyPath, { txHash: {} })).status, 400);
    assert.equal((await req('/api/auth/security-status')).status, 200); // process is alive
    assert.equal((await req('/api/auth/login', { ...account, totpCode: '999999' })).status, 401);
    const loggedIn = await req('/api/auth/login', { email:account.email, password:account.password, totpCode:generateTotpCode(data.sellers[0].totpSecretHex), storeName:'Login must not rename the shop' });
    assert.equal(loggedIn.status,200); assert.equal(loggedIn.body.store.name,'Fixture');
    const setCookie=loggedIn.headers.get('set-cookie')!;
    assert.match(setCookie,/HttpOnly/); assert.match(setCookie,/SameSite=Lax/); assert.match(setCookie,/Max-Age=/); assert.ok(Number(setCookie.match(/Max-Age=(\d+)/)![1])<=28800); assert.doesNotMatch(setCookie,/Domain=/);
    const cookie=setCookie.split(';')[0];
    for (let i=0;i<3;i++) {
      const restored=await fetch(base+'/api/auth/session',{headers:{Cookie:cookie}});
      assert.equal(restored.status,200); const sessionData=await restored.json();
      assert.equal(sessionData.store.name,'Fixture'); assert.equal(sessionData.mfaVerified,true); assert.equal(sessionData.token,undefined);
    }
    const crossOrigin=await fetch(base+'/api/auth/logout',{method:'POST',headers:{Cookie:cookie,Origin:'https://attacker.invalid','Content-Type':'application/json'},body:'{}'});
    assert.equal(crossOrigin.status,403);
    assert.equal((await fetch(base+'/api/seller/dashboard',{headers:{Cookie:cookie}})).status,200);
    const loggedOut=await fetch(base+'/api/auth/logout',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{}'});
    assert.equal(loggedOut.status,200); assert.match(loggedOut.headers.get('set-cookie')!,/Expires=Thu, 01 Jan 1970/);
    assert.equal((await fetch(base+'/api/auth/session',{headers:{Cookie:cookie}})).status,401);

    const second = await req('/api/auth/register', { ...account, email: 'other@example.test', storeSlug: 'other' });
    const secondData = JSON.parse(fs.readFileSync(process.env.NIMTERA_DATA_FILE!, 'utf8'));
    await req('/api/auth/mfa/confirm', { totpCode: generateTotpCode(secondData.sellers[1].totpSecretHex) }, second.body.token);
    assert.equal((await req('/api/seller/store-logo',{logoUrl:photo.body.imageUrl},second.body.token,'PATCH')).status,400);
    assert.equal((await req('/api/seller/products',{name:'Stolen photo',imageUrl:photo.body.imageUrl,priceNimLuna:'100000'},second.body.token)).status,400);
    assert.equal((await req(`/api/seller/products/${product.body.product.id}`, { name: 'Stolen' }, second.body.token, 'PUT')).status, 403);
    assert.equal((await req('/api/seller/network-environment', { environment: 'mainnet' }, session, 'PATCH')).status, 403);
    assert.ok(!JSON.stringify((await req(`/api/public/orders/${created.body.order.publicToken}`)).body).includes('totpSecret'));
    const usdtInvoice = await req('/api/public/stores/fixture/orders', { ...cart, asset: 'USDT', environment: 'testnet' });
    assert.equal(usdtInvoice.status, 201);
    const signed = Wallet.createRandom();
    const intentPath = `/api/public/orders/${usdtInvoice.body.order.publicToken}/intent`;
    const signature = await signed.signMessage(paymentIntentMessage(usdtInvoice.body.order));
    assert.equal((await req(intentPath, { sender: signed.address, signature })).status, 200);
    const wrongInvoiceSignature = await signed.signMessage(paymentIntentMessage(order));
    assert.equal((await req(intentPath, { sender: signed.address, signature: wrongInvoiceSignature })).status, 409);
    const attacker = Wallet.createRandom();
    assert.equal((await req(intentPath, { sender: attacker.address, signature: await attacker.signMessage(paymentIntentMessage(usdtInvoice.body.order)) })).status, 409);
    const throttled: number[] = [];
    for (let i = 0; i < 4; i++) throttled.push((await req('/api/auth/login', { email: 'unknown@example.test', password: 'Wrong#PasswordForTest!2026', totpCode: '000000' })).status);
    assert.deepEqual(throttled, [401, 401, 401, 429]); // Removing CAPTCHA does not remove brute-force protection.

  } finally {
    globalThis.fetch = original; await new Promise<void>(r => server.close(() => r())); fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('native NIM sends a string memo once, reuses hash without replay, and blocks unknown outcomes', async () => {
  const globals = globalThis as any;
  const previous = new Map(['window', 'navigator', 'localStorage'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const storage = new Map<string, string>(); let sends = 0;
  const provider = { sendBasicTransactionWithData: async (args: any) => { sends++; assert.equal(typeof args.data, 'string'); assert.ok(args.data.includes(order.publicToken)); return { hash }; } };
  Object.defineProperty(globals, 'window', { configurable: true, value: { nimiq: provider, nimiqPay: { network: 'testnet' } } });
  Object.defineProperty(globals, 'navigator', { configurable: true, value: { locks: { request: async (_key: string, _opts: unknown, cb: any) => cb({}) } } });
  Object.defineProperty(globals, 'localStorage', { configurable: true, value: { getItem: (k: string) => storage.get(k) || null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) } });
  try {
    const p = { recipient, amountLuna: '100000', orderNumber: order.orderNumber, publicToken: order.publicToken, network: 'nimiq-testnet' as const };
    assert.equal((await requestNativeNimPayment(p)).txHash, hash); assert.equal(sends, 1);
    assert.equal((await requestNativeNimPayment(p)).txHash, hash); assert.equal(sends, 1);
    storage.set(`nimtera.payment:nimiq-testnet:${p.publicToken}`, JSON.stringify({ awaiting: true }));
    assert.equal((await requestNativeNimPayment(p)).ok, false); assert.equal(sends, 1);
    globals.window.nimiqPay.network = 'mainnet'; assert.equal((await requestNativeNimPayment(p)).ok, false); assert.equal(sends, 1);
    globals.window.ethereum = { request: async ({ method }: { method: string }) => { assert.equal(method, 'eth_chainId'); return '0x89'; } };
    assert.equal((await requestNativePolygonUsdtPayment({ recipient: '0x' + '3'.repeat(40), amountMicro: '100', network: 'polygon-amoy', tokenContract: '0x' + '2'.repeat(40), intentMessage: 'test', authorizeIntent: async () => assert.fail('wrong-chain signature must not run') })).ok, false);
  } finally {
    for (const [k, descriptor] of previous) { if (descriptor) Object.defineProperty(globals, k, descriptor); else delete globals[k]; }
  }
});
