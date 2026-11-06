import {
  buildNimiqPaymentDetails,
  buildPolygonUsdtTransferDetails,
  POLYGON_AMOY_CHAIN_ID,
  POLYGON_MAINNET_CHAIN_ID,
  POLYGON_USDT_CONTRACT,
  validateAmoyTestTokenContract,
} from './domain';

interface NimiqMiniAppProvider {
  listAccounts?: () => Promise<string[]>;
  isConsensusEstablished?: () => Promise<boolean>;
  getBlockNumber?: () => Promise<number>;
  getNetwork?: () => Promise<string>;
  network?: string;
  sendBasicTransaction?: (tx: {
    recipient: string;
    value: number;
    fee?: number;
  }) => Promise<string | { hash?: string; transactionHash?: string }>;
  sendBasicTransactionWithData?: (tx: {
    recipient: string;
    value: number;
    fee?: number;
    data: Uint8Array | string;
  }) => Promise<string | { hash?: string; transactionHash?: string }>;
}

interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

declare global {
  interface Window {
    nimiq?: NimiqMiniAppProvider;
    ethereum?: Eip1193Provider;
  }
}

export interface HostCapabilities {
  hasNimiqProvider: boolean;
  hasEvmProvider: boolean;
  isInsideNimiqPayWebView: boolean;
  detectedNimiqNetwork: string | null;
  hostLimitationSummary: string;
}

export function detectNimiqPayCapabilities(): HostCapabilities {
  if (typeof window === 'undefined') {
    return {
      hasNimiqProvider: false,
      hasEvmProvider: false,
      isInsideNimiqPayWebView: false,
      detectedNimiqNetwork: null,
      hostLimitationSummary:
        'Server-side / non-browser environment. Native Nimiq Pay WebView is not active.',
    };
  }
  const hasNimiqProvider = Boolean(window.nimiq);
  const hasEvmProvider = Boolean(window.ethereum);
  const detectedNimiqNetwork =
    typeof window.nimiq?.network === 'string' ? window.nimiq.network : null;

  return {
    hasNimiqProvider,
    hasEvmProvider,
    isInsideNimiqPayWebView: hasNimiqProvider,
    detectedNimiqNetwork,
    hostLimitationSummary: hasNimiqProvider
      ? 'Nimiq Pay provider detected. Note: Consumer Nimiq Pay builds default to Nimiq Mainnet and Polygon Mainnet; if the host does not expose test-albatross or Polygon Amoy (Chain ID 80002), direct wallet prompt is blocked on Testnet orders to prevent accidental Mainnet spend.'
      : 'Browser / external device mode: Nimiq Pay WebView (window.nimiq) is not active in this browser tab. For Testnet orders, pay via Nimiq Testnet Keyguard (wallet.nimiq-testnet.com) or an EVM wallet connected to Polygon Amoy (Chain ID 80002), then verify the transaction hash on-chain.',
  };
}

/**
 * Inspects the active EVM wallet Chain ID without sending any transaction.
 */
export async function inspectConnectedEvmChainId(): Promise<{
  connected: boolean;
  chainId: number | null;
  chainIdHex: string | null;
  error?: string;
}> {
  if (typeof window === 'undefined' || !window.ethereum) {
    return { connected: false, chainId: null, chainIdHex: null };
  }
  try {
    const chainHex = (await window.ethereum.request({ method: 'eth_chainId' })) as string;
    const chainId = parseInt(chainHex, 16);
    return {
      connected: true,
      chainId: Number.isNaN(chainId) ? null : chainId,
      chainIdHex: chainHex,
    };
  } catch (err: unknown) {
    return {
      connected: false,
      chainId: null,
      chainIdHex: null,
      error: err instanceof Error ? err.message : 'Unable to read wallet chain ID.',
    };
  }
}

/**
 * Requests native NIM payment confirmation inside Nimiq Pay Mini App host.
 * Enforces strict network matching:
 * - Blocks payment if order is 'nimiq-testnet' (`test-albatross`) and wallet network is 'main-albatross' or cannot be verified as Testnet.
 * - Blocks payment if order is 'nimiq-mainnet' (`main-albatross`) and wallet network is Testnet.
 * - Never auto-approves or silently switches networks.
 */
export async function requestNativeNimPayment(params: {
  recipient: string;
  amountLuna: string;
  orderNumber: string;
  publicToken: string;
  network?: 'nimiq-testnet' | 'nimiq-mainnet';
}): Promise<{ ok: boolean; txHash?: string; error?: string; blockedByNetworkGuard?: boolean }> {
  const targetNetwork = params.network || 'nimiq-mainnet';
  const isTestnetOrder = targetNetwork === 'nimiq-testnet';

  if (typeof window === 'undefined' || !window.nimiq) {
    return {
      ok: false,
      blockedByNetworkGuard: true,
      error: isTestnetOrder
        ? 'Provider Nimiq Pay (window.nimiq) tidak terdeteksi di browser ini, dan rilis publik Nimiq Pay mobile umumnya terhubung ke Mainnet. Untuk pesanan Nimiq TESTNET (test-albatross), gunakan Nimiq Testnet Wallet (https://wallet.nimiq-testnet.com), kirim NIM Testnet ke alamat penerima di atas, lalu tempel hash transaksi Testnet untuk diverifikasi.'
        : 'Nimiq Pay Mini App provider (window.nimiq) was not detected in this browser. Open this checkout page inside Nimiq Pay or scan the QR code from Nimiq Pay.',
    };
  }

  try {
    const provider = window.nimiq;

    // Strict Network Guard: Verify Nimiq provider network matches order network
    let walletNetwork: string | null =
      typeof provider.network === 'string' ? provider.network.toLowerCase() : null;
    if (!walletNetwork && typeof provider.getNetwork === 'function') {
      try {
        const net = await provider.getNetwork();
        if (typeof net === 'string') walletNetwork = net.toLowerCase();
      } catch {
        walletNetwork = null;
      }
    }

    if (isTestnetOrder) {
      if (!walletNetwork || !walletNetwork.includes('test')) {
        return {
          ok: false,
          blockedByNetworkGuard: true,
          error: `PEMBAYARAN DIBLOKIR (Pengaman Jaringan): Pesanan ini terkunci pada Nimiq TESTNET (test-albatross), tetapi jaringan wallet Nimiq Pay terdeteksi sebagai "${
            walletNetwork || 'tidak dapat diverifikasi / default Mainnet'
          }". Untuk mencegah pengiriman NIM Mainnet asli secara tidak sengaja, transaksi diblokir. Gunakan wallet Nimiq Testnet (wallet.nimiq-testnet.com) atau pastikan host berada di jaringan test-albatross.`,
        };
      }
    } else {
      if (walletNetwork && walletNetwork.includes('test')) {
        return {
          ok: false,
          blockedByNetworkGuard: true,
          error:
            'PEMBAYARAN DIBLOKIR (Pengaman Jaringan): Pesanan ini terkunci pada Nimiq MAINNET (main-albatross), tetapi wallet Anda sedang berada di Nimiq Testnet. Silakan pindahkan wallet ke Nimiq Mainnet terlebih dahulu.',
        };
      }
    }

    if (provider.isConsensusEstablished) {
      const consensus = await provider.isConsensusEstablished();
      if (!consensus) {
        return {
          ok: false,
          error: `Nimiq Pay is still establishing ${targetNetwork} consensus. Please wait a moment and try again.`,
        };
      }
    }

    const details = buildNimiqPaymentDetails({
      ...params,
      network: targetNetwork,
    });
    const valueNumber = Number(BigInt(params.amountLuna));
    if (!Number.isSafeInteger(valueNumber) || valueNumber <= 0) {
      return { ok: false, error: 'Invalid Luna amount for transaction.' };
    }

    let result: string | { hash?: string; transactionHash?: string } | undefined;
    if (provider.sendBasicTransactionWithData) {
      const dataBytes = new TextEncoder().encode(details.memo);
      result = await provider.sendBasicTransactionWithData({
        recipient: params.recipient,
        value: valueNumber,
        fee: 0,
        data: dataBytes,
      });
    } else if (provider.sendBasicTransaction) {
      result = await provider.sendBasicTransaction({
        recipient: params.recipient,
        value: valueNumber,
        fee: 0,
      });
    } else {
      return {
        ok: false,
        error: 'The active Nimiq provider does not expose sendBasicTransaction.',
      };
    }

    const txHash =
      typeof result === 'string'
        ? result
        : result?.hash || result?.transactionHash || '';

    if (!txHash) {
      return { ok: false, error: 'Wallet did not return a transaction hash.' };
    }

    return { ok: true, txHash };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Transaction was rejected or canceled in Nimiq Pay.';
    return { ok: false, error: message };
  }
}

/**
 * Requests Polygon Mainnet (Chain ID 137) USDT or Polygon Amoy Testnet (Chain ID 80002) TEST TOKEN
 * transfer via EIP-1193 provider.
 * - Strictly verifies wallet Chain ID matches order network BEFORE requesting transaction.
 * - If wallet is on a different chain or cannot be verified, BLOCKS payment and shows instructions.
 * - Never uses Mainnet USDT contract on Polygon Amoy.
 * - Never falls back from Testnet to Mainnet.
 */
export async function requestNativePolygonUsdtPayment(params: {
  recipient: string;
  amountMicro: string;
  network?: 'polygon-amoy' | 'polygon-mainnet';
  tokenContract?: string | null;
}): Promise<{ ok: boolean; txHash?: string; error?: string; blockedByNetworkGuard?: boolean }> {
  const targetNetwork = params.network || 'polygon-mainnet';
  const isAmoy = targetNetwork === 'polygon-amoy';
  const expectedChainId = isAmoy ? POLYGON_AMOY_CHAIN_ID : POLYGON_MAINNET_CHAIN_ID;
  const expectedChainHex = isAmoy ? '0x13882' : '0x89';

  // Contract guard for Polygon Amoy vs Polygon Mainnet
  let targetContract = isAmoy
    ? params.tokenContract || null
    : params.tokenContract || POLYGON_USDT_CONTRACT;

  if (isAmoy) {
    const amoyCheck = validateAmoyTestTokenContract(targetContract || '');
    if (!amoyCheck.valid) {
      return {
        ok: false,
        blockedByNetworkGuard: true,
        error: amoyCheck.reason,
      };
    }
    if (!amoyCheck.normalized) {
      return {
        ok: false,
        blockedByNetworkGuard: true,
        error:
          'PEMBAYARAN DIBLOKIR: Kontrak TEST TOKEN untuk Polygon Amoy Testnet (Chain ID 80002) belum dikonfigurasi pada pesanan/toko ini. Jangan pernah menggunakan alamat kontrak USDT Mainnet di Amoy. Konfigurasikan alamat kontrak ERC-20 TEST TOKEN Amoy di Pengaturan Seller atau minta persetujuan sebelum men-deploy kontrak uji.',
      };
    }
    targetContract = amoyCheck.normalized;
  }

  if (typeof window === 'undefined' || !window.ethereum) {
    return {
      ok: false,
      blockedByNetworkGuard: true,
      error: isAmoy
        ? 'EVM wallet provider (window.ethereum) tidak terdeteksi. Catatan Keterbatasan Host: aplikasi Nimiq Pay standar hanya mendukung Polygon Mainnet (Chain ID 137) dan belum menyediakan pengalih ke Polygon Amoy Testnet (Chain ID 80002). Gunakan browser dengan wallet EVM Testnet (mis. MetaMask/Rabby di jaringan Polygon Amoy 80002) untuk mengirim TEST TOKEN.'
        : 'EVM wallet provider (window.ethereum) was not detected. Open this checkout inside Nimiq Pay with Polygon USDT enabled or scan the QR code.',
    };
  }

  try {
    const ethereum = window.ethereum;

    // 1. Verify Chain ID BEFORE requesting transaction
    const currentChainHex = (await ethereum.request({
      method: 'eth_chainId',
    })) as string;
    const currentChainId = parseInt(currentChainHex, 16);

    if (Number.isNaN(currentChainId)) {
      return {
        ok: false,
        blockedByNetworkGuard: true,
        error:
          'PEMBAYARAN DIBLOKIR: Chain ID wallet tidak dapat diverifikasi. Pastikan wallet terhubung ke jaringan yang sesuai dengan pesanan.',
      };
    }

    if (currentChainId !== expectedChainId) {
      return {
        ok: false,
        blockedByNetworkGuard: true,
        error: isAmoy
          ? `PEMBAYARAN DIBLOKIR (Jaringan Wallet Berbeda): Pesanan ini terkunci pada Polygon Amoy Testnet (Chain ID ${POLYGON_AMOY_CHAIN_ID} / ${expectedChainHex}), tetapi wallet Anda sedang berada di Chain ID ${currentChainId}. Pindahkan jaringan wallet Anda secara manual ke Polygon Amoy Testnet (Chain ID 80002, RPC https://rpc-amoy.polygon.technology) sebelum melanjutkan. Sistem tidak akan mengalihkan pesanan ke Mainnet.`
          : `PEMBAYARAN DIBLOKIR (Jaringan Wallet Berbeda): Pesanan ini terkunci pada Polygon Mainnet (Chain ID ${POLYGON_MAINNET_CHAIN_ID} / ${expectedChainHex}), tetapi wallet Anda sedang berada di Chain ID ${currentChainId}. Pindahkan jaringan wallet Anda ke Polygon Mainnet (Chain ID 137) sebelum membayar USDT.`,
      };
    }

    const accounts = (await ethereum.request({
      method: 'eth_requestAccounts',
    })) as string[];

    if (!accounts || accounts.length === 0) {
      return { ok: false, error: 'No EVM account authorized in wallet.' };
    }

    const transferDetails = buildPolygonUsdtTransferDetails({
      recipient: params.recipient,
      amountMicro: params.amountMicro,
      network: targetNetwork,
      tokenContractOverride: targetContract,
    });

    const txHash = (await ethereum.request({
      method: 'eth_sendTransaction',
      params: [
        {
          from: accounts[0],
          to: targetContract,
          value: '0x0',
          data: transferDetails.data,
        },
      ],
    })) as string;

    if (!txHash || typeof txHash !== 'string') {
      return { ok: false, error: 'Wallet did not return a valid transaction hash.' };
    }

    return { ok: true, txHash };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Polygon transaction was canceled or rejected.';
    return { ok: false, error: message };
  }
}
