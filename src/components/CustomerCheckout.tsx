import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  ArrowLeft,
  AlertTriangle,
  Copy,
  Check,
  ExternalLink,
  ShieldAlert,
  Globe,
  FlaskConical,
} from 'lucide-react';
import {
  buildNimiqPaymentDetails,
  buildPolygonUsdtTransferDetails,
  formatAssetAmount,
  NETWORK_CONFIGS,
  POLYGON_USDT_CONTRACT,
  type NetworkId,
  type OrderSnapshot,
} from '../lib/domain';
import { LOCALE_METADATA, TRANSLATIONS, type SupportedLocale } from '../lib/i18n';
import {
  detectNimiqPayCapabilities,
  inspectConnectedEvmChainId,
  requestNativeNimPayment,
  requestNativePolygonUsdtPayment,
} from '../lib/nimiqPay';
import { BrandLogo } from './BrandLogo';
import { OrderStatusBadge } from './OrderStatusBadge';

interface CustomerCheckoutProps {
  publicToken: string;
  locale: SupportedLocale;
  onChangeLocale: (locale: SupportedLocale) => void;
  onBackToStore: (storeSlug: string) => void;
}

export const CustomerCheckout: React.FC<CustomerCheckoutProps> = ({
  publicToken,
  locale,
  onChangeLocale,
  onBackToStore,
}) => {
  const t = TRANSLATIONS[locale] || TRANSLATIONS.en;

  const [order, setOrder] = useState<OrderSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qrMode, setQrMode] = useState<'checkout_link' | 'wallet_uri'>('checkout_link');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [qrUriError, setQrUriError] = useState<string | null>(null);
  const [showFullRecipient, setShowFullRecipient] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [txHashInput, setTxHashInput] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [walletNotice, setWalletNotice] = useState<string | null>(null);
  const [showTestHarness, setShowTestHarness] = useState(true);
  const [mainnetExplicitConsent, setMainnetExplicitConsent] = useState(false);
  const [detectedEvmChainId, setDetectedEvmChainId] = useState<number | null>(null);

  const capabilities = detectNimiqPayCapabilities();

  const fetchOrder = async () => {
    try {
      const resp = await fetch(`/api/public/orders/${encodeURIComponent(publicToken)}`);
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || 'Order not found.');
        setLoading(false);
        return;
      }
      setOrder(data.order);
      if (data.order.txHash && !txHashInput) {
        setTxHashInput(data.order.txHash);
      }
      setLoading(false);
    } catch {
      setError('Unable to load checkout details.');
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrder();
    inspectConnectedEvmChainId().then((res) => setDetectedEvmChainId(res.chainId));
    const interval = setInterval(fetchOrder, 3500);
    return () => clearInterval(interval);
  }, [publicToken]);

  // Generate crisp static QR code whenever order or qrMode changes, preserving network identity
  useEffect(() => {
    if (!order) return;
    setQrUriError(null);
    const origin =
      typeof window !== 'undefined' ? window.location.origin : 'https://nimtera.store';
    const isTestnetOrder =
      order.environment === 'testnet' ||
      order.network === 'nimiq-testnet' ||
      order.network === 'polygon-amoy';
    const envParam = isTestnetOrder ? 'testnet' : 'mainnet';
    const checkoutUrl = `${origin}/s/${order.storeSlug}/order/${order.publicToken}?net=${order.network}&env=${envParam}`;

    let payload = checkoutUrl;
    if (qrMode === 'wallet_uri') {
      if (order.asset === 'NIM') {
        const nimDetails = buildNimiqPaymentDetails({
          recipient: order.snapshotRecipient,
          amountLuna: order.amountBase,
          orderNumber: order.orderNumber,
          publicToken: order.publicToken,
          network: order.network === 'nimiq-testnet' ? 'nimiq-testnet' : 'nimiq-mainnet',
        });
        payload = nimDetails.uri;
      } else {
        const polyDetails = buildPolygonUsdtTransferDetails({
          recipient: order.snapshotRecipient,
          amountMicro: order.amountBase,
          network: order.network === 'polygon-amoy' ? 'polygon-amoy' : 'polygon-mainnet',
          tokenContract: order.snapshotTokenContract,
        });
        if (!polyDetails.valid) {
          setQrUriError(
            polyDetails.error ||
              'Kontrak TEST TOKEN Amoy belum dikonfigurasi. Menampilkan QR tautan pesanan dengan identitas jaringan terkunci.'
          );
          payload = checkoutUrl;
        } else {
          payload = polyDetails.eip681Uri;
        }
      }
    }

    QRCode.toDataURL(payload, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0B101C',
        light: '#FFFFFF',
      },
    })
      .then((url) => setQrDataUrl(url))
      .catch(() => setQrDataUrl(''));
  }, [order, qrMode]);

  const handleCopy = (text: string, label: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedField(label);
      setTimeout(() => setCopiedField(null), 1800);
    }
  };

  const handlePayInNimiqPay = async () => {
    if (!order) return;
    setWalletNotice(null);

    const isTestnetOrder =
      order.environment === 'testnet' ||
      order.network === 'nimiq-testnet' ||
      order.network === 'polygon-amoy';

    if (!isTestnetOrder && !mainnetExplicitConsent) {
      setWalletNotice(
        'PERINGATAN MAINNET: Pesanan ini berada di jaringan MAINNET (Dana Asli). Centang persetujuan eksplisit di atas tombol sebelum mengirim transaksi dana asli.'
      );
      return;
    }

    if (order.asset === 'NIM') {
      const res = await requestNativeNimPayment({
        recipient: order.snapshotRecipient,
        amountLuna: order.amountBase,
        orderNumber: order.orderNumber,
        publicToken: order.publicToken,
        network: order.network === 'nimiq-testnet' ? 'nimiq-testnet' : 'nimiq-mainnet',
      });
      if (!res.ok) {
        setWalletNotice(res.error || 'Could not initiate Nimiq Pay transaction.');
        return;
      }
      if (res.txHash) {
        setTxHashInput(res.txHash);
        await submitVerification(res.txHash);
      }
    } else {
      const res = await requestNativePolygonUsdtPayment({
        recipient: order.snapshotRecipient,
        amountMicro: order.amountBase,
        network: order.network === 'polygon-amoy' ? 'polygon-amoy' : 'polygon-mainnet',
        tokenContract: order.snapshotTokenContract,
      });
      if (!res.ok) {
        setWalletNotice(res.error || 'Could not initiate Polygon token transaction.');
        return;
      }
      if (res.txHash) {
        setTxHashInput(res.txHash);
        await submitVerification(res.txHash);
      }
    }
  };

  const submitVerification = async (
    hashOverride?: string,
    sandboxSimulation?: {
      executionStatus: 'pending' | 'confirmed' | 'failed' | 'rpc_timeout';
      amountBase?: string;
      network?: NetworkId;
      chainId?: number;
      tokenContract?: string;
      recipient?: string;
    }
  ) => {
    if (!order) return;
    const hashToUse = (hashOverride ?? txHashInput).trim();
    if (!hashToUse) {
      setWalletNotice('Please enter or generate a transaction hash to verify.');
      return;
    }
    setVerifying(true);
    setWalletNotice(null);
    try {
      const resp = await fetch(
        `/api/public/orders/${encodeURIComponent(order.publicToken)}/verify`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            txHash: hashToUse,
            sandboxSimulation,
          }),
        }
      );
      const data = await resp.json();
      if (!resp.ok) {
        setWalletNotice(data.error || 'Verification request failed.');
      } else {
        setOrder(data.order);
        if (data.reconciliation?.reviewReason) {
          setWalletNotice(data.reconciliation.reviewReason);
        }
      }
    } catch {
      setWalletNotice('Network error while contacting verification server.');
    } finally {
      setVerifying(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B101C] text-[#F3F4F6] flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-[#131C2E] border border-slate-800 rounded-2xl p-8 space-y-4">
          <div className="h-6 w-40 bg-slate-800 rounded" />
          <div className="h-24 w-full bg-slate-800/60 rounded-xl" />
          <div className="h-48 w-full bg-slate-800/40 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen bg-[#0B101C] text-[#F3F4F6] flex flex-col items-center justify-center p-6 text-center space-y-4">
        <AlertTriangle className="w-10 h-10 text-amber-400" />
        <h1 className="text-xl font-semibold">{error || 'Order not found'}</h1>
        <button
          type="button"
          onClick={() => onBackToStore('moonlight-cafe')}
          className="px-5 py-2.5 rounded-xl bg-[#14B8A6] text-[#071318] font-semibold text-sm cursor-pointer"
        >
          Return to Storefront
        </button>
      </div>
    );
  }

  const isTestnetOrder =
    order.environment === 'testnet' ||
    order.network === 'nimiq-testnet' ||
    order.network === 'polygon-amoy';
  const netSpec = NETWORK_CONFIGS[order.network] || NETWORK_CONFIGS['nimiq-testnet'];
  const orderEnvironment: 'testnet' | 'mainnet' = isTestnetOrder ? 'testnet' : 'mainnet';

  const shortenedRecipient =
    order.snapshotRecipient.length > 16
      ? `${order.snapshotRecipient.slice(0, 7)}...${order.snapshotRecipient.slice(-5)}`
      : order.snapshotRecipient;

  const checkoutShareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/s/${order.storeSlug}/order/${order.publicToken}?net=${order.network}&env=${orderEnvironment}`
      : `https://nimtera.store/s/${order.storeSlug}/order/${order.publicToken}?net=${order.network}&env=${orderEnvironment}`;

  return (
    <div className="min-h-screen bg-[#0B101C] text-[#F3F4F6] relative flex flex-col justify-between py-4 px-4 sm:px-8">
      {/* Subtle Night Market atmospheric radial gradient backdrop */}
      <div
        className="fixed inset-0 pointer-events-none opacity-35"
        style={{
          background:
            'radial-gradient(circle at 20% 35%, rgba(217, 192, 150, 0.16), transparent 45%), radial-gradient(circle at 80% 65%, rgba(20, 184, 166, 0.14), transparent 50%)',
        }}
        aria-hidden="true"
      />

      {/* Top Bar */}
      <header className="relative z-10 max-w-5xl w-full mx-auto flex flex-col gap-3 pb-3">
        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => onBackToStore(order.storeSlug)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#131C2E] border border-slate-800 text-xs sm:text-sm font-medium text-slate-300 hover:text-[#F3F4F6] hover:border-slate-700 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{order.storeName}</span>
          </button>

          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-[#DFC496]" aria-hidden="true" />
            <select
              aria-label="Checkout Language"
              value={locale}
              onChange={(e) => onChangeLocale(e.target.value as SupportedLocale)}
              className="bg-[#131C2E] border border-slate-700/80 rounded-xl px-3 py-1.5 text-xs font-medium text-[#F3F4F6] cursor-pointer"
            >
              {(Object.keys(LOCALE_METADATA) as SupportedLocale[]).map((loc) => (
                <option key={loc} value={loc}>
                  {LOCALE_METADATA[loc].label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* PROMINENT TESTNET / MAINNET CHECKOUT & QR BANNER */}
        <div
          data-testid="checkout-testnet-banner"
          className={`rounded-2xl border px-4 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2 ${
            isTestnetOrder
              ? 'bg-amber-100 border-amber-400 text-amber-950'
              : 'bg-emerald-100 border-emerald-500 text-emerald-950'
          }`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-0.5 rounded-full font-extrabold uppercase tracking-wider text-[11px] ${
                isTestnetOrder
                  ? 'bg-amber-900 text-amber-100'
                  : 'bg-emerald-900 text-emerald-100'
              }`}
            >
              {isTestnetOrder ? 'TESTNET CHECKOUT & QR' : 'MAINNET CHECKOUT (DANA ASLI)'}
            </span>
            <span className="font-semibold">
              {isTestnetOrder
                ? `Jaringan Terkunci: ${netSpec.label} · Aset: ${
                    order.assetLabel || netSpec.assetDisplayLabel
                  } (Bukan Dana Asli / Bukan USDT Mainnet). Tidak ada fallback otomatis ke Mainnet.`
                : `Jaringan Terkunci: ${netSpec.label} · Aset: ${netSpec.assetDisplayLabel} (Transaksi Dana Asli — Tidak dapat dibatalkan otomatis).`}
            </span>
          </div>
          <a
            href={netSpec.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[11px] underline font-semibold shrink-0"
          >
            Explorer: {netSpec.explorerName} ↗
          </a>
        </div>
      </header>

      {/* Main Centered Checkout Card matching checkout_16947649.png */}
      <main className="relative z-10 my-auto py-1 flex flex-col items-center">
        <div className="w-full max-w-[440px] bg-[#131C2E] border border-slate-700/80 rounded-3xl p-4 sm:p-5 shadow-2xl space-y-3.5">
          {/* Card Top Header: Store Identity + NimTera Logo */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-full bg-[#1E293B] border border-slate-700 flex items-center justify-center text-xs font-bold text-[#DFC496] shrink-0">
                {order.storeName.slice(0, 1)}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[#F3F4F6] truncate">
                  {order.storeName}
                </div>
                <div className="text-[11px] text-slate-400">
                  merchant · {order.fulfillmentMode.replace('_', '-')} ·{' '}
                  <strong className={isTestnetOrder ? 'text-amber-700' : 'text-emerald-700'}>
                    {isTestnetOrder ? 'TESTNET' : 'MAINNET'}
                  </strong>
                </div>
              </div>
            </div>

            <BrandLogo variant="champagne" size="sm" onClick={() => onBackToStore(order.storeSlug)} />
          </div>

          {/* Slate-Blue Checkout Header Banner matching checkout_16947649.png */}
          <div className="bg-[#7C9CB5] text-[#0B101C] rounded-2xl py-2.5 px-4 text-center">
            <h1 className="text-lg font-bold tracking-tight text-[#F8FAFC]">
              {t.checkoutTitle} {isTestnetOrder ? '(TESTNET)' : '(MAINNET)'}
            </h1>
            <p className="text-xs font-semibold text-[#FDE68A] tabular-nums">
              {t.orderNumberLabel} {order.orderNumber} · {netSpec.shortBadge}
            </p>
          </div>

          {/* Itemized Breakdown */}
          <div className="bg-[#182338] border border-slate-800/90 rounded-2xl p-3 space-y-2">
            <div className="flex items-start gap-3">
              {order.items[0]?.imageUrl && (
                <img
                  src={order.items[0].imageUrl}
                  alt={order.items[0].name}
                  referrerPolicy="no-referrer"
                  className="w-12 h-12 rounded-xl object-cover shrink-0 border border-slate-700/60"
                />
              )}
              <div className="flex-1 min-w-0 space-y-1.5">
                {order.items.map((item) => (
                  <div
                    key={item.productId}
                    className="flex items-baseline justify-between gap-2 text-xs sm:text-sm"
                  >
                    <div className="min-w-0 truncate text-[#F3F4F6] font-medium">
                      <span>{item.name}</span>{' '}
                      <span className="text-slate-400 tabular-nums">x{item.quantity}</span>
                    </div>
                    <div className="font-semibold text-[#F3F4F6] tabular-nums shrink-0">
                      {formatAssetAmount(item.lineTotalBase, order.asset, orderEnvironment)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {order.tableOrNote && (
              <div className="text-[11px] text-slate-400 pt-1.5 border-t border-slate-800/80">
                Note: <span className="text-slate-300">{order.tableOrNote}</span>
              </div>
            )}
          </div>

          {/* Total & Strictly Locked Network Specification */}
          <div className="space-y-1.5 px-1">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-slate-300">{t.totalLabel}</span>
              <span
                data-testid="checkout-total-amount"
                className="text-lg font-bold text-[#F3F4F6] tabular-nums"
              >
                {order.amountFormatted}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Jaringan Terkunci (Locked)</span>
              <span
                data-testid="checkout-locked-network"
                className="font-semibold text-[#2DD4BF] font-mono"
              >
                {order.network} {order.snapshotChainId ? `(Chain ID ${order.snapshotChainId})` : ''}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Label Aset</span>
              <span className="font-bold">
                {order.assetLabel || netSpec.assetDisplayLabel}
              </span>
            </div>
            {order.asset === 'USDT' && (
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>
                  {order.network === 'polygon-amoy'
                    ? 'Amoy TEST TOKEN Contract'
                    : 'Mainnet USDT Contract (137)'}
                </span>
                <span className="font-mono text-slate-300">
                  {order.network === 'polygon-amoy'
                    ? order.snapshotTokenContract
                      ? `${order.snapshotTokenContract.slice(0, 8)}...${order.snapshotTokenContract.slice(-6)}`
                      : 'Belum dikonfigurasi (Kontrak 0xc213...8e8F dilarang)'
                    : `${POLYGON_USDT_CONTRACT.slice(0, 8)}...${POLYGON_USDT_CONTRACT.slice(-6)}`}
                </span>
              </div>
            )}
            {order.network === 'polygon-amoy' && !order.snapshotTokenContract && (
              <div
                data-testid="checkout-amoy-contract-guard"
                className="p-2.5 rounded-xl bg-amber-100 border border-amber-400 text-amber-950 text-[11px] leading-relaxed"
              >
                <strong>Pengaman Kontrak Polygon Amoy (Chain ID 80002):</strong> Kontrak{' '}
                <code>TEST TOKEN</code> belum dikonfigurasi pada toko ini. Sesuai aturan keamanan,
                NimTera <strong>menolak penggunaan alamat kontrak USDT Mainnet</strong> (
                <code>0xc2132D05D31c914a87C6611C10748AEb04B58e8F</code>) di Amoy. Mintalah
                persetujuan sebelum melakukan deployment kontrak token uji baru, atau gunakan fitur
                simulasi rekonsiliasi sandbox di bawah.
              </div>
            )}
          </div>

          {/* Recipient Box + Static QR Container */}
          <div className="bg-[#182338] border border-slate-800 rounded-2xl p-3.5 space-y-3">
            <div className="bg-[#11192A] border border-slate-800/90 rounded-xl p-2.5 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#F3F4F6] font-mono">
                  {t.recipientLabel} ({isTestnetOrder ? 'TESTNET' : 'MAINNET'}): {shortenedRecipient}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowFullRecipient(!showFullRecipient)}
                    className="text-[11px] text-[#2DD4BF] hover:underline cursor-pointer"
                  >
                    {showFullRecipient ? 'Hide' : 'Inspect full'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopy(order.snapshotRecipient, 'recipient')}
                    aria-label="Copy recipient wallet address"
                    className="p-1 rounded bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
                  >
                    {copiedField === 'recipient' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
              {showFullRecipient && (
                <div
                  data-testid="full-snapshot-recipient"
                  className="text-[11px] font-mono text-[#DFC496] break-all bg-[#0B101C] p-2 rounded-lg border border-slate-800"
                >
                  {order.snapshotRecipient}
                </div>
              )}
              <p className="text-[11px] text-slate-400">{t.verifyRecipientHint}</p>
            </div>

            {/* Static High-Contrast QR Code with Network Identity Badge */}
            <div className="flex flex-col items-center space-y-2">
              <div
                data-testid="qr-network-badge"
                className={`px-3 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider ${
                  isTestnetOrder
                    ? 'bg-amber-900 text-amber-100'
                    : 'bg-emerald-900 text-emerald-100'
                }`}
              >
                {isTestnetOrder
                  ? `QR TESTNET · ${order.network.toUpperCase()} · BUKAN DANA ASLI`
                  : `QR MAINNET · ${order.network.toUpperCase()} · DANA ASLI`}
              </div>

              <div className="bg-white p-2.5 rounded-2xl shadow-md">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt={`Payment QR code for order ${order.orderNumber} on ${order.network}`}
                    className="w-36 h-36 block"
                  />
                ) : (
                  <div className="w-36 h-36 flex items-center justify-center text-xs text-slate-900">
                    Generating QR...
                  </div>
                )}
              </div>

              {qrUriError && (
                <p className="text-[11px] text-amber-700 font-medium text-center max-w-xs">
                  {qrUriError}
                </p>
              )}

              <p className="text-[11px] text-slate-400 text-center max-w-xs leading-snug">
                {qrMode === 'checkout_link'
                  ? `${t.qrCheckoutExplanation} (Mempertahankan parameter jaringan ?net=${order.network}&env=${orderEnvironment})`
                  : `Direct Wallet URI QR (${order.network}): Mengenkode penerima, nominal presisi, dan jaringan pesanan.`}
              </p>
            </div>

            {/* Explicit Mainnet Real-Funds Consent Checkbox (Required only when order is Mainnet) */}
            {!isTestnetOrder && order.paymentStatus !== 'confirmed' && (
              <label
                data-testid="mainnet-consent-box"
                className="flex items-start gap-2.5 p-2.5 rounded-xl bg-emerald-100 border border-emerald-500 text-emerald-950 text-xs cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={mainnetExplicitConsent}
                  onChange={(e) => setMainnetExplicitConsent(e.target.checked)}
                  className="mt-0.5 accent-emerald-800"
                />
                <span>
                  <strong>Izin Eksplisit Transaksi Mainnet:</strong> Saya memahami pesanan ini
                  berada di <strong>{netSpec.label}</strong> dan menyetujui pengiriman{' '}
                  <strong>dana asli ({order.amountFormatted})</strong> langsung ke wallet merchant.
                </span>
              </label>
            )}

            {/* Action Buttons matching checkout_16947649.png */}
            <div className="space-y-2.5 pt-1">
              <button
                type="button"
                data-testid="pay-in-wallet-btn"
                onClick={handlePayInNimiqPay}
                disabled={order.paymentStatus === 'confirmed'}
                className="w-full py-3 px-5 rounded-xl bg-[#14B8A6] hover:bg-[#0D9488] disabled:opacity-50 text-[#071318] font-semibold text-sm transition-colors cursor-pointer shadow"
              >
                {order.paymentStatus === 'confirmed'
                  ? `✓ ${t.statusConfirmed} (${order.network})`
                  : `${t.payInNimiqPay} · ${isTestnetOrder ? 'TESTNET' : 'MAINNET'}`}
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setQrMode(qrMode === 'checkout_link' ? 'wallet_uri' : 'checkout_link')
                  }
                  className="py-2 px-3 rounded-xl bg-[#11192A] border border-slate-700/80 hover:border-slate-600 text-xs font-medium text-slate-300 transition-colors cursor-pointer"
                >
                  {qrMode === 'checkout_link' ? 'Show Direct URI QR' : 'Show Checkout Link QR'}
                </button>

                <button
                  type="button"
                  onClick={() => handleCopy(checkoutShareUrl, 'link')}
                  className="py-2 px-3 rounded-xl bg-[#11192A] border border-slate-700/80 hover:border-slate-600 text-xs font-medium text-slate-300 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  {copiedField === 'link' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Copied Link</span>
                    </>
                  ) : (
                    <>
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Copy Order Link</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Honest Payment & Fulfillment Status Banner */}
            <div
              data-testid="checkout-payment-status"
              className="rounded-xl p-3 bg-[#11192A] border border-slate-800 text-xs space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <OrderStatusBadge
                  status={order.paymentStatus}
                  locale={locale}
                  size="sm"
                />
                <OrderStatusBadge
                  status={order.fulfillmentStatus}
                  locale={locale}
                  size="sm"
                />
              </div>

              {order.paymentReviewReason && (
                <p className="text-[11px] text-amber-800 font-medium">{order.paymentReviewReason}</p>
              )}
              {order.paymentStatus === 'unpaid' && (
                <p className="text-[11px] text-slate-400">{t.awaitingPaymentNotice}</p>
              )}
            </div>

            {walletNotice && (
              <div
                role="alert"
                data-testid="checkout-wallet-guard-alert"
                className="p-3 rounded-xl bg-amber-100 border border-amber-500 text-amber-950 text-xs font-medium leading-relaxed"
              >
                {walletNotice}
              </div>
            )}

            {/* Honest Nimiq Pay Host Capability & Testnet Availability Report */}
            <div
              data-testid="nimiq-host-capability-report"
              className="p-3 rounded-xl bg-[#11192A] border border-slate-800 text-[11px] space-y-1.5"
            >
              <div className="flex items-center justify-between font-semibold text-[#1C1917]">
                <span className="inline-flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                  <span>Diagnostik Host Nimiq Pay & Ketersediaan Testnet</span>
                </span>
                <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-[#FAF6F0] border border-[#E2D9C8]">
                  EVM Chain: {detectedEvmChainId ?? 'Tidak terdeteksi'}
                </span>
              </div>
              <p className="text-slate-500 leading-relaxed">
                {capabilities.hostLimitationSummary}
              </p>
            </div>

            {/* On-chain Transaction Hash Verification Input */}
            <div className="pt-2 border-t border-slate-800/80 space-y-2">
              <label
                htmlFor="tx-hash-verify-input"
                className="block text-[11px] font-medium text-slate-400"
              >
                {t.txHashLabel} (Diverifikasi ketat hanya di RPC <strong className="font-mono">{order.network}</strong>)
              </label>
              <div className="flex gap-2">
                <input
                  id="tx-hash-verify-input"
                  type="text"
                  value={txHashInput}
                  onChange={(e) => setTxHashInput(e.target.value)}
                  placeholder={`Hash tx di ${order.network}...`}
                  className="flex-1 bg-[#0B101C] border border-slate-700/80 rounded-xl px-3 py-1.5 text-xs font-mono text-[#F3F4F6]"
                />
                <button
                  type="button"
                  disabled={verifying}
                  onClick={() => submitVerification()}
                  className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-[#F3F4F6] shrink-0 cursor-pointer"
                >
                  {verifying ? '...' : 'Verify'}
                </button>
              </div>
            </div>

            {/* Sandbox / 2-Device Automated Verification Simulator (Explicitly labeled NOT native E2E) */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowTestHarness(!showTestHarness)}
                className="w-full flex items-center justify-between text-[11px] text-slate-400 hover:text-slate-200 py-1 cursor-pointer"
              >
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  <FlaskConical className="w-3.5 h-3.5 text-[#DFC496]" />
                  <span>Simulasi Rekonsiliasi Otomatis (Sandbox — Bukan Native E2E)</span>
                </span>
                <span>{showTestHarness ? '▴' : '▾'}</span>
              </button>

              {showTestHarness && (
                <div className="mt-2 p-3 rounded-xl bg-[#0B101C] border border-slate-800 space-y-2 text-[11px]">
                  <p className="text-slate-500 leading-relaxed">
                    <strong>Catatan Kejujuran Pengujian:</strong> Tombol di bawah menguji mesin
                    verifikasi & rekonsiliasi server (termasuk notifikasi & suara kasir lintas
                    perangkat). Simulasi otomatis ini <strong>bukan</strong> pembayaran native
                    end-to-end dari aplikasi Nimiq Pay.
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      data-testid="sim-pending-btn"
                      onClick={() => {
                        const demoHash = `0xsim_pending_${order.network}_${order.id.slice(-5)}`;
                        setTxHashInput(demoHash);
                        submitVerification(demoHash, {
                          executionStatus: 'pending',
                          network: order.network,
                        });
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 font-medium text-left cursor-pointer"
                    >
                      1. Simulasi Tx Pending ({order.network})
                    </button>

                    <button
                      type="button"
                      data-testid="sim-confirmed-btn"
                      onClick={() => {
                        const demoHash = `0xsim_confirmed_${order.network}_${order.id.slice(-5)}`;
                        setTxHashInput(demoHash);
                        submitVerification(demoHash, {
                          executionStatus: 'confirmed',
                          network: order.network,
                        });
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-950/80 border border-emerald-700/60 hover:bg-emerald-900/70 text-emerald-300 font-medium text-left cursor-pointer"
                    >
                      2. Simulasi Tx Confirmed ({order.network})
                    </button>

                    <button
                      type="button"
                      data-testid="sim-underpay-btn"
                      onClick={() => {
                        const demoHash = `0xsim_underpay_${order.network}_${order.id.slice(-5)}`;
                        setTxHashInput(demoHash);
                        submitVerification(demoHash, {
                          executionStatus: 'confirmed',
                          network: order.network,
                          amountBase: (BigInt(order.amountBase) / 2n).toString(),
                        });
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-amber-950/70 border border-amber-700/50 text-amber-300 font-medium text-left cursor-pointer"
                    >
                      3. Simulasi Kurang Bayar (Underpaid)
                    </button>

                    <button
                      type="button"
                      data-testid="sim-wrong-network-btn"
                      onClick={() => {
                        const mismatchedNet: NetworkId =
                          order.network === 'nimiq-testnet'
                            ? 'nimiq-mainnet'
                            : order.network === 'polygon-amoy'
                            ? 'polygon-mainnet'
                            : order.network === 'nimiq-mainnet'
                            ? 'nimiq-testnet'
                            : 'polygon-amoy';
                        const demoHash = `0xsim_wrongnet_${mismatchedNet}_${order.id.slice(-5)}`;
                        setTxHashInput(demoHash);
                        submitVerification(demoHash, {
                          executionStatus: 'confirmed',
                          network: mismatchedNet,
                        });
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-rose-950/70 border border-rose-700/60 text-rose-200 font-medium text-left cursor-pointer"
                    >
                      4. Uji Tolak Salah Jaringan (Mismatch)
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Honest Disclaimers matching checkout_16947649.png */}
          <div className="text-center text-[11px] text-slate-400 space-y-0.5 leading-relaxed">
            <p>{t.directNoEscrowNotice}</p>
            <p>{t.noConversionNotice}</p>
            <p className="text-slate-500">
              Standard network fees apply in your wallet. Expires:{' '}
              {new Date(order.expiresAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
        </div>
      </main>

      <footer className="relative z-10 text-center text-xs text-slate-500 pt-4">
        NimTera — {t.independentNotice}
      </footer>
    </div>
  );
};
