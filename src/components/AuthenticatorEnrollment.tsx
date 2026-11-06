import type { SupportedLocale } from '../lib/i18n';
import { sellerAuthHeaders } from '../lib/sellerSession';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function AuthenticatorEnrollment({ enrollment, token, onComplete, onCancel, embedded=false, locale='en' }: { embedded?:boolean; locale?:SupportedLocale; enrollment: { secret: string; uri: string }; token: string; onComplete: () => void; onCancel: () => void }) {
  const copy:Record<SupportedLocale,string[]>={
 en:['Set up your authenticator','Scan this private setup QR in your authenticator. Do not share this secret. Setup expires after 10 minutes.','Enter a setup key manually','Authenticator code','Checking…','Enable 2FA','Cancel','Keep your authenticator backup securely. Account recovery is not yet provided.','Invalid code or setup expired. Try again or restart setup.'],
 id:['Siapkan autentikator','Scan QR pribadi ini di aplikasi autentikator. Jangan bagikan rahasianya. Penyiapan berlaku 10 menit.','Masukkan kunci secara manual','Kode autentikator','Memeriksa…','Aktifkan 2FA','Batal','Simpan cadangan autentikator dengan aman. Pemulihan akun belum tersedia.','Kode salah atau penyiapan kedaluwarsa. Coba lagi atau mulai ulang.'],
 'zh-CN':['设置验证器','使用验证器扫描此私人二维码，请勿分享密钥。设置有效期为 10 分钟。','手动输入密钥','验证器代码','正在检查…','开启双重验证','取消','请妥善保存验证器备份，目前不提供账户恢复。','验证码无效或设置已过期，请重试或重新开始。'],
 vi:['Thiết lập ứng dụng xác thực','Quét mã QR riêng tư trong ứng dụng xác thực. Không chia sẻ khóa. Thiết lập hết hạn sau 10 phút.','Nhập khóa thủ công','Mã xác thực','Đang kiểm tra…','Bật 2FA','Hủy','Giữ bản sao xác thực an toàn. Chưa hỗ trợ khôi phục tài khoản.','Mã sai hoặc thiết lập hết hạn. Thử lại hoặc bắt đầu lại.'],
 ms:['Sediakan pengesah','Imbas QR peribadi ini dalam aplikasi pengesah. Jangan kongsi rahsia. Persediaan tamat selepas 10 minit.','Masukkan kunci secara manual','Kod pengesah','Menyemak…','Aktifkan 2FA','Batal','Simpan sandaran pengesah dengan selamat. Pemulihan akaun belum tersedia.','Kod salah atau persediaan tamat. Cuba lagi atau mulakan semula.'],
 ru:['Настройка аутентификатора','Сканируйте этот личный QR в аутентификаторе. Не передавайте секрет. Настройка действует 10 минут.','Ввести ключ вручную','Код аутентификатора','Проверка…','Включить 2FA','Отмена','Храните резервную копию аутентификатора. Восстановление аккаунта пока недоступно.','Неверный код или настройка истекла. Повторите или начните заново.'],
 };const text=copy[locale];
  const [qr, setQr] = useState(''), [code, setCode] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; void QRCode.toDataURL(enrollment.uri, { width: 240, margin: 2 }).then(q => { if (live) setQr(q); }); return () => { live = false; }; }, [enrollment.uri]);
  return <div className={embedded?"text-white":"min-h-screen grid place-items-center bg-[#0B0F14] text-white p-5"}><form className="max-w-md w-full bg-[#1C2430] rounded-2xl p-6 space-y-4" onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = await fetch('/api/auth/mfa/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json', ...sellerAuthHeaders(token) }, body: JSON.stringify({ totpCode: code }) });
      if (!r.ok) throw new Error(text[8]);
      onComplete();
    } catch (err) { setError(err instanceof Error ? err.message : 'Enrollment failed'); } finally { setBusy(false); }
  }}><h1 className="text-xl text-[#DFC496]">{text[0]}</h1><p className="text-sm">{text[1]}</p>{qr && <img src={qr} alt="Private authenticator setup QR" className="mx-auto rounded-lg" />}<details><summary>{text[2]}</summary><code className="break-all block text-sm py-3">{enrollment.secret}</code></details><label className="block">{text[3]}<input value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" className="block w-full bg-slate-800 p-3 rounded mt-2" /></label>{error && <p role="alert" className="text-rose-300">{error}</p>}<button disabled={busy} className="bg-teal-500 text-slate-950 p-3 rounded-lg w-full">{busy ? text[4] : text[5]}</button><button type="button" onClick={onCancel} className="text-slate-300 w-full">{text[6]}</button><p className="text-xs text-amber-200">{text[7]}</p></form></div>;
}
