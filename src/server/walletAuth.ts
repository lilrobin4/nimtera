import crypto from 'node:crypto';
import { blake2b } from '@noble/hashes/blake2.js';
import { createValidNimiqAddress, validateNimiqAddress } from '../lib/domain.js';
export type WalletPurpose = 'login' | 'register' | 'link' | 'password';
export interface WalletChallenge {
  id: string; message: string; address: string; network: 'mainnet' | 'testnet'; origin: string;
  purpose: WalletPurpose | 'registration-ready'; expiresAt: number; bindingHash: string;
  sellerId?: string; sessionHash?: string; publicKey?: string;
}
export function fingerprint(value: string): string { return crypto.createHash('sha256').update(value).digest('hex'); }
export function normalizedWallet(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 100) return null;
  const checked=validateNimiqAddress(value);return checked.valid ? checked.normalized : null;
}
export function walletAddressOf(publicKey: Uint8Array): string {
  if (publicKey.length!==32) throw new Error('Invalid Nimiq public key');
  const bytes=blake2b(publicKey,{dkLen:32}).subarray(0,20),alphabet='0123456789ABCDEFGHJKLMNPQRSTUVXY';
  let value=0,bits=0,body='';
  for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){body+=alphabet[(value >>> (bits-5))&31];bits-=5;}value&=(1<<bits)-1;}
  return createValidNimiqAddress(body);
}
export function signedMessageDigest(message: string): Buffer {
  const bytes=Buffer.from(message,'utf8');
  return crypto.createHash('sha256').update(Buffer.concat([Buffer.from('\x16Nimiq Signed Message:\n'+bytes.length,'utf8'),bytes])).digest();
}
export function verifyWalletProof(message:string,address:string,publicKey:unknown,signature:unknown):boolean {
  if(typeof publicKey!=='string'||typeof signature!=='string')return false;
  const pub=publicKey.replace(/^0x/i,''),sig=signature.replace(/^0x/i,'');
  if(!/^[a-f\d]{64}$/i.test(pub)||!/^[a-f\d]{128}$/i.test(sig))return false;
  try {
    const bytes=Buffer.from(pub,'hex');if(walletAddressOf(bytes)!==address)return false;
    const key=crypto.createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),bytes]),format:'der',type:'spki'});
    return crypto.verify(null,signedMessageDigest(message),key,Buffer.from(sig,'hex'));
  }catch{return false;}
}
export function newWalletChallenge(params:Omit<WalletChallenge,'id'|'message'|'expiresAt'>):WalletChallenge {
  const id=crypto.randomBytes(32).toString('hex'),expiresAt=Date.now()+5*60*1000;
  const message=[`NimTera wallet authentication`, `Origin: ${params.origin}`, `Action: ${params.purpose}`, `Address: ${params.address}`, `Wallet network: ${params.network}`, `Nonce: ${id}`, `Issued at: ${new Date().toISOString()}`, `Expires at: ${new Date(expiresAt).toISOString()}`, 'Approve only on the NimTera site you opened.', 'This proves wallet ownership. It does not send NIM, authorize spending, or change a payment recipient.'].join('\n');
  return {...params,id,expiresAt,message};
}
