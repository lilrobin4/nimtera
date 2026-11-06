import test from 'node:test';
import assert from 'node:assert/strict';
import { CashierAudioEngine } from '../src/lib/audio';
import { paymentSpeech,indonesianInteger } from '../src/lib/paymentSpeech';
import { LOCALE_METADATA,type SupportedLocale } from '../src/lib/i18n';
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function idle(engine:CashierAudioEngine){const deadline=Date.now()+5000;while(engine.getStatus().busy&&Date.now()<deadline)await pause(15);assert.equal(engine.getStatus().busy,false);}
function browser(){
 const originals=Object.fromEntries(['window','localStorage','SpeechSynthesisUtterance'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const storage=new Map<string,string>();const spoken:any[]=[];const tones:any[]=[];let cancelled=0;
 const voices=[{name:'English Natural',lang:'en-US',voiceURI:'en'},{name:'Indonesian Natural',lang:'id-ID',voiceURI:'id'},{name:'Indonesian Basic',lang:'id-ID',voiceURI:'id-basic'}];
 const gain={gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};
 class Context {state='running';currentTime=0;destination={};async resume(){this.state='running';}createGain(){return gain;}createOscillator(){return {type:'sine',frequency:{setValueAtTime(){}},connect(){},disconnect(){},onended:null,start(){tones.push(Date.now());},stop(){}};}}
 const speech={getVoices:()=>voices,addEventListener(){},cancel(){cancelled++;},speak(utter:any){spoken.push({text:utter.text,lang:utter.lang,voice:utter.voice,at:Date.now()});setTimeout(()=>utter.onend?.(),25);}};
 Object.defineProperty(globalThis,'window',{configurable:true,value:{AudioContext:Context,addEventListener(){},speechSynthesis:speech}});
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>storage.get(k)||null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)}});
 Object.defineProperty(globalThis,'SpeechSynthesisUtterance',{configurable:true,value:class {constructor(public text:string){}}});
 return {spoken,tones,get cancelled(){return cancelled;},restore(){for(const [key,value] of Object.entries(originals))if(value)Object.defineProperty(globalThis,key,value);else delete (globalThis as any)[key];}};
}
test('six-language speech is status plus exact amount only, without test/preview prefixes',()=>{
 for(const locale of Object.keys(LOCALE_METADATA) as SupportedLocale[]){const phrase=paymentSpeech('confirmed','[TESTNET] 110.50000 NIM (TESTNET)',locale,true);assert.doesNotMatch(phrase,/TESTNET|#T01|110\.50000/);assert.match(phrase,locale==='id'?/seratus sepuluh/:/110/);assert.match(phrase,/nim/i);}
 assert.equal(paymentSpeech('confirmed','0.00001 NIM','id'),'Pembayaran diterima, nol koma nol nol nol nol satu nim.');
 assert.equal(paymentSpeech('confirmed','2.00 NIM (TESTNET)','en',true),'Payment received, 2 NIM.');
});
test('Indonesian amounts are clear words, including 1000 NIM and precise decimals',()=>{
 assert.equal(paymentSpeech('confirmed','1000 NIM (TESTNET)','id'),'Pembayaran diterima, seribu nim.');
 assert.equal(paymentSpeech('confirmed','1500.25 NIM','id'),'Pembayaran diterima, seribu lima ratus koma dua lima nim.');
 for(const [input,expected] of [['0','nol'],['11','sebelas'],['110','seratus sepuluh'],['1000000','satu juta'],['1001001','satu juta seribu satu'],['999999999999999999999','sembilan ratus sembilan puluh sembilan kuintiliun sembilan ratus sembilan puluh sembilan kuadriliun sembilan ratus sembilan puluh sembilan triliun sembilan ratus sembilan puluh sembilan miliar sembilan ratus sembilan puluh sembilan juta sembilan ratus sembilan puluh sembilan ribu sembilan ratus sembilan puluh sembilan']])assert.equal(indonesianInteger(input),expected);
});
test('legacy English default migrates to Indonesian once; explicitly selecting English still persists',()=>{
 const env=browser(),one=new CashierAudioEngine(),two=new CashierAudioEngine();try{
 localStorage.setItem('nimtera.audio.preferences.legacy',JSON.stringify({voiceLocale:'en',voiceURI:'en',volume:.4,muted:false}));
 one.setScope('legacy','en');assert.equal(one.getStatus().voiceLocale,'id');assert.equal(one.getStatus().voiceURI,'');assert.equal(one.getStatus().volume,.4);
 one.setConfig({voiceLocale:'en'});two.setScope('legacy','id');assert.equal(two.getStatus().voiceLocale,'en');
 }finally{one.stop();two.stop();env.restore();}
});
test('cashier audio sequences chime then matching voice, queues confirmations and deduplicates persistently',async()=>{
 const env=browser(),engine=new CashierAudioEngine();
 try{engine.setScope('audio-shop','id');assert.equal(await engine.unlock(),true);const cancels=env.cancelled;
  engine.announcePaymentReady('1 NIM (TESTNET)','T01');await idle(engine);assert.equal(env.spoken.length,0);
  const started=Date.now();engine.announcePaymentConfirmed('1.25 NIM (TESTNET)','T01');engine.announcePaymentConfirmed('2 NIM (TESTNET)','T02');engine.announcePaymentConfirmed('2 NIM (TESTNET)','T02');
  await pause(100);assert.equal(env.spoken.length,0);await idle(engine);assert.equal(env.spoken.length,2);assert.ok(env.spoken[0].at-started>=450);assert.equal(env.spoken[0].voice.voiceURI,'id');assert.equal(env.spoken[0].lang,'id-ID');assert.equal(env.cancelled,cancels);
  engine.stop();const fresh=new CashierAudioEngine();try{fresh.setScope('audio-shop','id');await fresh.unlock();fresh.announcePaymentConfirmed('1.25 NIM (TESTNET)','T01');await idle(fresh);assert.equal(env.spoken.length,2);}finally{fresh.stop();}
 }finally{engine.stop();env.restore();}
});
test('mute/zero volume cannot be bypassed by previews; missing locale voice never falls back to wrong language',async()=>{
 const env=browser(),engine=new CashierAudioEngine();try{engine.setScope('mute-shop','id');await engine.unlock();engine.setConfig({muted:true});engine.announcePaymentConfirmed('2 NIM','preview',true);await pause(30);assert.equal(env.spoken.length,0);assert.equal(env.tones.length,0);
 engine.setConfig({muted:false,volume:0});engine.announcePaymentConfirmed('2 NIM','preview',true);assert.equal(env.tones.length,0);
 engine.setConfig({volume:.6,voiceLocale:'ms'});engine.announcePaymentConfirmed('2 NIM','T01');await idle(engine);assert.equal(env.spoken.length,0);assert.equal(engine.getStatus().voiceAvailable,false);assert.ok(env.tones.length>0);
 }finally{engine.stop();env.restore();}
});
test('only one shop-scoped browser tab announces, and audio preferences restore independently from UI language',async()=>{
 const env=browser(),one=new CashierAudioEngine(),two=new CashierAudioEngine();try{one.setScope('tab-shop','id');await one.unlock();one.setConfig({volume:.35,voiceURI:'id-basic'});two.setScope('tab-shop','en');assert.equal(two.getStatus().voiceLocale,'id');assert.equal(two.getStatus().volume,.35);assert.equal(two.getStatus().voiceURI,'id-basic');await two.unlock();one.announcePaymentConfirmed('1 NIM','T01');two.announcePaymentConfirmed('1 NIM','T01');await idle(two);assert.equal(env.spoken.length,1);assert.equal(one.getStatus().isPrimaryDevice,false);assert.equal(env.spoken[0].voice.voiceURI,'id-basic');
 }finally{one.stop();two.stop();env.restore();}
});
