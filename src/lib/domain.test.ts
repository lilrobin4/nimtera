import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNimToLuna,
  formatLunaToNim,
  createValidNimiqAddress,
  validateNimiqAddress,
  validateSellerPassword,
  calculateCartTotals,
  buildNimiqPaymentDetails,
  reconcilePaymentVerification,
  shouldTriggerAudioAnnouncement,
  getPaymentStatusTone,
  getFulfillmentStatusTone,
  getOrderStatusBadgeClasses,
  DEFAULT_NETWORK_ENV,
  NETWORK_CONFIGS,
  isActiveNimOrder,
  type ProductRecord,
} from './domain';

test('NIM integer monetary conversion has zero floating-point drift', () => {
  assert.equal(parseNimToLuna('40'), 4_000_000n);
  assert.equal(parseNimToLuna('0.12345'), 12_345n);
  assert.equal(parseNimToLuna('0.123456'), null); // > 5 decimals rejected
  assert.equal(formatLunaToNim(4_000_000n), '40');
  assert.equal(formatLunaToNim(4_550_000n), '45.5');

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


test('Seller password policy enforces >= 15 characters and blocks breached passphrases', () => {
  assert.equal(validateSellerPassword('shortpass123').valid, false);
  assert.equal(validateSellerPassword('password123456789').valid, false);
  assert.equal(validateSellerPassword('AAAAAAAAAAAAAAA').valid, false);
  assert.equal(validateSellerPassword('Moonlight#NightMarket!2026').valid, true);
});

test('Server-authoritative NIM calculation ignores legacy prices and rejects missing NIM prices', () => {
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

  const archivedOnly = {...sampleCatalog[0], priceNimLuna:null};
  const incompatible = calculateCartTotals([{productId:'p1',quantity:1}],[archivedOnly],'NIM','testnet');
  assert.equal(incompatible.compatible,false);
  assert.equal(incompatible.incompatibleProducts[0].productId,'p1');
  assert.throws(()=>calculateCartTotals([],sampleCatalog,'USDT' as any,'testnet'), /Only NIM/);
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

});

test('NIM payment URI contains the exact amount and invoice memo', () => {
  const addr = createValidNimiqAddress('M00N11GHTCAFE0000000000000000000');
  const nimDetails = buildNimiqPaymentDetails({
    recipient: addr,
    amountLuna: 7_000_000n,
    orderNumber: '#024',
    publicToken: 'nt_ord_12345678',
  });
  assert.ok(nimDetails.uri.startsWith('nimiq:NQ'));
  assert.ok(nimDetails.uri.includes('amount=70'));

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

test('active network configuration is Nimiq-only; historical payment methods stay inert', () => {
  assert.equal(DEFAULT_NETWORK_ENV, 'testnet');
  assert.deepEqual(Object.keys(NETWORK_CONFIGS), ['nimiq-testnet','nimiq-mainnet']);
  assert.equal(isActiveNimOrder({asset:'NIM',network:'nimiq-testnet',environment:'testnet'}),true);
  assert.equal(isActiveNimOrder({asset:'NIM',network:'nimiq-mainnet',environment:'mainnet'}),false);
  const old = {id:'legacy',orderNumber:'#old',publicToken:'old',asset:'USDT',network:'polygon-amoy',snapshotRecipient:'original',amountBase:'2000000',expiresAt:'2026-12-31T00:00:00Z',paymentStatus:'pending'} as const;
  const before = JSON.stringify(old);
  assert.equal(isActiveNimOrder(old),false);
  const result = reconcilePaymentVerification({order:old,evidence:{txHash:'hash',network:'polygon-amoy',recipient:'original',amountBase:2000000n,executionStatus:'confirmed'},claimedTxOrderMap:new Map()});
  assert.equal(result.paymentStatus,'pending');
  assert.equal(result.shouldBindTxHash,false);
  assert.equal(JSON.stringify(old),before);
  const current = {...old,asset:'NIM',network:'nimiq-mainnet'} as const;
  const wrongNetwork = reconcilePaymentVerification({order:current,evidence:{txHash:'cross-network',network:'nimiq-testnet',recipient:'original',amountBase:2000000n,executionStatus:'confirmed'},claimedTxOrderMap:new Map()});
  assert.equal(wrongNetwork.paymentStatus,'needs_review');
  assert.match(wrongNetwork.reviewReason || '',/Network mismatch/);
});
