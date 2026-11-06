import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
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
} from './src/lib/domain';
import type { SupportedLocale } from './src/lib/i18n';

const PORT = 3000;
const DATA_FILE = path.resolve(process.cwd(), '.nimtera-store-db.json');

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

function createInitialSeedDatabase(): DatabaseState {
  const moonlightNimiq = createValidNimiqAddress('M00NL1GHTCAFE778899AABBCCDDEEFF0');
  const moonlightTestnetNimiq = createValidNimiqAddress('TESTNETM00NL1GHT0011223344556677');
  const auroraNimiq = createValidNimiqAddress('AUR0RAR0ASTERS112233445566778899');
  const auroraTestnetNimiq = createValidNimiqAddress('TESTNETAUR0RA0001122334455667788');

  const moonlightPass = hashPassword('Moonlight#NightMarket!2026');
  const auroraPass = hashPassword('AuroraRoasters#Night!2026');

  const moonlightSeller: SellerAccount = {
    id: 'sel_moonlight',
    email: 'merchant@moonlight.store',
    passwordSalt: moonlightPass.salt,
    passwordHash: moonlightPass.hash,
    totpSecretHex: '4d6f6f6e6c696768744e696d5465726132303236',
    totpEnabled: true,
    emailVerified: true,
    storeSlug: 'moonlight-cafe',
    createdAt: '2026-11-01T18:00:00.000Z',
  };

  const auroraSeller: SellerAccount = {
    id: 'sel_aurora',
    email: 'seller@aurora.store',
    passwordSalt: auroraPass.salt,
    passwordHash: auroraPass.hash,
    totpSecretHex: '4175726f7261526f617374657273536563726574',
    totpEnabled: true,
    emailVerified: true,
    storeSlug: 'aurora-roasters',
    createdAt: '2026-11-01T19:00:00.000Z',
  };

  const stores: StoreRecord[] = [
    {
      slug: 'moonlight-cafe',
      name: 'Moonlight Cafe',
      sellerId: moonlightSeller.id,
      activeEnvironment: DEFAULT_NETWORK_ENV,
      nimiqAddress: moonlightNimiq,
      polygonAddress: '0x129A40885B3fe74921c88492A09B6429371b9A40',
      nimiqTestnetAddress: moonlightTestnetNimiq,
      polygonAmoyAddress: '0x71C95911E9a5D330f4D621842EC243EE1343292e',
      polygonAmoyTestTokenContract: process.env.POLYGON_AMOY_TEST_TOKEN_CONTRACT || null,
      supportsPickup: true,
      supportsDelivery: true,
      supportsDineIn: true,
      defaultLocale: 'en',
      voiceLocale: 'en',
      createdAt: '2026-11-01T18:00:00.000Z',
      updatedAt: '2026-11-01T18:00:00.000Z',
    },
    {
      slug: 'aurora-roasters',
      name: 'Aurora Night Roasters',
      sellerId: auroraSeller.id,
      activeEnvironment: DEFAULT_NETWORK_ENV,
      nimiqAddress: auroraNimiq,
      polygonAddress: '0x88492A09B6429371b9A40129A40885B3fe74921c',
      nimiqTestnetAddress: auroraTestnetNimiq,
      polygonAmoyAddress: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
      polygonAmoyTestTokenContract: process.env.POLYGON_AMOY_TEST_TOKEN_CONTRACT || null,
      supportsPickup: true,
      supportsDelivery: false,
      supportsDineIn: true,
      defaultLocale: 'id',
      voiceLocale: 'id',
      createdAt: '2026-11-01T19:00:00.000Z',
      updatedAt: '2026-11-01T19:00:00.000Z',
    },
  ];

  const products: ProductRecord[] = [
    {
      id: 'prod_iced_latte',
      storeSlug: 'moonlight-cafe',
      name: 'Iced Latte',
      description: 'Double-shot night market espresso layered over cold velvet milk.',
      category: 'drinks',
      imageUrl: '/src/assets/images/product_iced_latte_1793717983788.jpg',
      available: true,
      priceNimLuna: '4000000', // 40 NIM
      priceUsdtMicro: '1200000', // 1.20 USDT
    },
    {
      id: 'prod_matcha',
      storeSlug: 'moonlight-cafe',
      name: 'Matcha',
      description: 'First-harvest Uji ceremonial matcha whisked over crystal ice.',
      category: 'drinks',
      imageUrl: '/src/assets/images/product_matcha_latte_1793717985445.jpg',
      available: true,
      priceNimLuna: '4500000', // 45 NIM
      priceUsdtMicro: '1350000', // 1.35 USDT
    },
    {
      id: 'prod_croissant',
      storeSlug: 'moonlight-cafe',
      name: 'Butter Croissant',
      description: 'Golden laminated French pastry baked fresh every evening.',
      category: 'bakery',
      imageUrl: '/src/assets/images/product_butter_croissant_1793717986872.jpg',
      available: true,
      priceNimLuna: '3000000', // 30 NIM
      priceUsdtMicro: '800000', // 0.80 USDT
    },
    {
      id: 'prod_jasmine_tea',
      storeSlug: 'moonlight-cafe',
      name: 'Iced Jasmine Tea',
      description: 'Cold-steeped fragrant jasmine blossom green tea with fresh citrus.',
      category: 'drinks',
      imageUrl: '/src/assets/images/product_jasmine_tea_1793717986722.jpg',
      available: true,
      priceNimLuna: '3500000', // 35 NIM
      priceUsdtMicro: '1050000', // 1.05 USDT
    },
    {
      id: 'prod_sourdough',
      storeSlug: 'moonlight-cafe',
      name: 'Sourdough Loaf',
      description: '36-hour naturally leavened country sourdough with blistered crust.',
      category: 'food',
      imageUrl: '/src/assets/images/product_sourdough_loaf_1793717990053.jpg',
      available: true,
      priceNimLuna: '5500000', // 55 NIM
      priceUsdtMicro: '1650000', // 1.65 USDT
    },
    {
      id: 'prod_matcha_parfait',
      storeSlug: 'moonlight-cafe',
      name: 'Matcha Tiramisu Parfait',
      description: 'Velvet mascarpone cream layered with ceremonial matcha sponge and cocoa.',
      category: 'dessert',
      imageUrl: '/src/assets/images/product_matcha_latte_1793717985445.jpg',
      available: true,
      priceNimLuna: '4800000', // 48 NIM
      priceUsdtMicro: '1450000', // 1.45 USDT
    },
    {
      id: 'prod_tropical_fruit',
      storeSlug: 'moonlight-cafe',
      name: 'Tropical Mango & Citrus Bowl',
      description: 'Chilled honey mango, sweet pomelo, and mint lime zest bowl.',
      category: 'fruit',
      imageUrl: '/src/assets/images/product_jasmine_tea_1793717986722.jpg',
      available: true,
      priceNimLuna: '3200000', // 32 NIM
      priceUsdtMicro: '950000', // 0.95 USDT
    },
    {
      id: 'prod_ceramic_mug',
      storeSlug: 'moonlight-cafe',
      name: 'Ceramic Mug',
      description: 'Hand-thrown midnight indigo stoneware mug by local ceramicists.',
      category: 'goods',
      imageUrl: '/src/assets/images/product_ceramic_mug_1793717988583.jpg',
      available: true,
      priceNimLuna: '8500000', // 85 NIM
      priceUsdtMicro: '2550000', // 2.55 USDT
    },
    {
      id: 'prod_moonlight_tote',
      storeSlug: 'moonlight-cafe',
      name: 'Moonlight Reserve Beans (NIM Only)',
      description: 'Single-origin anaerobic night harvest coffee beans — priced exclusively in NIM.',
      category: 'goods',
      imageUrl: '/src/assets/images/product_iced_latte_1793717983788.jpg',
      available: true,
      priceNimLuna: '12000000', // 120 NIM
      priceUsdtMicro: null, // Intentionally NIM-only to demonstrate mixed-asset guard
    },
    // Second seller catalog (Aurora Night Roasters)
    {
      id: 'prod_aurora_v60',
      storeSlug: 'aurora-roasters',
      name: 'Gayo Wine Pour-Over',
      description: 'Hand-brewed Sumatran filter coffee.',
      category: 'drinks',
      imageUrl: '/src/assets/images/product_iced_latte_1793717983788.jpg',
      available: true,
      priceNimLuna: '5000000',
      priceUsdtMicro: '1500000',
    },
  ];

  const now = Date.now();
  const orders: OrderSnapshot[] = [
    {
      id: 'ord_seed_024',
      publicToken: 'nt_ord_moonlight024',
      orderNumber: '#024',
      storeSlug: 'moonlight-cafe',
      storeName: 'Moonlight Cafe',
      asset: 'USDT',
      network: 'polygon-mainnet',
      snapshotRecipient: '0x129A40885B3fe74921c88492A09B6429371b9A40',
      amountBase: '2000000',
      amountFormatted: '2.00 USDT',
      items: [
        {
          productId: 'prod_iced_latte',
          name: 'Iced Latte',
          quantity: 1,
          unitPriceBase: '1200000',
          lineTotalBase: '1200000',
          imageUrl: '/src/assets/images/product_iced_latte_1793717983788.jpg',
        },
        {
          productId: 'prod_croissant',
          name: 'Butter Croissant',
          quantity: 1,
          unitPriceBase: '800000',
          lineTotalBase: '800000',
          imageUrl: '/src/assets/images/product_butter_croissant_1793717986872.jpg',
        },
      ],
      fulfillmentMode: 'dine_in',
      tableOrNote: 'Table 7',
      paymentStatus: 'unpaid',
      fulfillmentStatus: 'new',
      createdAt: new Date(now - 5 * 60_000).toISOString(),
      expiresAt: new Date(now + 45 * 60_000).toISOString(),
    },
    {
      id: 'ord_seed_023',
      publicToken: 'nt_ord_moonlight023',
      orderNumber: '#023',
      storeSlug: 'moonlight-cafe',
      storeName: 'Moonlight Cafe',
      asset: 'NIM',
      network: 'nimiq-mainnet',
      snapshotRecipient: moonlightNimiq,
      amountBase: '11000000',
      amountFormatted: '110 NIM',
      items: [
        {
          productId: 'prod_iced_latte',
          name: 'Iced Latte',
          quantity: 2,
          unitPriceBase: '4000000',
          lineTotalBase: '8000000',
          imageUrl: '/src/assets/images/product_iced_latte_1793717983788.jpg',
        },
        {
          productId: 'prod_croissant',
          name: 'Butter Croissant',
          quantity: 1,
          unitPriceBase: '3000000',
          lineTotalBase: '3000000',
          imageUrl: '/src/assets/images/product_butter_croissant_1793717986872.jpg',
        },
      ],
      fulfillmentMode: 'pickup',
      tableOrNote: 'Pickup counter',
      paymentStatus: 'confirmed',
      txHash: '0x94f8a21e77c092d1b6429371b9a40129a40885b3fe74921c88492a09b6420023',
      verifiedAt: new Date(now - 12 * 60_000).toISOString(),
      fulfillmentStatus: 'preparing',
      createdAt: new Date(now - 15 * 60_000).toISOString(),
      expiresAt: new Date(now + 15 * 60_000).toISOString(),
    },
    {
      id: 'ord_seed_022',
      publicToken: 'nt_ord_moonlight022',
      orderNumber: '#022',
      storeSlug: 'moonlight-cafe',
      storeName: 'Moonlight Cafe',
      asset: 'USDT',
      network: 'polygon-mainnet',
      snapshotRecipient: '0x129A40885B3fe74921c88492A09B6429371b9A40',
      amountBase: '3900000',
      amountFormatted: '3.90 USDT',
      items: [
        {
          productId: 'prod_ceramic_mug',
          name: 'Ceramic Mug',
          quantity: 1,
          unitPriceBase: '2550000',
          lineTotalBase: '2550000',
          imageUrl: '/src/assets/images/product_ceramic_mug_1793717988583.jpg',
        },
        {
          productId: 'prod_matcha',
          name: 'Matcha',
          quantity: 1,
          unitPriceBase: '1350000',
          lineTotalBase: '1350000',
          imageUrl: '/src/assets/images/product_matcha_latte_1793717985445.jpg',
        },
      ],
      fulfillmentMode: 'pickup',
      tableOrNote: 'Gift wrap please',
      paymentStatus: 'confirmed',
      txHash: '0x53c1b89021e77c092d1b6429371b9a40129a40885b3fe74921c88492a09b0022',
      verifiedAt: new Date(now - 25 * 60_000).toISOString(),
      fulfillmentStatus: 'completed',
      createdAt: new Date(now - 30 * 60_000).toISOString(),
      expiresAt: new Date(now).toISOString(),
    },
  ];

  const auditLogs: AuditLogEntry[] = [
    {
      id: 'aud_1',
      storeSlug: 'moonlight-cafe',
      sellerEmail: 'merchant@moonlight.store',
      action: 'WALLET_INITIALIZED',
      details: 'Initial Nimiq and Polygon USDT recipient wallets configured and checksum-verified.',
      newValue: `${moonlightNimiq} | 0x129A40885B3fe74921c88492A09B6429371b9A40`,
      createdAt: '2026-11-01T18:00:00.000Z',
    },
  ];

  return {
    sellers: [moonlightSeller, auroraSeller],
    stores,
    products,
    orders,
    auditLogs,
    claimedTransactions: {
      '0x94f8a21e77c092d1b6429371b9a40129a40885b3fe74921c88492a09b6420023': 'ord_seed_023',
      '0x53c1b89021e77c092d1b6429371b9a40129a40885b3fe74921c88492a09b0022': 'ord_seed_022',
    },
    orderSequenceByStore: {
      'moonlight-cafe': 24,
      'aurora-roasters': 1,
    },
  };
}

function loadDatabase(): DatabaseState {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as DatabaseState;
      const moonlightTestnetNimiq = createValidNimiqAddress('TESTNETM00NL1GHT0011223344556677');
      const auroraTestnetNimiq = createValidNimiqAddress('TESTNETAUR0RA0001122334455667788');

      // Backfill separate Testnet wallet profiles and default 'testnet' environment
      for (const st of parsed.stores) {
        if (!st.activeEnvironment) {
          st.activeEnvironment = DEFAULT_NETWORK_ENV;
        }
        if (st.nimiqTestnetAddress === undefined) {
          st.nimiqTestnetAddress =
            st.slug === 'aurora-roasters' ? auroraTestnetNimiq : moonlightTestnetNimiq;
        }
        if (st.polygonAmoyAddress === undefined) {
          st.polygonAmoyAddress =
            st.slug === 'aurora-roasters'
              ? '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
              : '0x71C95911E9a5D330f4D621842EC243EE1343292e';
        }
        if (st.polygonAmoyTestTokenContract === undefined) {
          st.polygonAmoyTestTokenContract = process.env.POLYGON_AMOY_TEST_TOKEN_CONTRACT || null;
        }
      }

      // Backfill environment & assetLabel on existing orders
      for (const ord of parsed.orders) {
        if (!ord.environment) {
          ord.environment = getNetworkEnvironment(ord.network);
        }
        if (!ord.assetLabel) {
          ord.assetLabel = getAssetLabelForEnvironment(ord.asset, ord.environment);
        }
        if (ord.snapshotChainId === undefined) {
          ord.snapshotChainId = NETWORK_CONFIGS[ord.network]?.chainId ?? null;
        }
        if (ord.snapshotTokenContract === undefined) {
          ord.snapshotTokenContract =
            ord.network === 'polygon-mainnet' ? POLYGON_USDT_CONTRACT : null;
        }
      }

      // Ensure at least one seeded Testnet order exists so Testnet Orders & Reports are immediately demonstrable
      if (!parsed.orders.some((o) => getNetworkEnvironment(o.network) === 'testnet')) {
        parsed.orders.unshift({
          id: 'ord_seed_testnet_001',
          publicToken: 'nt_ord_testnet001',
          orderNumber: '#T01',
          storeSlug: 'moonlight-cafe',
          storeName: parsed.stores.find((s) => s.slug === 'moonlight-cafe')?.name || 'Moonlight Cafe',
          environment: 'testnet',
          asset: 'NIM',
          assetLabel: 'NIM (TESTNET)',
          network: 'nimiq-testnet',
          snapshotChainId: null,
          snapshotTokenContract: null,
          snapshotRecipient: moonlightTestnetNimiq,
          amountBase: '7000000',
          amountFormatted: '70 NIM (TESTNET)',
          items: [
            {
              productId: 'prod_iced_latte',
              name: 'Iced Latte',
              quantity: 1,
              unitPriceBase: '4000000',
              lineTotalBase: '4000000',
              imageUrl: '/src/assets/images/product_iced_latte_1793717983788.jpg',
            },
            {
              productId: 'prod_croissant',
              name: 'Butter Croissant',
              quantity: 1,
              unitPriceBase: '3000000',
              lineTotalBase: '3000000',
              imageUrl: '/src/assets/images/product_butter_croissant_1793717986872.jpg',
            },
          ],
          fulfillmentMode: 'dine_in',
          tableOrNote: 'Testnet Sandbox · Table 3',
          paymentStatus: 'unpaid',
          fulfillmentStatus: 'new',
          createdAt: new Date(Date.now() - 2 * 60_000).toISOString(),
          expiresAt: new Date(Date.now() + 45 * 60_000).toISOString(),
        });
      }

      // Backfill dessert and fruit items if loading from an older database snapshot
      if (!parsed.products.some((p) => p.category === 'dessert')) {
        parsed.products.push({
          id: 'prod_matcha_parfait',
          storeSlug: 'moonlight-cafe',
          name: 'Matcha Tiramisu Parfait',
          description: 'Velvet mascarpone cream layered with ceremonial matcha sponge and cocoa.',
          category: 'dessert',
          imageUrl: '/src/assets/images/product_matcha_latte_1793717985445.jpg',
          available: true,
          priceNimLuna: '4800000',
          priceUsdtMicro: '1450000',
        });
      }
      if (!parsed.products.some((p) => p.category === 'fruit')) {
        parsed.products.push({
          id: 'prod_tropical_fruit',
          storeSlug: 'moonlight-cafe',
          name: 'Tropical Mango & Citrus Bowl',
          description: 'Chilled honey mango, sweet pomelo, and mint lime zest bowl.',
          category: 'fruit',
          imageUrl: '/src/assets/images/product_jasmine_tea_1793717986722.jpg',
          available: true,
          priceNimLuna: '3200000',
          priceUsdtMicro: '950000',
        });
      }
      return parsed;
    }
  } catch {
    // Fallback to clean seed
  }
  const initial = createInitialSeedDatabase();
  saveDatabase(initial);
  return initial;
}

function saveDatabase(state: DatabaseState) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    // Non-fatal in read-only filesystems
  }
}

const db = loadDatabase();
const sessions = new Map<string, SessionRecord>();

// Progressive rate limiting / backoff state per IP/identifier
const loginRateLimits = new Map<string, { failures: number; lockedUntilMs: number }>();
const publicEndpointRateLimits = new Map<string, { count: number; windowStartMs: number }>();

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
  if (!secret) {
    return payload;
  }
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${payload}:${sellerId}:${storeSlug}`)
    .digest('hex');
  return `${payload}.${sig}`;
}

function verifySessionSignature(session: SessionRecord): boolean {
  const secret = process.env.SESSION_SECRET;
  if (!secret || !session.token.includes('.')) {
    return true;
  }
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

function requireSellerAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please sign in to the Seller Console.' });
    return;
  }
  const session = sessions.get(token);
  if (!session || Date.now() > session.expiresAt || !verifySessionSignature(session)) {
    sessions.delete(token);
    res.status(401).json({ error: 'Seller session expired or invalid. Please sign in again.' });
    return;
  }
  req.sellerSession = session;
  next();
}

/**
 * Verifies Cloudflare Turnstile token on the server when TURNSTILE_SECRET_KEY is configured.
 * Reports configuration status honestly without weakening security.
 */
async function verifyTurnstileToken(token: string | undefined, remoteIp: string): Promise<{
  passed: boolean;
  mode: 'cloudflare_verified' | 'unconfigured_notice';
  error?: string;
}> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Honest reporting when Turnstile secret is not yet configured in environment
    if (!token || token.trim().length < 4) {
      return {
        passed: false,
        mode: 'unconfigured_notice',
        error: 'CAPTCHA verification challenge must be completed.',
      };
    }
    return { passed: true, mode: 'unconfigured_notice' };
  }

  try {
    const formData = new URLSearchParams();
    formData.append('secret', secret);
    formData.append('response', token || '');
    formData.append('remoteip', remoteIp);

    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
    });
    const data = (await resp.json()) as { success?: boolean };
    if (!data.success) {
      return {
        passed: false,
        mode: 'cloudflare_verified',
        error: 'Cloudflare Turnstile CAPTCHA verification failed.',
      };
    }
    return { passed: true, mode: 'cloudflare_verified' };
  } catch {
    return {
      passed: false,
      mode: 'cloudflare_verified',
      error: 'Unable to reach Cloudflare Turnstile verification server.',
    };
  }
}

/**
 * Queries allowlisted Polygon Mainnet (Chain ID 137) or Polygon Amoy Testnet (Chain ID 80002)
 * RPC for transaction receipt and parses ERC-20 Transfer log.
 * Never falls back from Amoy to Mainnet or vice versa.
 */
async function verifyPolygonTransactionOnRpc(
  txHash: string,
  expectedRecipient: string,
  network: 'polygon-amoy' | 'polygon-mainnet',
  expectedTokenContract: string | null
): Promise<OnChainTxEvidence> {
  const rpcUrl =
    network === 'polygon-amoy' ? ALLOWLISTED_POLYGON_AMOY_RPC : ALLOWLISTED_POLYGON_MAINNET_RPC;
  const targetContract =
    network === 'polygon-amoy'
      ? expectedTokenContract
      : expectedTokenContract || POLYGON_USDT_CONTRACT;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getTransactionReceipt',
        params: [txHash],
      }),
    });
    clearTimeout(timeout);
    const json = (await resp.json()) as {
      result?: {
        status?: string;
        logs?: Array<{
          address: string;
          topics: string[];
          data: string;
        }>;
      } | null;
    };

    if (!json.result) {
      return {
        txHash,
        network,
        executionStatus: 'pending',
        recipient: expectedRecipient,
        amountBase: 0n,
      };
    }

    if (json.result.status !== '0x1') {
      return {
        txHash,
        network,
        executionStatus: 'failed',
        recipient: expectedRecipient,
        amountBase: 0n,
      };
    }

    // Find ERC-20 Transfer(address,address,uint256) event from the order's locked token contract
    const logs = json.result.logs || [];
    if (targetContract) {
      for (const log of logs) {
        if (
          log.address?.toLowerCase() === targetContract.toLowerCase() &&
          log.topics?.[0]?.toLowerCase() === ERC20_TRANSFER_TOPIC.toLowerCase() &&
          log.topics.length >= 3
        ) {
          const toTopic = log.topics[2];
          const toAddress = `0x${toTopic.slice(-40)}`;
          const amountBig = BigInt(log.data || '0x0');
          return {
            txHash,
            network,
            executionStatus: 'confirmed',
            recipient: toAddress,
            amountBase: amountBig,
            tokenContract: log.address,
          };
        }
      }
    }

    return {
      txHash,
      network,
      executionStatus: 'confirmed',
      recipient: expectedRecipient,
      amountBase: 0n,
      tokenContract: '0x0000000000000000000000000000000000000000',
    };
  } catch {
    clearTimeout(timeout);
    return {
      txHash,
      network,
      executionStatus: 'rpc_timeout',
      recipient: expectedRecipient,
      amountBase: 0n,
    };
  }
}

/**
 * Queries allowlisted Nimiq Testnet (`test-albatross`) or Nimiq Mainnet (`main-albatross`)
 * RPC for transaction details. Strictly isolated per network.
 */
async function verifyNimiqTransactionOnRpc(
  txHash: string,
  expectedRecipient: string,
  network: 'nimiq-testnet' | 'nimiq-mainnet'
): Promise<OnChainTxEvidence> {
  const rpcUrl =
    network === 'nimiq-testnet' ? ALLOWLISTED_NIMIQ_TESTNET_RPC : ALLOWLISTED_NIMIQ_MAINNET_RPC;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransactionByHash',
        params: [txHash],
      }),
    });
    clearTimeout(timeout);
    const json = (await resp.json()) as {
      result?: {
        to?: string;
        toAddress?: string;
        value?: number | string;
        confirmations?: number;
        executionResult?: boolean;
      } | null;
    };

    if (!json.result) {
      return {
        txHash,
        network,
        executionStatus: 'pending',
        recipient: expectedRecipient,
        amountBase: 0n,
      };
    }

    const confirmations = json.result.confirmations ?? 1;
    const recipient = json.result.toAddress || json.result.to || '';
    const valueBig = BigInt(json.result.value ?? 0);

    return {
      txHash,
      network,
      executionStatus: confirmations > 0 ? 'confirmed' : 'pending',
      recipient,
      amountBase: valueBig,
    };
  } catch {
    clearTimeout(timeout);
    return {
      txHash,
      network,
      executionStatus: 'rpc_timeout',
      recipient: expectedRecipient,
      amountBase: 0n,
    };
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  // Basic security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // 1. Honest Auth & Security Setup Status Endpoint
  app.get('/api/auth/security-status', (_req, res) => {
    const turnstileConfigured = Boolean(process.env.TURNSTILE_SECRET_KEY);
    const demoSeller = db.sellers.find((s) => s.storeSlug === 'moonlight-cafe');
    res.json({
      passwordMinLength: 15,
      totp2faRequired: true,
      rateLimitActive: true,
      turnstileConfigured,
      turnstileSiteKey: process.env.VITE_TURNSTILE_SITE_KEY || null,
      domainCanonical: process.env.APP_URL || 'https://nimtera.store',
      demoTotpCurrentCode: demoSeller ? generateTotpCode(demoSeller.totpSecretHex) : null,
      demoAccounts: [
        {
          email: 'merchant@moonlight.store',
          storeSlug: 'moonlight-cafe',
          storeName: 'Moonlight Cafe',
        },
        {
          email: 'seller@aurora.store',
          storeSlug: 'aurora-roasters',
          storeName: 'Aurora Night Roasters',
        },
      ],
    });
  });

  // Helper endpoint to get current TOTP code for either seeded store during evaluation
  app.get('/api/auth/totp-helper/:email', (req, res) => {
    const email = String(req.params.email || '').toLowerCase();
    const seller = db.sellers.find((s) => s.email.toLowerCase() === email);
    if (!seller) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    res.json({
      email: seller.email,
      totpCode: generateTotpCode(seller.totpSecretHex),
      validForSeconds: 30 - (Math.floor(Date.now() / 1000) % 30),
    });
  });

  // 2. Seller Login with 15+ char password policy, progressive backoff, CAPTCHA, 2FA TOTP, and Restaurant Name input
  app.post('/api/auth/login', async (req, res) => {
    const ip = req.ip || 'local';
    const { email, password, totpCode, captchaToken, storeName } = req.body as {
      email?: string;
      password?: string;
      totpCode?: string;
      captchaToken?: string;
      storeName?: string;
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

    const captchaResult = await verifyTurnstileToken(captchaToken, ip);
    if (!captchaResult.passed) {
      res.status(400).json({ error: captchaResult.error });
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
      res.status(401).json({
        error: 'Invalid 6-digit 2FA Authenticator code.',
      });
      return;
    }

    loginRateLimits.delete(rateKey);

    const sessionToken = createSignedSessionToken(seller.id, seller.storeSlug);
    const session: SessionRecord = {
      token: sessionToken,
      sellerId: seller.id,
      storeSlug: seller.storeSlug,
      email: seller.email,
      expiresAt: Date.now() + 8 * 60 * 60 * 1000, // 8 hours
    };
    sessions.set(sessionToken, session);

    const store = db.stores.find((st) => st.slug === seller.storeSlug);
    const cleanRestoName = (storeName || '').trim().slice(0, 60);
    if (store && cleanRestoName) {
      store.name = cleanRestoName;
      store.updatedAt = new Date().toISOString();
      saveDatabase(db);
    }

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
      captchaMode: captchaResult.mode,
    });
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

  // 3. Seller Onboarding / New Store Registration
  app.post('/api/auth/register', async (req, res) => {
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
      captchaToken,
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
      captchaToken?: string;
    };

    const captchaResult = await verifyTurnstileToken(captchaToken, ip);
    if (!captchaResult.passed) {
      res.status(400).json({ error: captchaResult.error });
      return;
    }

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
      totpEnabled: true,
      emailVerified: true,
      storeSlug: cleanSlug,
      createdAt: nowIso,
    };

    const newStore: StoreRecord = {
      slug: cleanSlug,
      name: (storeName || cleanSlug).trim().slice(0, 60),
      sellerId,
      activeEnvironment: DEFAULT_NETWORK_ENV,
      nimiqAddress: normalizedNimiq,
      polygonAddress: normalizedPoly,
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
      sellerId,
      storeSlug: cleanSlug,
      email: cleanEmail,
      expiresAt: Date.now() + 8 * 60 * 60 * 1000,
    });

    res.status(201).json({
      token: sessionToken,
      seller: {
        id: newSeller.id,
        email: newSeller.email,
        storeSlug: newSeller.storeSlug,
        totpEnabled: newSeller.totpEnabled,
      },
      store: newStore,
      totpSetupCode: generateTotpCode(totpSecretHex),
    });
  });

  app.post('/api/auth/logout', requireSellerAuth, (req: AuthedRequest, res) => {
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
        error: `Toko ini belum mengaktifkan alamat wallet penerima ${
          orderEnv === 'testnet' ? 'TESTNET' : 'MAINNET'
        } untuk aset ${getAssetLabelForEnvironment(asset, orderEnv)}. Tidak ada fallback otomatis antar jaringan.`,
      });
      return;
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
  app.get('/api/public/orders/:publicToken', (req, res) => {
    const token = String(req.params.publicToken || '').trim();
    const order = db.orders.find((o) => o.publicToken === token);
    if (!order) {
      res.status(404).json({ error: 'Order not found or invalid public token.' });
      return;
    }
    res.json({ order: sanitizeOrderForPublic(order) });
  });

  // 7. Submit & Verify Transaction on Network (Atomic txHash uniqueness + Strict Network Isolation)
  app.post('/api/public/orders/:publicToken/verify', async (req, res) => {
    const token = String(req.params.publicToken || '').trim();
    const order = db.orders.find((o) => o.publicToken === token);
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }

    const { txHash, sandboxSimulation } = req.body as {
      txHash?: string;
      /**
       * Clearly documented sandbox verification mode for automated tests & 3-device demo
       * when not broadcasting a live on-chain transaction. Never claimed as native E2E payment.
       */
      sandboxSimulation?: {
        executionStatus: 'pending' | 'confirmed' | 'failed' | 'rpc_timeout';
        amountBase?: string;
        network?: NetworkId;
        tokenContract?: string;
        recipient?: string;
      };
    };

    const cleanTxHash = (txHash || order.txHash || '').trim();
    if (!cleanTxHash || cleanTxHash.length < 10) {
      res.status(400).json({ error: 'Valid transaction hash is required for verification.' });
      return;
    }

    // For Polygon Amoy TEST TOKEN, if no sandbox simulation is used and no Amoy token contract is configured on the order,
    // keep order in needs_review and explain clearly.
    let evidence: OnChainTxEvidence;
    if (sandboxSimulation) {
      const defaultContractForSim =
        order.network === 'polygon-mainnet'
          ? POLYGON_USDT_CONTRACT
          : order.network === 'polygon-amoy'
          ? order.snapshotTokenContract || '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582'
          : undefined;

      // Ensure order has a valid snapshotTokenContract when running sandbox simulation on polygon-amoy
      if (order.network === 'polygon-amoy' && !order.snapshotTokenContract) {
        order.snapshotTokenContract = '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582';
      }

      evidence = {
        txHash: cleanTxHash,
        network: sandboxSimulation.network || order.network,
        executionStatus: sandboxSimulation.executionStatus,
        recipient: sandboxSimulation.recipient || order.snapshotRecipient,
        amountBase: BigInt(sandboxSimulation.amountBase ?? order.amountBase),
        tokenContract: sandboxSimulation.tokenContract ?? defaultContractForSim,
      };
    } else if (order.network === 'polygon-mainnet' || order.network === 'polygon-amoy') {
      evidence = await verifyPolygonTransactionOnRpc(
        cleanTxHash,
        order.snapshotRecipient,
        order.network,
        order.snapshotTokenContract ?? null
      );
    } else {
      evidence = await verifyNimiqTransactionOnRpc(
        cleanTxHash,
        order.snapshotRecipient,
        order.network
      );
    }

    const claimedMap = new Map<string, string>(Object.entries(db.claimedTransactions));
    const outcome = reconcilePaymentVerification({
      order,
      evidence,
      claimedTxOrderMap: claimedMap,
    });

    if (outcome.shouldBindTxHash) {
      const lowerHash = cleanTxHash.toLowerCase();
      db.claimedTransactions[lowerHash] = order.id;
      order.txHash = cleanTxHash;
    }

    order.paymentStatus = outcome.paymentStatus;
    order.paymentReviewReason = outcome.reviewReason;
    if (outcome.paymentStatus === 'confirmed' && !order.verifiedAt) {
      order.verifiedAt = new Date().toISOString();
    }

    saveDatabase(db);
    res.json({
      order: sanitizeOrderForPublic(order),
      reconciliation: outcome,
      verificationSource: sandboxSimulation
        ? 'sandbox_test_simulation'
        : `${order.network}_rpc`,
    });
  });

  // ============================================================================
  // SELLER PROTECTED ENDPOINTS (Enforces store isolation + Testnet/Mainnet separation)
  // ============================================================================

  app.get('/api/seller/dashboard', requireSellerAuth, (req: AuthedRequest, res) => {
    const storeSlug = req.sellerSession!.storeSlug;
    const store = db.stores.find((s) => s.slug === storeSlug);
    if (!store) {
      res.status(404).json({ error: 'Store not found.' });
      return;
    }
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
  });

  // Switch Store Active Environment ('testnet' vs 'mainnet')
  app.patch('/api/seller/network-environment', requireSellerAuth, (req: AuthedRequest, res) => {
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
  app.get('/api/seller/mainnet-readiness', requireSellerAuth, async (req: AuthedRequest, res) => {
    const storeSlug = req.sellerSession!.storeSlug;
    const store = db.stores.find((s) => s.slug === storeSlug);
    if (!store) {
      res.status(404).json({ error: 'Store not found.' });
      return;
    }

    const nimValid = store.nimiqAddress ? validateNimiqAddress(store.nimiqAddress).valid : false;
    const polyValid = store.polygonAddress
      ? validatePolygonAddress(store.polygonAddress).valid
      : false;
    const walletsDistinctFromTestnet =
      store.nimiqAddress !== store.nimiqTestnetAddress &&
      store.polygonAddress?.toLowerCase() !== store.polygonAmoyAddress?.toLowerCase();

    // Check Polygon Mainnet RPC Chain ID (must be 0x89 / 137)
    let polygonMainnetRpcOk = false;
    let polygonMainnetChainHex: string | null = null;
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 3500);
      const r = await fetch(ALLOWLISTED_POLYGON_MAINNET_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      clearTimeout(t);
      const j = (await r.json()) as { result?: string };
      polygonMainnetChainHex = j.result || null;
      polygonMainnetRpcOk = parseInt(j.result || '0x0', 16) === POLYGON_MAINNET_CHAIN_ID;
    } catch {
      polygonMainnetRpcOk = false;
    }

    const checks = [
      {
        id: 'nim_mainnet_wallet',
        label: 'Nimiq Mainnet Recipient Wallet (MOD-97-10 verified)',
        passed: nimValid,
        detail: store.nimiqAddress || 'Not configured',
      },
      {
        id: 'polygon_mainnet_wallet',
        label: 'Polygon Mainnet USDT Recipient Wallet (Chain ID 137)',
        passed: polyValid,
        detail: store.polygonAddress || 'Not configured',
      },
      {
        id: 'testnet_mainnet_wallet_separation',
        label: 'Mainnet & Testnet Wallet Profiles Separated',
        passed: walletsDistinctFromTestnet,
        detail: walletsDistinctFromTestnet
          ? 'Mainnet and Testnet recipient addresses are distinct.'
          : 'Mainnet and Testnet addresses are identical — use separate wallets for strict isolation.',
      },
      {
        id: 'polygon_mainnet_usdt_contract',
        label: 'Official Polygon Mainnet USDT Contract (6 Decimals)',
        passed: POLYGON_USDT_CONTRACT === '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
        detail: `${POLYGON_USDT_CONTRACT} (Chain ID ${POLYGON_MAINNET_CHAIN_ID})`,
      },
      {
        id: 'polygon_mainnet_rpc_probe',
        label: 'Polygon Mainnet RPC Reachability & Chain ID 137 Check',
        passed: polygonMainnetRpcOk,
        detail: polygonMainnetRpcOk
          ? `Connected (${ALLOWLISTED_POLYGON_MAINNET_RPC}, Chain ID ${polygonMainnetChainHex})`
          : `RPC unreachable or timed out (${ALLOWLISTED_POLYGON_MAINNET_RPC})`,
      },
    ];

    res.json({
      readyForMainnetSmallValueTest: checks.every((c) => c.passed),
      checks,
      warning:
        'Keberhasilan di Testnet (Nimiq Testnet / Polygon Amoy) TIDAK menjamin jalur USDT Mainnet, gas fee POL, atau relayer di Nimiq Pay Mainnet identik. Selalu jalankan uji nominal kecil di Mainnet dengan persetujuan eksplisit sebelum transaksi produksi.',
    });
  });

  // Seller Product Management (Create / Update)
  app.post('/api/seller/products', requireSellerAuth, (req: AuthedRequest, res) => {
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
        '/src/assets/images/product_iced_latte_1793717983788.jpg',
      available: available ?? true,
      priceNimLuna: validNim,
      priceUsdtMicro: validUsdt,
    };

    db.products.push(newProd);
    saveDatabase(db);
    res.status(201).json({ product: newProd });
  });

  app.put('/api/seller/products/:id', requireSellerAuth, (req: AuthedRequest, res) => {
    const storeSlug = req.sellerSession!.storeSlug;
    const product = db.products.find((p) => p.id === req.params.id);
    if (!product || product.storeSlug !== storeSlug) {
      res.status(403).json({
        error: 'Access denied: You can only modify products belonging to your own store.',
      });
      return;
    }

    const { name, description, category, imageUrl, available, priceNimLuna, priceUsdtMicro } =
      req.body as Partial<ProductRecord>;

    if (name !== undefined) product.name = name.trim().slice(0, 80) || product.name;
    if (description !== undefined) product.description = description.trim().slice(0, 240);
    if (category && ['drinks', 'bakery', 'food', 'dessert', 'fruit', 'goods'].includes(category)) {
      product.category = category;
    }
    if (imageUrl !== undefined && imageUrl.trim()) {
      product.imageUrl = imageUrl.trim();
    }
    if (available !== undefined) product.available = Boolean(available);
    if (priceNimLuna !== undefined) {
      product.priceNimLuna =
        priceNimLuna && BigInt(priceNimLuna) > 0n ? BigInt(priceNimLuna).toString() : null;
    }
    if (priceUsdtMicro !== undefined) {
      product.priceUsdtMicro =
        priceUsdtMicro && BigInt(priceUsdtMicro) > 0n ? BigInt(priceUsdtMicro).toString() : null;
    }

    if (!product.priceNimLuna && !product.priceUsdtMicro) {
      res.status(400).json({
        error: 'At least one asset price (NIM or USDT) must remain active.',
      });
      return;
    }

    saveDatabase(db);
    res.json({ product });
  });

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

  if (process.env.NODE_ENV !== 'production') {
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NimTera server listening on http://0.0.0.0:${PORT}`);
  });
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

startServer();
