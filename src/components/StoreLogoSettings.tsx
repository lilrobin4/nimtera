import { useEffect, useRef, useState } from 'react';
import { optimizedPhoto } from '../lib/imageUpload';
import { sellerAuthHeaders } from '../lib/sellerSession';
import type { SupportedLocale } from '../lib/i18n';
const TEXT:Record<SupportedLocale,string[]>={
 en:['Shop logo','Upload shop logo','Remove logo','Saving…','JPG, PNG or WebP, up to 5 MB / 16 MP. Saved automatically and shown on your public storefront. NimTera branding stays unchanged.','Could not save the logo. Please try again.','Logo saved.','Logo removed.'],
 id:['Logo toko','Upload logo toko','Hapus logo','Menyimpan…','JPG, PNG, atau WebP, maksimal 5 MB / 16 MP. Otomatis tersimpan dan tampil di katalog publik toko. Logo NimTera tidak berubah.','Logo belum berhasil disimpan. Silakan coba lagi.','Logo tersimpan.','Logo dihapus.'],
 'zh-CN':['店铺标志','上传店铺标志','移除标志','正在保存…','JPG、PNG 或 WebP，最大 5 MB / 1600 万像素。自动保存并显示在公开店铺中。NimTera 标志保持不变。','无法保存标志，请重试。','标志已保存。','标志已移除。'],
 vi:['Logo cửa hàng','Tải logo cửa hàng','Xóa logo','Đang lưu…','JPG, PNG hoặc WebP, tối đa 5 MB / 16 MP. Tự động lưu và hiển thị trên cửa hàng công khai. Thương hiệu NimTera không thay đổi.','Không thể lưu logo. Hãy thử lại.','Đã lưu logo.','Đã xóa logo.'],
 ms:['Logo kedai','Muat naik logo kedai','Buang logo','Menyimpan…','JPG, PNG atau WebP, sehingga 5 MB / 16 MP. Disimpan secara automatik dan dipaparkan di kedai awam. Jenama NimTera tidak berubah.','Logo gagal disimpan. Sila cuba lagi.','Logo disimpan.','Logo dibuang.'],
 ru:['Логотип магазина','Загрузить логотип','Удалить логотип','Сохранение…','JPG, PNG или WebP, до 5 МБ / 16 Мп. Автоматически сохраняется и отображается в публичном магазине. Бренд NimTera не меняется.','Не удалось сохранить логотип. Повторите попытку.','Логотип сохранён.','Логотип удалён.'],
};
export function StoreLogoSettings({logo,name,locale,token,onSaved}:{logo?:string;name:string;locale:SupportedLocale;token:string|null;onSaved:(store:any)=>void}) {
 const [busy,setBusy]=useState(false),[error,setError]=useState(false),[notice,setNotice]=useState('');const active=useRef(true);const text=TEXT[locale];
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 async function save(file?:File) {
  setBusy(true);setError(false);setNotice('');
  try {
   let logoUrl='';
   if(file) {const imageData=await optimizedPhoto(file);const response=await fetch('/api/seller/product-images',{method:'POST',headers:{'Content-Type':'application/json',...sellerAuthHeaders(token)},body:JSON.stringify({imageData})});if(!response.ok)throw new Error('upload');logoUrl=(await response.json()).imageUrl;}
   const response=await fetch('/api/seller/store-logo',{method:'PATCH',headers:{'Content-Type':'application/json',...sellerAuthHeaders(token)},body:JSON.stringify({logoUrl})});if(!response.ok)throw new Error('save');const data=await response.json();onSaved(data.store);if(active.current)setNotice(file?text[6]:text[7]);
  } catch {if(active.current)setError(true);} finally {if(active.current)setBusy(false);}
 }
 return <section className="lg:col-span-12 bg-[var(--surface-card)] border border-slate-600 rounded-2xl p-6 space-y-3" aria-label={text[0]}>
  <h2 className="text-lg font-bold">{text[0]}</h2><div className="flex items-center gap-4 flex-wrap">
   {logo?<img src={logo} alt={`${name} logo`} data-testid="shop-logo-preview" className="w-24 h-24 rounded-xl object-contain bg-white p-2"/>:<div className="w-24 h-24 rounded-xl bg-[var(--surface-raised)] border border-slate-500 grid place-items-center text-3xl font-semibold" aria-hidden="true">{name.slice(0,1).toUpperCase()}</div>}
   <label className="cursor-pointer bg-teal-400 text-slate-950 font-semibold text-sm rounded-xl px-4 py-2 focus-within:outline-2 focus-within:outline-teal-200">{busy?text[3]:text[1]}<input type="file" accept="image/jpeg,image/png,image/webp" aria-label={text[1]} data-testid="shop-logo-upload" className="sr-only" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void save(file);}}/></label>
   {logo&&<button type="button" disabled={busy} onClick={()=>void save()} className="rounded-xl border border-slate-500 px-4 py-2 text-sm">{text[2]}</button>}
  </div><p className="text-xs text-slate-300">{text[4]}</p>{error&&<p role="alert" className="text-sm text-rose-200">{text[5]}</p>}{notice&&<p role="status" className="text-sm text-teal-200">{notice}</p>}
 </section>;
}
