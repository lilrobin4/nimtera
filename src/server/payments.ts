import { buildNimiqPaymentDetails, isActiveNimOrder, NETWORK_CONFIGS, type OrderSnapshot, type OnChainTxEvidence } from '../lib/domain.js';

export type RpcCall = (url: string, method: string, params: unknown[]) => Promise<any>;
class RpcUnavailable extends Error {}
export const rpcCall: RpcCall = async (url, method, params) => {
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new RpcUnavailable('RPC HTTP error');
    const body = await response.json();
    if (body?.error && method === 'getTransactionByHash' && /transaction.*not found/i.test(String(body.error.message))) return null;
    if (!body || body.error || !Object.hasOwn(body, 'result')) throw new RpcUnavailable('Invalid or unavailable RPC response');
    return body.result?.data !== undefined ? body.result.data : body.result;
  } catch (error) {
    if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) throw error;
    throw new RpcUnavailable('RPC unavailable; retry later');
  }
};



function normalizeAddress(v: unknown): string { return typeof v === 'string' ? v.replace(/\s/g, '').toLowerCase() : ''; }
function timeMs(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error('Missing block timestamp');
  return n < 1e12 ? n * 1000 : n;
}
function checkTime(o: OrderSnapshot, timestamp: unknown) {
  const ms = timeMs(timestamp);
  if (ms < Date.parse(o.createdAt) - 2000 || ms > Date.now() + 120000) throw new Error('Transfer is not within this invoice timeframe');
}
function memoText(v: unknown): string {
  if (typeof v === 'string') {
    const raw = v.replace(/^0x/, '');
    if (raw.length > 0 && raw.length % 2 === 0 && /^[a-f\d]+$/i.test(raw)) return Buffer.from(raw, 'hex').toString('utf8');
    return v;
  }
  if (v && typeof v === 'object' && 'raw' in v) return memoText((v as any).raw);
  throw new Error('Missing invoice memo');
}

/** All evidence originates from a fixed server RPC, never from the customer request. */
export async function readPaymentEvidence(o: OrderSnapshot, hash: string, urls: Record<string, string>, call: RpcCall = rpcCall): Promise<OnChainTxEvidence> {
  return readEvidence(o,hash,urls,call,false);
}
/** Only the authenticated seller review route may use this. No public auto-confirmation without a memo. */
export async function readAddressPaymentEvidence(o: OrderSnapshot, hash: string, urls: Record<string, string>, call: RpcCall = rpcCall): Promise<OnChainTxEvidence> {
  return readEvidence(o,hash,urls,call,true);
}
async function readEvidence(o: OrderSnapshot, hash: string, urls: Record<string,string>, call: RpcCall, sellerAddressReview:boolean):Promise<OnChainTxEvidence> {
  const base = { txHash: hash, network: o.network, recipient: o.snapshotRecipient, amountBase: 0n };
  if (!isActiveNimOrder(o)) return { ...base, executionStatus: 'unverified', invalidReason: 'Mainnet disabled in this testnet beta.' };
  try {
    if (o.network === 'nimiq-testnet') {
      const t = await call(urls[o.network], 'getTransactionByHash', [hash]);
      if (!t) return { ...base, executionStatus: 'pending' };
      if (typeof t.hash !== 'string' || t.hash.toLowerCase().replace(/^0x/, '') !== hash.toLowerCase().replace(/^0x/, '')) throw new Error('RPC hash mismatch');
      if (t.networkId !== NETWORK_CONFIGS[o.network].nimiqNetworkIdNumber) throw new Error('Nimiq network ID mismatch');
      const recipient = t.recipient ?? t.toAddress ?? t.to;
      if (normalizeAddress(recipient) !== normalizeAddress(o.snapshotRecipient)) throw new Error('Recipient mismatch');
      const expectedMemo = buildNimiqPaymentDetails({ recipient: o.snapshotRecipient, amountLuna: o.amountBase, orderNumber: o.orderNumber, publicToken: o.publicToken, network: o.network }).memo;
      const rawMemo=t.data ?? t.recipientData;
      const actualMemo=rawMemo==null?'':memoText(rawMemo);
      if (actualMemo !== expectedMemo && !(sellerAddressReview && actualMemo==='')) throw new Error('Invoice memo mismatch');
      if (!Number.isSafeInteger(t.blockNumber) || t.blockNumber < 1 || !Number.isSafeInteger(t.confirmations) || t.confirmations < 1) return { ...base, executionStatus: 'pending' };
      checkTime(o, t.timestamp ?? t.blockTimestamp);
      if(sellerAddressReview && timeMs(t.timestamp ?? t.blockTimestamp)>Date.parse(o.expiresAt))throw new Error('Transfer was received after invoice expiry');
      if (typeof t.executionResult !== 'boolean') throw new Error('Execution result is not verified');
      if (!t.executionResult) return { ...base, executionStatus: 'failed' };
      if (!(typeof t.value === 'string' && /^\d+$/.test(t.value)) && !(Number.isSafeInteger(t.value) && t.value >= 0)) throw new Error('Invalid transaction value');
      return { ...base, recipient, amountBase: BigInt(t.value), memo: actualMemo, executionStatus: 'confirmed' };
    }
    throw new Error('Unsupported payment network.');
  } catch (error) {
    if (error instanceof RpcUnavailable || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))) return { ...base, executionStatus: 'rpc_timeout' };
    return { ...base, executionStatus: 'unverified', invalidReason: error instanceof Error ? error.message : 'Unable to validate network evidence' };
  }
}
