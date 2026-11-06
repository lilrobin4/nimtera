import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import sharp from 'sharp';
import { createValidNimiqAddress } from '../../src/lib/domain';
// This suite uses the REAL backend and PostgreSQL-engine request adapter, not route mocks.
test.skip(!process.env.PLAYWRIGHT_AUTH_E2E, 'Requires isolated real API fixture; never creates accounts in production.');
function totp(base32:string) {
  const bits=Array.from(base32).map(c=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0')).join('');
  const bytes=Buffer.from(bits.match(/.{8}/g)!.map(b=>parseInt(b,2))); const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest=createHmac('sha1',bytes).update(counter).digest(),offset=digest[19]&15;
  return ((digest.readUInt32BE(offset)&0x7fffffff)%1000000).toString().padStart(6,'0');
}
test('email/password/2FA login restores shop on reload, navigation, new tab and browser restart', async ({page,context,browser}) => {
  const email='cookie-fixture@example.test',password='Fixture#PrivatePassword!2026';
  const registered=await context.request.post('/api/auth/register',{data:{email,password,storeName:'Persistent Restaurant',storeSlug:'persistent-restaurant',nimiqAddress:createValidNimiqAddress('00000000000000000000000000000000')}});
  expect(registered.status()).toBe(201); const data=await registered.json();
  const secret=data.enrollment.secret;
  await page.goto('/seller/counter');
  await expect(page.getByRole('heading',{name:'Set up your authenticator',exact:true})).toBeVisible();
  await page.reload();
  await page.getByRole('textbox',{name:'Authenticator code',exact:true}).fill(totp(secret));
  await page.getByRole('button',{name:'Confirm and open seller console',exact:true}).click();
  await expect(page.getByTestId('seller-header-store-btn')).toContainText('Persistent Restaurant');
  expect((await context.request.post('/api/auth/logout',{data:{}})).status()).toBe(200);
  await page.goto('/seller/login'); await expect(page.locator('#seller-email-input')).toBeVisible();
  await expect(page.locator('#seller-resto-name-input')).toHaveCount(0);
  await expect(page.locator('form input')).toHaveCount(3);
  await page.locator('#seller-email-input').fill(email); await page.locator('#seller-password-input').fill(password); await page.locator('#seller-totp-input').fill(totp(secret));
  await page.getByRole('button',{name:'Sign in to Seller Console',exact:true}).click();
  await expect(page).toHaveURL(/\/seller\/counter$/);
  await expect(page.getByTestId('seller-header-store-btn')).toContainText('Persistent Restaurant');
  await page.getByRole('button',{name:'Orders',exact:true}).click(); await expect(page).toHaveURL(/\/seller\/orders$/);
  await expect(page.getByTestId('seller-header-store-btn')).toContainText('Persistent Restaurant');
  await page.goto('/seller/products');
  await page.getByPlaceholder('Cardamom Cold Brew',{exact:true}).fill('Merchant uploaded product');
  await expect(page.getByTestId('product-photo-presets').getByRole('button')).toHaveCount(18);
  await page.getByTestId('product-photo-presets').getByRole('button',{name:'Pizza',exact:true}).click();
  await expect(page.getByTestId('selected-product-photo')).toHaveAttribute('src','/products/pizza.jpg');
  const bytes=await sharp({create:{width:400,height:300,channels:3,background:'#f59e0b'}}).png().toBuffer();
  const uploaded=page.waitForResponse(response=>response.url().endsWith('/api/seller/product-images')&&response.request().method()==='POST');
  await page.getByTestId('product-photo-upload').setInputFiles({name:'my-product.png',mimeType:'image/png',buffer:bytes});
  const uploadResponse=await uploaded;expect(uploadResponse.status()).toBe(201);const photo=(await uploadResponse.json()).imageUrl;
  await expect(page.getByTestId('selected-product-photo')).toHaveAttribute('src',photo);
  const photoResponse=await context.request.get(photo);expect(photoResponse.status()).toBe(200);expect(photoResponse.headers()['content-type']).toContain('image/webp');
  await page.getByRole('button',{name:'+ Save item and prices to catalog',exact:true}).click();
  await expect(page.getByText('Merchant uploaded product',{exact:true})).toBeVisible();
  await page.reload();await expect(page.locator(`img[src="${photo}"]`).first()).toBeVisible();
  const publicCatalog=await context.newPage();await publicCatalog.goto('/s/persistent-restaurant');
  await expect(publicCatalog.getByText('Merchant uploaded product',{exact:true})).toBeVisible();await expect(publicCatalog.locator(`img[src="${photo}"]`).first()).toBeVisible();await publicCatalog.close();
  await page.getByTestId('product-photo-upload').setInputFiles({name:'unsafe.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});
  await expect(page.getByRole('alert')).toContainText('Could not upload');
  const cookie=(await context.cookies()).find(c=>c.name==='nimtera_seller_session'); expect(cookie?.httpOnly).toBe(true);expect(cookie?.expires).toBeGreaterThan(Date.now()/1000);
  expect(await page.evaluate(()=>sessionStorage.getItem('nimtera_seller_token'))).toBeNull();
  for (const route of ['products','orders','reports','settings','counter']) {
    await page.goto('/seller/'+route);await expect(page.getByTestId('seller-header-store-btn')).toContainText('Persistent Restaurant');
    await page.reload();await expect(page.getByTestId('seller-header-store-btn')).toContainText('Persistent Restaurant');
    await expect(page.locator('#seller-email-input')).toHaveCount(0);
  }
  await page.goto('/');await page.getByRole('button',{name:'Seller login',exact:true}).click();
  await expect(page).toHaveURL(/\/seller\/counter$/);await expect(page.getByTestId('seller-header-store-btn')).toContainText('Persistent Restaurant');
  const tab=await context.newPage();await tab.goto('/seller/orders');await expect(tab.getByTestId('seller-header-store-btn')).toContainText('Persistent Restaurant');await tab.close();
  // Reload persisted browser cookies into a fresh context, with no sessionStorage.
  const restored=await browser.newContext({storageState:await context.storageState(),baseURL:'http://127.0.0.1:3016'});
  const fresh=await restored.newPage();await fresh.goto('/seller/counter');await expect(fresh.getByTestId('seller-header-store-btn')).toContainText('Persistent Restaurant');
  await fresh.route('**/api/auth/session',route=>route.fulfill({status:503,json:{error:'Temporary test outage'}}));
  await fresh.reload(); await expect(fresh.getByText('Session connection is unavailable. Your session has not been cleared.',{exact:true})).toBeVisible();
  expect((await restored.cookies()).some(c=>c.name==='nimtera_seller_session')).toBe(true);
  await fresh.unroute('**/api/auth/session');await fresh.getByRole('button',{name:'Try again',exact:true}).click();
  await expect(fresh.getByTestId('seller-header-store-btn')).toContainText('Persistent Restaurant');
  await fresh.getByRole('button',{name:'Sign out',exact:true}).first().click();await expect(fresh.locator('#seller-email-input')).toBeVisible();
  await fresh.reload();await expect(fresh.locator('#seller-email-input')).toBeVisible();
  expect((await restored.request.get('/api/auth/session')).status()).toBe(401);
  await restored.close();
});
