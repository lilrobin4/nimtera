import type { SupportedLocale } from './i18n';
const WORDS:Record<SupportedLocale,{test:string;demo:string;ready:string;confirmed:string;token:string;decimal:string;usdt:string}>={
 en:{test:'Test mode.',demo:'Audio preview.',ready:'Payment request ready.',confirmed:'Payment received.',token:'test tokens',decimal:'point',usdt:'U S D T'},
 id:{test:'Mode uji.',demo:'Contoh suara.',ready:'Tagihan siap dibayar.',confirmed:'Pembayaran diterima.',token:'token uji',decimal:'koma',usdt:'U S D T'},
 'zh-CN':{test:'测试模式。',demo:'语音试听。',ready:'付款请求已生成。',confirmed:'已收到付款。',token:'测试代币',decimal:'点',usdt:'U S D T'},
 vi:{test:'Chế độ thử nghiệm.',demo:'Nghe thử.',ready:'Yêu cầu thanh toán đã sẵn sàng.',confirmed:'Đã nhận thanh toán.',token:'token thử nghiệm',decimal:'phẩy',usdt:'U S D T'},
 ms:{test:'Mod ujian.',demo:'Pratonton suara.',ready:'Bil sedia untuk dibayar.',confirmed:'Bayaran diterima.',token:'token ujian',decimal:'perpuluhan',usdt:'U S D T'},
 ru:{test:'Тестовый режим.',demo:'Проверка звука.',ready:'Счёт готов к оплате.',confirmed:'Оплата получена.',token:'тестовых токенов',decimal:'запятая',usdt:'U S D T'},
};
// Values come from immutable server order snapshots, never a floating-point price calculation.
export function paymentSpeech(kind:'ready'|'confirmed',amount:string,locale:SupportedLocale,preview=false):string {
 const words=WORDS[locale];const match=amount.match(/\d+(?:\.\d+)?/);let spoken='';
 if(match) {const [whole,fraction='']=match[0].split('.');const decimals=fraction.replace(/0+$/,'');spoken=whole+(decimals?` ${words.decimal} ${decimals.split('').join(' ')}`:'');
 const currency=/TEST TOKEN/i.test(amount)?words.token:/USDT/i.test(amount)?words.usdt:/\bNIM\b/i.test(amount)?'Nimiq':'';spoken+=' '+currency;}
 return [preview?words.demo:'',/TESTNET|TEST TOKEN/i.test(amount)?words.test:'',words[kind],spoken.trim()?spoken.trim()+'.':''].filter(Boolean).join(' ');
}
