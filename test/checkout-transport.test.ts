import test from 'node:test';
import assert from 'node:assert/strict';
import {checkoutTransport} from '../src/lib/checkoutTransport';
import {CHECKOUT_TRANSPORT_COPY} from '../src/lib/checkoutTransportCopy';
test('checkout QR opens the exact invoice Mini App, never a fabricated CPLink or memo-losing payment URI',()=>{
 const checkout='https://nimtera.store/s/shop/order/unique-token?net=nimiq-testnet&env=testnet',result=checkoutTransport(checkout);
 assert.equal(result.checkoutUrl,checkout);assert.equal(result.openUrl,'https://nimpay.app/miniapps/open/nimtera.store/s/shop/order/unique-token?net=nimiq-testnet&env=testnet');assert.equal(result.qrPayload,result.openUrl);assert.ok(!result.qrPayload.startsWith('nimiq:'));assert.ok(!result.qrPayload.includes('cpl_id'));
 const extracted=result.openUrl!.replace('https://nimpay.app/miniapps/open/','https://');assert.equal(extracted,checkout);
});
test('checkout transport rejects insecure remote URLs, embedded credentials and fragments; local previews remain browser-only',()=>{
 for(const url of ['http://nimtera.store/s/x','javascript:alert(1)','https://user:secret@nimtera.store/s/x','https://nimtera.store/s/x#secret'])assert.throws(()=>checkoutTransport(url));
 const local=checkoutTransport('http://127.0.0.1:3016/s/shop/order/token?net=nimiq-testnet&env=testnet');assert.equal(local.openUrl,null);assert.equal(local.qrPayload,local.checkoutUrl);
});
test('all six checkout languages warn against wallet scanner use and retain Testnet/memo guidance',()=>{
 assert.equal(Object.keys(CHECKOUT_TRANSPORT_COPY).length,6);for(const copy of Object.values(CHECKOUT_TRANSPORT_COPY)){assert.ok(copy.title&&copy.scan&&copy.open&&copy.fallback&&copy.inside&&copy.alt);assert.match(copy.scan,/CPLink/);assert.match(copy.fallback,/Testnet|测试网/);}
});
