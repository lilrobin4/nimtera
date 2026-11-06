import { LOCALE_METADATA, type SupportedLocale } from './i18n';
import { paymentSpeech } from './paymentSpeech';
type Job={kind:'ready'|'confirmed';amount:string;key:string;preview:boolean;at:number;locale:SupportedLocale};
export class CashierAudioEngine {
 private ctx:AudioContext|null=null;
 private unlocked=false;private muted=false;private volume=.8;private voiceLocale:SupportedLocale='en';private voiceURI='';private primary=false;private enabled=true;private scope='';
 private id=`tab_${Math.random().toString(36).slice(2)}`;private queue:Job[]=[];private running=false;private seen=new Set<string>();private generation=0;private listeners=new Set<()=>void>();private finishSpeech:(()=>void)|null=null;private currentJob:Job|null=null;private oscillators=new Set<OscillatorNode>();private heartbeat:ReturnType<typeof setInterval>|null=null;
 constructor(){if(typeof window!=='undefined'){window.addEventListener('storage',event=>{if(event.key===this.leaseKey())this.syncLease();});window.addEventListener('pagehide',()=>this.stop());window.addEventListener('pageshow',()=>{if(this.unlocked)this.claimPrimaryDevice();});window.speechSynthesis?.addEventListener('voiceschanged',()=>this.emit());}}
 private emit(){for(const cb of this.listeners)cb();}
 public subscribe(cb:()=>void){this.listeners.add(cb);return()=>{this.listeners.delete(cb);};}
 public getVoices(){if(typeof window==='undefined')return [];const lang=LOCALE_METADATA[this.voiceLocale].speechLang.toLowerCase();return (window.speechSynthesis?.getVoices()||[]).filter(v=>v.lang.toLowerCase()===lang || v.lang.toLowerCase().split('-')[0]===lang.split('-')[0]).sort((a,b)=>this.score(b)-this.score(a));}
 private score(v:SpeechSynthesisVoice){return (v.lang.toLowerCase()===LOCALE_METADATA[this.voiceLocale].speechLang.toLowerCase()?10:0)+(/natural|neural|premium|enhanced/i.test(v.name)?5:0)+(v.default?1:0);}
 private selectedVoice(){const voices=this.getVoices();return voices.find(v=>v.voiceURI===this.voiceURI)||voices[0];}
 public getStatus(){return {unlocked:this.unlocked,muted:this.muted,volume:this.volume,voiceLocale:this.voiceLocale,voiceURI:this.voiceURI,isPrimaryDevice:this.primary,deviceId:this.id,voiceAvailable:!!this.selectedVoice(),voiceName:this.selectedVoice()?.name||'',busy:this.running};}
 private prefKey(){return `nimtera.audio.preferences.${this.scope}`;}private leaseKey(){return `nimtera.audio.tab.${this.scope}`;}
 public setScope(scope:string,defaultLocale:SupportedLocale='en'){
  if(this.scope===scope)return;this.stop();this.scope=scope;this.seen.clear();this.muted=false;this.volume=.8;this.voiceLocale=defaultLocale;this.voiceURI='';this.enabled=true;
  try {const pref=JSON.parse(localStorage.getItem(this.prefKey())||'null');if(pref){this.muted=pref.muted===true;this.volume=Number.isFinite(pref.volume)?Math.max(0,Math.min(1,pref.volume)):.8;if(pref.voiceLocale in LOCALE_METADATA)this.voiceLocale=pref.voiceLocale;this.voiceURI=typeof pref.voiceURI==='string'?pref.voiceURI:'';}}catch{}this.emit();
 }
 private lease():{id:string;until:number}|null {try{return JSON.parse(localStorage.getItem(this.leaseKey())||'null');}catch{return null;}}
 private syncLease(){const lease=this.lease();const next=!!lease&&lease.id===this.id&&lease.until>Date.now();if(this.primary&&!next)this.cancel();this.primary=next;this.emit();}
 public claimPrimaryDevice(){if(!this.scope||!this.unlocked||!this.enabled||this.muted)return;try{localStorage.setItem(this.leaseKey(),JSON.stringify({id:this.id,until:Date.now()+4500}));this.primary=true;}catch{this.primary=true;}if(!this.heartbeat)this.heartbeat=setInterval(()=>{if(!this.primary||!this.unlocked||this.muted)return;const current=this.lease();if(current&&current.id!==this.id&&current.until>Date.now()){this.syncLease();return;}try{localStorage.setItem(this.leaseKey(),JSON.stringify({id:this.id,until:Date.now()+4500}));}catch{}},1500);this.emit();}
 private ownsTab(){if(!this.primary)return false;const current=this.lease();if(current&&current.id!==this.id&&current.until>Date.now()){this.syncLease();return false;}return true;}
 private release(){try{if(this.lease()?.id===this.id)localStorage.removeItem(this.leaseKey());}catch{}this.primary=false;if(this.heartbeat)clearInterval(this.heartbeat);this.heartbeat=null;}
 public async unlock():Promise<boolean> {
  if(typeof window==='undefined')return false;
  const generation=this.generation;
  try{const AudioCtx=window.AudioContext||(window as any).webkitAudioContext;if(!AudioCtx)return false;this.ctx ||= new AudioCtx();if(this.ctx!.state==='suspended')await this.ctx!.resume();if(generation!==this.generation)return false;this.unlocked=this.ctx!.state==='running';this.enabled=true;if(this.unlocked&&!this.muted)this.claimPrimaryDevice();this.emit();return this.unlocked;}catch{this.unlocked=false;this.emit();return false;}
 }
 public setConfig(opts:{muted?:boolean;volume?:number;voiceLocale?:SupportedLocale;voiceURI?:string;isPrimaryDevice?:boolean}){
  if(opts.muted!==undefined){this.muted=opts.muted;if(this.muted){this.cancel();this.release();}else if(this.unlocked)this.claimPrimaryDevice();}
  if(opts.volume!==undefined&&Number.isFinite(opts.volume))this.volume=Math.max(0,Math.min(1,opts.volume));
  if(opts.voiceLocale!==undefined){this.cancel();this.voiceLocale=opts.voiceLocale;this.voiceURI='';}
  if(opts.voiceURI!==undefined){this.cancel();this.voiceURI=opts.voiceURI;}
  if(opts.isPrimaryDevice!==undefined){this.enabled=opts.isPrimaryDevice;if(this.enabled)this.claimPrimaryDevice();else{this.cancel();this.release();}}
  try{if(this.scope)localStorage.setItem(this.prefKey(),JSON.stringify({muted:this.muted,volume:this.volume,voiceLocale:this.voiceLocale,voiceURI:this.voiceURI}));}catch{}this.emit();
 }
 private cancel(){for(const osc of this.oscillators){try{osc.stop();}catch{}}this.oscillators.clear();this.generation++;this.queue=[];try{window.speechSynthesis?.cancel();}catch{}this.finishSpeech?.();this.finishSpeech=null;}
 public stopPreview(){if(this.currentJob?.preview||!this.currentJob)this.cancel();}
 public stop(){this.cancel();this.release();this.unlocked=false;this.emit();}
 private canPlay(){return this.unlocked&&!this.muted&&this.volume>0&&this.ownsTab();}
 private tone(freq:number,start:number,duration:number,peak:number){if(!this.ctx)return;const osc=this.ctx.createOscillator(),gain=this.ctx.createGain();osc.type='sine';osc.frequency.setValueAtTime(freq,start);gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(Math.max(.001,peak*this.volume),start+.025);gain.gain.exponentialRampToValueAtTime(.0001,start+duration);osc.connect(gain);gain.connect(this.ctx.destination);this.oscillators.add(osc);osc.onended=()=>{this.oscillators.delete(osc);osc.disconnect();gain.disconnect();};osc.start(start);osc.stop(start+duration+.02);}
 private chime(kind:'ready'|'confirmed'){if(!this.canPlay()||!this.ctx)return;const now=this.ctx.currentTime;this.tone(kind==='ready'?523.25:659.25,now,.18,.13);this.tone(kind==='ready'?659.25:880,now+.15,.3,.15);}
 public playInvoiceReadyChime(){this.enqueue('ready','','unlock',false);}
 public playPaymentConfirmedChime(){this.enqueue('confirmed','','chime',false);}
 public announcePaymentReady(amount:string,order:string,preview=false){this.enqueue('ready',amount,order,preview);}
 public announcePaymentConfirmed(amount:string,order:string,preview=false){this.enqueue('confirmed',amount,order,preview);}
 private async enqueue(kind:'ready'|'confirmed',amount:string,order:string,preview:boolean){
  if(preview){if((this.currentJob?.kind==='confirmed'&&!this.currentJob.preview)||this.queue.some(job=>job.kind==='confirmed'&&!job.preview))return;if(this.muted||this.volume===0)return;if(!await this.unlock())return;this.cancel();}
  if(!this.canPlay())return;
  const key=`${kind}:${order}`;
  if(!preview&&amount){let history:Record<string,number>={};try{const stored=JSON.parse(localStorage.getItem(`nimtera.audio.events.${this.scope}`)||'{}');if(stored&&typeof stored==='object'&&!Array.isArray(stored))history=stored;}catch{}
   if(this.seen.has(key)||Number(history[key])>Date.now()-86400000)return;this.seen.add(key);if(this.seen.size>1000)this.seen.delete(this.seen.values().next().value!);
   history[key]=Date.now();try{localStorage.setItem(`nimtera.audio.events.${this.scope}`,JSON.stringify(Object.fromEntries(Object.entries(history).filter(([,at])=>at>Date.now()-86400000).slice(-1000))));}catch{}
  }
  if(!preview&&kind==='confirmed')this.queue=this.queue.filter(job=>job.key!==`ready:${order}`);
  if(this.queue.length>=12)this.queue.shift();this.queue.push({kind,amount,key,preview,at:Date.now(),locale:this.voiceLocale});void this.drain();
 }
 private async drain(){if(this.running)return;this.running=true;this.emit();
  try{while(this.queue.length){const job=this.queue.shift()!;if(!this.canPlay())break;if(Date.now()-job.at>30000)continue;this.currentJob=job;const generation=this.generation;
   if(this.ctx?.state==='suspended'){try{await this.ctx.resume();}catch{continue;}}if(generation!==this.generation||!this.canPlay())continue;
   this.chime(job.kind);await new Promise(resolve=>setTimeout(resolve,480));if(generation!==this.generation||!this.canPlay())continue;
   // Real invoice creation is a quiet chime; only verified confirmation gets a spoken payment status.
   if(job.amount&&(job.kind==='confirmed'||job.preview))await this.speak(paymentSpeech(job.kind,job.amount,job.locale,job.preview),job.locale);
   await new Promise(resolve=>setTimeout(resolve,150));
  }}finally{this.currentJob=null;this.running=false;this.emit();}
 }
 private speak(text:string,locale:SupportedLocale):Promise<void>{const voice=this.selectedVoice();if(!voice||typeof window==='undefined'||!window.speechSynthesis)return Promise.resolve();return new Promise(resolve=>{
  let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);this.finishSpeech=null;resolve();};const timer=setTimeout(()=>{try{window.speechSynthesis.cancel();}catch{}finish();},15000);this.finishSpeech=finish;
  try{const utter=new SpeechSynthesisUtterance(text);utter.lang=LOCALE_METADATA[locale].speechLang;utter.voice=voice;utter.volume=this.volume;utter.rate=1;utter.pitch=1;utter.onend=finish;utter.onerror=finish;window.speechSynthesis.speak(utter);}catch{finish();}
 });}
}
export const cashierAudio=new CashierAudioEngine();
