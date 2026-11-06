/**
 * Core pure domain logic for NimTera:
 * - Integer / BigInt monetary arithmetic (Luna for NIM, micro-USDT for Polygon USDT)
 * - Nimiq MOD-97-10 address checksum validation & Polygon address validation
 * - Cart compatibility & server-authoritative order calculation
 * - Payment URI / ERC-20 calldata encoding
 * - On-chain payment verification & reconciliation state machine
 * - Seller password policy (>= 15 chars + breached check)
 * - Audio announcement deduplication
 */

export type PaymentAsset = 'NIM' | 'USDT';
export type NetworkEnvironment = 'testnet' | 'mainnet';
export type NetworkId =
  | 'nimiq-testnet'
  | 'nimiq-mainnet'
  | 'polygon-amoy'
  | 'polygon-mainnet';
export type FulfillmentMode = 'pickup' | 'delivery' | 'dine_in';

export type PaymentStatus =
  | 'unpaid'
  | 'pending'
  | 'confirmed'
  | 'failed'
  | 'expired'
  | 'needs_review';

export type FulfillmentStatus =
  | 'new'
  | 'preparing'
  | 'ready'
  | 'completed'
  | 'canceled';

export const DEFAULT_NETWORK_ENV: NetworkEnvironment = 'testnet';
export const LUNA_PER_NIM = 100_000n; // 1 NIM = 10^5 Luna (5 decimals)
export const MICRO_PER_USDT = 1_000_000n; // 1 USDT / TEST TOKEN = 10^6 micro units (6 decimals)
export const POLYGON_MAINNET_CHAIN_ID = 137;
export const POLYGON_AMOY_CHAIN_ID = 80002;
export const POLYGON_USDT_CONTRACT = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
export const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export interface NetworkConfiguration {
  id: NetworkId;
  environment: NetworkEnvironment;
  asset: PaymentAsset;
  /** Display label for the asset — strictly 'TEST TOKEN' on Polygon Amoy and 'NIM (TESTNET)' on Nimiq Testnet */
  assetDisplayLabel: string;
  networkDisplayName: string;
  chainId: number | null;
  chainIdHex: string | null;
  nimiqNetworkName: 'test-albatross' | 'main-albatross' | null;
  nimiqNetworkIdNumber: number | null;
  defaultRpcUrl: string;
  explorerBaseUrl: string;
  tokenContract: string | null;
  isRealFunds: boolean;
}

export const NETWORK_CONFIGS: Record<NetworkId, NetworkConfiguration> = {
  'nimiq-testnet': {
    id: 'nimiq-testnet',
    environment: 'testnet',
    asset: 'NIM',
    assetDisplayLabel: 'NIM (TESTNET)',
    networkDisplayName: 'Nimiq Testnet (test-albatross)',
    chainId: null,
    chainIdHex: null,
    nimiqNetworkName: 'test-albatross',
    nimiqNetworkIdNumber: 5,
    defaultRpcUrl: 'https://rpc.nimiq-testnet.com',
    explorerBaseUrl: 'https://wallet.nimiq-testnet.com',
    tokenContract: null,
    isRealFunds: false,
  },
  'nimiq-mainnet': {
    id: 'nimiq-mainnet',
    environment: 'mainnet',
    asset: 'NIM',
    assetDisplayLabel: 'NIM',
    networkDisplayName: 'Nimiq Mainnet (main-albatross)',
    chainId: null,
    chainIdHex: null,
    nimiqNetworkName: 'main-albatross',
    nimiqNetworkIdNumber: 24,
    defaultRpcUrl: 'https://rpc.nimiq.network',
    explorerBaseUrl: 'https://nimiq.watch',
    tokenContract: null,
    isRealFunds: true,
  },
  'polygon-amoy': {
    id: 'polygon-amoy',
    environment: 'testnet',
    asset: 'USDT',
    assetDisplayLabel: 'TEST TOKEN',
    networkDisplayName: 'Polygon Amoy Testnet (Chain ID 80002)',
    chainId: POLYGON_AMOY_CHAIN_ID,
    chainIdHex: '0x13882',
    nimiqNetworkName: null,
    nimiqNetworkIdNumber: null,
    defaultRpcUrl: 'https://rpc-amoy.polygon.technology',
    explorerBaseUrl: 'https://amoy.polygonscan.com',
    tokenContract: null, // Must NEVER use Mainnet USDT contract; configured per store/env after explicit approval
    isRealFunds: false,
  },
  'polygon-mainnet': {
    id: 'polygon-mainnet',
    environment: 'mainnet',
    asset: 'USDT',
    assetDisplayLabel: 'USDT',
    networkDisplayName: 'Polygon Mainnet (Chain ID 137)',
    chainId: POLYGON_MAINNET_CHAIN_ID,
    chainIdHex: '0x89',
    nimiqNetworkName: null,
    nimiqNetworkIdNumber: null,
    defaultRpcUrl: 'https://polygon-rpc.com',
    explorerBaseUrl: 'https://polygonscan.com',
    tokenContract: POLYGON_USDT_CONTRACT,
    isRealFunds: true,
  },
};

export function resolveNetworkId(
  asset: PaymentAsset,
  environment: NetworkEnvironment = 'mainnet'
): NetworkId {
  if (environment === 'testnet') {
    return asset === 'NIM' ? 'nimiq-testnet' : 'polygon-amoy';
  }
  return asset === 'NIM' ? 'nimiq-mainnet' : 'polygon-mainnet';
}

export function getNetworkEnvironment(network: NetworkId): NetworkEnvironment {
  return network === 'nimiq-testnet' || network === 'polygon-amoy' ? 'testnet' : 'mainnet';
}

export function getAssetLabelForEnvironment(
  asset: PaymentAsset,
  environment: NetworkEnvironment = 'mainnet'
): string {
  if (environment === 'testnet') {
    return asset === 'NIM' ? 'NIM (TESTNET)' : 'TEST TOKEN';
  }
  return asset;
}

/**
 * Validates a Polygon Amoy Test Token contract address.
 * Strictly forbids using the Polygon Mainnet USDT contract address (0xc2132D05D31c914a87C6611C10748AEb04B58e8F) on Amoy.
 */
export function validateAmoyTestTokenContract(contractAddress: string): {
  valid: boolean;
  normalized: string | null;
  reason?: string;
} {
  const clean = contractAddress.trim();
  if (!clean) {
    return { valid: true, normalized: null };
  }
  const addrCheck = validatePolygonAddress(clean);
  if (!addrCheck.valid) {
    return { valid: false, normalized: null, reason: addrCheck.reason };
  }
  if (addrCheck.normalized.toLowerCase() === POLYGON_USDT_CONTRACT.toLowerCase()) {
    return {
      valid: false,
      normalized: null,
      reason:
        'DILARANG menggunakan alamat kontrak USDT Mainnet (0xc2132D...) sebagai kontrak TEST TOKEN di Polygon Amoy Testnet (Chain ID 80002).',
    };
  }
  return { valid: true, normalized: addrCheck.normalized };
}

export type ProductCategory = 'food' | 'drinks' | 'dessert' | 'fruit' | 'bakery' | 'goods';

export const MENU_CATEGORY_COLUMNS: Array<{
  id: ProductCategory;
  titleId: string;
  titleEn: string;
  subtitleId: string;
  accentClass: string;
}> = [
  {
    id: 'food',
    titleId: 'Makanan',
    titleEn: 'Food & Mains',
    subtitleId: 'Hidangan utama & sajian mengenyangkan',
    accentClass: 'bg-amber-100/90 text-amber-900 border-amber-300',
  },
  {
    id: 'drinks',
    titleId: 'Minuman',
    titleEn: 'Drinks & Coffee',
    subtitleId: 'Kopi dingin, matcha, & teh segar',
    accentClass: 'bg-teal-100/90 text-teal-900 border-teal-300',
  },
  {
    id: 'dessert',
    titleId: 'Dessert',
    titleEn: 'Desserts',
    subtitleId: 'Hidangan penutup manis & parfait',
    accentClass: 'bg-rose-100/90 text-rose-900 border-rose-300',
  },
  {
    id: 'fruit',
    titleId: 'Buah Segar',
    titleEn: 'Fresh Fruits',
    subtitleId: 'Buah potong tropis & bowl segar',
    accentClass: 'bg-emerald-100/90 text-emerald-900 border-emerald-300',
  },
  {
    id: 'bakery',
    titleId: 'Bakery & Roti',
    titleEn: 'Bakery & Pastry',
    subtitleId: 'Croissant mentega & pastry hangat',
    accentClass: 'bg-orange-100/90 text-orange-900 border-orange-300',
  },
  {
    id: 'goods',
    titleId: 'Lainnya / Merchandise',
    titleEn: 'Goods & Beans',
    subtitleId: 'Biji kopi & keramik eksklusif',
    accentClass: 'bg-stone-200/90 text-stone-800 border-stone-300',
  },
];

export interface ProductRecord {
  id: string;
  storeSlug: string;
  name: string;
  description: string;
  category: ProductCategory;
  imageUrl: string;
  available: boolean;
  /** Price in Luna (1 NIM = 100,000 Luna), null if NIM not supported for this product */
  priceNimLuna: string | null;
  /** Price in micro-USDT (1 USDT = 1,000,000 micro-USDT), null if USDT not supported */
  priceUsdtMicro: string | null;
}

export interface CartItemInput {
  productId: string;
  quantity: number;
}

export interface OrderItemSnapshot {
  productId: string;
  name: string;
  quantity: number;
  unitPriceBase: string;
  lineTotalBase: string;
  imageUrl: string;
}

export interface OrderSnapshot {
  id: string;
  publicToken: string;
  orderNumber: string;
  storeSlug: string;
  storeName: string;
  /** Strictly locked environment at order creation time ('testnet' | 'mainnet') */
  environment?: NetworkEnvironment;
  asset: PaymentAsset;
  /** Display label locked at creation time ('NIM (TESTNET)', 'TEST TOKEN', 'NIM', or 'USDT') */
  assetLabel?: string;
  network: NetworkId;
  /** Locked Chain ID at order creation time (80002 for Amoy, 137 for Polygon Mainnet, null for Nimiq) */
  snapshotChainId?: number | null;
  /** Locked token contract address at order creation time (for Polygon Amoy TEST TOKEN or Polygon Mainnet USDT) */
  snapshotTokenContract?: string | null;
  /** Snapshot of merchant wallet at order creation time (never mutated when merchant updates wallet) */
  snapshotRecipient: string;
  /** Total in smallest integer unit (Luna or micro-USDT) stored as decimal string for JSON safety */
  amountBase: string;
  amountFormatted: string;
  items: OrderItemSnapshot[];
  fulfillmentMode: FulfillmentMode;
  tableOrNote: string;
  deliveryInfo?: {
    recipientName: string;
    phone: string;
    address: string;
  };
  paymentStatus: PaymentStatus;
  paymentReviewReason?: string;
  manualPaymentNote?: string;
  txHash?: string;
  verifiedAt?: string;
  fulfillmentStatus: FulfillmentStatus;
  createdAt: string;
  expiresAt: string;
}

/**
 * Parse a human-entered decimal string into base integer units (BigInt) without floating point.
 */
export function parseDecimalToBaseUnits(input: string, decimals: number): bigint | null {
  const trimmed = input.trim();
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) {
    return null;
  }
  const [wholePart, fracPart = ''] = trimmed.split('.');
  if (fracPart.length > decimals) {
    return null;
  }
  const paddedFrac = fracPart.padEnd(decimals, '0');
  const combined = `${wholePart}${paddedFrac}`.replace(/^0+(?=\d)/, '');
  try {
    const val = BigInt(combined);
    return val > 0n ? val : null;
  } catch {
    return null;
  }
}

export function parseNimToLuna(nimInput: string): bigint | null {
  return parseDecimalToBaseUnits(nimInput, 5);
}

export function parseUsdtToMicro(usdtInput: string): bigint | null {
  return parseDecimalToBaseUnits(usdtInput, 6);
}

export function formatBaseUnitsToDecimal(
  baseUnits: bigint | string,
  decimals: number,
  minFractionDigits = 0
): string {
  const val = typeof baseUnits === 'string' ? BigInt(baseUnits) : baseUnits;
  const isNegative = val < 0n;
  const absVal = isNegative ? -val : val;
  const str = absVal.toString().padStart(decimals + 1, '0');
  const whole = str.slice(0, str.length - decimals);
  let frac = str.slice(str.length - decimals).replace(/0+$/, '');
  if (frac.length < minFractionDigits) {
    frac = frac.padEnd(minFractionDigits, '0');
  }
  const sign = isNegative ? '-' : '';
  return frac.length > 0 ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
}

export function formatLunaToNim(luna: bigint | string): string {
  return formatBaseUnitsToDecimal(luna, 5, 0);
}

export function formatMicroToUsdt(micro: bigint | string): string {
  return formatBaseUnitsToDecimal(micro, 6, 2);
}

export function formatAssetAmount(
  baseUnits: bigint | string,
  asset: PaymentAsset,
  environment: NetworkEnvironment = 'mainnet'
): string {
  const label = getAssetLabelForEnvironment(asset, environment);
  return asset === 'NIM'
    ? `${formatLunaToNim(baseUnits)} ${label}`
    : `${formatMicroToUsdt(baseUnits)} ${label}`;
}

/**
 * Official Nimiq IBAN-style MOD-97-10 checksum calculation and validation.
 * Nimiq addresses are 'NQ' + 2 check digits + 32 base32 chars from alphabet 0123456789ABCDEFGHJKLMNPQRSTUVXY.
 */
const NIMIQ_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVXY';

function nimiqIbanCheck(str: string): number {
  const numStr = str
    .split('')
    .map((ch) => {
      const code = ch.toUpperCase().charCodeAt(0);
      if (code >= 48 && code <= 57) return ch;
      return (code - 55).toString();
    })
    .join('');

  let remainder = 0;
  for (let i = 0; i < numStr.length; i += 6) {
    const chunk = remainder.toString() + numStr.slice(i, i + 6);
    remainder = parseInt(chunk, 10) % 97;
  }
  return remainder;
}

export function createValidNimiqAddress(body32: string): string {
  const cleanBody = body32.replace(/\s+/g, '').toUpperCase();
  if (cleanBody.length !== 32) {
    throw new Error('Nimiq address body must be 32 characters');
  }
  for (const ch of cleanBody) {
    if (!NIMIQ_ALPHABET.includes(ch)) {
      throw new Error(`Invalid Nimiq base32 character: ${ch}`);
    }
  }
  const checkDigits = 98 - nimiqIbanCheck(`${cleanBody}NQ00`);
  const checkStr = checkDigits.toString().padStart(2, '0');
  const raw = `NQ${checkStr}${cleanBody}`;
  return raw.match(/.{1,4}/g)!.join(' ');
}

export function validateNimiqAddress(address: string): {
  valid: boolean;
  normalized: string;
  reason?: string;
} {
  const clean = address.replace(/[\s-]+/g, '').toUpperCase();
  if (!clean.startsWith('NQ')) {
    return { valid: false, normalized: '', reason: 'Must start with NQ' };
  }
  if (clean.length !== 36) {
    return { valid: false, normalized: '', reason: 'Must be 36 characters (excluding spaces)' };
  }
  const checkPart = clean.slice(2, 4);
  if (!/^\d{2}$/.test(checkPart)) {
    return { valid: false, normalized: '', reason: 'Invalid check digits after NQ' };
  }
  const body = clean.slice(4);
  for (const ch of body) {
    if (!NIMIQ_ALPHABET.includes(ch)) {
      return { valid: false, normalized: '', reason: `Invalid character '${ch}' in Nimiq address` };
    }
  }
  if (nimiqIbanCheck(body + clean.slice(0, 4)) !== 1) {
    return { valid: false, normalized: '', reason: 'Nimiq address checksum (MOD-97-10) failed' };
  }
  const formatted = clean.match(/.{1,4}/g)!.join(' ');
  return { valid: true, normalized: formatted };
}

/**
 * Validates Polygon EVM address (0x + 40 hex chars).
 */
export function validatePolygonAddress(address: string): {
  valid: boolean;
  normalized: string;
  reason?: string;
} {
  const clean = address.trim();
  if (!clean.startsWith('0x')) {
    return { valid: false, normalized: '', reason: 'Must start with 0x' };
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(clean)) {
    return { valid: false, normalized: '', reason: 'Must be a 42-character hexadecimal address' };
  }
  if (/^0x0{40}$/.test(clean)) {
    return { valid: false, normalized: '', reason: 'Zero address is not allowed' };
  }
  return { valid: true, normalized: clean };
}

/**
 * Seller password security policy:
 * - Minimum 15 characters
 * - Rejects common/breached passphrases and trivial repetitions
 */
const BREACHED_SUBSTRINGS = [
  'password1234567',
  '123456789012345',
  'qwertyuiopasdfg',
  'admin1234567890',
  'letmein12345678',
  'welcome12345678',
  'iloveyou1234567',
];

export function validateSellerPassword(password: string): {
  valid: boolean;
  reason?: string;
} {
  if (typeof password !== 'string' || password.length < 15) {
    return {
      valid: false,
      reason: 'Password must be at least 15 characters long.',
    };
  }
  if (password.length > 256) {
    return {
      valid: false,
      reason: 'Password must not exceed 256 characters.',
    };
  }
  const lower = password.toLowerCase();
  for (const breached of BREACHED_SUBSTRINGS) {
    if (lower.includes(breached)) {
      return {
        valid: false,
        reason: 'This password appears in common breached password lists. Please choose a unique passphrase.',
      };
    }
  }
  if (/^(.)\1{14,}$/.test(password)) {
    return {
      valid: false,
      reason: 'Password cannot consist of a single repeated character.',
    };
  }
  return { valid: true };
}

/**
 * Server-authoritative cart calculation.
 * Never mixes NIM and USDT. Reports any products in the cart that lack a price in the chosen asset.
 */
export interface CartCalculationResult {
  compatible: boolean;
  environment: NetworkEnvironment;
  asset: PaymentAsset;
  assetLabel: string;
  network: NetworkId;
  totalBase: bigint;
  totalFormatted: string;
  items: OrderItemSnapshot[];
  incompatibleProducts: { productId: string; name: string; missingAsset: PaymentAsset }[];
  unavailableProducts: { productId: string; name: string }[];
}

export function calculateCartTotals(
  cartItems: CartItemInput[],
  catalog: ProductRecord[],
  selectedAsset: PaymentAsset,
  environment: NetworkEnvironment = 'mainnet'
): CartCalculationResult {
  const network: NetworkId = resolveNetworkId(selectedAsset, environment);
  const assetLabel = getAssetLabelForEnvironment(selectedAsset, environment);
  const productMap = new Map(catalog.map((p) => [p.id, p]));

  let totalBase = 0n;
  const snapshots: OrderItemSnapshot[] = [];
  const incompatibleProducts: { productId: string; name: string; missingAsset: PaymentAsset }[] = [];
  const unavailableProducts: { productId: string; name: string }[] = [];

  for (const entry of cartItems) {
    if (!Number.isInteger(entry.quantity) || entry.quantity <= 0) continue;
    const product = productMap.get(entry.productId);
    if (!product || !product.available) {
      unavailableProducts.push({
        productId: entry.productId,
        name: product?.name ?? entry.productId,
      });
      continue;
    }

    const rawUnitPrice =
      selectedAsset === 'NIM' ? product.priceNimLuna : product.priceUsdtMicro;

    if (!rawUnitPrice || BigInt(rawUnitPrice) <= 0n) {
      incompatibleProducts.push({
        productId: product.id,
        name: product.name,
        missingAsset: selectedAsset,
      });
      continue;
    }

    const unitPrice = BigInt(rawUnitPrice);
    const lineTotal = unitPrice * BigInt(entry.quantity);
    totalBase += lineTotal;

    snapshots.push({
      productId: product.id,
      name: product.name,
      quantity: entry.quantity,
      unitPriceBase: unitPrice.toString(),
      lineTotalBase: lineTotal.toString(),
      imageUrl: product.imageUrl,
    });
  }

  const compatible =
    incompatibleProducts.length === 0 &&
    unavailableProducts.length === 0 &&
    snapshots.length > 0 &&
    totalBase > 0n;

  return {
    compatible,
    environment,
    asset: selectedAsset,
    assetLabel,
    network,
    totalBase,
    totalFormatted: formatAssetAmount(totalBase, selectedAsset, environment),
    items: snapshots,
    incompatibleProducts,
    unavailableProducts,
  };
}

/**
 * Builds standard Nimiq URI and order-bound message payload.
 * Preserves explicit network identity (nimiq-testnet vs nimiq-mainnet).
 */
export function buildNimiqPaymentDetails(params: {
  recipient: string;
  amountLuna: bigint | string;
  orderNumber: string;
  publicToken: string;
  network?: 'nimiq-testnet' | 'nimiq-mainnet';
}) {
  const network = params.network || 'nimiq-mainnet';
  const isTestnet = network === 'nimiq-testnet';
  const cleanRecipient = params.recipient.replace(/\s+/g, '');
  const nimDecimal = formatLunaToNim(params.amountLuna);
  const envTag = isTestnet ? 'TESTNET ' : '';
  const memo = `NimTera ${envTag}${params.orderNumber} (${params.publicToken.slice(-8)})`;
  const uri = `nimiq:${cleanRecipient}?amount=${encodeURIComponent(nimDecimal)}&message=${encodeURIComponent(memo)}&network=${encodeURIComponent(network)}`;
  return {
    uri,
    memo,
    network,
    nimiqNetworkName: isTestnet ? 'test-albatross' : 'main-albatross',
    valueLuna: BigInt(params.amountLuna).toString(),
    recipientFormatted: params.recipient,
  };
}

/**
 * Encodes ERC-20 `transfer(address,uint256)` calldata and EIP-681 payment request URI
 * for Polygon Mainnet USDT (Chain ID 137) or Polygon Amoy TEST TOKEN (Chain ID 80002).
 * Never uses the Mainnet USDT contract on Amoy.
 */
export function buildPolygonUsdtTransferDetails(params: {
  recipient: string;
  amountMicro: bigint | string;
  network?: 'polygon-amoy' | 'polygon-mainnet';
  tokenContractOverride?: string | null;
}) {
  const network = params.network || 'polygon-mainnet';
  const isAmoy = network === 'polygon-amoy';
  const chainId = isAmoy ? POLYGON_AMOY_CHAIN_ID : POLYGON_MAINNET_CHAIN_ID;
  const chainIdHex = isAmoy ? '0x13882' : '0x89';
  const tokenContract = isAmoy
    ? params.tokenContractOverride || null
    : POLYGON_USDT_CONTRACT;

  const cleanRecipient = params.recipient.trim().toLowerCase().replace(/^0x/, '');
  const amountBig = typeof params.amountMicro === 'string' ? BigInt(params.amountMicro) : params.amountMicro;
  const amountHex = amountBig.toString(16).padStart(64, '0');
  const addressHex = cleanRecipient.padStart(64, '0');
  const data = `0xa9059cbb${addressHex}${amountHex}`;
  const eip681Uri = tokenContract
    ? `ethereum:${tokenContract}@${chainId}/transfer?address=${params.recipient}&uint256=${amountBig.toString()}`
    : `ethereum:${params.recipient}@${chainId}?value=0`;

  return {
    network,
    chainId,
    chainIdHex,
    tokenContract,
    assetLabel: isAmoy ? 'TEST TOKEN' : 'USDT',
    decimals: 6,
    data,
    eip681Uri,
    amountMicro: amountBig.toString(),
  };
}

/**
 * On-chain payment verification & reconciliation input and output types.
 */
export interface OnChainTxEvidence {
  txHash: string;
  network: NetworkId;
  /** 'pending' if still in mempool / unconfirmed, 'confirmed' if mined/finalized, 'failed' if reverted, 'rpc_timeout' if upstream timed out */
  executionStatus: 'pending' | 'confirmed' | 'failed' | 'rpc_timeout';
  recipient: string;
  /** Actual amount transferred in smallest unit (Luna or micro-USDT) */
  amountBase: bigint;
  /** For Polygon USDT, the token contract that emitted the Transfer event */
  tokenContract?: string;
  /** Optional transaction memo/data for Nimiq transactions */
  memo?: string;
}

export interface ReconciliationOutcome {
  paymentStatus: PaymentStatus;
  reviewReason?: string;
  shouldBindTxHash: boolean;
}

export function reconcilePaymentVerification(params: {
  order: Pick<
    OrderSnapshot,
    | 'id'
    | 'orderNumber'
    | 'publicToken'
    | 'asset'
    | 'network'
    | 'snapshotRecipient'
    | 'snapshotTokenContract'
    | 'amountBase'
    | 'expiresAt'
    | 'paymentStatus'
  >;
  evidence: OnChainTxEvidence;
  /** Map of lowercase txHash -> orderId that already claimed this transaction */
  claimedTxOrderMap: Map<string, string>;
  nowIso?: string;
}): ReconciliationOutcome {
  const { order, evidence, claimedTxOrderMap } = params;
  const normalizedTxHash = evidence.txHash.trim().toLowerCase();

  // 1. Prevent replay / same transaction used across two different orders
  const existingOwnerOrderId = claimedTxOrderMap.get(normalizedTxHash);
  if (existingOwnerOrderId && existingOwnerOrderId !== order.id) {
    return {
      paymentStatus: 'failed',
      reviewReason: 'Transaction hash is already linked to another order (replay rejected).',
      shouldBindTxHash: false,
    };
  }

  // 2. Do not falsely mark failed on RPC timeout
  if (evidence.executionStatus === 'rpc_timeout') {
    return {
      paymentStatus: order.paymentStatus === 'confirmed' ? 'confirmed' : 'pending',
      reviewReason: 'Network RPC timed out while checking confirmation. Will retry verification.',
      shouldBindTxHash: true,
    };
  }

  // 3. Reverted / failed on-chain execution
  if (evidence.executionStatus === 'failed') {
    return {
      paymentStatus: 'failed',
      reviewReason: 'On-chain transaction execution failed or reverted.',
      shouldBindTxHash: true,
    };
  }

  // 4. Wrong chain / network guard (strictly blocks testnet tx on mainnet order and vice versa)
  if (evidence.network !== order.network) {
    return {
      paymentStatus: 'needs_review',
      reviewReason: `Network mismatch: order requires ${order.network}, but transaction is on ${evidence.network}. Cross-network fallback is strictly prohibited.`,
      shouldBindTxHash: true,
    };
  }

  // 5. For Polygon (Mainnet USDT or Amoy TEST TOKEN), verify token contract matches order snapshot contract
  if (order.asset === 'USDT') {
    const expectedContract =
      order.network === 'polygon-amoy'
        ? order.snapshotTokenContract || null
        : order.snapshotTokenContract || POLYGON_USDT_CONTRACT;

    if (!expectedContract) {
      return {
        paymentStatus: 'needs_review',
        reviewReason:
          'Polygon Amoy TEST TOKEN contract was not configured on this order. Cannot verify ERC-20 transfer without an approved Amoy TEST TOKEN contract.',
        shouldBindTxHash: false,
      };
    }

    if (
      order.network === 'polygon-amoy' &&
      expectedContract.toLowerCase() === POLYGON_USDT_CONTRACT.toLowerCase()
    ) {
      return {
        paymentStatus: 'failed',
        reviewReason:
          'Invalid configuration: Polygon Mainnet USDT contract cannot be used on Polygon Amoy Testnet.',
        shouldBindTxHash: false,
      };
    }

    if (
      !evidence.tokenContract ||
      evidence.tokenContract.toLowerCase() !== expectedContract.toLowerCase()
    ) {
      return {
        paymentStatus: 'needs_review',
        reviewReason: `Token contract mismatch on ${order.network}: expected ${expectedContract}.`,
        shouldBindTxHash: true,
      };
    }
  }

  // 6. Verify recipient matches snapshotRecipient
  const normExpectedRecipient = order.snapshotRecipient.replace(/\s+/g, '').toLowerCase();
  const normActualRecipient = evidence.recipient.replace(/\s+/g, '').toLowerCase();
  if (normExpectedRecipient !== normActualRecipient) {
    return {
      paymentStatus: 'failed',
      reviewReason: 'Recipient address in transaction does not match order snapshot recipient.',
      shouldBindTxHash: false,
    };
  }

  // 7. Pending in mempool -> never announce or mark as confirmed yet
  if (evidence.executionStatus === 'pending') {
    return {
      paymentStatus: 'pending',
      reviewReason: 'Transaction submitted and awaiting block confirmation.',
      shouldBindTxHash: true,
    };
  }

  // 8. Check exact amount in smallest integer units
  const expectedAmount = BigInt(order.amountBase);
  if (evidence.amountBase < expectedAmount) {
    return {
      paymentStatus: 'needs_review',
      reviewReason: `Underpayment detected: expected ${order.amountBase} base units, received ${evidence.amountBase.toString()}.`,
      shouldBindTxHash: true,
    };
  }
  if (evidence.amountBase > expectedAmount) {
    return {
      paymentStatus: 'needs_review',
      reviewReason: `Overpayment detected: expected ${order.amountBase} base units, received ${evidence.amountBase.toString()}.`,
      shouldBindTxHash: true,
    };
  }

  // 9. Check if paid after order expiration window
  const nowMs = params.nowIso ? Date.parse(params.nowIso) : Date.now();
  const expiresMs = Date.parse(order.expiresAt);
  if (!Number.isNaN(expiresMs) && nowMs > expiresMs) {
    return {
      paymentStatus: 'needs_review',
      reviewReason: 'Payment confirmed on-chain after the order expiration window; merchant review required.',
      shouldBindTxHash: true,
    };
  }

  // 10. All criteria verified
  return {
    paymentStatus: 'confirmed',
    shouldBindTxHash: true,
  };
}

/**
 * Deduplicates audio announcements so reload, reconnect, duplicate realtime events,
 * or historical transactions never re-trigger chimes or voice announcements.
 */
export function shouldTriggerAudioAnnouncement(params: {
  orderId: string;
  eventType: 'payment_ready' | 'payment_confirmed';
  orderCreatedAtIso: string;
  sessionStartedAtMs: number;
  announcedKeys: Set<string>;
}): boolean {
  const key = `${params.orderId}:${params.eventType}`;
  if (params.announcedKeys.has(key)) {
    return false;
  }
  // Ignore historical orders created more than 60 seconds before the cashier session opened for 'payment_ready'
  const createdMs = Date.parse(params.orderCreatedAtIso);
  if (
    params.eventType === 'payment_ready' &&
    !Number.isNaN(createdMs) &&
    createdMs < params.sessionStartedAtMs - 60_000
  ) {
    return false;
  }
  params.announcedKeys.add(key);
  return true;
}

export type StatusColorTone =
  | 'teal'
  | 'amber'
  | 'orange'
  | 'rose'
  | 'sky'
  | 'champagne'
  | 'slate';

export function getPaymentStatusTone(status: PaymentStatus): StatusColorTone {
  switch (status) {
    case 'confirmed':
      return 'teal';
    case 'pending':
      return 'amber';
    case 'needs_review':
      return 'orange';
    case 'failed':
      return 'rose';
    case 'expired':
      return 'slate';
    case 'unpaid':
    default:
      return 'champagne';
  }
}

export function getFulfillmentStatusTone(status: FulfillmentStatus): StatusColorTone {
  switch (status) {
    case 'completed':
      return 'teal';
    case 'ready':
      return 'sky';
    case 'preparing':
      return 'amber';
    case 'canceled':
      return 'rose';
    case 'new':
    default:
      return 'champagne';
  }
}

export type OrderBadgeStatus = PaymentStatus | FulfillmentStatus | (string & {});

/**
 * Maps an order status to the exact high-contrast Tailwind CSS pill classes:
 * - 'pending' / 'preparing': 'bg-amber-900/30 text-amber-500'
 * - 'confirmed' / 'completed': 'bg-teal-900/30 text-teal-500'
 * - other states: 'bg-slate-800 text-slate-400'
 */
export function getOrderStatusBadgeClasses(status: OrderBadgeStatus): string {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'pending' || normalized === 'preparing') {
    return 'bg-amber-900/30 text-amber-500';
  }
  if (normalized === 'confirmed' || normalized === 'completed') {
    return 'bg-teal-900/30 text-teal-500';
  }
  return 'bg-slate-800 text-slate-400';
}


