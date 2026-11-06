/** Open the invoice in a Mini App, never turn a checkout URL into a wallet payment request.
 * Matches nimiq/nimiq-pay-app src/lib/mini-app-deeplink.ts. Payment scanners do not handle this URL.
 * A raw nimiq: URI is intentionally NOT offered: host parsers may drop its invoice memo/network hint.
 */
export function checkoutTransport(checkoutUrl:string) {
 const url=new URL(checkoutUrl);
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('Checkout requires HTTPS');
 if(url.username||url.password||url.hash)throw new Error('Invalid checkout URL');
 const openUrl=url.protocol==='https:'?`https://nimpay.app/miniapps/open/${url.host}${url.pathname==='/'?'':url.pathname}${url.search}`:null;
 return {checkoutUrl:url.href,openUrl,qrPayload:openUrl||url.href};
}
