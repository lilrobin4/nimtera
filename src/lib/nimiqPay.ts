import { init, getHostNetwork } from '@nimiq/mini-app-sdk';
import { buildNimiqPaymentDetails, buildPolygonUsdtTransferDetails, validateAmoyTestTokenContract } from './domain';

interface Eip1193Provider { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }
declare global { interface Window { ethereum?: Eip1193Provider } }
export interface HostCapabilities {
  hasNimiqProvider: boolean; hasEvmProvider: boolean; isInsideNimiqPayWebView: boolean;
  detectedNimiqNetwork: string | null; hostLimitationSummary: string;
}
export function detectNimiqPayCapabilities(): HostCapabilities {
  const hasNimiqProvider = typeof window !== 'undefined' && Boolean((window as any).nimiq);
  const network = typeof window === 'undefined' ? null : getHostNetwork() || null;
  return { hasNimiqProvider, hasEvmProvider: typeof window !== 'undefined' && Boolean(window.ethereum), isInsideNimiqPayWebView: hasNimiqProvider, detectedNimiqNetwork: network,
    hostLimitationSummary: 'Testnet beta only. Native testnet capability must be exposed and verified by the wallet. If unavailable, use the matching testnet wallet and verify the real transaction hash. No mainnet fallback.' };
}
export async function inspectConnectedEvmChainId(): Promise<{ connected: boolean; chainId: number | null; chainIdHex: string | null; error?: string }> {
  if (typeof window === 'undefined' || !window.ethereum) return { connected: false, chainId: null, chainIdHex: null };
  try {
    const hex = await window.ethereum.request({ method: 'eth_chainId' });
    if (typeof hex !== 'string' || !/^0x[\da-f]+$/i.test(hex)) throw new Error('Unknown wallet chain');
    return { connected: true, chainId: Number(BigInt(hex)), chainIdHex: hex };
  } catch (e) { return { connected: true, chainId: null, chainIdHex: null, error: e instanceof Error ? e.message : 'Unknown wallet chain' }; }
}
type PaymentResult = { ok: boolean; txHash?: string; error?: string; blockedByNetworkGuard?: boolean };
let sending = false;
async function performGuardedPayment(key: string, send: () => Promise<unknown>): Promise<PaymentResult> {
  if (sending) return { ok: false, error: 'A wallet request is already running.' };
  sending = true;
  let submitted = false;
  try {
    const previous = localStorage.getItem(key);
    if (previous) {
      const attempt = JSON.parse(previous);
      if (attempt.hash) return { ok: true, txHash: attempt.hash }; // Read-only verification, never replay.
      return { ok: false, error: 'An earlier wallet request has an unknown outcome. Check wallet history and verify its hash; do not send again blindly.' };
    }
    localStorage.setItem(key, JSON.stringify({ awaiting: true, time: Date.now() }));
    submitted = true;
    const raw: any = await send();
    const result = raw?.data ?? raw;
    const hash = typeof result === 'string' ? result : result?.hash || result?.transactionHash;
    if (typeof hash !== 'string' || !/^(0x)?[\da-f]{64}$/i.test(hash)) throw new Error('Wallet returned no verified hash. Check its history before another request.');
    localStorage.setItem(key, JSON.stringify({ hash, time: Date.now() }));
    return { ok: true, txHash: hash };
  } catch (e: any) {
    if (submitted && (e?.code === 4001 || e?.type === 'PERMISSION_DENIED')) localStorage.removeItem(key);
    return { ok: false, error: e instanceof Error ? e.message : 'Wallet outcome is unknown. Check wallet history.' };
  } finally { sending = false; }
}
async function guardedPayment(key: string, send: () => Promise<unknown>): Promise<PaymentResult> {
  if (typeof navigator === 'undefined' || !navigator.locks) return { ok: false, error: 'This browser cannot safely lock concurrent wallet requests. Use a supported browser or pay from a matching testnet wallet and verify the hash.' };
  return navigator.locks.request(key, { ifAvailable: true }, lock => lock ? performGuardedPayment(key, send) : Promise.resolve({ ok: false, error: 'This invoice already has a wallet request open in another tab.' }));
}
export async function requestNativeNimPayment(params: { recipient: string; amountLuna: string; orderNumber: string; publicToken: string; network?: 'nimiq-testnet' | 'nimiq-mainnet' }): Promise<PaymentResult> {
  if (params.network !== 'nimiq-testnet') return { ok: false, blockedByNetworkGuard: true, error: 'Mainnet payments are disabled during the testnet beta.' };
  const network = getHostNetwork();
  if (!['testnet', 'test-albatross'].includes(String(network))) return { ok: false, blockedByNetworkGuard: true, error: 'A verified Nimiq TESTNET host is required. Unknown/mainnet hosts are blocked; use the matching testnet wallet instead.' };
  try {
    const provider = await init({ timeout: 5000 });
    const details = buildNimiqPaymentDetails(params);
    const value = Number(BigInt(params.amountLuna));
    if (!Number.isSafeInteger(value) || value <= 0 || new TextEncoder().encode(details.memo).length > 64) throw new Error('Invalid amount or invoice memo.');
    if (typeof provider.sendBasicTransactionWithData !== 'function') throw new Error('Host cannot attach the required invoice memo. Payment blocked.');
    if (!['testnet', 'test-albatross'].includes(String(getHostNetwork()))) throw new Error('Wallet network changed. Payment blocked.');
    const key = `nimtera.payment:${params.network}:${params.publicToken}`;
    return await guardedPayment(key, () => {
      if (!['testnet', 'test-albatross'].includes(String(getHostNetwork()))) throw new Error('Wallet network changed. Payment blocked.');
      return provider.sendBasicTransactionWithData({ recipient: params.recipient, value, data: details.memo });
    });
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Unable to prepare native testnet request' }; }
}
export async function requestNativePolygonUsdtPayment(params: { recipient: string; amountMicro: string; network?: 'polygon-amoy' | 'polygon-mainnet'; tokenContract?: string | null; intentMessage: string; authorizeIntent: (sender: string, signature: string) => Promise<void> }): Promise<PaymentResult> {
  if (params.network !== 'polygon-amoy') return { ok: false, blockedByNetworkGuard: true, error: 'Mainnet payments are disabled during the testnet beta.' };
  const check = validateAmoyTestTokenContract(params.tokenContract || '');
  if (!check.valid || !check.normalized) return { ok: false, error: check.reason || 'Configure an approved Amoy test-token contract first.' };
  if (typeof window === 'undefined' || !window.ethereum) return { ok: false, error: 'An Amoy-compatible EVM test wallet is required. Native host support must be verified on-device.' };
  const eth = window.ethereum;
  try {
    const guard = async () => { if (await eth.request({ method: 'eth_chainId' }) !== '0x13882') throw new Error('Wrong or unknown network. Polygon Amoy 80002 required.'); };
    await guard();
    const accounts = await eth.request({ method: 'eth_requestAccounts' }) as string[];
    if (!accounts?.[0] || !/^0x[\da-f]{40}$/i.test(accounts[0])) throw new Error('No valid account authorized');
    await guard();
    const bytes = new TextEncoder().encode(params.intentMessage);
    const messageHex = '0x' + Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
    // Account-check signature binds this invoice, not an allowance or spending authorization.
    const signature = await eth.request({ method: 'personal_sign', params: [messageHex, accounts[0]] });
    if (typeof signature !== 'string') throw new Error('No signed invoice intent returned');
    await params.authorizeIntent(accounts[0], signature);
    await guard();
    const details = buildPolygonUsdtTransferDetails({ recipient: params.recipient, amountMicro: params.amountMicro, network: 'polygon-amoy', tokenContractOverride: check.normalized });
    return await guardedPayment(`nimtera.payment:polygon-amoy:${params.intentMessage}`, async () => {
      await guard();
      const current = await eth.request({ method: 'eth_accounts' }) as string[];
      if (current?.[0]?.toLowerCase() !== accounts[0].toLowerCase()) throw new Error('Wallet account changed. Review the invoice again.');
      return eth.request({ method: 'eth_sendTransaction', params: [{ from: accounts[0], to: check.normalized, value: '0x0', data: details.data }] });
    });
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Unable to prepare test-token payment' }; }
}
