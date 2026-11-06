import { test, expect, type Page } from '@playwright/test';
const store = { slug: 'language-fixture', name: 'Language Fixture', activeEnvironment: 'testnet', nimiqTestnetAddress: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000', supportsPickup: true, supportsDelivery: true, supportsDineIn: true, acceptsNim: true, acceptsUsdt: false, acceptsTestnetNim: true, acceptsTestnetUsdt: false, defaultLocale: 'id', voiceLocale: 'id' };
const products = [{ id: 'fixture-product', storeSlug: store.slug, name: 'Merchant item name', description: 'Merchant content stays unchanged', category: 'food', imageUrl: '/products/product_iced_latte_1793717983788.jpg', available: true, priceNimLuna: '100000', priceUsdtMicro: null }];
async function mockApi(page: Page) {
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const body = path.startsWith('/api/public/orders/') ? { order: { id:'fixture-order', publicToken:'fixture-token', orderNumber:'T0001', storeSlug:store.slug, storeName:store.name, environment:'testnet', asset:'NIM', network:'nimiq-testnet', snapshotRecipient:store.nimiqTestnetAddress, amountBase:'100000', amountFormatted:'1', items:[{productId:'fixture-product', name:products[0].name, quantity:1, lineTotalBase:'100000'}], fulfillmentMode:'pickup', tableOrNote:'', paymentStatus:'pending', fulfillmentStatus:'new', createdAt:new Date().toISOString(), expiresAt:new Date(Date.now()+900000).toISOString() } } : path === '/api/seller/dashboard' ? { store, products, orders: [], auditLogs: [] }
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

test('night palette keeps visible text readable across seller and customer views', async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(() => { sessionStorage.setItem('nimtera_seller_token', 'ui-fixture-only'); });
  for (const route of ['/', '/seller/login', '/seller/setup', '/seller/counter', '/seller/products', '/seller/orders', '/seller/reports', '/seller/settings', '/s/language-fixture', '/s/language-fixture/order/fixture-token']) {
    await page.goto(route);
    await expect(page.locator('main, header').first()).toBeVisible();
    if (route.includes('/order/')) await expect(page.getByTestId('checkout-total-amount')).toBeVisible();
    const failures = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d')!;
      const rgba = (color: string) => { ctx.clearRect(0,0,1,1); ctx.fillStyle=color; ctx.fillRect(0,0,1,1); return Array.from(ctx.getImageData(0,0,1,1).data).map((v,i) => i===3?v/255:v); };
      const lum = (c: number[]) => c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      const errors: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('body *')) {
        const text=Array.from(el.childNodes).filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('').trim();
        if (!text || !el.getClientRects().length || el.closest('select,button:disabled,[aria-disabled="true"],svg,script,style')) continue;
        const style=getComputedStyle(el); if (style.visibility==='hidden' || Number(style.opacity)<.5) continue;
        const chain: HTMLElement[]=[]; for(let p:HTMLElement|null=el;p;p=p.parentElement) chain.unshift(p);
        let bg=[11,16,28,1];
        for(const parent of chain) { const c=rgba(getComputedStyle(parent).backgroundColor); bg=[...c.slice(0,3).map((v,i)=>v*c[3]+bg[i]*(1-c[3])),1]; }
        const c=rgba(style.color);const fg=c.slice(0,3).map((v,i)=>v*c[3]+bg[i]*(1-c[3]));
        const a=lum(fg),b=lum(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
        const large=parseFloat(style.fontSize)>=24 || (parseFloat(style.fontSize)>=18.66 && Number(style.fontWeight)>=700);
        if (ratio<(large?3:4.5)) errors.push(`${text.slice(0,65)}: ${ratio.toFixed(2)} (${style.color} on ${bg.slice(0,3)})`);
      }
      return errors;
    });
    expect(failures, route).toEqual([]);
  }
});

test('night theme stays usable at phone width', async ({ page }) => {
  await mockApi(page); await page.setViewportSize({ width:390, height:844 });
  for (const route of ['/', '/seller/login', '/seller/setup', '/s/language-fixture', '/s/language-fixture/order/fixture-token']) {
    await page.goto(route);
    if (route.includes('/order/')) await expect(page.getByTestId('checkout-total-amount')).toBeVisible();
    else await expect(page.locator('h1').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), route).toBeLessThanOrEqual(390);
  }
});

test('public help contains user guidance only in all six languages', async ({ page }) => {
  await mockApi(page); await page.goto('/s/language-fixture');
  const { PUBLIC_HELP } = await import('../../src/lib/publicDocs');
  for (const locale of ['en','id','zh-CN','vi','ms','ru'] as const) {
    const copy=PUBLIC_HELP[locale];
    await page.locator('#storefront-lang-select').selectOption(locale);
    const opener=page.getByRole('button',{name:copy.title,exact:true}); await opener.click();
    const dialog=page.getByRole('dialog'); await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading',{name:copy.title,exact:true})).toBeVisible();
    for (const tab of ['overview','security','privacy'] as const) {
      await dialog.getByRole('button',{name:copy.tabs[tab],exact:true}).click();
      await expect(dialog.getByRole('heading',{name:copy.content[tab].heading,exact:true})).toBeVisible();
      await expect(dialog).not.toContainText(/StakeSafe|DNS|Deploy|APP_URL|Hosting Load Balancer|RFC 6238|scrypt|3-Device|Mainnet Assets/);
    }
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
  }
});
