import { test, expect, type Page } from '@playwright/test';
const store = { slug: 'language-fixture', name: 'Language Fixture', activeEnvironment: 'testnet', nimiqTestnetAddress: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000', supportsPickup: true, supportsDelivery: true, supportsDineIn: true, acceptsNim: true, acceptsUsdt: false, acceptsTestnetNim: true, acceptsTestnetUsdt: false, defaultLocale: 'id', voiceLocale: 'id' };
const products = [{ id: 'fixture-product', storeSlug: store.slug, name: 'Merchant item name', description: 'Merchant content stays unchanged', category: 'food', imageUrl: '/products/product_iced_latte_1793717983788.jpg', available: true, priceNimLuna: '100000', priceUsdtMicro: null }];
async function mockApi(page: Page) {
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/api/seller/dashboard' ? { store, products, orders: [], auditLogs: [] }
      : path.startsWith('/api/public/stores/') ? { store, products }
      : path === '/api/health' ? { ready: true, configured: { database: true, sessionSecret: true }, databaseReachable: true }
      : { captchaRequired: false };
    await route.fulfill({ json: body });
  });
}
test('seller login switches ID to EN and keeps the preference after refresh', async ({ page }) => {
  await mockApi(page); await page.goto('/seller/login');
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('id');
  await expect(page.getByText('Nama Resto / Toko Anda', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('en');
  await expect(page.getByText('Your restaurant / shop name', { exact: true })).toBeVisible();
  await expect(page.getByText('Nama Resto / Toko Anda', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Language', exact: true })).toHaveValue('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
test('seller cashier, product editor, orders, reports and settings use English copy', async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(() => { sessionStorage.setItem('nimtera_seller_token', 'ui-fixture-only'); });
  await page.goto('/seller/counter');
  await page.getByRole('combobox', { name: 'Seller UI Language' }).selectOption('id');
  await expect(page.getByRole('button', { name: '+ Tambah Menu & Harga', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Seller UI Language' }).selectOption('en');
  await page.getByRole('button', { name: '+ Add item and prices', exact: true }).click();
  await expect(page.getByText('Item / product name', { exact: true })).toBeVisible();
  await expect(page.getByTestId('pos-menu-name-input')).toHaveAttribute('placeholder', 'Example: Country Fried Rice / Creamy Iced Coffee');
  for (const route of ['products','orders','reports','settings']) {
    await page.goto('/seller/'+route);
    await expect(page.getByRole('combobox', { name: 'Seller UI Language' })).toHaveValue('en');
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/Nama Menu|Harga NIM|Belum ada menu|Daftar Pesanan|Simpan Profil|Pesanan Testnet Terverifikasi|Pemeriksaan Kesiapan/);
  }
});
test('customer category labels follow the language selector, not the seller default', async ({ page }) => {
  await mockApi(page); await page.goto('/s/language-fixture');
  await page.locator('#storefront-lang-select').selectOption('id');
  await expect(page.getByTestId('menu-column-food')).toContainText('Makanan');
  await page.locator('#storefront-lang-select').selectOption('en');
  await expect(page.getByTestId('menu-column-food')).toContainText('Food & Mains');
  await expect(page.getByTestId('menu-column-food')).not.toContainText('Makanan');
  await expect(page.getByText('Merchant item name', { exact: true })).toBeVisible();
  await page.reload(); await expect(page.locator('#storefront-lang-select')).toHaveValue('en');
});
