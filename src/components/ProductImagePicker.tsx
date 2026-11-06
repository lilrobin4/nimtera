import { optimizedPhoto } from '../lib/imageUpload';
import { useEffect, useRef, useState } from 'react';
import { PRODUCT_IMAGE_PRESETS } from '../lib/productImages';
import type { SupportedLocale } from '../lib/i18n';
import { sellerAuthHeaders } from '../lib/sellerSession';

const COPY:Record<SupportedLocale,{title:string;upload:string;busy:string;hint:string;examples:string;selected:string;error:string}>={
 en:{title:'Product photo',upload:'Upload your photo',busy:'Preparing and uploading…',hint:'JPG, PNG or WebP, up to 5 MB / 16 MP. Up to 100 uploads per shop. Photos are optimized and appear in your public catalog after saving the product.',examples:'Example photos — choose one or upload your own',selected:'Selected photo',error:'Could not upload this photo. Use JPG, PNG or WebP up to 5 MB, then try again.'},
 id:{title:'Foto produk',upload:'Upload foto sendiri',busy:'Menyiapkan dan mengunggah…',hint:'JPG, PNG, atau WebP, maksimal 5 MB / 16 MP. Hingga 100 foto upload per toko. Foto dioptimalkan dan tampil di katalog publik setelah produk disimpan.',examples:'Foto contoh — pilih satu atau upload foto sendiri',selected:'Foto terpilih',error:'Foto belum berhasil diunggah. Gunakan JPG, PNG, atau WebP maksimal 5 MB, lalu coba lagi.'},
 'zh-CN':{title:'商品照片',upload:'上传自己的照片',busy:'正在处理并上传…',hint:'JPG、PNG 或 WebP，最大 5 MB / 1600 万像素。每店最多上传 100 张。照片将优化，并在保存商品后显示于公开目录。',examples:'示例照片：选择一张或上传自己的照片',selected:'已选照片',error:'上传失败。请使用不超过 5 MB 的 JPG、PNG 或 WebP 照片后重试。'},
 vi:{title:'Ảnh sản phẩm',upload:'Tải ảnh của bạn',busy:'Đang xử lý và tải lên…',hint:'JPG, PNG hoặc WebP, tối đa 5 MB / 16 MP. Tối đa 100 ảnh tải lên mỗi cửa hàng. Ảnh được tối ưu và hiển thị công khai sau khi lưu sản phẩm.',examples:'Ảnh mẫu — chọn một ảnh hoặc tải ảnh của bạn',selected:'Ảnh đã chọn',error:'Không thể tải ảnh. Dùng JPG, PNG hoặc WebP tối đa 5 MB rồi thử lại.'},
 ms:{title:'Foto produk',upload:'Muat naik foto sendiri',busy:'Menyediakan dan memuat naik…',hint:'JPG, PNG atau WebP, sehingga 5 MB / 16 MP. Sehingga 100 foto muat naik setiap kedai. Foto dioptimumkan dan dipaparkan dalam katalog awam selepas produk disimpan.',examples:'Foto contoh — pilih satu atau muat naik sendiri',selected:'Foto dipilih',error:'Foto gagal dimuat naik. Gunakan JPG, PNG atau WebP sehingga 5 MB dan cuba lagi.'},
 ru:{title:'Фото товара',upload:'Загрузить своё фото',busy:'Обработка и загрузка…',hint:'JPG, PNG или WebP, до 5 МБ / 16 Мп. До 100 загрузок на магазин. Фото оптимизируется и появится в публичном каталоге после сохранения товара.',examples:'Примеры: выберите фото или загрузите своё',selected:'Выбранное фото',error:'Не удалось загрузить фото. Используйте JPG, PNG или WebP до 5 МБ и повторите попытку.'},
};

export function ProductImagePicker({value,onChange,locale,token,onBusyChange}:{value:string;onChange:(url:string)=>void;locale:SupportedLocale;token:string|null;onBusyChange:(busy:boolean)=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');const alive=useRef(true),controller=useRef<AbortController|null>(null);const copy=COPY[locale];
  useEffect(()=>{alive.current=true;return ()=>{alive.current=false;controller.current?.abort();onBusyChange(false);};},[]);
  const selected=PRODUCT_IMAGE_PRESETS.find(photo=>photo.url===value);
  return <section className="space-y-3" aria-label={copy.title}>
    <div className="flex items-start gap-3"><img data-testid="selected-product-photo" src={value} alt={copy.selected} className="w-20 h-20 rounded-xl object-cover border border-slate-500 shrink-0" /><div className="space-y-1 min-w-0"><p className="text-sm font-semibold text-slate-100">{copy.title}</p><p className="text-xs text-slate-300">{selected?.label || copy.selected}</p><label className={`inline-flex rounded-lg bg-teal-400 px-3 py-2 font-semibold text-xs text-slate-950 ${busy?'opacity-70':'cursor-pointer'}`}>
      {busy?copy.busy:copy.upload}<input type="file" accept="image/jpeg,image/png,image/webp" aria-label={copy.upload} data-testid="product-photo-upload" className="sr-only" disabled={busy} onChange={async event=>{
        const file=event.target.files?.[0];event.target.value='';if(!file)return;setError('');setBusy(true);onBusyChange(true);controller.current=new AbortController();
        try {const imageData=await optimizedPhoto(file);if(!alive.current)return;const response=await fetch('/api/seller/product-images',{method:'POST',headers:{'Content-Type':'application/json',...sellerAuthHeaders(token)},credentials:'same-origin',body:JSON.stringify({imageData}),signal:controller.current.signal});const data=await response.json();if(!response.ok)throw new Error('Upload failed');if(alive.current)onChange(data.imageUrl);}
        catch {if(alive.current)setError(copy.error);}finally{if(alive.current){setBusy(false);onBusyChange(false);}}
      }}/></label></div></div>
    <p className="text-xs text-slate-300">{copy.hint}</p>{error&&<p role="alert" className="text-sm text-rose-200">{error}</p>}
    <p className="text-xs font-semibold text-slate-200">{copy.examples}</p>
    <div className="grid grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1" data-testid="product-photo-presets">{PRODUCT_IMAGE_PRESETS.map(photo=><button key={photo.url} type="button" aria-pressed={photo.url===value} disabled={busy} onClick={()=>onChange(photo.url)} className={`min-w-0 rounded-xl border p-1.5 text-left ${photo.url===value?'bg-teal-400/15 border-teal-300 text-[var(--ink)]':'bg-[var(--surface-raised)] border-slate-500 text-slate-200'}`}><img src={photo.url} alt="" loading="lazy" className="aspect-[4/3] w-full rounded-lg object-cover"/><span className="block text-xs mt-1 truncate">{photo.label}</span></button>)}</div>
  </section>;
}
