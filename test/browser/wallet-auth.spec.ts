import {test,expect,type Page} from '@playwright/test';
import crypto from 'node:crypto';
import {walletAddressOf,signedMessageDigest} from '../../src/server/walletAuth';
import {createValidNimiqAddress} from '../../src/lib/domain';
test.use({extraHTTPHeaders:{'x-nimtera-fixture-client':'wallet-auth-tests'}});
test.skip(!process.env.PLAYWRIGHT_AUTH_E2E,'Only isolated real API fixtures; never registers production accounts.');
async function simulatedPay(page:Page){
 const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519'),pub=publicKey.export({format:'der',type:'spki'}).subarray(-32),address=walletAddressOf(pub);let signatures=0;
 await page.exposeFunction('fixtureSignIdentity',(message:string)=>{signatures++;return {publicKey:pub.toString('hex'),signature:crypto.sign(null,signedMessageDigest(message),privateKey).toString('hex')};});
 await page.addInitScript(({address})=>{(window as any).nimiqPay={network:'mainnet'};(window as any).nimiq={listAccounts:async()=>[address],sign:async(message:any)=>(window as any).fixtureSignIdentity(typeof message==='string'?message:message.message),sendBasicTransaction:()=>{throw new Error('Authentication must never send a transaction.');}};},{address});
 return {address,signatures:()=>signatures};
}
async function prove(page:Page,mode:string){const panel=page.getByTestId(`wallet-auth-${mode}`);await panel.locator('summary').click();await page.getByTestId(`wallet-connect-${mode}`).click();await expect(page.getByTestId(`wallet-account-${mode}`)).toBeVisible();await page.getByTestId(`wallet-verify-${mode}`).click();}
test('wallet-first native-provider simulation proves ownership, completes profile, sets email password and restores the same shop',async({page,context})=>{
 await page.setViewportSize({width:390,height:844});const wallet=await simulatedPay(page);
 await page.goto('/seller/setup');await expect(page.locator('input[type=email]')).toBeVisible();await prove(page,'register');await expect(page.getByTestId('wallet-registration-form')).toBeVisible();
 await page.getByTestId('wallet-register-email').fill('wallet-browser@example.test');await page.getByTestId('wallet-register-shop').fill('Wallet Browser Shop');await page.getByTestId('wallet-register-slug').fill('wallet-browser-shop');
 // A mainnet login proof must NEVER populate the testnet payment recipient automatically.
 await expect(page.getByTestId('wallet-register-recipient')).toHaveValue('');await page.getByTestId('wallet-register-recipient').fill(createValidNimiqAddress('0'.repeat(32)));
 await page.getByRole('button',{name:'Create wallet-linked account',exact:true}).click();await expect(page).toHaveURL(/\/seller\/counter$/);await expect(page.getByTestId('seller-header-store-btn')).toContainText('Wallet Browser Shop');
 await page.goto('/seller/settings');await expect(page.getByTestId('wallet-account-settings')).toContainText(wallet.address);await expect(page.getByTestId('wallet-unlink')).toBeDisabled();
 const password='Browser#WalletEmailPassword!2026';await page.getByTestId('wallet-new-password').fill(password);await page.getByTestId('wallet-new-password-confirm').fill(password);await prove(page,'password');await expect(page.getByTestId('wallet-current-password')).toBeVisible();
 expect(wallet.signatures()).toBe(2);expect((await context.request.post('/api/auth/logout',{data:{}})).status()).toBe(200);
 await page.goto('/seller/login');await page.locator('#seller-email-input').fill('wallet-browser@example.test');await page.locator('#seller-password-input').fill(password);await page.getByRole('button',{name:'Sign in to Seller Console',exact:true}).click();await expect(page).toHaveURL(/\/seller\/counter$/);await expect(page.getByTestId('seller-header-store-btn')).toContainText('Wallet Browser Shop');
 await page.reload();await expect(page.getByTestId('seller-header-store-btn')).toContainText('Wallet Browser Shop');
 expect((await context.request.post('/api/auth/logout',{data:{}})).status()).toBe(200);await page.goto('/seller/login');
 // Legacy sessionStorage must not override the new cookie after wallet login.
 await page.evaluate(()=>sessionStorage.setItem('nimtera_seller_token','stale-legacy-token'));await prove(page,'login');await expect(page).toHaveURL(/\/seller\/counter$/);await expect(page.getByTestId('seller-header-store-btn')).toContainText('Wallet Browser Shop');expect(wallet.signatures()).toBe(3);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('email-first registration links a proven wallet and wallet login opens the same existing store',async({page,context})=>{
 const wallet=await simulatedPay(page),password='Email#BrowserWalletPassword!2026';
 const registered=await context.request.post('/api/auth/register',{data:{email:'email-wallet-browser@example.test',password,storeName:'Email Wallet Shop',storeSlug:'email-wallet-browser',nimiqAddress:createValidNimiqAddress('1'.repeat(32))}});expect(registered.status()).toBe(201);
 await page.goto('/seller/settings');await page.getByTestId('wallet-current-password').fill(password);await prove(page,'link');await expect(page.getByTestId('wallet-auth-password').locator('summary')).toBeVisible();await expect(page.getByTestId('wallet-account-settings')).toContainText(wallet.address);
 await context.request.post('/api/auth/logout',{data:{}});await page.goto('/seller/login');await prove(page,'login');await expect(page.getByTestId('seller-header-store-btn')).toContainText('Email Wallet Shop');
 const session=await (await context.request.get('/api/auth/session')).json();expect(session.store.nimiqTestnetAddress).toBe(createValidNimiqAddress('1'.repeat(32)));expect(session.store.nimiqAddress).toBeNull();expect(wallet.signatures()).toBe(2);
});
