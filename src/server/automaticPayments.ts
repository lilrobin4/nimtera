import crypto from 'node:crypto';
import {isActiveNimOrder,reconcilePaymentVerification,type OrderSnapshot} from '../lib/domain.js';
import {readAddressPaymentEvidence,rpcWatchCall,type RpcCall} from './payments.js';
export const UNIQUE_CODE_MAX=999;
export const normalizeRecipient=(value:string)=>value.replace(/\s/g,'').toUpperCase();
export function allocateUniqueAmount(subtotal:bigint,recipient:string,network:string,orders:OrderSnapshot[]){
 if(network!=='nimiq-testnet'||subtotal<=0n)throw new Error('Only positive NIM Testnet subtotals are supported.');
 const used=new Set(orders.filter(o=>o.network===network&&normalizeRecipient(o.snapshotRecipient)===normalizeRecipient(recipient)).map(o=>o.amountBase));
 for(let code=1;code<=UNIQUE_CODE_MAX;code++){const amount=subtotal+BigInt(code);if(amount<=BigInt(Number.MAX_SAFE_INTEGER)&&!used.has(amount.toString()))return {amountBase:amount.toString(),subtotalBase:subtotal.toString(),paymentCodeLuna:String(code),matchingMode:'unique-amount-v1' as const};}
 throw new Error('Unique payment-code capacity reached for this receiving address. No amount was reused.');
}
export interface AutomaticPaymentDatabase {orders:OrderSnapshot[];claimedTransactions:Record<string,string>;auditLogs:{id:string;storeSlug:string;sellerEmail:string;action:string;details:string;createdAt:string}[];paymentScanState?:Record<string,{checkedAt:number;status:'ok'|'unavailable'|'limited'}>}
function validReservation(o:OrderSnapshot){
 try{return o.matchingMode==='unique-amount-v1'&&isActiveNimOrder(o)&&/^\d+$/.test(o.subtotalBase||'')&&/^\d+$/.test(o.paymentCodeLuna||'')&&BigInt(o.subtotalBase!)>0n&&BigInt(o.paymentCodeLuna!)>=1n&&BigInt(o.paymentCodeLuna!)<=BigInt(UNIQUE_CODE_MAX)&&BigInt(o.subtotalBase!)+BigInt(o.paymentCodeLuna!)===BigInt(o.amountBase);}catch{return false;}
}
function millis(value:unknown){const n=Number(value);return Number.isFinite(n)&&n>0?(n<1e12?n*1000:n):NaN;}
/** Read-only address history, called on cashier/invoice polling. No signing, broadcast or mainnet fallback.
 * A shared durable cooldown bounds RPC work across server instances. Exact amounts are never reused.
 */
export async function discoverAutomaticPayments(db:AutomaticPaymentDatabase,urls:Record<string,string>,storeSlug?:string,call:RpcCall=rpcWatchCall,now=Date.now()){
 const pending=db.orders.filter(o=>validReservation(o)&&o.paymentStatus!=='confirmed'&&o.autoMatchState!=='needs_review'&&(!storeSlug||o.storeSlug===storeSlug));
 db.paymentScanState??={};const scanState=db.paymentScanState;
 const recipients=[...new Set(pending.map(o=>normalizeRecipient(o.snapshotRecipient)))].filter(r=>now-(scanState[r]?.checkedAt||0)>=10000).sort((a,b)=>(scanState[a]?.checkedAt||0)-(scanState[b]?.checkedAt||0));
 const recipient=recipients[0];if(!recipient)return;
 scanState[recipient]={checkedAt:now,status:'ok'};
 const candidates=db.orders.filter(o=>validReservation(o)&&o.paymentStatus!=='confirmed'&&o.autoMatchState!=='needs_review'&&normalizeRecipient(o.snapshotRecipient)===recipient);
 for(const o of candidates){o.autoMatchCheckedAt=new Date(now).toISOString();o.autoMatchState='watching';}
 let history:any;
 try{history=await call(urls['nimiq-testnet'],'getTransactionsByAddress',[recipient,500,null]);if(!Array.isArray(history)||history.length>500)throw new Error('Invalid address history');}
 catch{scanState[recipient].status='unavailable';for(const o of candidates)o.autoMatchState='unavailable';return;}
 if(history.length===500)scanState[recipient].status='limited';
 const seen=new Set<string>();const transfers=history.filter(t=>{if(!t||typeof t.hash!=='string'||!/^[a-f0-9]{64}$/i.test(t.hash)||seen.has(t.hash.toLowerCase()))return false;seen.add(t.hash.toLowerCase());return true;});
 for(const order of candidates){
  if(order.paymentStatus==='confirmed')continue;
  // Check all retained reservations, including other shops sharing this wallet and expired/legacy orders.
  const collisions=db.orders.filter(o=>o.network===order.network&&normalizeRecipient(o.snapshotRecipient)===recipient&&o.amountBase===order.amountBase);
  if(collisions.length!==1){order.autoMatchState='needs_review';order.paymentStatus='needs_review';order.paymentReviewReason='Ambiguous payment amount; automatic matching stopped.';continue;}
  const possible=transfers.filter(t=>{
   try{return normalizeRecipient(String(t.recipient??t.toAddress??t.to??''))===recipient&&BigInt(t.value)===BigInt(order.amountBase)&&millis(t.timestamp??t.blockTimestamp)>=Date.parse(order.createdAt)&&millis(t.timestamp??t.blockTimestamp)<=Date.parse(order.expiresAt);}catch{return false;}
  });
  const verified=[];
  for(const t of possible){
   const evidence=await readAddressPaymentEvidence(order,t.hash,urls,async()=>t);
   if(evidence.executionStatus!=='confirmed')continue;
   const key=`${order.network}:${t.hash.toLowerCase()}`;
   if(db.claimedTransactions[key]&&db.claimedTransactions[key]!==order.id)continue;
   verified.push({evidence,key,hash:t.hash.toLowerCase()});
  }
  if(verified.length>1){order.autoMatchState='needs_review';order.paymentStatus='needs_review';order.paymentReviewReason='Multiple transfers match this payment code; cashier review required.';continue;}
  if(verified.length!==1){if(history.length===500)order.autoMatchState='limited';continue;}
  const {evidence,key,hash}=verified[0];
  const outcome=reconcilePaymentVerification({order,evidence:{...evidence,txHash:key},claimedTxOrderMap:new Map(Object.entries(db.claimedTransactions)),nowIso:new Date(Math.min(now,Date.parse(order.expiresAt))).toISOString()});
  if(outcome.paymentStatus!=='confirmed'||!outcome.shouldBindTxHash)continue;
  db.claimedTransactions[key]=order.id;order.txHash=hash;order.paymentStatus='confirmed';order.paymentBinding='unique-amount';order.verifiedAt=new Date(now).toISOString();order.autoMatchState='confirmed';order.paymentReviewReason=undefined;
  db.auditLogs.unshift({id:`aud_${crypto.randomBytes(6).toString('hex')}`,storeSlug:order.storeSlug,sellerEmail:'automatic-verifier',action:'UNIQUE_AMOUNT_PAYMENT_CONFIRMED',details:`Read-only Testnet RPC verified unique amount ${order.amountBase}, recipient, execution, inclusion time and no-replay for ${order.orderNumber}.`,createdAt:order.verifiedAt});
 }
}
