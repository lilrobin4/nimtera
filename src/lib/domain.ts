/**
 * Core pure domain logic for NimTera:
 * - Integer / BigInt NIM arithmetic in Luna
 * - Nimiq MOD-97-10 address checksum validation
 * - Cart compatibility & server-authoritative order calculation
 * - Order-bound Nimiq payment URIs
 * - On-chain payment verification & reconciliation state machine
 * - Seller password policy (>= 15 chars + breached check)
 * - Audio announcement deduplication
 */

export type PaymentAsset = 'NIM';
/** Read-only compatibility for existing orders. Never accepted for new payments. */
export type HistoricalAsset = PaymentAsset | 'USDT';
export type NetworkEnvironment = 'testnet' | 'mainnet';
export type NetworkId = 'nimiq-testnet' | 'nimiq-mainnet';
/** Archived identifiers only: no RPC, wallet or payment implementation remains. */
export type HistoricalNetwork = NetworkId | 'polygon-amoy' | 'polygon-mainnet';
export function isActiveNimOrder(order: {asset: unknown; network: unknown; environment?: unknown}): boolean {
  return order.asset === 'NIM' && order.network === 'nimiq-testnet' && order.environment === 'testnet';
}
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
export interface NetworkConfiguration {
  id: NetworkId;
  environment: NetworkEnvironment;
  asset: PaymentAsset;
  /** Display label for the asset — 'NIM (TESTNET)' on Nimiq Testnet */
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
    defaultRpcUrl: 'https://rpc.testnet.nimiqwatch.com',
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

};

export function resolveNetworkId(
  asset: PaymentAsset,
  environment: NetworkEnvironment = 'mainnet'
): NetworkId {
  if (environment === 'testnet') {
    if (asset !== 'NIM') throw new Error('Only NIM payments are supported.');
    return 'nimiq-testnet';
  }
  if (asset !== 'NIM') throw new Error('Only NIM payments are supported.');
  return 'nimiq-mainnet';
}

export function getNetworkEnvironment(network: NetworkId): NetworkEnvironment {
  return network === 'nimiq-testnet' ? 'testnet' : 'mainnet';
}

export function getAssetLabelForEnvironment(
  asset: PaymentAsset,
  environment: NetworkEnvironment = 'mainnet'
): string {
  if (environment === 'testnet') {
    return 'NIM (TESTNET)';
  }
  return asset;
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
    /** @deprecated Retained unchanged for stored historical records; never priced or edited. */
  priceUsdtMicro?: string | null;
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
  asset: HistoricalAsset;
  /** Original display label preserved for historical receipts. */
  assetLabel?: string;
  network: HistoricalNetwork;
  /** Legacy receipt metadata, read-only. */
  snapshotChainId?: number | null;
  /** Legacy receipt metadata, read-only. */
  snapshotTokenContract?: string | null;
  /** Snapshot of merchant wallet at order creation time (never mutated when merchant updates wallet) */
  snapshotRecipient: string;
  /** Total in smallest integer unit (Luna (or original units for archived records)) stored as decimal string for JSON safety */
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
  paymentBinding?: 'invoice-memo' | 'seller-reviewed-address' | 'unique-amount';
  matchingMode?: 'unique-amount-v1';
  subtotalBase?: string;
  paymentCodeLuna?: string;
  autoMatchCheckedAt?: string;
  autoMatchState?: 'watching' | 'unavailable' | 'limited' | 'needs_review' | 'confirmed';
  txHash?: string;
  paymentVerificationAttemptedAt?: string;
  payerAddress?: string;
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

export function formatAssetAmount(
  baseUnits: bigint | string,
  asset: PaymentAsset,
  environment: NetworkEnvironment = 'mainnet'
): string {
  const label = getAssetLabelForEnvironment(asset, environment);
  if (asset !== 'NIM') throw new Error('Only NIM payments are supported.');
  return `${formatLunaToNim(baseUnits)} ${label}`;
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
 * Reports products without a valid NIM price.
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
      product.priceNimLuna;

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
  const memo = `NimTera ${envTag}${params.orderNumber} ${params.publicToken}`;
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
 * On-chain payment verification & reconciliation input and output types.
 */
export interface OnChainTxEvidence {
  txHash: string;
  network: HistoricalNetwork;
  /** 'pending' if still in mempool / unconfirmed, 'confirmed' if mined/finalized, 'failed' if reverted, 'rpc_timeout' if upstream timed out */
  executionStatus: 'pending' | 'confirmed' | 'failed' | 'rpc_timeout' | 'unverified';
  invalidReason?: string;
  recipient: string;
  /** Actual amount transferred in smallest unit (Luna (or original units for archived records)) */
  amountBase: bigint;
  /** Original receipt metadata only. */
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
  if (order.asset !== 'NIM' || !['nimiq-testnet','nimiq-mainnet'].includes(order.network)) return {paymentStatus: order.paymentStatus, reviewReason: 'Archived payment method. Read-only history.', shouldBindTxHash: false};

  // A verified receipt is terminal; public requests cannot erase it.
  if (order.paymentStatus === 'confirmed') return { paymentStatus: 'confirmed', shouldBindTxHash: false };
  if (evidence.executionStatus === 'unverified') return { paymentStatus: 'needs_review', reviewReason: evidence.invalidReason || 'Network evidence could not be verified.', shouldBindTxHash: false };
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
      paymentStatus: 'pending',
      reviewReason: 'Network RPC timed out while checking confirmation. Will retry verification.',
      shouldBindTxHash: false,
    };
  }

  // 3. Reverted / failed on-chain execution
  if (evidence.executionStatus === 'failed') {
    return {
      paymentStatus: 'failed',
      reviewReason: 'On-chain transaction execution failed or reverted.',
      shouldBindTxHash: false,
    };
  }

  // 4. Wrong chain / network guard (strictly blocks testnet tx on mainnet order and vice versa)
  if (evidence.network !== order.network) {
    return {
      paymentStatus: 'needs_review',
      reviewReason: `Network mismatch: order requires ${order.network}, but transaction is on ${evidence.network}. Cross-network fallback is strictly prohibited.`,
      shouldBindTxHash: false,
    };
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
      shouldBindTxHash: false,
    };
  }

  // 8. Check exact amount in smallest integer units
  const expectedAmount = BigInt(order.amountBase);
  if (evidence.amountBase < expectedAmount) {
    return {
      paymentStatus: 'needs_review',
      reviewReason: `Underpayment detected: expected ${order.amountBase} base units, received ${evidence.amountBase.toString()}.`,
      shouldBindTxHash: false,
    };
  }
  if (evidence.amountBase > expectedAmount) {
    return {
      paymentStatus: 'needs_review',
      reviewReason: `Overpayment detected: expected ${order.amountBase} base units, received ${evidence.amountBase.toString()}.`,
      shouldBindTxHash: false,
    };
  }

  // 9. Check if paid after order expiration window
  const nowMs = params.nowIso ? Date.parse(params.nowIso) : Date.now();
  const expiresMs = Date.parse(order.expiresAt);
  if (!Number.isNaN(expiresMs) && nowMs > expiresMs) {
    return {
      paymentStatus: 'needs_review',
      reviewReason: 'Payment confirmed on-chain after the order expiration window; merchant review required.',
      shouldBindTxHash: false,
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
