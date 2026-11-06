import type { SupportedLocale } from './i18n';
const WORDS:Record<SupportedLocale,{ready:string;confirmed:string;decimal:string}>={
 en:{ready:'Payment request ready',confirmed:'Payment received',decimal:'point'},
 id:{ready:'Tagihan siap',confirmed:'Pembayaran diterima',decimal:'koma'},
 'zh-CN':{ready:'付款请求已生成',confirmed:'已收到付款',decimal:'点'},
 vi:{ready:'Yêu cầu thanh toán đã sẵn sàng',confirmed:'Đã nhận thanh toán',decimal:'phẩy'},
 ms:{ready:'Bil sedia',confirmed:'Bayaran diterima',decimal:'perpuluhan'},
 ru:{ready:'Счёт готов к оплате',confirmed:'Оплата получена',decimal:'запятая'},
};
const DIGITS=['nol','satu','dua','tiga','empat','lima','enam','tujuh','delapan','sembilan'];
function small(n:number):string {
 if(n<10)return DIGITS[n];if(n===10)return 'sepuluh';if(n===11)return 'sebelas';if(n<20)return small(n-10)+' belas';
 if(n<100)return small(Math.floor(n/10))+' puluh'+(n%10?' '+small(n%10):'');
 return (n<200?'seratus':small(Math.floor(n/100))+' ratus')+(n%100?' '+small(n%100):'');
}
export function indonesianInteger(value:string):string {
 const digits=value.replace(/^0+(?=\d)/,'');if(digits==='0')return 'nol';
 const scales=['','ribu','juta','miliar','triliun','kuadriliun','kuintiliun'];
 if(digits.length>21)return digits.split('').map(d=>DIGITS[Number(d)]).join(' ');
 const groups=digits.match(/\d{1,3}(?=(\d{3})*$)/g)!;
 return groups.map((group,index)=>{const n=Number(group),level=groups.length-index-1;if(!n)return '';if(n===1&&level===1)return 'seribu';return small(n)+(scales[level]?' '+scales[level]:'');}).filter(Boolean).join(' ');
}
// Speak only status + exact nominal + asset. Test/preview labels remain visible on screen.
// Source values are immutable server snapshots; no floating-point price conversion.
export function paymentSpeech(kind:'ready'|'confirmed',amount:string,locale:SupportedLocale,_preview=false):string {
 const words=WORDS[locale],match=amount.match(/\d+(?:\.\d+)?/);let spoken='';
 if(match){const [whole,fraction='']=match[0].split('.'),decimals=fraction.replace(/0+$/,'');
 spoken=locale==='id'?indonesianInteger(whole):whole;
 if(decimals)spoken+=` ${words.decimal} `+decimals.split('').map(d=>locale==='id'?DIGITS[Number(d)]:d).join(' ');
 const currency=/\bNIM\b/i.test(amount)?(locale==='id'?'nim':'NIM'):'';spoken+=' '+currency;}
 return words[kind]+(spoken.trim()?', '+spoken.trim():'')+'.';
}
