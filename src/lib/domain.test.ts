import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNimToLuna,
  formatLunaToNim,
  parseUsdtToMicro,
  formatMicroToUsdt,
  createValidNimiqAddress,
  validateNimiqAddress,
  validatePolygonAddress,
  validateAmoyTestTokenContract,
  validateSellerPassword,
  calculateCartTotals,
  buildNimiqPaymentDetails,
  buildPolygonUsdtTransferDetails,
  reconcilePaymentVerification,
  shouldTriggerAudioAnnouncement,
  getPaymentStatusTone,
  getFulfillmentStatusTone,
  getOrderStatusBadgeClasses,
  POLYGON_USDT_CONTRACT,
  POLYGON_AMOY_CHAIN_ID,
  POLYGON_MAINNET_CHAIN_ID,
  DEFAULT_NETWORK_ENV,
  type ProductRecord,
} from './domain';

test('NIM and Polygon USDT integer monetary conversion has zero floating-point drift', () => {
  assert.equal(parseNimToLuna('40'), 4_000_000n);
  assert.equal(parseNimToLuna('0.12345'), 12_345n);
  assert.equal(parseNimToLuna('0.123456'), null); // > 5 decimals rejected
  assert.equal(formatLunaToNim(4_000_000n), '40');
  assert.equal(formatLunaToNim(4_550_000n), '45.5');

  assert.equal(parseUsdtToMicro('1.20'), 1_200_000n);
  assert.equal(parseUsdtToMicro('0.80'), 800_000n);
  assert.equal(parseUsdtToMicro('1.1234567'), null); // > 6 decimals rejected
  assert.equal(formatMicroToUsdt(2_000_000n), '2.00');
  assert.equal(formatMicroToUsdt(1_250_000n), '1.25');
});

test('Nimiq MOD-97-10 checksum validation accepts valid addresses and rejects tampered ones', () => {
  const validAddr = createValidNimiqAddress('00000000000000000000000000000000');
  const check = validateNimiqAddress(validAddr);
  assert.equal(check.valid, true);
  assert.equal(check.normalized, validAddr);

  // Tamper one character -> checksum must fail
  const tampered = validAddr.slice(0, -1) + 'Y';
  const tamperedCheck = validateNimiqAddress(tampered);
  assert.equal(tamperedCheck.valid, false);
  assert.match(tamperedCheck.reason || '', /checksum/i);
});

test('Polygon address validation enforces 0x hex format and rejects zero address', () => {
  const valid = validatePolygonAddress('0x129A40885B3fe74921c88492A09B6429371b9A40');
  assert.equal(valid.valid, true);

  const zero = validatePolygonAddress('0x0000000000000000000000000000000000000000');
  assert.equal(zero.valid, false);

  const invalidHex = validatePolygonAddress('0x12345');
  assert.equal(invalidHex.valid, false);
});

test('Seller password policy enforces >= 15 characters and blocks breached passphrases', () => {
  assert.equal(validateSellerPassword('shortpass123').valid, false);
  assert.equal(validateSellerPassword('password123456789').valid, false);
  assert.equal(validateSellerPassword('AAAAAAAAAAAAAAA').valid, false);
  assert.equal(validateSellerPassword('Moonlight#NightMarket!2026').valid, true);
});

test('Server-authoritative cart calculation never mixes NIM and USDT and detects missing asset prices', () => {
  const sampleCatalog: ProductRecord[] = [
    {
      id: 'p1',
      storeSlug: 'moonlight-cafe',
      name: 'Iced Latte',
      description: 'Cold brew with milk',
      category: 'drinks',
      imageUrl: '/img/latte.jpg',
      available: true,
      priceNimLuna: '4000000', // 40 NIM
      priceUsdtMicro: '1200000', // 1.20 USDT
    },
    {
      id: 'p2',
      storeSlug: 'moonlight-cafe',
      name: 'Butter Croissant',
      description: 'Flaky pastry',
      category: 'bakery',
      imageUrl: '/img/croissant.jpg',
      available: true,
      priceNimLuna: '3000000', // 30 NIM
      priceUsdtMicro: '800000', // 0.80 USDT
    },
    {
      id: 'p3',
      storeSlug: 'moonlight-cafe',
      name: 'NIM Exclusive Blend',
      description: 'Only priced in NIM',
      category: 'goods',
      imageUrl: '/img/blend.jpg',
      available: true,
      priceNimLuna: '10000000', // 100 NIM
      priceUsdtMicro: null, // No USDT price
    },
  ];

  // 1 Iced Latte + 1 Butter Croissant in NIM = 70 NIM (7,000,000 Luna)
  const nimCalc = calculateCartTotals(
    [
      { productId: 'p1', quantity: 1 },
      { productId: 'p2', quantity: 1 },
    ],
    sampleCatalog,
    'NIM'
  );
  assert.equal(nimCalc.compatible, true);
  assert.equal(nimCalc.totalBase, 7_000_000n);
  assert.equal(nimCalc.totalFormatted, '70 NIM');

  // Same cart in USDT = 2.00 USDT (2,000,000 micro-USDT)
  const usdtCalc = calculateCartTotals(
    [
      { productId: 'p1', quantity: 1 },
      { productId: 'p2', quantity: 1 },
    ],
    sampleCatalog,
    'USDT'
  );
  assert.equal(usdtCalc.compatible, true);
  assert.equal(usdtCalc.totalBase, 2_000_000n);
  assert.equal(usdtCalc.totalFormatted, '2.00 USDT');

  // Adding NIM-only product when paying with USDT must flag incompatibility
  const incompatibleCalc = calculateCartTotals(
    [
      { productId: 'p1', quantity: 1 },
      { productId: 'p3', quantity: 1 },
    ],
    sampleCatalog,
    'USDT'
  );
  assert.equal(incompatibleCalc.compatible, false);
  assert.equal(incompatibleCalc.incompatibleProducts.length, 1);
  assert.equal(incompatibleCalc.incompatibleProducts[0].productId, 'p3');
});

test('Payment verification guards against replay, wrong chain, pending status, RPC timeout, and underpayment', () => {
  const merchantNim = createValidNimiqAddress('M00N11GHTCAFE0000000000000000000');
  const order = {
    id: 'ord_1',
    orderNumber: '#024',
    publicToken: 'nt_ord_abcdef123456',
    asset: 'NIM' as const,
    network: 'nimiq-mainnet' as const,
    snapshotRecipient: merchantNim,
    amountBase: '7000000',
    expiresAt: '2026-12-31T23:59:59.000Z',
    paymentStatus: 'unpaid' as const,
  };

  const claimedMap = new Map<string, string>();

  // 1. Pending tx is never marked confirmed
  const pendingRes = reconcilePaymentVerification({
    order,
    evidence: {
      txHash: '0xtx_pending',
      network: 'nimiq-mainnet',
      executionStatus: 'pending',
      recipient: merchantNim,
      amountBase: 7_000_000n,
    },
    claimedTxOrderMap: claimedMap,
    nowIso: '2026-11-03T12:00:00.000Z',
  });
  assert.equal(pendingRes.paymentStatus, 'pending');

  // 2. RPC timeout does not mark order as failed
  const timeoutRes = reconcilePaymentVerification({
    order,
    evidence: {
      txHash: '0xtx_timeout',
      network: 'nimiq-mainnet',
      executionStatus: 'rpc_timeout',
      recipient: merchantNim,
      amountBase: 0n,
    },
    claimedTxOrderMap: claimedMap,
    nowIso: '2026-11-03T12:00:00.000Z',
  });
  assert.equal(timeoutRes.paymentStatus, 'pending');

  // 3. Underpayment goes to needs_review
  const underpayRes = reconcilePaymentVerification({
    order,
    evidence: {
      txHash: '0xtx_under',
      network: 'nimiq-mainnet',
      executionStatus: 'confirmed',
      recipient: merchantNim,
      amountBase: 6_500_000n,
    },
    claimedTxOrderMap: claimedMap,
    nowIso: '2026-11-03T12:00:00.000Z',
  });
  assert.equal(underpayRes.paymentStatus, 'needs_review');

  // 4. Exact match confirms payment
  const exactRes = reconcilePaymentVerification({
    order,
    evidence: {
      txHash: '0xtx_valid_1',
      network: 'nimiq-mainnet',
      executionStatus: 'confirmed',
      recipient: merchantNim,
      amountBase: 7_000_000n,
    },
    claimedTxOrderMap: claimedMap,
    nowIso: '2026-11-03T12:00:00.000Z',
  });
  assert.equal(exactRes.paymentStatus, 'confirmed');
  claimedMap.set('0xtx_valid_1', order.id);

  // 5. Reusing the same txHash for a second order is rejected
  const secondOrder = { ...order, id: 'ord_2', orderNumber: '#025' };
  const replayRes = reconcilePaymentVerification({
    order: secondOrder,
    evidence: {
      txHash: '0xtx_valid_1',
      network: 'nimiq-mainnet',
      executionStatus: 'confirmed',
      recipient: merchantNim,
      amountBase: 7_000_000n,
    },
    claimedTxOrderMap: claimedMap,
    nowIso: '2026-11-03T12:00:00.000Z',
  });
  assert.equal(replayRes.paymentStatus, 'failed');
  assert.match(replayRes.reviewReason || '', /already linked/i);

  // 6. Polygon USDT requires matching contract address
  const usdtOrder = {
    ...order,
    id: 'ord_3',
    asset: 'USDT' as const,
    network: 'polygon-mainnet' as const,
    snapshotRecipient: '0x129A40885B3fe74921c88492A09B6429371b9A40',
    amountBase: '2000000',
  };
  const wrongTokenRes = reconcilePaymentVerification({
    order: usdtOrder,
    evidence: {
      txHash: '0xpoly_wrong_contract',
      network: 'polygon-mainnet',
      executionStatus: 'confirmed',
      recipient: '0x129A40885B3fe74921c88492A09B6429371b9A40',
      amountBase: 2_000_000n,
      tokenContract: '0x0000000000000000000000000000000000001010',
    },
    claimedTxOrderMap: claimedMap,
    nowIso: '2026-11-03T12:00:00.000Z',
  });
  assert.equal(wrongTokenRes.paymentStatus, 'needs_review');

  const validUsdtRes = reconcilePaymentVerification({
    order: usdtOrder,
    evidence: {
      txHash: '0xpoly_valid_usdt',
      network: 'polygon-mainnet',
      executionStatus: 'confirmed',
      recipient: '0x129A40885B3fe74921c88492A09B6429371b9A40',
      amountBase: 2_000_000n,
      tokenContract: POLYGON_USDT_CONTRACT,
    },
    claimedTxOrderMap: claimedMap,
    nowIso: '2026-11-03T12:00:00.000Z',
  });
  assert.equal(validUsdtRes.paymentStatus, 'confirmed');
});

test('Payment URI builders produce accurate Nimiq URI and Polygon ERC-20 transfer calldata', () => {
  const addr = createValidNimiqAddress('M00N11GHTCAFE0000000000000000000');
  const nimDetails = buildNimiqPaymentDetails({
    recipient: addr,
    amountLuna: 7_000_000n,
    orderNumber: '#024',
    publicToken: 'nt_ord_12345678',
  });
  assert.ok(nimDetails.uri.startsWith('nimiq:NQ'));
  assert.ok(nimDetails.uri.includes('amount=70'));

  const polyDetails = buildPolygonUsdtTransferDetails({
    recipient: '0x129A40885B3fe74921c88492A09B6429371b9A40',
    amountMicro: 2_000_000n,
  });
  assert.equal(polyDetails.chainId, 137);
  assert.equal(polyDetails.tokenContract, POLYGON_USDT_CONTRACT);
  assert.ok(polyDetails.data.startsWith('0xa9059cbb'));
});

test('Audio deduplication prevents repeated announcements on duplicate events or old orders', () => {
  const announced = new Set<string>();
  const now = Date.parse('2026-11-03T12:00:00.000Z');

  // First announcement succeeds
  assert.equal(
    shouldTriggerAudioAnnouncement({
      orderId: 'ord_100',
      eventType: 'payment_confirmed',
      orderCreatedAtIso: '2026-11-03T11:59:30.000Z',
      sessionStartedAtMs: now,
      announcedKeys: announced,
    }),
    true
  );

  // Duplicate event for same order + eventType is suppressed
  assert.equal(
    shouldTriggerAudioAnnouncement({
      orderId: 'ord_100',
      eventType: 'payment_confirmed',
      orderCreatedAtIso: '2026-11-03T11:59:30.000Z',
      sessionStartedAtMs: now,
      announcedKeys: announced,
    }),
    false
  );
});

test('Order payment and fulfillment statuses map to distinct high-contrast color tones', () => {
  assert.equal(getPaymentStatusTone('confirmed'), 'teal');
  assert.equal(getPaymentStatusTone('pending'), 'amber');
  assert.equal(getPaymentStatusTone('needs_review'), 'orange');
  assert.equal(getPaymentStatusTone('failed'), 'rose');
  assert.equal(getPaymentStatusTone('expired'), 'slate');
  assert.equal(getPaymentStatusTone('unpaid'), 'champagne');

  assert.equal(getFulfillmentStatusTone('completed'), 'teal');
  assert.equal(getFulfillmentStatusTone('ready'), 'sky');
  assert.equal(getFulfillmentStatusTone('preparing'), 'amber');
  assert.equal(getFulfillmentStatusTone('canceled'), 'rose');
  assert.equal(getFulfillmentStatusTone('new'), 'champagne');

  assert.equal(getOrderStatusBadgeClasses('pending'), 'bg-amber-900/30 text-amber-500');
  assert.equal(getOrderStatusBadgeClasses('preparing'), 'bg-amber-900/30 text-amber-500');
  assert.equal(getOrderStatusBadgeClasses('confirmed'), 'bg-teal-900/30 text-teal-500');
  assert.equal(getOrderStatusBadgeClasses('completed'), 'bg-teal-900/30 text-teal-500');
  assert.equal(getOrderStatusBadgeClasses('failed'), 'bg-slate-800 text-slate-400');
  assert.equal(getOrderStatusBadgeClasses('unpaid'), 'bg-slate-800 text-slate-400');
});

test('Testnet vs Mainnet strict separation: default is testnet, TEST TOKEN label enforced on Amoy, Mainnet USDT contract rejected on Amoy', () => {
  assert.equal(DEFAULT_NETWORK_ENV, 'testnet');
  assert.equal(POLYGON_AMOY_CHAIN_ID, 80002);
  assert.equal(POLYGON_MAINNET_CHAIN_ID, 137);

  // Reject Mainnet USDT contract on Amoy
  const forbiddenMainnetOnAmoy = validateAmoyTestTokenContract(POLYGON_USDT_CONTRACT);
  assert.equal(forbiddenMainnetOnAmoy.valid, false);
  assert.match(forbiddenMainnetOnAmoy.reason || '', /DILARANG/i);

  // Accept valid distinct Amoy test token contract
  const validAmoyContract = '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582';
  const amoyCheck = validateAmoyTestTokenContract(validAmoyContract);
  assert.equal(amoyCheck.valid, true);
  assert.equal(amoyCheck.normalized, validAmoyContract);

  // Cart calculation in Testnet labels asset as TEST TOKEN / NIM (TESTNET)
  const sampleCatalog: ProductRecord[] = [
    {
      id: 'p1',
      storeSlug: 'moonlight-cafe',
      name: 'Iced Latte',
      description: 'Cold brew with milk',
      category: 'drinks',
      imageUrl: '/img/latte.jpg',
      available: true,
      priceNimLuna: '4000000',
      priceUsdtMicro: '1200000',
    },
  ];

  const testnetUsdtCalc = calculateCartTotals(
    [{ productId: 'p1', quantity: 2 }],
    sampleCatalog,
    'USDT',
    'testnet'
  );
  assert.equal(testnetUsdtCalc.network, 'polygon-amoy');
  assert.equal(testnetUsdtCalc.assetLabel, 'TEST TOKEN');
  assert.equal(testnetUsdtCalc.totalFormatted, '2.40 TEST TOKEN');

  const testnetNimCalc = calculateCartTotals(
    [{ productId: 'p1', quantity: 2 }],
    sampleCatalog,
    'NIM',
    'testnet'
  );
  assert.equal(testnetNimCalc.network, 'nimiq-testnet');
  assert.equal(testnetNimCalc.assetLabel, 'NIM (TESTNET)');
  assert.equal(testnetNimCalc.totalFormatted, '80 NIM (TESTNET)');

  // Reconciliation strictly blocks cross-network transactions (e.g. Testnet tx submitted for Mainnet order)
  const merchantNim = createValidNimiqAddress('M00N11GHTCAFE0000000000000000000');
  const mainnetOrder = {
    id: 'ord_mainnet_1',
    orderNumber: '#101',
    publicToken: 'nt_ord_mainnet_1',
    asset: 'NIM' as const,
    network: 'nimiq-mainnet' as const,
    snapshotRecipient: merchantNim,
    amountBase: '4000000',
    expiresAt: '2026-12-31T23:59:59.000Z',
    paymentStatus: 'unpaid' as const,
  };
  const crossNetAttempt = reconcilePaymentVerification({
    order: mainnetOrder,
    evidence: {
      txHash: '0xtestnet_tx_on_mainnet_order',
      network: 'nimiq-testnet',
      executionStatus: 'confirmed',
      recipient: merchantNim,
      amountBase: 4_000_000n,
    },
    claimedTxOrderMap: new Map(),
    nowIso: '2026-11-04T10:00:00.000Z',
  });
  assert.equal(crossNetAttempt.paymentStatus, 'needs_review');
  assert.match(crossNetAttempt.reviewReason || '', /Network mismatch/i);
});


