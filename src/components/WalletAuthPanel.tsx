import {clearLegacySellerToken} from '../lib/sellerSession';
import {useState} from 'react';
import type {SupportedLocale} from '../lib/i18n';
import {WALLET_COPY} from '../lib/walletCopy';
import {connectWalletIdentity,proveWalletIdentity,walletJson,type WalletConnection} from '../lib/walletIdentity';
const field='block w-full min-w-0 bg-[var(--surface-base)] border border-slate-500 rounded-xl p-3 mt-1 text-sm';
export function WalletAuthPanel({locale,mode,extra={},canProceed=true}:{locale:SupportedLocale;mode:'login'|'register'|'link'|'password';extra?:Record<string,string>;canProceed?:boolean}){
 const text=WALLET_COPY[locale];
 const [connection,setConnection]=useState<WalletConnection|null>(null),[address,setAddress]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[ticket,setTicket]=useState(''),[totp,setTotp]=useState('');
 const [email,setEmail]=useState(''),[name,setName]=useState(''),[slug,setSlug]=useState(''),[recipient,setRecipient]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState('');
 const finish=()=>{clearLegacySellerToken();window.location.assign(mode==='link'||mode==='password'?'/seller/settings':'/seller/counter');};
 return <details className="rounded-2xl border border-slate-500 bg-[var(--surface-base)] p-4 space-y-3" data-testid={`wallet-auth-${mode}`}>
  <summary className="cursor-pointer font-semibold text-sm text-[var(--gold-ink)]">{mode==='link'?text.link:mode==='password'?text.setPassword:text.title}</summary>
  <p className="text-xs text-slate-300 mt-3">{text.note}</p><p className="text-xs text-slate-300">{mode==='link'||mode==='password'?text.settingsBrowser:text.browser}</p>
  {!ticket?<div className="space-y-3">
   <button type="button" disabled={busy} data-testid={`wallet-connect-${mode}`} className="rounded-xl bg-[#DFC496] text-[#101827] px-4 py-2 text-sm font-semibold disabled:opacity-70" onClick={async()=>{setBusy(true);setError('');setConnection(null);try{const c=await connectWalletIdentity();setConnection(c);setAddress(c.addresses[0]);}catch(e){setError(e instanceof Error?e.message:'Could not connect wallet.');}finally{setBusy(false);}}}>{busy?text.busy:text.connect}</button>
   {connection&&<><label className="block text-xs">{text.account}<select data-testid={`wallet-account-${mode}`} value={address} onChange={e=>setAddress(e.target.value)} disabled={busy} className={field}>{connection.addresses.map(account=><option key={account} value={account}>{account}</option>)}</select></label>
    {mode==='login'&&<label className="block text-xs">{text.code}<input autoComplete="one-time-code" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" value={totp} onChange={e=>setTotp(e.target.value)} data-testid="wallet-login-totp" className={field}/></label>}
    <button type="button" disabled={busy||!canProceed} data-testid={`wallet-verify-${mode}`} className="w-full rounded-xl bg-teal-400 text-slate-950 px-4 py-3 text-sm font-semibold disabled:opacity-60" onClick={async()=>{setBusy(true);setError('');try{const result=await proveWalletIdentity(connection,address,mode,{totpCode:totp,...extra});if(mode==='register'){setTicket(result.registrationTicket);setAddress(result.address);if(result.network==='testnet')setRecipient(result.address);}else finish();}catch(e){setError(e instanceof Error?e.message:'Wallet proof failed.');}finally{setBusy(false);}}}>{busy?text.busy:text.verify}</button>
   </>}
  </div>:<form className="space-y-3" data-testid="wallet-registration-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{if(password!==confirm)throw new Error(text.confirm);await walletJson('/api/auth/wallet/register',{registrationTicket:ticket,email,storeName:name,storeSlug:slug,nimiqAddress:recipient,...(password?{password}:{}),defaultLocale:locale});finish();}catch(e){setError(e instanceof Error?e.message:'Could not complete registration.');}finally{setBusy(false);}}}>
   <h2 className="font-semibold">{text.profile}</h2><p className="text-xs break-all">{text.verified}: {address}</p>
   <label className="block text-xs">{text.email}<input data-testid="wallet-register-email" type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} className={field}/></label>
   <label className="block text-xs">{text.shop}<input required maxLength={60} data-testid="wallet-register-shop" value={name} onChange={e=>setName(e.target.value)} className={field}/></label>
   <label className="block text-xs">{text.slug}<input required pattern="[a-z0-9-]{3,40}" minLength={3} maxLength={40} data-testid="wallet-register-slug" value={slug} onChange={e=>setSlug(e.target.value.toLowerCase())} className={field}/></label>
   <label className="block text-xs">{text.receiver}<input required maxLength={100} data-testid="wallet-register-recipient" value={recipient} onChange={e=>setRecipient(e.target.value)} className={field}/></label><p className="text-xs text-slate-300">{text.receiverHint}</p>
   <label className="block text-xs">{text.optionalPassword}<input type="password" minLength={15} maxLength={256} autoComplete="new-password" data-testid="wallet-register-password" value={password} onChange={e=>setPassword(e.target.value)} className={field}/></label>
   {password&&<label className="block text-xs">{text.confirm}<input type="password" required autoComplete="new-password" maxLength={256} data-testid="wallet-register-confirm" value={confirm} onChange={e=>setConfirm(e.target.value)} className={field}/></label>}
   <button type="submit" disabled={busy} className="w-full rounded-xl bg-teal-400 text-slate-950 px-4 py-3 text-sm font-semibold">{busy?text.busy:text.create}</button>
   <button type="button" onClick={()=>{setTicket('');setConnection(null);setPassword('');setConfirm('');setError('');}} className="text-xs underline text-slate-300">{text.retry}</button>
  </form>}
  {error&&<p role="alert" className="text-sm text-rose-200 break-words">{error}</p>}
 </details>;
}
