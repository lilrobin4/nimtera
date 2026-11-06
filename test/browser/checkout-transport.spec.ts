import {test,expect} from '@playwright/test';
import sharp from 'sharp';
import jsQR from 'jsqr';
import {mockApi} from './fixtures';
import {CHECKOUT_TRANSPORT_COPY} from '../../src/lib/checkoutTransportCopy';
import {checkoutTransport} from '../../src/lib/checkoutTransport';
test('real QR pixels open the exact invoice; all six locales explain camera vs payment scanner',async({page})=>{
 await mockApi(page);await page.setViewportSize({width:390,height:844});await page.goto('/s/language-fixture/order/fixture-token');
 const image=page.getByTestId('checkout-open-qr');await expect(image).toHaveAttribute('src',/^data:image\/png;base64,/);
 const buffer=Buffer.from((await image.getAttribute('src'))!.split(',')[1],'base64'),raw=await sharp(buffer).ensureAlpha().raw().toBuffer({resolveWithObject:true});const decoded=jsQR(new Uint8ClampedArray(raw.data),raw.info.width,raw.info.height);expect(decoded).not.toBeNull();
 const origin=new URL(page.url()).origin,checkout=origin+'/s/language-fixture/order/fixture-token?net=nimiq-testnet&env=testnet';expect(decoded!.data).toBe(checkoutTransport(checkout).qrPayload);
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
