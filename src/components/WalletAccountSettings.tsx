import {useEffect,useState} from 'react';
import type {SupportedLocale} from '../lib/i18n';
import {WALLET_COPY} from '../lib/walletCopy';
import {WalletAuthPanel} from './WalletAuthPanel';
import {walletJson} from '../lib/walletIdentity';
export function WalletAccountSettings({locale}:{locale:SupportedLocale}){
 const text=WALLET_COPY[locale],[state,setState]=useState<{hasPassword:boolean;walletAuthAddress:string|null;totpEnabled:boolean}|null>(null),[error,setError]=useState(''),[password,setPassword]=useState(''),[newPassword,setNewPassword]=useState(''),[confirm,setConfirm]=useState(''),[totp,setTotp]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{const controller=new AbortController();void fetch('/api/seller/security',{credentials:'same-origin',cache:'no-store',signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error('Account security unavailable.');const data=await response.json();setState({hasPassword:data.hasPassword!==false,walletAuthAddress:data.walletAuthAddress||null,totpEnabled:data.totpEnabled===true});}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[]);
 const field='block w-full bg-[var(--surface-base)] border border-slate-500 rounded-xl p-3 mt-1 text-sm';
 return <section data-testid="wallet-account-settings" className="lg:col-span-12 bg-[var(--surface-card)] border border-slate-600 rounded-2xl p-6 space-y-4"><h2 className="font-bold text-lg">{text.settings}</h2><p className="text-sm text-slate-300">{text.unchanged}</p>
 {state&&<><p className="text-sm break-all">{state.walletAuthAddress?`${text.linked}: ${state.walletAuthAddress}`:text.unlinked}</p>
 {state.hasPassword?<label className="block text-sm max-w-md">{text.current}<input type="password" autoComplete="current-password" data-testid="wallet-current-password" value={password} onChange={e=>setPassword(e.target.value)} className={field}/></label>:<p className="text-sm text-slate-300">{text.passwordHint}</p>}
 {state.totpEnabled&&<label className="block text-sm max-w-md">{text.code}<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} data-testid="wallet-settings-totp" value={totp} onChange={e=>setTotp(e.target.value)} className={field}/></label>}
 {!state.walletAuthAddress?<WalletAuthPanel locale={locale} mode="link" canProceed={state.hasPassword&&password.length>0} extra={{currentPassword:password,totpCode:totp}}/>:<>
 <label className="block text-sm max-w-md">{text.newPassword}<input type="password" autoComplete="new-password" minLength={15} maxLength={256} data-testid="wallet-new-password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} className={field}/></label>
 <label className="block text-sm max-w-md">{text.confirm}<input type="password" autoComplete="new-password" maxLength={256} data-testid="wallet-new-password-confirm" value={confirm} onChange={e=>setConfirm(e.target.value)} className={field}/></label>
 <WalletAuthPanel locale={locale} mode="password" canProceed={newPassword.length>=15&&newPassword===confirm&&(!state.hasPassword||password.length>0)} extra={{currentPassword:password,password:newPassword,totpCode:totp}}/>
 <p className="text-xs text-slate-300">{text.backup}</p><button type="button" disabled={busy||!state.hasPassword||!password} data-testid="wallet-unlink" className="rounded-xl px-4 py-2 border border-slate-500 text-sm disabled:opacity-60" onClick={async()=>{setBusy(true);setError('');try{await walletJson('/api/seller/wallet-login/unlink',{currentPassword:password,totpCode:totp});window.location.reload();}catch(e){setError(e instanceof Error?e.message:'Could not unlink wallet.');}finally{setBusy(false);}}}>{text.unlink}</button>
 </>}
 </>}
 {error&&<p role="alert" className="text-sm text-rose-200">{error}</p>}</section>;
}
