import { normalizeProductImage, saveProductImage, readProductImage, validProductImageUrl } from './src/server/productImages.js';
import { requestState, scopedDatabase, scopedMap } from './src/server/requestState.js';
import { verifyMessage } from 'ethers';
import { readPaymentEvidence, paymentIntentMessage } from './src/server/payments.js';
import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  calculateCartTotals,
  createValidNimiqAddress,
  DEFAULT_NETWORK_ENV,
  ERC20_TRANSFER_TOPIC,
  formatAssetAmount,
  getAssetLabelForEnvironment,
  getNetworkEnvironment,
  NETWORK_CONFIGS,
  POLYGON_AMOY_CHAIN_ID,
  POLYGON_MAINNET_CHAIN_ID,
  POLYGON_USDT_CONTRACT,
  reconcilePaymentVerification,
  resolveNetworkId,
  validateAmoyTestTokenContract,
  validateNimiqAddress,
  validatePolygonAddress,
  validateSellerPassword,
  type CartItemInput,
  type FulfillmentMode,
  type FulfillmentStatus,
  type NetworkEnvironment,
  type NetworkId,
  type OnChainTxEvidence,
  type OrderSnapshot,
  type PaymentAsset,
  type ProductRecord,
} from './src/lib/domain.js';
import type { SupportedLocale } from './src/lib/i18n.js';

const PORT = Number(process.env.PORT || 3000);
const TESTNET_ONLY = true;
const DATA_FILE = path.resolve(process.env.NIMTERA_DATA_FILE || '.data/store.json');

// Strictly separated allowlisted upstream RPC URLs per network (no cross-network fallback)
const ALLOWLISTED_NIMIQ_TESTNET_RPC =
  process.env.NIMIQ_TESTNET_RPC_URL || NETWORK_CONFIGS['nimiq-testnet'].defaultRpcUrl;
const ALLOWLISTED_NIMIQ_MAINNET_RPC =
  process.env.NIMIQ_MAINNET_RPC_URL || NETWORK_CONFIGS['nimiq-mainnet'].defaultRpcUrl;
const ALLOWLISTED_POLYGON_AMOY_RPC =
  process.env.POLYGON_AMOY_RPC_URL || NETWORK_CONFIGS['polygon-amoy'].defaultRpcUrl;
const ALLOWLISTED_POLYGON_MAINNET_RPC =
  process.env.POLYGON_MAINNET_RPC_URL || NETWORK_CONFIGS['polygon-mainnet'].defaultRpcUrl;

export interface StoreRecord {
  slug: string;
  name: string;
  sellerId: string;
  logoUrl?: string;
  /** Active operating environment for new orders ('testnet' default in development, 'mainnet' for production) */
  activeEnvironment: NetworkEnvironment;
  /** Mainnet Recipient Wallet Profile */
  nimiqAddress: string | null;
  polygonAddress: string | null;
  /** Testnet Recipient Wallet Profile (Strictly separated from Mainnet) */
  nimiqTestnetAddress: string | null;
  polygonAmoyAddress: string | null;
  /** Optional 6-decimal ERC-20 TEST TOKEN contract on Polygon Amoy (Chain ID 80002). Must NEVER equal Mainnet USDT contract */
  polygonAmoyTestTokenContract: string | null;
  supportsPickup: boolean;
  supportsDelivery: boolean;
  supportsDineIn: boolean;
  defaultLocale: SupportedLocale;
  voiceLocale: SupportedLocale;
  createdAt: string;
  updatedAt: string;
}

export interface SellerAccount {
  id: string;
  email: string;
  passwordSalt: string;
  passwordHash: string;
  totpSecretHex: string;
  totpEnabled: boolean;
  emailVerified: boolean;
  storeSlug: string;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  storeSlug: string;
  sellerEmail: string;
  action: string;
  details: string;
  oldValue?: string;
  newValue?: string;
  createdAt: string;
}

interface SessionRecord {
  mfaVerified: boolean;
  token: string;
  sellerId: string;
  storeSlug: string;
  email: string;
  expiresAt: number;
}

interface DatabaseState {
  sellers: SellerAccount[];
  stores: StoreRecord[];
  products: ProductRecord[];
  orders: OrderSnapshot[];
  auditLogs: AuditLogEntry[];
  /** Lowercase txHash -> orderId unique binding */
  claimedTransactions: Record<string, string>;
  orderSequenceByStore: Record<string, number>;
}

// Cryptographic password hashing via Node.js scrypt
function hashPassword(password: string, saltHex?: string): { salt: string; hash: string } {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash: derived };
}

function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const derived = crypto.scryptSync(password, salt, 64);
  const expectedBuf = Buffer.from(expectedHash, 'hex');
  if (derived.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(derived, expectedBuf);
}

// RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30s step)
export function generateTotpCode(secretHex: string, timestampMs = Date.now()): string {
  const counter = Math.floor(timestampMs / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter), 0);
  const hmac = crypto.createHmac('sha1', Buffer.from(secretHex, 'hex')).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    (((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)) %
    1_000_000;
  return code.toString().padStart(6, '0');
}

function verifyTotpCode(secretHex: string, inputCode: string, nowMs = Date.now()): boolean {
  const clean = inputCode.trim();
  if (!/^\d{6}$/.test(clean)) return false;
  for (const offsetSteps of [-1, 0, 1]) {
    const candidate = generateTotpCode(secretHex, nowMs + offsetSteps * 30_000);
    if (candidate === clean) return true;
  }
  return false;
}

export function emptyDatabase(): DatabaseState {
  return { sellers: [], stores: [], products: [], orders: [], auditLogs: [], claimedTransactions: {}, orderSequenceByStore: {} };
}
function loadDatabase(): DatabaseState {
  if (!fs.existsSync(DATA_FILE)) return emptyDatabase();
  const state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as DatabaseState;
  if (!Array.isArray(state.sellers) || !Array.isArray(state.orders) || !Array.isArray(state.stores)) throw new Error('Invalid database; refusing to restore demo data.');
  return state;
}
function saveDatabase(state: DatabaseState) {
  if (requestState.getStore()) return; // The cloud transaction commits atomically before the response.
  if (process.env.VERCEL) throw new Error('Cloud writes require a PostgreSQL transaction.');
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true, mode: 0o700 });
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(tmp, DATA_FILE);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch {}
    throw new Error('Database write failed; operation is not durable.', { cause: error });
  }
}

const db = scopedDatabase(process.env.VERCEL ? emptyDatabase() : loadDatabase());
const sessions = scopedMap<string, SessionRecord>('sessions');

// Progressive rate limiting / backoff state per IP/identifier
const loginRateLimits = scopedMap<string, { failures: number; lockedUntilMs: number }>('loginRateLimits');
const publicEndpointRateLimits = scopedMap<string, { count: number; windowStartMs: number }>('publicEndpointRateLimits');

function checkPublicRateLimit(ip: string, maxPerMinute = 90): boolean {
  const now = Date.now();
  const rec = publicEndpointRateLimits.get(ip);
  if (!rec || now - rec.windowStartMs > 60_000) {
    publicEndpointRateLimits.set(ip, { count: 1, windowStartMs: now });
    return true;
  }
  rec.count += 1;
  return rec.count <= maxPerMinute;
}

function createSignedSessionToken(sellerId: string, storeSlug: string): string {
  const nonce = crypto.randomBytes(24).toString('hex');
  const payload = `nt_sess_${nonce}`;
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 64) throw new Error('SESSION_SECRET must contain at least 64 characters.');
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${payload}:${sellerId}:${storeSlug}`)
    .digest('hex');
  return `${payload}.${sig}`;
}

function verifySessionSignature(session: SessionRecord): boolean {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 64 || !session.token.includes('.')) return false;
  const [payload, sig] = session.token.split('.');
  if (!payload || !sig) return false;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(`${payload}:${session.sellerId}:${session.storeSlug}`)
    .digest('hex');
  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expectedSig, 'hex');
  if (sigBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expectedBuf);
}

// Pre-create a convenient active session token when requested via login
interface AuthedRequest extends Request {
  sellerSession?: SessionRecord;
}

const SELLER_COOKIE = 'nimtera_seller_session';
function cookieOptions(req: Request) {
  return { httpOnly: true, secure: Boolean(process.env.VERCEL) || req.secure, sameSite: 'lax' as const, path: '/' };
}
function setSellerCookie(req: Request, res: Response, session: SessionRecord) {
  res.cookie(SELLER_COOKIE, session.token, { ...cookieOptions(req), maxAge: Math.max(0, session.expiresAt - Date.now()) });
}
function sellerCookieToken(req: Request): string {
  try { return decodeURIComponent((req.headers.cookie || '').match(/(?:^|;\s*)nimtera_seller_session=([^;]*)/)?.[1] || ''); } catch { return ''; }
}

function requireSession(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : sellerCookieToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please sign in to the Seller Console.' });
    return;
  }
  const session = sessions.get(token);
  if (!session || Date.now() > session.expiresAt || !verifySessionSignature(session)) {
    sessions.delete(token);
    if (!authHeader) res.clearCookie(SELLER_COOKIE, cookieOptions(req));
    res.status(401).json({ error: 'Seller session expired or invalid. Please sign in again.' });
    return;
  }
  req.sellerSession = session;
  next();
}

function requireSellerAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  requireSession(req, res, () => {
    const seller = db.sellers.find(s => s.id === req.sellerSession?.sellerId);
    if (!seller?.totpEnabled || !req.sellerSession?.mfaVerified) { res.status(403).json({ error: 'Complete authenticator enrollment first.' }); return; }
    next();
  });
}
function enrollmentDetails(seller: SellerAccount) {
  const bytes = Buffer.from(seller.totpSecretHex, 'hex');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const b of bytes) bits += b.toString(2).padStart(8,'0');
  let secret = ''; for (let i=0;i<bits.length;i+=5) secret += alphabet[parseInt(bits.slice(i,i+5).padEnd(5,'0'),2)];
  return { secret, uri: `otpauth://totp/NimTera:${encodeURIComponent(seller.email)}?secret=${secret}&issuer=NimTera&algorithm=SHA1&digits=6&period=30` };
}

const verifyingOrders = new Set<string>();
const rpcUrls: Record<string, string> = { 'nimiq-testnet': ALLOWLISTED_NIMIQ_TESTNET_RPC, 'polygon-amoy': ALLOWLISTED_POLYGON_AMOY_RPC };
export async function verifyOrderPayment(order: OrderSnapshot, hash: string) {
  if (order.paymentStatus === 'confirmed') return;
  if (verifyingOrders.has(order.id)) throw new Error('Verification already running; retry the read later.');
  verifyingOrders.add(order.id);
  try {
    order.paymentVerificationAttemptedAt = new Date().toISOString();
    const evidence = await readPaymentEvidence(order, hash, rpcUrls);
    const key = `${order.network}:${hash.toLowerCase()}`;
    const claimed = new Map(Object.entries(db.claimedTransactions));
    // Domain helper keys must also be namespaced by network.
    const outcome = reconcilePaymentVerification({ order, evidence: { ...evidence, txHash: key }, claimedTxOrderMap: claimed });
    if (outcome.shouldBindTxHash) db.claimedTransactions[key] = order.id;
    if (['pending','rpc_timeout'].includes(evidence.executionStatus)) {
      order.txHash = hash;
    } else if (outcome.paymentStatus === 'confirmed') {
      order.txHash = hash;
      order.verifiedAt = new Date().toISOString();
    }
    order.paymentStatus = outcome.paymentStatus;
    order.paymentReviewReason = outcome.reviewReason;
    saveDatabase(db);
  } finally { verifyingOrders.delete(order.id); }
}
export async function reconcilePendingPayments() {
  for (const order of db.orders.filter(o => o.environment === 'testnet' && o.txHash && o.paymentStatus === 'pending').slice(0, 50)) {
    try { await verifyOrderPayment(order, order.txHash!); } catch { /* pending reads retry on the next bounded tick */ }
  }
}

export async function createApp(options: { apiOnly?: boolean } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.VERCEL) app.set('trust proxy', 1);
  const asyncRoute = (fn: (req: Request, res: Response, next: NextFunction) => unknown) =>
    (req: Request, res: Response, next: NextFunction) => Promise.resolve().then(() => fn(req, res, next)).catch(next);
  app.use(express.json({ limit: '256kb' }));

  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && (() => { try { return new URL(origin).host !== req.get('host'); } catch { return true; } })())) {
        res.status(403).json({ error: 'Cross-origin account and order changes are not allowed.' }); return;
      }
    }
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      const b = req.body;
      if (!b || typeof b !== 'object' || Array.isArray(b)) { res.status(400).json({ error: 'JSON object required.' }); return; }
      if (b.environment !== undefined && !['testnet','mainnet'].includes(b.environment)) { res.status(400).json({ error: 'Unknown environment.' }); return; }
      for (const k of ['defaultLocale','voiceLocale']) if (b[k] !== undefined && !['en','id','zh-CN','vi','ms','ru'].includes(b[k])) { res.status(400).json({ error: 'Unsupported language.' }); return; }
      if ('sandboxSimulation' in b) { res.status(400).json({ error: 'Client-supplied payment evidence is not accepted.' }); return; }
      const strings = ['email','password','currentPassword','totpCode','storeName','storeSlug','name','description','category','imageUrl','priceNimLuna','priceUsdtMicro','txHash','asset','environment','fulfillmentMode','fulfillmentStatus','tableOrNote','manualPaymentNote','defaultLocale','voiceLocale','sender','signature'];
      for (const k of strings) if (b[k] !== undefined && (typeof b[k] !== 'string' || b[k].length > (k === 'imageUrl' ? 2048 : 4096))) { res.status(400).json({ error: `Invalid ${k}.` }); return; }
      for (const k of ['nimiqAddress','polygonAddress','nimiqTestnetAddress','polygonAmoyAddress','polygonAmoyTestTokenContract']) if (b[k] !== undefined && b[k] !== null && (typeof b[k] !== 'string' || b[k].length > 128)) { res.status(400).json({ error: `Invalid ${k}.` }); return; }
      for (const k of ['supportsPickup','supportsDelivery','supportsDineIn','available']) if (b[k] !== undefined && typeof b[k] !== 'boolean') { res.status(400).json({ error: `Invalid ${k}.` }); return; }
      for (const k of ['priceNimLuna','priceUsdtMicro']) if (b[k] && (!/^[0-9]{1,30}$/.test(b[k]) || BigInt(b[k]) > BigInt(Number.MAX_SAFE_INTEGER))) { res.status(400).json({ error: 'Invalid price.' }); return; }
      if (b.items !== undefined && (!Array.isArray(b.items) || b.items.length > 100 || b.items.some((x: any) => !x || typeof x.productId !== 'string' || !Number.isSafeInteger(x.quantity) || x.quantity < 1 || x.quantity > 99))) { res.status(400).json({ error: 'Invalid cart items.' }); return; }
      if (b.deliveryInfo !== undefined && (!b.deliveryInfo || typeof b.deliveryInfo !== 'object' || Array.isArray(b.deliveryInfo) || ['recipientName','phone','address'].some(k => typeof b.deliveryInfo[k] !== 'string' || b.deliveryInfo[k].length > 500))) { res.status(400).json({ error: 'Invalid delivery information.' }); return; }
      if ((req.path.startsWith('/auth/') || req.path.endsWith('/verify') || req.path.endsWith('/intent') || req.path.endsWith('/wallets')) && !checkPublicRateLimit(req.ip || 'local', 60)) { res.status(429).json({ error: 'Too many attempts. Please wait.' }); return; }
    }
    next();
  });

  // Basic security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.get('/api/health', (_req, res) => {
    const configured = {
      database: true,
      sessionSecret: Boolean(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 64),
    };
    const ready = configured.sessionSecret;
    res.status(ready ? 200 : 503).json({ ready, configured, databaseReachable: true, testnetOnly: true, storage: 'local-single-server', nativeDeviceValidated: false });
  });

  // 1. Honest Auth & Security Setup Status Endpoint
  app.get('/api/auth/security-status', (_req, res) => {
    res.json({ passwordMinLength: 15, totp2faRequired: true, rateLimitActive: true,
      captchaRequired: false,
      testnetOnly: true });
  });

  // 2. Seller login authenticates the existing account; it never renames its shop.
  app.post('/api/auth/login', asyncRoute(async (req, res) => {
    const ip = req.ip || 'local';
    const { email, password, totpCode } = req.body as {
      email?: string;
      password?: string;
      totpCode?: string;
    };

    const cleanEmail = (email || '').trim().toLowerCase();
    const rateKey = `${ip}:${cleanEmail}`;
    const limitState = loginRateLimits.get(rateKey);
    if (limitState && Date.now() < limitState.lockedUntilMs) {
      const waitSec = Math.ceil((limitState.lockedUntilMs - Date.now()) / 1000);
      res.status(429).json({
        error: `Too many failed login attempts. Progressive backoff active — please wait ${waitSec} seconds.`,
      });
      return;
    }


    const passCheck = validateSellerPassword(password || '');
    if (!passCheck.valid) {
      res.status(400).json({ error: passCheck.reason });
      return;
    }

    const seller = db.sellers.find((s) => s.email.toLowerCase() === cleanEmail);
    if (!seller || !verifyPassword(password || '', seller.passwordSalt, seller.passwordHash)) {
      const failures = (limitState?.failures || 0) + 1;
      const backoffMs = Math.min(60_000, Math.pow(2, failures) * 1000);
      loginRateLimits.set(rateKey, {
        failures,
        lockedUntilMs: failures >= 3 ? Date.now() + backoffMs : 0,
      });
      res.status(401).json({ error: 'Invalid merchant email or password.' });
      return;
    }

    if (seller.totpEnabled && !verifyTotpCode(seller.totpSecretHex, totpCode || '')) {
      const failures = (limitState?.failures || 0) + 1;
      loginRateLimits.set(rateKey, { failures, lockedUntilMs: failures >= 3 ? Date.now() + Math.min(60000, 2 ** Math.min(failures, 10) * 1000) : 0 });
      res.status(401).json({
        error: 'Invalid 6-digit 2FA Authenticator code.',
      });
      return;
    }

    loginRateLimits.delete(rateKey);

    const sessionToken = createSignedSessionToken(seller.id, seller.storeSlug);
    const session: SessionRecord = {
      token: sessionToken,
      mfaVerified: seller.totpEnabled,
      sellerId: seller.id,
      storeSlug: seller.storeSlug,
      email: seller.email,
      expiresAt: Date.now() + 8 * 60 * 60 * 1000, // 8 hours
    };
    sessions.set(sessionToken, session);

    const store = db.stores.find((st) => st.slug === seller.storeSlug);
    setSellerCookie(req, res, session);

    res.json({
      token: sessionToken,
      seller: {
        id: seller.id,
        email: seller.email,
        storeSlug: seller.storeSlug,
        totpEnabled: seller.totpEnabled,
        emailVerified: seller.emailVerified,
      },
      store,
      enrollment: seller.totpEnabled ? undefined : enrollmentDetails(seller),
    });
  }));

  app.get('/api/auth/session', requireSession, (req: AuthedRequest, res) => {
    const session = req.sellerSession!;
    const seller = db.sellers.find(item => item.id === session.sellerId);
    const store = db.stores.find(item => item.slug === session.storeSlug);
    if (!seller || !store) { res.status(401).json({ error: 'Account session is unavailable. Please sign in again.' }); return; }
    setSellerCookie(req, res, session); // Migrate valid legacy Bearer sessions without extending their expiry.
    res.json({ seller: { email: seller.email, storeSlug: seller.storeSlug }, store, mfaVerified: session.mfaVerified, expiresAt: session.expiresAt });
  });

  // Update Seller Restaurant / Store Name directly
  app.patch('/api/seller/store-name', requireSellerAuth, (req: AuthedRequest, res) => {
    const storeSlug = req.sellerSession!.storeSlug;
    const store = db.stores.find((st) => st.slug === storeSlug);
    if (!store) {
      res.status(404).json({ error: 'Store not found.' });
      return;
    }
    const { storeName } = req.body as { storeName?: string };
    const cleanName = (storeName || '').trim().slice(0, 60);
    if (!cleanName) {
      res.status(400).json({ error: 'Restaurant / store name cannot be empty.' });
      return;
    }
    store.name = cleanName;
    store.updatedAt = new Date().toISOString();
    saveDatabase(db);
    res.json({ store });
  });

  app.patch('/api/seller/store-logo', requireSellerAuth, asyncRoute(async (req: AuthedRequest, res) => {
    const owner=req.sellerSession!.storeSlug;
    const store=db.stores.find(st=>st.slug===owner);
    if(!store) {res.status(404).json({error:'Store not found.'});return;}
    const logo=req.body.logoUrl;
    if(typeof logo!=='string' || (logo!=='' && (!/^\/api\/product-images\/[a-f0-9]{32}\.webp$/.test(logo) || !await validProductImageUrl(logo,owner)))) {
      res.status(400).json({error:'Upload a logo to your own shop first.'});return;
    }
    store.logoUrl=logo || undefined;store.updatedAt=new Date().toISOString();saveDatabase(db);res.json({store});
  }));

  // 3. Seller Onboarding / New Store Registration
  app.post('/api/auth/register', asyncRoute(async (req, res) => {
    const ip = req.ip || 'local';
    if (!checkPublicRateLimit(ip, 20)) {
      res.status(429).json({ error: 'Rate limit exceeded. Try again in a minute.' });
      return;
    }

    const {
      email,
      password,
      storeName,
      storeSlug,
      nimiqAddress,
      polygonAddress,
      supportsPickup,
      supportsDelivery,
      defaultLocale,
    } = req.body as {
      email?: string;
      password?: string;
      storeName?: string;
      storeSlug?: string;
      nimiqAddress?: string;
      polygonAddress?: string;
      supportsPickup?: boolean;
      supportsDelivery?: boolean;
      defaultLocale?: SupportedLocale;
    };


    const cleanEmail = (email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({ error: 'Valid merchant email is required.' });
      return;
    }
    if (db.sellers.some((s) => s.email.toLowerCase() === cleanEmail)) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const passCheck = validateSellerPassword(password || '');
    if (!passCheck.valid) {
      res.status(400).json({ error: passCheck.reason });
      return;
    }

    const cleanSlug = (storeSlug || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (cleanSlug.length < 3 || cleanSlug.length > 40) {
      res.status(400).json({ error: 'Store slug must be between 3 and 40 characters.' });
      return;
    }
    if (db.stores.some((st) => st.slug === cleanSlug)) {
      res.status(409).json({ error: 'Store slug is already taken. Choose another unique slug.' });
      return;
    }

    let normalizedNimiq: string | null = null;
    if (nimiqAddress && nimiqAddress.trim()) {
      const nimCheck = validateNimiqAddress(nimiqAddress);
      if (!nimCheck.valid) {
        res.status(400).json({ error: `Nimiq address invalid: ${nimCheck.reason}` });
        return;
      }
      normalizedNimiq = nimCheck.normalized;
    }

    let normalizedPoly: string | null = null;
    if (polygonAddress && polygonAddress.trim()) {
      const polyCheck = validatePolygonAddress(polygonAddress);
      if (!polyCheck.valid) {
        res.status(400).json({ error: `Polygon USDT address invalid: ${polyCheck.reason}` });
        return;
      }
      normalizedPoly = polyCheck.normalized;
    }

    if (!normalizedNimiq && !normalizedPoly) {
      res.status(400).json({
        error: 'At least one recipient wallet (Nimiq NIM or Polygon USDT) must be configured.',
      });
      return;
    }

    const { salt, hash } = hashPassword(password!);
    const totpSecretHex = crypto.randomBytes(20).toString('hex');
    const sellerId = `sel_${crypto.randomBytes(8).toString('hex')}`;
    const nowIso = new Date().toISOString();

    const newSeller: SellerAccount = {
      id: sellerId,
      email: cleanEmail,
      passwordSalt: salt,
      passwordHash: hash,
      totpSecretHex,
      totpEnabled: false,
      emailVerified: false,
      storeSlug: cleanSlug,
      createdAt: nowIso,
    };

    const newStore: StoreRecord = {
      slug: cleanSlug,
      name: (storeName || cleanSlug).trim().slice(0, 60),
      sellerId,
      activeEnvironment: DEFAULT_NETWORK_ENV,
      nimiqAddress: null,
      polygonAddress: null,
      nimiqTestnetAddress: normalizedNimiq,
      polygonAmoyAddress: normalizedPoly,
      polygonAmoyTestTokenContract: process.env.POLYGON_AMOY_TEST_TOKEN_CONTRACT || null,
      supportsPickup: supportsPickup ?? true,
      supportsDelivery: supportsDelivery ?? false,
      supportsDineIn: true,
      defaultLocale: defaultLocale || 'en',
      voiceLocale: defaultLocale || 'en',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    db.sellers.push(newSeller);
    db.stores.push(newStore);
    db.orderSequenceByStore[cleanSlug] = 0;
    db.auditLogs.unshift({
      id: `aud_${crypto.randomBytes(6).toString('hex')}`,
      storeSlug: cleanSlug,
      sellerEmail: cleanEmail,
      action: 'STORE_ONBOARDED',
      details: 'Store created and initial recipient wallets verified.',
      newValue: `${normalizedNimiq || 'None'} | ${normalizedPoly || 'None'}`,
      createdAt: nowIso,
    });
    saveDatabase(db);

    const sessionToken = createSignedSessionToken(sellerId, cleanSlug);
    sessions.set(sessionToken, {
      token: sessionToken,
      mfaVerified: false,
      sellerId,
      storeSlug: cleanSlug,
      email: cleanEmail,
      expiresAt: Date.now() + 8 * 60 * 60 * 1000,
    });

    setSellerCookie(req, res, sessions.get(sessionToken)!);
    res.status(201).json({
      token: sessionToken,
      seller: {
        id: newSeller.id,
        email: newSeller.email,
        storeSlug: newSeller.storeSlug,
        totpEnabled: newSeller.totpEnabled,
      },
      store: newStore,
      enrollment: enrollmentDetails(newSeller),
    });
  }));

  app.get('/api/auth/mfa/enrollment', requireSession, (req: AuthedRequest, res) => {
    const seller = db.sellers.find(s => s.id === req.sellerSession?.sellerId);
    if (!seller || seller.totpEnabled) { res.status(409).json({ error: 'Enrollment is not available.' }); return; }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ enrollment: enrollmentDetails(seller) });
  });

  app.post('/api/auth/mfa/confirm', requireSession, (req: AuthedRequest, res) => {
    const seller = db.sellers.find(s => s.id === req.sellerSession?.sellerId);
    if (!seller || seller.totpEnabled || !verifyTotpCode(seller.totpSecretHex, req.body.totpCode || '')) { res.status(400).json({ error: 'Invalid enrollment code or enrollment already complete.' }); return; }
    seller.totpEnabled = true;
    req.sellerSession!.mfaVerified = true;
    for (const [token, session] of sessions) if (session.sellerId === seller.id && !session.mfaVerified) sessions.delete(token);
    saveDatabase(db);
    res.json({ ok: true });
  });

  app.post('/api/auth/logout', requireSession, (req: AuthedRequest, res) => {
    res.clearCookie(SELLER_COOKIE, cookieOptions(req));
    if (req.sellerSession) {
      sessions.delete(req.sellerSession.token);
    }
    res.json({ ok: true });
  });

  // 4. Public Customer Storefront Endpoint (Strictly scoped to :slug, never mixes stores)
  app.get('/api/public/stores/:slug', (req, res) => {
    const slug = String(req.params.slug || '').toLowerCase();
    const store = db.stores.find((s) => s.slug === slug);
    if (!store) {
      res.status(404).json({ error: 'Store not found.' });
      return;
    }
    const activeEnv: NetworkEnvironment = store.activeEnvironment || DEFAULT_NETWORK_ENV;
    const products = db.products.filter((p) => p.storeSlug === slug);
    res.json({
      store: {
        slug: store.slug,
        name: store.name,
        logoUrl: store.logoUrl,
        activeEnvironment: activeEnv,
        acceptsNim:
          activeEnv === 'testnet'
            ? Boolean(store.nimiqTestnetAddress)
            : Boolean(store.nimiqAddress),
        acceptsUsdt:
          activeEnv === 'testnet'
            ? Boolean(store.polygonAmoyAddress)
            : Boolean(store.polygonAddress),
        hasAmoyTestTokenContract: Boolean(store.polygonAmoyTestTokenContract),
        polygonAmoyTestTokenContract: store.polygonAmoyTestTokenContract || null,
        supportsPickup: store.supportsPickup,
        supportsDelivery: store.supportsDelivery,
        supportsDineIn: store.supportsDineIn,
        defaultLocale: store.defaultLocale,
      },
      products,
    });
  });

  // 5. Public Customer Order Creation (Server-authoritative pricing + strict network & wallet snapshot)
  app.post('/api/public/stores/:slug/orders', (req, res) => {
    const ip = req.ip || 'local';
    if (!checkPublicRateLimit(ip, 45)) {
      res.status(429).json({ error: 'Too many order requests. Please wait a moment.' });
      return;
    }

    const slug = String(req.params.slug || '').toLowerCase();
    const store = db.stores.find((s) => s.slug === slug);
    if (!store) {
      res.status(404).json({ error: 'Store not found.' });
      return;
    }

    const { items, asset, environment, fulfillmentMode, tableOrNote, deliveryInfo } = req.body as {
      items?: CartItemInput[];
      asset?: PaymentAsset;
      environment?: NetworkEnvironment;
      fulfillmentMode?: FulfillmentMode;
      tableOrNote?: string;
      deliveryInfo?: {
        recipientName?: string;
        phone?: string;
        address?: string;
      };
    };

    if (asset !== 'NIM' && asset !== 'USDT') {
      res.status(400).json({ error: 'Payment asset must be NIM or USDT.' });
      return;
    }

    // Lock environment at order creation time (never falls back from testnet to mainnet)
    const orderEnv: NetworkEnvironment =
      environment === 'testnet' || environment === 'mainnet'
        ? environment
        : store.activeEnvironment || DEFAULT_NETWORK_ENV;

    if (orderEnv !== 'testnet' || store.activeEnvironment !== 'testnet' || orderEnv !== store.activeEnvironment) { res.status(403).json({ error: 'Testnet beta: mainnet checkout is disabled.' }); return; }

    // Select recipient strictly from the matching environment profile
    const snapshotRecipient =
      orderEnv === 'testnet'
        ? asset === 'NIM'
          ? store.nimiqTestnetAddress
          : store.polygonAmoyAddress
        : asset === 'NIM'
        ? store.nimiqAddress
        : store.polygonAddress;

    if (!snapshotRecipient) {
      res.status(400).json({
        error: `This shop has not configured a recipient wallet on ${
          orderEnv === 'testnet' ? 'TESTNET' : 'MAINNET'
        } for ${getAssetLabelForEnvironment(asset, orderEnv)}. Automatic cross-network fallback is not allowed.`,
      });
      return;
    }

    if (asset === 'USDT' && (!ALLOWLISTED_POLYGON_AMOY_RPC || !validateAmoyTestTokenContract(store.polygonAmoyTestTokenContract || '').valid)) {
      res.status(503).json({ error: 'Amoy checkout is unavailable until the operator configures a working Amoy RPC and the seller sets an approved 6-decimal test-token contract. No mainnet fallback.' }); return;
    }

    const storeCatalog = db.products.filter((p) => p.storeSlug === slug);
    const calc = calculateCartTotals(items || [], storeCatalog, asset, orderEnv);
    if (!calc.compatible) {
      res.status(400).json({
        error:
          calc.incompatibleProducts.length > 0
            ? `Incompatible items for ${calc.assetLabel}: ${calc.incompatibleProducts.map((i) => i.name).join(', ')}`
            : 'Cart is empty or contains unavailable items.',
        incompatibleProducts: calc.incompatibleProducts,
        unavailableProducts: calc.unavailableProducts,
      });
      return;
    }

    const mode: FulfillmentMode = fulfillmentMode || 'pickup';
    if (!['pickup','delivery','dine_in'].includes(mode) || (mode === 'pickup' && !store.supportsPickup) || (mode === 'dine_in' && !store.supportsDineIn)) { res.status(400).json({ error: 'Fulfillment mode unavailable.' }); return; }
    let cleanDelivery: OrderSnapshot['deliveryInfo'] | undefined;
    if (mode === 'delivery') {
      if (!store.supportsDelivery) {
        res.status(400).json({ error: 'Delivery is not enabled for this store.' });
        return;
      }
      const rName = (deliveryInfo?.recipientName || '').trim().slice(0, 80);
      const rPhone = (deliveryInfo?.phone || '').trim().slice(0, 40);
      const rAddr = (deliveryInfo?.address || '').trim().slice(0, 240);
      if (!rName || !rPhone || !rAddr) {
        res.status(400).json({
          error: 'Recipient name, phone number, and delivery address are required for delivery orders.',
        });
        return;
      }
      cleanDelivery = { recipientName: rName, phone: rPhone, address: rAddr };
    }

    const nextSeq = (db.orderSequenceByStore[slug] || 0) + 1;
    db.orderSequenceByStore[slug] = nextSeq;
    const prefix = orderEnv === 'testnet' ? '#T' : '#';
    const orderNumber = `${prefix}${nextSeq.toString().padStart(3, '0')}`;
    const publicToken = `nt_ord_${crypto.randomBytes(12).toString('hex')}`;
    const now = Date.now();

    const snapshotChainId = NETWORK_CONFIGS[calc.network].chainId;
    const snapshotTokenContract =
      calc.network === 'polygon-mainnet'
        ? POLYGON_USDT_CONTRACT
        : calc.network === 'polygon-amoy'
        ? store.polygonAmoyTestTokenContract || null
        : null;

    const newOrder: OrderSnapshot = {
      id: `ord_${crypto.randomBytes(8).toString('hex')}`,
      publicToken,
      orderNumber,
      storeSlug: store.slug,
      storeName: store.name,
      environment: orderEnv,
      asset,
      assetLabel: calc.assetLabel,
      network: calc.network,
      snapshotChainId,
      snapshotTokenContract,
      snapshotRecipient,
      amountBase: calc.totalBase.toString(),
      amountFormatted: calc.totalFormatted,
      items: calc.items,
      fulfillmentMode: mode,
      tableOrNote: (tableOrNote || '').trim().slice(0, 120),
      deliveryInfo: cleanDelivery,
      paymentStatus: 'unpaid',
      fulfillmentStatus: 'new',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 30 * 60_000).toISOString(),
    };

    db.orders.unshift(newOrder);
    saveDatabase(db);

    // Return sanitized public view (delivery PII masked in public payload)
    res.status(201).json({
      order: sanitizeOrderForPublic(newOrder),
    });
  });

  // 6. Public Order Lookup by Strong Random Public Token (Never exposes full order table or delivery PII)
  app.get('/api/public/orders/:publicToken', asyncRoute(async (req, res) => {
    const token = String(req.params.publicToken || '').trim();
    const order = db.orders.find((o) => o.publicToken === token);
    if (!order) {
      res.status(404).json({ error: 'Order not found or invalid public token.' });
      return;
    }
    if (order.paymentStatus === 'pending' && order.txHash && Date.now() - Date.parse(order.paymentVerificationAttemptedAt || '1970-01-01') >= 15000) await verifyOrderPayment(order, order.txHash);
    res.json({ order: sanitizeOrderForPublic(order) });
  }));

  app.post('/api/public/orders/:publicToken/intent', asyncRoute(async (req, res) => {
    const order = db.orders.find(o => o.publicToken === req.params.publicToken);
    if (!order || order.network !== 'polygon-amoy' || order.environment !== 'testnet' || order.paymentStatus !== 'unpaid' || Date.now() > Date.parse(order.expiresAt)) { res.status(409).json({ error: 'Invoice cannot accept a new payment intent.' }); return; }
    const { sender, signature } = req.body;
    if (!validatePolygonAddress(sender || '').valid || !/^0x[0-9a-f]{130}$/i.test(signature || '')) { res.status(400).json({ error: 'Signed payment intent required.' }); return; }
    let recovered: string;
    try { recovered = verifyMessage(paymentIntentMessage(order), signature); } catch { res.status(400).json({ error: 'Invalid signature.' }); return; }
    if (recovered.toLowerCase() !== sender.toLowerCase() || (order.payerAddress && order.payerAddress.toLowerCase() !== recovered.toLowerCase())) { res.status(409).json({ error: 'Invoice payer mismatch.' }); return; }
    order.payerAddress = recovered;
    saveDatabase(db);
    res.json({ ok: true });
  }));

  // Browser supplies only a hash hint; all payment evidence is read by the server.
  app.post('/api/public/orders/:publicToken/verify', asyncRoute(async (req, res) => {
    const order = db.orders.find(o => o.publicToken === req.params.publicToken);
    if (!order) { res.status(404).json({ error: 'Order not found.' }); return; }
    if (order.environment !== 'testnet') { res.status(403).json({ error: 'Mainnet disabled in this testnet beta.' }); return; }
    const hash = (req.body.txHash || '').trim();
    const valid = order.asset === 'NIM' ? /^[0-9a-f]{64}$/i.test(hash) : /^0x[0-9a-f]{64}$/i.test(hash);
    if (!valid) { res.status(400).json({ error: 'Invalid transaction hash for this network.' }); return; }
    if (order.paymentStatus !== 'confirmed') await verifyOrderPayment(order, hash);
    res.json({ order: sanitizeOrderForPublic(order), verificationSource: `${order.network}_rpc` });
  }));

  // ============================================================================
  // SELLER PROTECTED ENDPOINTS (Enforces store isolation + Testnet/Mainnet separation)
  // ============================================================================

  app.get('/api/seller/dashboard', requireSellerAuth, asyncRoute(async (req: AuthedRequest, res) => {
    const storeSlug = req.sellerSession!.storeSlug;
    const store = db.stores.find((s) => s.slug === storeSlug);
    if (!store) {
      res.status(404).json({ error: 'Store not found.' });
      return;
    }
    const pendingCheck = db.orders.find(o => o.storeSlug === storeSlug && o.paymentStatus === 'pending' && o.txHash && Date.now() - Date.parse(o.paymentVerificationAttemptedAt || '1970-01-01') >= 15000);
    if (pendingCheck?.txHash) await verifyOrderPayment(pendingCheck, pendingCheck.txHash);
    const products = db.products.filter((p) => p.storeSlug === storeSlug);
    const orders = db.orders.filter((o) => o.storeSlug === storeSlug);
    const auditLogs = db.auditLogs.filter((a) => a.storeSlug === storeSlug);

    // Strictly separate MAINNET (Real Sales) vs TESTNET (Sandbox Testing — NEVER counted as real sales)
    let confirmedMainnetNimLuna = 0n;
    let confirmedMainnetUsdtMicro = 0n;
    let confirmedMainnetOrdersCount = 0;
    let totalMainnetOrdersCount = 0;

    let confirmedTestnetNimLuna = 0n;
    let confirmedTestTokenMicro = 0n;
    let confirmedTestnetOrdersCount = 0;
    let totalTestnetOrdersCount = 0;

    for (const ord of orders) {
      const env = ord.environment || getNetworkEnvironment(ord.network);
      if (env === 'testnet') {
        totalTestnetOrdersCount += 1;
        if (ord.paymentStatus === 'confirmed') {
          confirmedTestnetOrdersCount += 1;
          if (ord.asset === 'NIM') {
            confirmedTestnetNimLuna += BigInt(ord.amountBase);
          } else if (ord.asset === 'USDT') {
            confirmedTestTokenMicro += BigInt(ord.amountBase);
          }
        }
      } else {
        totalMainnetOrdersCount += 1;
        if (ord.paymentStatus === 'confirmed') {
          confirmedMainnetOrdersCount += 1;
          if (ord.asset === 'NIM') {
            confirmedMainnetNimLuna += BigInt(ord.amountBase);
          } else if (ord.asset === 'USDT') {
            confirmedMainnetUsdtMicro += BigInt(ord.amountBase);
          }
        }
      }
    }

    res.json({
      store,
      products,
      orders,
      auditLogs,
      metrics: {
        confirmedNimLuna: confirmedMainnetNimLuna.toString(),
        confirmedNimFormatted: formatAssetAmount(confirmedMainnetNimLuna, 'NIM', 'mainnet'),
        confirmedUsdtMicro: confirmedMainnetUsdtMicro.toString(),
        confirmedUsdtFormatted: formatAssetAmount(confirmedMainnetUsdtMicro, 'USDT', 'mainnet'),
        confirmedOrdersCount: confirmedMainnetOrdersCount,
        totalOrdersCount: totalMainnetOrdersCount,
      },
      testnetMetrics: {
        confirmedNimTestnetLuna: confirmedTestnetNimLuna.toString(),
        confirmedNimTestnetFormatted: formatAssetAmount(confirmedTestnetNimLuna, 'NIM', 'testnet'),
        confirmedTestTokenMicro: confirmedTestTokenMicro.toString(),
        confirmedTestTokenFormatted: formatAssetAmount(confirmedTestTokenMicro, 'USDT', 'testnet'),
        confirmedTestnetOrdersCount,
        totalTestnetOrdersCount,
      },
      networkConfigs: NETWORK_CONFIGS,
    });
  }));

  // Switch Store Active Environment ('testnet' vs 'mainnet')
  app.patch('/api/seller/network-environment', requireSellerAuth, (req: AuthedRequest, res) => {
    if (req.body.environment !== 'testnet') { res.status(403).json({ error: 'Mainnet is locked during the testnet beta.' }); return; }
    const storeSlug = req.sellerSession!.storeSlug;
    const store = db.stores.find((s) => s.slug === storeSlug);
    if (!store) {
      res.status(404).json({ error: 'Store not found.' });
      return;
    }
    const { environment } = req.body as { environment?: NetworkEnvironment };
    if (environment !== 'testnet' && environment !== 'mainnet') {
      res.status(400).json({ error: 'Environment must be testnet or mainnet.' });
      return;
    }
    const prev = store.activeEnvironment || 'testnet';
    store.activeEnvironment = environment;
    store.updatedAt = new Date().toISOString();

    if (prev !== environment) {
      db.auditLogs.unshift({
        id: `aud_${crypto.randomBytes(6).toString('hex')}`,
        storeSlug,
        sellerEmail: req.sellerSession!.email,
        action: 'NETWORK_ENVIRONMENT_SWITCHED',
        details: `Merchant switched store active environment from ${prev.toUpperCase()} to ${environment.toUpperCase()}. Existing orders remain locked to their original network.`,
        oldValue: prev,
        newValue: environment,
        createdAt: store.updatedAt,
      });
    }
    saveDatabase(db);
    res.json({
      store,
      auditLogs: db.auditLogs.filter((a) => a.storeSlug === storeSlug),
    });
  });

  // Pre-Production Mainnet Configuration Readiness Check
  app.get('/api/seller/mainnet-readiness', requireSellerAuth, (_req, res) => {
    res.json({ readyForMainnet: false, checks: { testnetOnly: true }, warning: 'Mainnet disabled. Complete testnet and production persistence review first.' });
  });

  app.post('/api/seller/product-images', requireSellerAuth, asyncRoute(async (req: AuthedRequest, res) => {
    if (!checkPublicRateLimit('photo:'+req.sellerSession!.storeSlug,15)) { res.status(429).json({ error: 'Too many photo uploads. Please wait a minute.' }); return; }
    let bytes: Buffer;
    try { bytes=await normalizeProductImage(req.body.imageData); } catch { res.status(400).json({ error: 'Invalid photo. Use JPG, PNG or WebP and keep the optimized upload below 160 KB.' }); return; }
    try { const imageUrl=await saveProductImage(req.sellerSession!.storeSlug,bytes); res.status(201).json({imageUrl}); }
    catch(error) { if(error instanceof Error && error.message.includes('100-photo')) { res.status(409).json({error:error.message}); return; } throw error; }
  }));

  app.get('/api/product-images/:file', asyncRoute(async (req, res) => {
    const id=String(req.params.file).match(/^([a-f0-9]{32})\.webp$/)?.[1];
    const bytes=id?await readProductImage(id):null;
    if(!bytes) {res.status(404).json({error:'Photo not found.'});return;}
    res.setHeader('Cache-Control','public, max-age=31536000, immutable');res.type('image/webp').send(bytes);
  }));

  // Seller Product Management (Create / Update)
  app.post('/api/seller/products', requireSellerAuth, asyncRoute(async (req: AuthedRequest, res) => {
    const storeSlug = req.sellerSession!.storeSlug;
    const { name, description, category, imageUrl, available, priceNimLuna, priceUsdtMicro } =
      req.body as Partial<ProductRecord>;

    const cleanName = (name || '').trim().slice(0, 80);
    if (!cleanName) {
      res.status(400).json({ error: 'Product name is required.' });
      return;
    }

    const validNim =
      priceNimLuna && BigInt(priceNimLuna) > 0n ? BigInt(priceNimLuna).toString() : null;
    const validUsdt =
      priceUsdtMicro && BigInt(priceUsdtMicro) > 0n ? BigInt(priceUsdtMicro).toString() : null;

    if (!validNim && !validUsdt) {
      res.status(400).json({
        error: 'Product must have at least one valid price (NIM or Polygon USDT).',
      });
      return;
    }

    if (imageUrl && !await validProductImageUrl(imageUrl.trim(),storeSlug)) { res.status(400).json({error:'Choose an example photo or upload a photo to your own shop.'});return; }
    const newProd: ProductRecord = {
      id: `prod_${crypto.randomBytes(6).toString('hex')}`,
      storeSlug,
      name: cleanName,
      description: (description || '').trim().slice(0, 240),
      category:
        category && ['drinks', 'bakery', 'food', 'dessert', 'fruit', 'goods'].includes(category)
          ? category
          : 'drinks',
      imageUrl:
        (imageUrl || '').trim() ||
        '/products/product_iced_latte_1793717983788.jpg',
      available: available ?? true,
      priceNimLuna: validNim,
      priceUsdtMicro: validUsdt,
    };

    db.products.push(newProd);
    saveDatabase(db);
    res.status(201).json({ product: newProd });
  }));

  app.put('/api/seller/products/:id', requireSellerAuth, asyncRoute(async (req: AuthedRequest, res) => {
    const storeSlug = req.sellerSession!.storeSlug;
    const product = db.products.find((p) => p.id === req.params.id);
    if (!product || product.storeSlug !== storeSlug) {
      res.status(403).json({
        error: 'Access denied: You can only modify products belonging to your own store.',
      });
      return;
    }

    const originalProduct = product;
    const draft = { ...product };
    const { name, description, category, imageUrl, available, priceNimLuna, priceUsdtMicro } =
      req.body as Partial<ProductRecord>;

    if (name !== undefined) draft.name = name.trim().slice(0, 80) || draft.name;
    if (description !== undefined) draft.description = description.trim().slice(0, 240);
    if (category && ['drinks', 'bakery', 'food', 'dessert', 'fruit', 'goods'].includes(category)) {
      draft.category = category;
    }
    if (imageUrl !== undefined && imageUrl.trim()) {
      if(!await validProductImageUrl(imageUrl.trim(),storeSlug)) { res.status(400).json({error:'Choose an example photo or upload a photo to your own shop.'});return; }
      draft.imageUrl = imageUrl.trim();
    }
    if (available !== undefined) draft.available = Boolean(available);
    if (priceNimLuna !== undefined) {
      draft.priceNimLuna =
        priceNimLuna && BigInt(priceNimLuna) > 0n ? BigInt(priceNimLuna).toString() : null;
    }
    if (priceUsdtMicro !== undefined) {
      draft.priceUsdtMicro =
        priceUsdtMicro && BigInt(priceUsdtMicro) > 0n ? BigInt(priceUsdtMicro).toString() : null;
    }

    if (!draft.priceNimLuna && !draft.priceUsdtMicro) {
      res.status(400).json({
        error: 'At least one asset price (NIM or USDT) must remain active.',
      });
      return;
    }

    Object.assign(originalProduct, draft);
    saveDatabase(db);
    res.json({ product: originalProduct });
  }));

  app.delete('/api/seller/products/:id', requireSellerAuth, (req: AuthedRequest, res) => {
    const storeSlug = req.sellerSession!.storeSlug;
    const idx = db.products.findIndex((p) => p.id === req.params.id);
    if (idx === -1 || db.products[idx].storeSlug !== storeSlug) {
      res.status(403).json({
        error: 'Access denied: You can only delete products belonging to your own store.',
      });
      return;
    }
    const [removed] = db.products.splice(idx, 1);
    saveDatabase(db);
    res.json({ deletedId: removed.id });
  });

  // Seller Order Fulfillment & Manual Note (Never allows faking on-chain 'confirmed' status)
  app.patch('/api/seller/orders/:id/fulfillment', requireSellerAuth, (req: AuthedRequest, res) => {
    const storeSlug = req.sellerSession!.storeSlug;
    const order = db.orders.find((o) => o.id === req.params.id);
    if (!order || order.storeSlug !== storeSlug) {
      res.status(403).json({
        error: 'Access denied: Order belongs to a different store.',
      });
      return;
    }

    const { fulfillmentStatus, manualPaymentNote } = req.body as {
      fulfillmentStatus?: FulfillmentStatus;
      manualPaymentNote?: string;
    };

    const allowedStatuses: FulfillmentStatus[] = [
      'new',
      'preparing',
      'ready',
      'completed',
      'canceled',
    ];
    if (fulfillmentStatus && allowedStatuses.includes(fulfillmentStatus)) {
      order.fulfillmentStatus = fulfillmentStatus;
    }

    if (manualPaymentNote !== undefined) {
      const cleanNote = manualPaymentNote.trim().slice(0, 200);
      order.manualPaymentNote = cleanNote;
      db.auditLogs.unshift({
        id: `aud_${crypto.randomBytes(6).toString('hex')}`,
        storeSlug,
        sellerEmail: req.sellerSession!.email,
        action: 'MANUAL_ORDER_NOTE',
        details: `Recorded manual cashier note on Order ${order.orderNumber} (On-chain status remains ${order.paymentStatus}).`,
        newValue: cleanNote,
        createdAt: new Date().toISOString(),
      });
    }

    saveDatabase(db);
    res.json({ order });
  });

  // Seller Wallet & Store Update (Requires password re-auth + 2FA TOTP, writes audit log, preserves old order snapshots)
  // Supports separated Testnet and Mainnet recipient wallet profiles & Amoy TEST TOKEN contract validation
  app.put('/api/seller/wallets', requireSellerAuth, (req: AuthedRequest, res) => {
    const storeSlug = req.sellerSession!.storeSlug;
    const seller = db.sellers.find((s) => s.id === req.sellerSession!.sellerId);
    const store = db.stores.find((st) => st.slug === storeSlug);

    if (!seller || !store) {
      res.status(404).json({ error: 'Seller or store not found.' });
      return;
    }

    const {
      currentPassword,
      totpCode,
      nimiqAddress,
      polygonAddress,
      nimiqTestnetAddress,
      polygonAmoyAddress,
      polygonAmoyTestTokenContract,
      storeName,
      supportsPickup,
      supportsDelivery,
      defaultLocale,
      voiceLocale,
    } = req.body as {
      currentPassword?: string;
      totpCode?: string;
      nimiqAddress?: string | null;
      polygonAddress?: string | null;
      nimiqTestnetAddress?: string | null;
      polygonAmoyAddress?: string | null;
      polygonAmoyTestTokenContract?: string | null;
      storeName?: string;
      supportsPickup?: boolean;
      supportsDelivery?: boolean;
      defaultLocale?: SupportedLocale;
      voiceLocale?: SupportedLocale;
    };

    if (!verifyPassword(currentPassword || '', seller.passwordSalt, seller.passwordHash)) {
      res.status(401).json({
        error: 'Re-authentication failed: Current password is incorrect.',
      });
      return;
    }

    if (!verifyTotpCode(seller.totpSecretHex, totpCode || '')) {
      res.status(401).json({
        error: '2FA verification failed: Valid 6-digit Authenticator code is required to change wallets.',
      });
      return;
    }

    let nextNim: string | null = null;
    if (nimiqAddress && nimiqAddress.trim()) {
      const check = validateNimiqAddress(nimiqAddress);
      if (!check.valid) {
        res.status(400).json({ error: `Mainnet Nimiq address error: ${check.reason}` });
        return;
      }
      nextNim = check.normalized;
    }

    let nextPoly: string | null = null;
    if (polygonAddress && polygonAddress.trim()) {
      const check = validatePolygonAddress(polygonAddress);
      if (!check.valid) {
        res.status(400).json({ error: `Mainnet Polygon address error: ${check.reason}` });
        return;
      }
      nextPoly = check.normalized;
    }

    let nextTestNim: string | null = store.nimiqTestnetAddress;
    if (nimiqTestnetAddress !== undefined) {
      if (nimiqTestnetAddress && nimiqTestnetAddress.trim()) {
        const check = validateNimiqAddress(nimiqTestnetAddress);
        if (!check.valid) {
          res.status(400).json({ error: `Testnet Nimiq address error: ${check.reason}` });
          return;
        }
        nextTestNim = check.normalized;
      } else {
        nextTestNim = null;
      }
    }

    let nextAmoyPoly: string | null = store.polygonAmoyAddress;
    if (polygonAmoyAddress !== undefined) {
      if (polygonAmoyAddress && polygonAmoyAddress.trim()) {
        const check = validatePolygonAddress(polygonAmoyAddress);
        if (!check.valid) {
          res.status(400).json({ error: `Polygon Amoy Testnet address error: ${check.reason}` });
          return;
        }
        nextAmoyPoly = check.normalized;
      } else {
        nextAmoyPoly = null;
      }
    }

    let nextAmoyContract: string | null = store.polygonAmoyTestTokenContract;
    if (polygonAmoyTestTokenContract !== undefined) {
      const contractCheck = validateAmoyTestTokenContract(polygonAmoyTestTokenContract || '');
      if (!contractCheck.valid) {
        res.status(400).json({ error: contractCheck.reason });
        return;
      }
      nextAmoyContract = contractCheck.normalized;
    }

    if (!nextNim && !nextPoly && !nextTestNim && !nextAmoyPoly) {
      res.status(400).json({
        error: 'At least one recipient wallet address must remain active.',
      });
      return;
    }

    const oldWallets = `MAINNET[NIM:${store.nimiqAddress || 'None'}, USDT:${store.polygonAddress || 'None'}] | TESTNET[NIM:${store.nimiqTestnetAddress || 'None'}, AMOY:${store.polygonAmoyAddress || 'None'}, TOKEN:${store.polygonAmoyTestTokenContract || 'None'}]`;
    const newWallets = `MAINNET[NIM:${nextNim || 'None'}, USDT:${nextPoly || 'None'}] | TESTNET[NIM:${nextTestNim || 'None'}, AMOY:${nextAmoyPoly || 'None'}, TOKEN:${nextAmoyContract || 'None'}]`;

    store.nimiqAddress = nextNim;
    store.polygonAddress = nextPoly;
    store.nimiqTestnetAddress = nextTestNim;
    store.polygonAmoyAddress = nextAmoyPoly;
    store.polygonAmoyTestTokenContract = nextAmoyContract;
    if (storeName && storeName.trim()) store.name = storeName.trim().slice(0, 60);
    if (supportsPickup !== undefined) store.supportsPickup = Boolean(supportsPickup);
    if (supportsDelivery !== undefined) store.supportsDelivery = Boolean(supportsDelivery);
    if (defaultLocale) store.defaultLocale = defaultLocale;
    if (voiceLocale) store.voiceLocale = voiceLocale;
    store.updatedAt = new Date().toISOString();

    if (oldWallets !== newWallets) {
      db.auditLogs.unshift({
        id: `aud_${crypto.randomBytes(6).toString('hex')}`,
        storeSlug,
        sellerEmail: seller.email,
        action: 'WALLET_PROFILES_UPDATED_WITH_2FA',
        details: 'Merchant updated separated Testnet/Mainnet recipient wallet profiles after password + 2FA verification. Existing orders retain their original snapshot recipient.',
        oldValue: oldWallets,
        newValue: newWallets,
        createdAt: store.updatedAt,
      });
    }

    saveDatabase(db);
    res.json({
      store,
      auditLogs: db.auditLogs.filter((a) => a.storeSlug === storeSlug),
    });
  });

  app.use('/api', (_req, res) => { res.status(404).json({ error: 'API route not found.' }); });
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    const badInput = error instanceof SyntaxError || error instanceof TypeError || error instanceof RangeError || error?.type === 'entity.too.large';
    res.status(badInput ? 400 : 503).json({ error: badInput ? 'Invalid request.' : 'Operation unavailable; no success has been confirmed.' });
  });

  if (options.apiOnly || process.env.NODE_ENV === 'test') return app;
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}


function sanitizeOrderForPublic(order: OrderSnapshot): Omit<OrderSnapshot, 'deliveryInfo'> & {
  hasDeliveryAddress: boolean;
} {
  const { deliveryInfo, ...rest } = order;
  return {
    ...rest,
    hasDeliveryAddress: Boolean(deliveryInfo),
  };
}

if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 64) throw new Error('Set a random SESSION_SECRET of at least 64 characters.');
  createApp().then(app => {
    const timer = setInterval(() => { void reconcilePendingPayments(); }, 8000); timer.unref();
    app.listen(PORT, '0.0.0.0', () => console.log(`NimTera TESTNET on port ${PORT}`));
  });
}
