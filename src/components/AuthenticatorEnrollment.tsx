import { sellerAuthHeaders } from '../lib/sellerSession';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function AuthenticatorEnrollment({ enrollment, token, onComplete, onCancel }: { enrollment: { secret: string; uri: string }; token: string; onComplete: () => void; onCancel: () => void }) {
  const [qr, setQr] = useState(''), [code, setCode] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; void QRCode.toDataURL(enrollment.uri, { width: 240, margin: 2 }).then(q => { if (live) setQr(q); }); return () => { live = false; }; }, [enrollment.uri]);
  return <main className="min-h-screen grid place-items-center bg-[#0B101C] text-white p-5"><form className="max-w-md w-full bg-[#131C2E] rounded-2xl p-6 space-y-4" onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = await fetch('/api/auth/mfa/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json', ...sellerAuthHeaders(token) }, body: JSON.stringify({ totpCode: code }) });
      if (!r.ok) throw new Error((await r.json()).error || 'Enrollment failed');
      onComplete();
    } catch (err) { setError(err instanceof Error ? err.message : 'Enrollment failed'); } finally { setBusy(false); }
  }}><h1 className="text-xl text-[#DFC496]">Set up your authenticator</h1><p className="text-sm">Scan this setup QR in your authenticator app. This is a private login secret, not a payment QR. Do not share it.</p>{qr && <img src={qr} alt="Private authenticator setup QR" className="mx-auto rounded-lg" />}<details><summary>Enter a setup key manually</summary><code className="break-all block text-sm py-3">{enrollment.secret}</code></details><label className="block">Authenticator code<input value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" className="block w-full bg-slate-800 p-3 rounded mt-2" /></label>{error && <p role="alert" className="text-rose-300">{error}</p>}<button disabled={busy} className="bg-teal-500 text-slate-950 p-3 rounded-lg w-full">{busy ? 'Checking…' : 'Confirm and open seller console'}</button><button type="button" onClick={onCancel} className="text-slate-300 w-full">Sign out</button><p className="text-xs text-amber-200">Testnet beta. Email is not verified and mainnet payments are disabled. Keep your authenticator backup securely; account recovery is not yet provided.</p></form></main>;
}
