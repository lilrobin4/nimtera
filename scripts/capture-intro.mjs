// Genuine application UI captures with explicitly illustrative API fixtures.
// Never creates a seller account, a real order or a chain transaction.
import {chromium} from 'playwright';
import fs from 'node:fs';
const base=process.env.INTRO_BASE_URL||'http://127.0.0.1:3040';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('Capture only against a local preview');
const folder='.arena/intro';fs.mkdirSync(folder,{recursive:true});
const store={slug:'nimtera-demo',name:'NimTera Demo',activeEnvironment:'testnet',nimiqTestnetAddress:'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',supportsPickup:true,supportsDelivery:false,supportsDineIn:true,acceptsNim:true,acceptsUsdt:false,acceptsTestnetNim:true,acceptsTestnetUsdt:false,defaultLocale:'id',voiceLocale:'id'};
const products=[{id:'demo-burger',name:'Burger Spesial',description:'Contoh menu untuk demo tampilan.',category:'food',imageUrl:'/products/burger.jpg',priceNimLuna:'10000000'},{id:'demo-fruit',name:'Buah Segar',description:'Pilihan buah dalam katalog contoh.',category:'fruit',imageUrl:'/products/fresh-fruit.jpg',priceNimLuna:'5000000'},{id:'demo-cake',name:'Cake Stroberi',description:'Dessert untuk menu contoh.',category:'dessert',imageUrl:'/products/cake.jpg',priceNimLuna:'7500000'}].map(product=>({...product,storeSlug:store.slug,available:true,priceUsdtMicro:null}));
const order={id:'illustrative-order',publicToken:'illustrative-video-order',orderNumber:'T-DEMO',storeSlug:store.slug,storeName:store.name,environment:'testnet',asset:'NIM',network:'nimiq-testnet',snapshotRecipient:store.nimiqTestnetAddress,amountBase:'10000000',amountFormatted:'100 NIM (TESTNET)',items:[{productId:products[0].id,name:products[0].name,quantity:1,lineTotalBase:'10000000',unitPriceBase:'10000000'}],fulfillmentMode:'pickup',tableOrNote:'DEMO TAMPILAN — BUKAN TRANSAKSI NYATA',paymentStatus:'unpaid',fulfillmentStatus:'new',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+900000).toISOString()};
const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1280,height:600},deviceScaleFactor:1,reducedMotion:'reduce'});let signedIn=false;
await context.addInitScript(()=>localStorage.setItem('nimtera.ui.locale','id'));
await context.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;
 if(route.request().method()!=='GET')throw new Error('Demo must not mutate any API');
 if(path==='/api/auth/session')return route.fulfill({status:signedIn?200:401,json:signedIn?{seller:{email:'demo@example.invalid',totpEnabled:false},store,mfaVerified:false}: {error:'Not signed in'}});
 const data=path==='/api/seller/dashboard'?{store,products,orders:[],auditLogs:[],security:{totpEnabled:false}}:path.startsWith('/api/public/orders/')?{order}:path.startsWith('/api/public/stores/')?{store,products}:path==='/api/health'?{ready:true,configured:{database:true,sessionSecret:true},databaseReachable:true}:{totpEnabled:false,captchaRequired:false};return route.fulfill({json:data});});
const page=await context.newPage();
async function capture(number){await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:`${folder}/screen-${number}.png`,animations:'disabled'});console.log('Captured',number,page.url());}
await page.goto(base);await page.locator('h1').waitFor();await capture(1);
await page.goto(base+'/seller/setup');await page.locator('form input').first().waitFor();await capture(2);
signedIn=true;await page.goto(base+'/seller/products');await page.getByTestId('product-photo-upload').waitFor();await capture(3);
await page.goto(base+'/s/nimtera-demo');await page.getByTestId('menu-column-food').scrollIntoViewIfNeeded();await capture(4);
await page.goto(base+'/s/nimtera-demo/order/illustrative-video-order');await page.getByTestId('checkout-total-amount').waitFor();await capture(5);
await browser.close();
