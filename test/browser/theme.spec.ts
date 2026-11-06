import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures';
import { textContrastFailures } from './contrast';

test('day/night choice persists across refresh, navigation, locales and browser tabs', async ({ page, context }) => {
  await mockApi(page); await page.goto('/');
  await expect(page.getByTestId('theme-night')).toHaveAttribute('aria-pressed','true');
  await page.getByTestId('theme-day').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','day');
  await expect(page.locator('body')).toHaveCSS('background-color','rgb(247, 244, 237)');
  await page.reload(); await expect(page.getByTestId('theme-day')).toHaveAttribute('aria-pressed','true');
  for (const [locale,day,night] of [['en','Day','Night'],['id','Siang','Malam'],['zh-CN','日间','夜间'],['vi','Ban ngày','Ban đêm'],['ms','Siang','Malam'],['ru','День','Ночь']]) {
    await page.locator('#landing-language').selectOption(locale);
    await expect(page.getByTestId('theme-day')).toHaveText(day);
    await expect(page.getByTestId('theme-night')).toHaveText(night);
    await expect(page.getByTestId('theme-day')).toHaveAttribute('aria-pressed','true');
  }
  const other=await context.newPage();await mockApi(other);await other.goto('/seller/login');
  await expect(other.locator('html')).toHaveAttribute('data-theme','day');
  await other.getByTestId('theme-night').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','night');
  await expect(page.getByTestId('theme-night')).toHaveAttribute('aria-pressed','true');
  await other.close();
});

test('day palette is readable and NIM-only throughout seller/customer views, including mobile', async ({ page }) => {
  await mockApi(page);await page.addInitScript(()=>{sessionStorage.setItem('nimtera_seller_token','ui-fixture-only');localStorage.setItem('nimtera.ui.theme','day');});
  const routes=['/','/seller/login','/seller/setup','/seller/counter','/seller/products','/seller/orders','/seller/reports','/seller/settings','/s/language-fixture','/s/language-fixture/order/fixture-token'];
  for(const route of routes){
    await page.goto(route);await expect(page.locator('main,header').first()).toBeVisible();
    if(route.includes('/order/'))await expect(page.getByTestId('checkout-total-amount')).toBeVisible();
    if(route==='/seller/settings')await expect(page.locator('#settings-testnet-nim-wallet')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/Polygon|Amoy|USDT|ERC-20|EVM Chain|TEST TOKEN/i);
    expect(await textContrastFailures(page),route).toEqual([]);
  }
  await page.setViewportSize({width:390,height:844});
  for(const route of routes){await page.goto(route);await expect(page.getByTestId('theme-day')).toHaveAttribute('aria-pressed','true');if(route.includes('/order/'))await expect(page.getByTestId('checkout-total-amount')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth),route).toBeLessThanOrEqual(390);}
});

test('retired checkout preserves the receipt but never displays QR or payment actions', async ({ page }) => {
  await page.route('**/api/public/orders/archived-token',route=>route.fulfill({json:{order:{id:'archived',publicToken:'archived-token',orderNumber:'#T-OLD',storeSlug:'old-shop',storeName:'Old shop',asset:'USDT',environment:'testnet',network:'polygon-amoy',snapshotRecipient:'0x'+'1'.repeat(40),amountBase:'2000000',amountFormatted:'2.00 TEST TOKEN',items:[],paymentStatus:'pending',fulfillmentStatus:'new',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+900000).toISOString()}}}));
  await page.goto('/s/old-shop/order/archived-token');
  const receipt=page.getByTestId('archived-order');await expect(receipt).toBeVisible();await expect(receipt).toContainText('2.00 TEST TOKEN');await expect(receipt).toContainText('read only');
  await expect(page.getByTestId('checkout-total-amount')).toHaveCount(0);await expect(page.locator('canvas')).toHaveCount(0);await expect(page.getByRole('button',{name:/Pay with|Verify|Open wallet|Nimiq Pay/i})).toHaveCount(0);
});
