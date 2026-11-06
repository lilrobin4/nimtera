import {test,expect} from '@playwright/test';
import sharp from 'sharp';
import jsQR from 'jsqr';
import {mockApi} from './fixtures';
import {CHECKOUT_TRANSPORT_COPY} from '../../src/lib/checkoutTransportCopy';
import {addressPaymentQr} from '../../src/lib/checkoutTransport';
test('real QR pixels contain only the snapshotted address; six locales explain amount entry and review',async({page})=>{
 await mockApi(page,{recipient:'NQ98 4VFR DPG0 8TQ6 88QJ 3RVX U95A NLG4 RKK4'});await page.setViewportSize({width:390,height:844});await page.goto('/s/language-fixture/order/fixture-token');
 const image=page.getByTestId('checkout-address-qr');await expect(image).toHaveAttribute('src',/^data:image\/png;base64,/);
 const buffer=Buffer.from((await image.getAttribute('src'))!.split(',')[1],'base64'),raw=await sharp(buffer).ensureAlpha().raw().toBuffer({resolveWithObject:true});const decoded=jsQR(new Uint8ClampedArray(raw.data),raw.info.width,raw.info.height);expect(decoded).not.toBeNull();
 expect(decoded!.data).toBe(addressPaymentQr('NQ98 4VFR DPG0 8TQ6 88QJ 3RVX U95A NLG4 RKK4'));expect(decoded!.data.startsWith('https:')).toBe(false);
 await expect(page.getByRole('button',{name:'Show Direct URI QR',exact:true})).toHaveCount(0);
 for(const [locale,copy]of Object.entries(CHECKOUT_TRANSPORT_COPY)){
 await page.getByRole('combobox',{name:'Checkout Language',exact:true}).selectOption(locale);await expect(page.getByTestId('checkout-qr-instructions')).toHaveText(copy.scan);await expect(page.getByTestId('checkout-native-guidance')).toContainText(copy.inside);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
});
test('native testnet SDK preserves exact invoice amount, recipient and memo; duplicate click never resends',async({page})=>{
 await mockApi(page);await page.addInitScript(()=>{(window as any).nimiqPay={network:'testnet'};(window as any).fixtureSends=[];(window as any).nimiq={sendBasicTransactionWithData:async(data:any)=>{(window as any).fixtureSends.push(data);return 'a'.repeat(64);}};});
 await page.goto('/s/language-fixture/order/fixture-token');await page.getByTestId('pay-in-wallet-btn').click();await expect.poll(()=>page.evaluate(()=>(window as any).fixtureSends.length)).toBe(1);
 const sent=await page.evaluate(()=>(window as any).fixtureSends[0]);expect(sent.value).toBe(100000);expect(sent.data).toBe('NimTera TESTNET T0001 fixture-token');expect(sent.recipient).toBe('NQ07 0000 0000 0000 0000 0000 0000 0000 0000');
 await page.getByTestId('pay-in-wallet-btn').click();expect(await page.evaluate(()=>(window as any).fixtureSends.length)).toBe(1);
});
test('mainnet and unknown hosts cannot use the testnet invoice to send',async({page})=>{
 await mockApi(page);await page.addInitScript(()=>{(window as any).nimiqPay={network:'mainnet'};(window as any).fixtureSends=[];(window as any).nimiq={sendBasicTransactionWithData:async(data:any)=>{(window as any).fixtureSends.push(data);throw Error('Must never send');}};});
 await page.goto('/s/language-fixture/order/fixture-token');await page.getByTestId('pay-in-wallet-btn').click();await expect(page.getByText(/verified Nimiq TESTNET host is required/)).toBeVisible();expect(await page.evaluate(()=>(window as any).fixtureSends.length)).toBe(0);
 await page.evaluate(()=>{delete (window as any).nimiqPay.network;});await page.getByTestId('pay-in-wallet-btn').click();expect(await page.evaluate(()=>(window as any).fixtureSends.length)).toBe(0);
});

test('cashier address receipt UI requires explicit order match and never displays an RPC rejection as paid',async({page})=>{
 const order={id:'review-fixture',publicToken:'review-token',orderNumber:'T001',storeSlug:'language-fixture',storeName:'Language Fixture',asset:'NIM',network:'nimiq-testnet',environment:'testnet',snapshotRecipient:'NQ98 4VFR DPG0 8TQ6 88QJ 3RVX U95A NLG4 RKK4',amountBase:'100000',amountFormatted:'1 NIM',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300000).toISOString(),paymentStatus:'needs_review',fulfillmentStatus:'new',items:[],fulfillmentMode:'pickup',tableOrNote:''};
 await mockApi(page,{orders:[order]});await page.addInitScript(()=>sessionStorage.setItem('nimtera_seller_token','ui-fixture-only'));let calls=0,accept=false;
 await page.route('**/api/seller/orders/review-fixture/address-payment',async route=>{calls++;const body=route.request().postDataJSON();expect(body.acknowledgeOrderMatch).toBe(true);expect(body.txHash).toBe('d'.repeat(64));if(!accept){await route.fulfill({status:409,json:{error:'Receipt is not confirmed yet'}});return;}order.paymentStatus='confirmed';await route.fulfill({json:{ok:true,order}});});
 await page.goto('/seller/orders');const panel=page.getByTestId('address-review-review-fixture');await panel.locator('summary').click();const submit=panel.getByRole('button');await expect(submit).toBeDisabled();await panel.getByRole('textbox').fill('d'.repeat(64));await panel.getByRole('checkbox').check();await submit.click();await expect(panel.getByRole('alert')).toHaveText('Receipt is not confirmed yet');expect(order.paymentStatus).toBe('needs_review');accept=true;await submit.click();await expect(panel).toHaveCount(0);expect(calls).toBe(2);
});
