import { buildNimiqPaymentDetails, ERC20_TRANSFER_TOPIC, NETWORK_CONFIGS, type OrderSnapshot, type OnChainTxEvidence } from '../lib/domain.js';

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

export { paymentIntentMessage } from '../lib/domain.js';

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
  const base = { txHash: hash, network: o.network, recipient: o.snapshotRecipient, amountBase: 0n };
  if (o.environment !== 'testnet' || !['nimiq-testnet', 'polygon-amoy'].includes(o.network)) return { ...base, executionStatus: 'unverified', invalidReason: 'Mainnet disabled in this testnet beta.' };
  try {
    if (o.network === 'nimiq-testnet') {
      const t = await call(urls[o.network], 'getTransactionByHash', [hash]);
      if (!t) return { ...base, executionStatus: 'pending' };
      if (typeof t.hash !== 'string' || t.hash.toLowerCase().replace(/^0x/, '') !== hash.toLowerCase().replace(/^0x/, '')) throw new Error('RPC hash mismatch');
      if (t.networkId !== NETWORK_CONFIGS[o.network].nimiqNetworkIdNumber) throw new Error('Nimiq network ID mismatch');
      const recipient = t.recipient ?? t.toAddress ?? t.to;
      if (normalizeAddress(recipient) !== normalizeAddress(o.snapshotRecipient)) throw new Error('Recipient mismatch');
      const expectedMemo = buildNimiqPaymentDetails({ recipient: o.snapshotRecipient, amountLuna: o.amountBase, orderNumber: o.orderNumber, publicToken: o.publicToken, network: o.network }).memo;
      if (memoText(t.data ?? t.recipientData) !== expectedMemo) throw new Error('Invoice memo mismatch');
      if (!Number.isSafeInteger(t.blockNumber) || t.blockNumber < 1 || !Number.isSafeInteger(t.confirmations) || t.confirmations < 1) return { ...base, executionStatus: 'pending' };
      checkTime(o, t.timestamp ?? t.blockTimestamp);
      if (typeof t.executionResult !== 'boolean') throw new Error('Execution result is not verified');
      if (!t.executionResult) return { ...base, executionStatus: 'failed' };
      if (!(typeof t.value === 'string' && /^\d+$/.test(t.value)) && !(Number.isSafeInteger(t.value) && t.value >= 0)) throw new Error('Invalid transaction value');
      return { ...base, recipient, amountBase: BigInt(t.value), memo: expectedMemo, executionStatus: 'confirmed' };
    }
    const chain = await call(urls[o.network], 'eth_chainId', []);
    if (chain !== '0x13882') throw new Error('RPC is not Polygon Amoy');
    if (!o.snapshotTokenContract || !o.payerAddress) throw new Error('Configure test token and sign the invoice payment intent before sending');
    const receipt = await call(urls[o.network], 'eth_getTransactionReceipt', [hash]);
    if (!receipt) return { ...base, executionStatus: 'pending' };
    if (receipt.transactionHash?.toLowerCase() !== hash.toLowerCase() || !/^0x[\da-f]+$/i.test(receipt.blockNumber || '')) throw new Error('Invalid receipt');
    const block = await call(urls[o.network], 'eth_getBlockByNumber', [receipt.blockNumber, false]);
    const head = await call(urls[o.network], 'eth_blockNumber', []);
    if (!block || block.hash?.toLowerCase() !== receipt.blockHash?.toLowerCase()) throw new Error('Receipt block is not canonical');
    if (BigInt(head) - BigInt(receipt.blockNumber) + 1n < 5n) return { ...base, executionStatus: 'pending' };
    checkTime(o, Number(BigInt(block.timestamp)));
    const tx = await call(urls[o.network], 'eth_getTransactionByHash', [hash]);
    if (tx?.from?.toLowerCase() !== o.payerAddress.toLowerCase()) throw new Error('Payer does not match signed invoice intent');
    if (receipt.status !== '0x1') return { ...base, executionStatus: 'failed' };
    const matching = (receipt.logs || []).filter((l: any) => l.address?.toLowerCase() === o.snapshotTokenContract?.toLowerCase() && l.topics?.length === 3 && l.topics[0]?.toLowerCase() === ERC20_TRANSFER_TOPIC && normalizeAddress('0x' + l.topics[2]?.slice(-40)) === normalizeAddress(o.snapshotRecipient) && normalizeAddress('0x' + l.topics[1]?.slice(-40)) === normalizeAddress(o.payerAddress));
    if (matching.length !== 1 || matching[0].removed || !/^0x[\da-f]{64}$/i.test(matching[0].data || '')) throw new Error('Invoice transfer event is missing or ambiguous');
    return { ...base, executionStatus: 'confirmed', amountBase: BigInt(matching[0].data), tokenContract: matching[0].address };
  } catch (error) {
    if (error instanceof RpcUnavailable || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))) return { ...base, executionStatus: 'rpc_timeout' };
    return { ...base, executionStatus: 'unverified', invalidReason: error instanceof Error ? error.message : 'Unable to validate network evidence' };
  }
}
