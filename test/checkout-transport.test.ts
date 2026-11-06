import test from 'node:test';
import assert from 'node:assert/strict';
import {addressQrAvailable,addressPaymentQr,checkoutTransport} from '../src/lib/checkoutTransport';
import {CHECKOUT_TRANSPORT_COPY} from '../src/lib/checkoutTransportCopy';
test('optional Mini App link preserves the exact invoice; it is no longer the payment QR',()=>{
 const checkout='https://nimtera.store/s/shop/order/unique-token?net=nimiq-testnet&env=testnet',result=checkoutTransport(checkout);
 assert.equal(result.checkoutUrl,checkout);assert.equal(result.openUrl,'https://nimpay.app/miniapps/open/nimtera.store/s/shop/order/unique-token?net=nimiq-testnet&env=testnet');assert.ok(!result.openUrl!.startsWith('nimiq:'));assert.ok(!result.openUrl!.includes('cpl_id'));
 const extracted=result.openUrl!.replace('https://nimpay.app/miniapps/open/','https://');assert.equal(extracted,checkout);
});
test('checkout transport rejects insecure remote URLs, embedded credentials and fragments; local previews remain browser-only',()=>{
 for(const url of ['http://nimtera.store/s/x','javascript:alert(1)','https://user:secret@nimtera.store/s/x','https://nimtera.store/s/x#secret'])assert.throws(()=>checkoutTransport(url));
 const local=checkoutTransport('http://127.0.0.1:3016/s/shop/order/token?net=nimiq-testnet&env=testnet');assert.equal(local.openUrl,null);assert.equal(local.checkoutUrl,'http://127.0.0.1:3016/s/shop/order/token?net=nimiq-testnet&env=testnet');
});
test('all six checkout languages explain wallet scanning and seller review',()=>{
 assert.equal(Object.keys(CHECKOUT_TRANSPORT_COPY).length,6);for(const copy of Object.values(CHECKOUT_TRANSPORT_COPY)){assert.ok(copy.title&&copy.scan&&copy.open&&copy.fallback&&copy.inside&&copy.alt);assert.match(copy.scan,/Testnet|测试网/);}
});

test('payment QR matches the user-provided wallet Receive QR, without overwriting any other seller recipient',()=>{
 const user='NQ98 4VFR DPG0 8TQ6 88QJ 3RVX U95A NLG4 RKK4';assert.equal(addressPaymentQr(user),user);assert.throws(()=>addressPaymentQr('https://nimtera.store'));assert.throws(()=>addressPaymentQr('NQ00 BAD'));
});

test('expired, confirmed, review, failed and already-submitted invoices do not expose a new payment QR',()=>{
 const now=Date.now(),o={paymentStatus:'unpaid',expiresAt:new Date(now+30000).toISOString()};assert.equal(addressQrAvailable(o,now),true);
 for(const status of ['confirmed','failed','needs_review'])assert.equal(addressQrAvailable({...o,paymentStatus:status},now),false);
 assert.equal(addressQrAvailable({...o,expiresAt:new Date(now-1).toISOString()},now),false);assert.equal(addressQrAvailable({...o,expiresAt:'invalid'},now),false);assert.equal(addressQrAvailable({...o,txHash:'d'.repeat(64)},now),false);
});
