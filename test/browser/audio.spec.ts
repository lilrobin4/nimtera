import {test,expect,type Page} from '@playwright/test';
const store={slug:'audio-browser-fixture',name:'Audio Shop',voiceLocale:'en',defaultLocale:'en',activeEnvironment:'testnet',supportsPickup:true,supportsDelivery:true,supportsDineIn:true};
async function setup(page:Page){
 await page.addInitScript(()=>{
  sessionStorage.setItem('nimtera_seller_token','audio-fixture');
  const voices=[{name:'English Natural',voiceURI:'en-natural',lang:'en-US',default:true},{name:'Indonesian Natural',voiceURI:'id-natural',lang:'id-ID',default:false}];
  (window as any).__spoken=[];
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>voices,addEventListener(){},cancel(){},speak(utter:any){(window as any).__spoken.push({text:utter.text,lang:utter.lang,voice:utter.voice.voiceURI,at:Date.now()});setTimeout(()=>utter.onend?.(),80);}}});
  Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class {text:string;constructor(text:string){this.text=text;}}});
 });
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;return route.fulfill({json:path==='/api/auth/session'?{seller:{email:'audio@example.test'},store,mfaVerified:true}:path==='/api/seller/dashboard'?{store,products:[],orders:[],auditLogs:[]}:path==='/api/health'?{ready:true,configured:{database:true,sessionSecret:true},databaseReachable:true}:{captchaRequired:false}});});
}
test('audio preview selects the correct language, respects mute and preserves independent preferences',async({page})=>{
 await setup(page);let paymentWrites=0;page.on('request',req=>{if(req.method()==='POST'&&/\/api\/(public\/orders|seller\/orders)/.test(req.url()))paymentWrites++;});
 await page.goto('/seller/settings');await expect(page.locator('#voice-lang-select')).toHaveValue('id');await page.locator('#voice-lang-select').selectOption('id');await page.locator('#cashier-voice-select').selectOption('id-natural');
 await page.getByTestId('enable-cashier-audio').click();await expect(page.getByTestId('enable-cashier-audio')).toHaveText('✓ Cashier audio active');
 await expect(page.getByTestId('preview-confirmed-audio')).toBeEnabled();await page.getByTestId('preview-confirmed-audio').click();
 await expect.poll(()=>page.evaluate(()=>(window as any).__spoken.length)).toBe(1);
 expect(await page.evaluate(()=>(window as any).__spoken[0])).toMatchObject({lang:'id-ID',voice:'id-natural',text:'Pembayaran diterima, seribu nim.'});
 await expect(page.getByTestId('preview-confirmed-audio')).toBeEnabled();
 await page.getByRole('button',{name:'Mute cashier audio',exact:true}).click();await expect(page.getByTestId('preview-confirmed-audio')).toBeDisabled();
 await page.locator('#audio-volume-range').fill('0.35');await page.reload();
 await expect(page.locator('#voice-lang-select')).toHaveValue('id');await expect(page.locator('#cashier-voice-select')).toHaveValue('id-natural');await expect(page.locator('#audio-volume-range')).toHaveValue('0.35');await expect(page.getByTestId('preview-confirmed-audio')).toBeDisabled();expect(paymentWrites).toBe(0);
});
test('activating another cashier tab hands audio ownership over without duplicate active tabs',async({page,context})=>{
 await setup(page);await page.goto('/seller/settings');await page.getByTestId('enable-cashier-audio').click();await expect(page.getByTestId('enable-cashier-audio')).toHaveText('✓ Cashier audio active');
 const other=await context.newPage();await setup(other);await other.goto('/seller/settings');await other.getByTestId('enable-cashier-audio').click();await expect(other.getByTestId('enable-cashier-audio')).toHaveText('✓ Cashier audio active');await expect(page.getByTestId('enable-cashier-audio')).toHaveText('Enable audio in this tab');await other.close();
});
test('an older invoice newly confirmed by automatic matching speaks its exact amount once',async({page})=>{
 await setup(page);let paid=false;const createdAt=new Date(Date.now()-3600000).toISOString();
 await page.route('**/api/seller/dashboard',route=>route.fulfill({json:{store,products:[],auditLogs:[],orders:[{id:'auto-audio-order',publicToken:'auto-audio-token',orderNumber:'T050',storeSlug:store.slug,storeName:store.name,asset:'NIM',environment:'testnet',network:'nimiq-testnet',snapshotRecipient:'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',amountBase:'8000001',amountFormatted:'80.00001 NIM (TESTNET)',subtotalBase:'8000000',paymentCodeLuna:'1',matchingMode:'unique-amount-v1',paymentStatus:paid?'confirmed':'unpaid',autoMatchState:paid?'confirmed':'watching',paymentBinding:paid?'unique-amount':undefined,verifiedAt:paid?new Date().toISOString():undefined,createdAt,expiresAt:new Date(Date.now()+300000).toISOString(),items:[],fulfillmentMode:'pickup',fulfillmentStatus:'new',tableOrNote:''}]}}));
 await page.goto('/seller/settings');await page.getByTestId('enable-cashier-audio').click();paid=true;
 await expect.poll(()=>page.evaluate(()=>(window as any).__spoken.length),{timeout:15000}).toBe(1);expect(await page.evaluate(()=>(window as any).__spoken[0].text)).toBe('Pembayaran diterima, delapan puluh koma nol nol nol nol satu nim.');
 await page.waitForTimeout(4500);expect(await page.evaluate(()=>(window as any).__spoken.length)).toBe(1);
});
