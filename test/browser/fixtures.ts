import type { Page } from '@playwright/test';
const store = { slug: 'language-fixture', name: 'Language Fixture', activeEnvironment: 'testnet', nimiqTestnetAddress: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000', supportsPickup: true, supportsDelivery: true, supportsDineIn: true, acceptsNim: true, acceptsTestnetNim: true, defaultLocale: 'id', voiceLocale: 'id' };
const products = [{ id: 'fixture-product', storeSlug: store.slug, name: 'Merchant item name', description: 'Merchant content stays unchanged', category: 'food', imageUrl: '/products/product_iced_latte_1793717983788.jpg', available: true, priceNimLuna: '100000' }];
export async function mockApi(page: Page) {
  let signedIn = false;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') {
      if (route.request().headers().authorization === 'Bearer ui-fixture-only') signedIn=true;
      await route.fulfill({ status:signedIn?200:401, json:signedIn?{seller:{email:'fixture@example.test'},store,mfaVerified:true,expiresAt:Date.now()+3600000}:{error:'No session'} }); return;
    }
    const body = path.startsWith('/api/public/orders/') ? { order: { id:'fixture-order', publicToken:'fixture-token', orderNumber:'T0001', storeSlug:store.slug, storeName:store.name, environment:'testnet', asset:'NIM', network:'nimiq-testnet', snapshotRecipient:store.nimiqTestnetAddress, amountBase:'100000', amountFormatted:'1', items:[{productId:'fixture-product', name:products[0].name, quantity:1, lineTotalBase:'100000'}], fulfillmentMode:'pickup', tableOrNote:'', paymentStatus:'pending', fulfillmentStatus:'new', createdAt:new Date().toISOString(), expiresAt:new Date(Date.now()+900000).toISOString() } } : path === '/api/seller/dashboard' ? { store, products, orders: [], auditLogs: [] }
      : path.startsWith('/api/public/stores/') ? { store, products }
      : path === '/api/health' ? { ready: true, configured: { database: true, sessionSecret: true }, databaseReachable: true }
      : { captchaRequired: false };
    await route.fulfill({ json: body });
  });
}
