import { init, getHostNetwork } from '@nimiq/mini-app-sdk';
import type { NimiqProvider } from '@nimiq/mini-app-sdk';
export interface WalletConnection { provider: NimiqProvider; addresses: string[]; network: 'mainnet' | 'testnet' }
let pending=false;
export async function connectWalletIdentity():Promise<WalletConnection> {
  if(pending)throw new Error('A wallet request is already open.');pending=true;
  try {
    if(typeof window==='undefined'||(!(window as any).nimiq && !(window as any).nimiqPay))throw new Error('Open NimTera inside Nimiq Pay, or use email sign-in in this browser.');
    const provider=await init({timeout:5000}),network=getHostNetwork();
    if(network!=='mainnet'&&network!=='testnet')throw new Error('Update Nimiq Pay: the wallet network cannot be identified safely. Email sign-in remains available.');
    const addresses=await provider.listAccounts();
    if(!Array.isArray(addresses)||!addresses.length||addresses.some(a=>typeof a!=='string'))throw new Error('No Nimiq account was approved.');
    return {provider,addresses,network};
  }finally{pending=false;}
}
export async function walletJson(url:string,body:unknown) {
  const response=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Wallet sign-in could not be completed.');return data;
}
export async function proveWalletIdentity(connection:WalletConnection,address:string,purpose:'login'|'register'|'link'|'password',extra:Record<string,string>={}) {
  if(pending)throw new Error('A wallet request is already open.');pending=true;
  try {
    if(getHostNetwork()!==connection.network)throw new Error('Wallet network changed. Reconnect and try again.');
    const challenge=await walletJson('/api/auth/wallet/challenge',{purpose,address,network:connection.network});
    const signed=await connection.provider.sign({message:challenge.message,isHex:false});
    if(!signed || !('publicKey' in signed) || !('signature' in signed))throw new Error('No signed wallet proof was returned. Nothing was sent.');
    if(getHostNetwork()!==connection.network)throw new Error('Wallet network changed. Reconnect and try again.');
    return await walletJson('/api/auth/wallet/verify',{challengeId:challenge.challengeId,publicKey:signed.publicKey,signature:signed.signature,...extra});
  }finally{pending=false;}
}
