import { textContrastFailures } from './contrast';
import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './fixtures';
test('seller login switches ID to EN and keeps the preference after refresh', async ({ page }) => {
  await mockApi(page); await page.goto('/seller/login');
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('id');
  await expect(page.getByText('Masuk Akun Penjual', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('en');
  await expect(page.getByText('Merchant Sign In', { exact: true })).toBeVisible();
  await expect(page.getByText('Masuk Akun Penjual', { exact: true })).toHaveCount(0);
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
    const failures = await textContrastFailures(page);
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

test('form text, hints and placeholders use the clearer high-contrast palette', async ({ page }) => {
  await mockApi(page);await page.goto('/seller/login');
  const input=page.locator('#seller-email-input');await expect(input).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('background-color','rgb(11, 15, 20)');
  await expect(page.locator('body')).toHaveCSS('color','rgb(248, 250, 252)');
  await expect(input).toHaveCSS('font-size','15px');
  await expect(page.locator('label[for="seller-email-input"]')).toHaveCSS('font-size','13px');
  const contrast=await input.evaluate(el=>{
    const style=getComputedStyle(el),placeholder=getComputedStyle(el,'::placeholder');
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d')!;
    const lum=(color:string)=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);const c=Array.from(ctx.getImageData(0,0,1,1).data).slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c.reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);};
    const bg=lum(style.backgroundColor);return {text:(lum(style.color)+.05)/(bg+.05),placeholder:(lum(placeholder.color)+.05)/(bg+.05)};
  });
  expect(contrast.text).toBeGreaterThanOrEqual(7);expect(contrast.placeholder).toBeGreaterThanOrEqual(7);
});
