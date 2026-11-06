import {checkoutTransport} from '../lib/checkoutTransport';
import {CHECKOUT_TRANSPORT_COPY} from '../lib/checkoutTransportCopy';
import { uiText, uiChoice, categoryCopy } from '../lib/uiLocale';
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
  isActiveNimOrder,
  formatAssetAmount,
  NETWORK_CONFIGS,
  type NetworkId,
  type OrderSnapshot,
} from '../lib/domain';
import { LOCALE_METADATA, TRANSLATIONS, type SupportedLocale } from '../lib/i18n';
import {
  detectNimiqPayCapabilities,
  requestNativeNimPayment,
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
  const transportText=CHECKOUT_TRANSPORT_COPY[locale];

  const [order, setOrder] = useState<OrderSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [showFullRecipient, setShowFullRecipient] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [txHashInput, setTxHashInput] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [walletNotice, setWalletNotice] = useState<string | null>(null);
  const [mainnetExplicitConsent, setMainnetExplicitConsent] = useState(false);

  const capabilities = detectNimiqPayCapabilities();

  const fetchOrder = async (signal?: AbortSignal) => {
    try {
      const resp = await fetch(`/api/public/orders/${encodeURIComponent(publicToken)}`, { signal });
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
      if (signal?.aborted) return;
      setError('Unable to load checkout details.');
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await fetchOrder(controller.signal); if (!stopped) timer = setTimeout(poll, 5000); };
    void poll();
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [publicToken]);

  // QR opens the exact invoice in the Mini App; never bypass memo/network guards.
  useEffect(() => {
    if (!order || !isActiveNimOrder(order)) return;
    const origin =
      typeof window !== 'undefined' ? window.location.origin : 'https://nimtera.store';
    const isTestnetOrder =
      order.environment === 'testnet' ||
      order.network === 'nimiq-testnet';
    const envParam = isTestnetOrder ? 'testnet' : 'mainnet';
    const checkoutUrl = `${origin}/s/${order.storeSlug}/order/${order.publicToken}?net=${order.network}&env=${envParam}`;

    const payload=checkoutTransport(checkoutUrl).qrPayload;

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
  }, [order]);

  const handleCopy = (text: string, label: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedField(label);
      setTimeout(() => setCopiedField(null), 1800);
    }
  };

  const handlePayInNimiqPay = async () => {
    if (!order) return;
    if (!isActiveNimOrder(order) || ['confirmed','failed'].includes(order.paymentStatus) || Date.now() > Date.parse(order.expiresAt)) { setWalletNotice('Invoice cannot request a new payment. Mainnet is disabled during the testnet beta.'); return; }
    if (verifying) return;
    setWalletNotice(null);

    const isTestnetOrder =
      order.environment === 'testnet' ||
      order.network === 'nimiq-testnet';

    if (!isTestnetOrder && !mainnetExplicitConsent) {
      setWalletNotice(
        uiText(locale, "PERINGATAN MAINNET: Pesanan ini berada di jaringan MAINNET (Dana Asli). Centang persetujuan eksplisit di atas tombol sebelum mengirim transaksi dana asli.")
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
    }
  };

  const submitVerification = async (
    hashOverride?: string,

  ) => {
    if (!order) return;
    const hashToUse = (hashOverride ?? txHashInput).trim();
    if (!hashToUse) {
      setWalletNotice('Please enter a transaction hash returned by your wallet.');
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
      <div className="min-h-screen bg-[var(--surface-base)] text-[var(--ink)] flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-[var(--surface-card)] border border-slate-600 rounded-2xl p-8 space-y-4">
          <div className="h-6 w-40 bg-slate-800 rounded" />
          <div className="h-24 w-full bg-slate-800/60 rounded-xl" />
          <div className="h-48 w-full bg-slate-800/40 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen bg-[var(--surface-base)] text-[var(--ink)] flex flex-col items-center justify-center p-6 text-center space-y-4">
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

  if (!isActiveNimOrder(order)) return <main className="min-h-screen bg-[var(--surface-base)] text-[var(--ink)] p-6"><div className="max-w-xl mx-auto rounded-2xl border border-slate-500 bg-[var(--surface-card)] p-6 space-y-4" data-testid="archived-order"><BrandLogo/><h1 className="text-2xl">{uiText(locale,'Arsip pesanan — hanya baca')}</h1><p>{order.orderNumber} · {order.amountFormatted}</p><p>{order.paymentStatus}</p><p>{uiText(locale,'Metode pembayaran ini tidak lagi aktif. Riwayat asli tetap disimpan. Jangan kirim pembayaran untuk pesanan ini.')}</p><button onClick={()=>onBackToStore(order.storeSlug)} className="border rounded-xl px-4 py-2">{uiText(locale,'Kembali ke toko')}</button></div></main>;

  const isTestnetOrder =
    order.environment === 'testnet' ||
    order.network === 'nimiq-testnet';
  const netSpec = NETWORK_CONFIGS['nimiq-testnet'];
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
    <div className="min-h-screen bg-[var(--surface-base)] text-[var(--ink)] relative flex flex-col justify-between py-4 px-4 sm:px-8">
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
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[var(--surface-card)] border border-slate-600 text-xs sm:text-sm font-medium text-slate-300 hover:text-[var(--ink)] hover:border-slate-500 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{order.storeName}</span>
          </button>

          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-[var(--gold-ink)]" aria-hidden="true" />
            <select
              aria-label="Checkout Language"
              value={locale}
              onChange={(e) => onChangeLocale(e.target.value as SupportedLocale)}
              className="bg-[var(--surface-card)] border border-slate-500/80 rounded-xl px-3 py-1.5 text-xs font-medium text-[var(--ink)] cursor-pointer"
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
              className={`px-2.5 py-0.5 rounded-full font-extrabold uppercase tracking-wider text-[13px] ${
                isTestnetOrder
                  ? 'bg-amber-900 text-amber-100'
                  : 'bg-emerald-900 text-emerald-100'
              }`}
            >
              {isTestnetOrder ? 'TESTNET CHECKOUT & QR' : 'MAINNET CHECKOUT (DANA ASLI)'}
            </span>
            <span className="font-semibold">
              {isTestnetOrder
                ? uiChoice(locale, `Jaringan Terkunci: ${netSpec.networkDisplayName} · Aset: ${
                    order.assetLabel || netSpec.assetDisplayLabel
                  } (Bukan Dana Asli). Tidak ada fallback otomatis ke Mainnet.`, `Locked network: ${netSpec.networkDisplayName} · Asset: ${
                    order.assetLabel || netSpec.assetDisplayLabel
                  } (Test funds, not real money). No automatic fallback to Mainnet.`)
                : uiChoice(locale, `Jaringan Terkunci: ${netSpec.networkDisplayName} · Aset: ${netSpec.assetDisplayLabel} (Transaksi Dana Asli — Tidak dapat dibatalkan otomatis).`, `Locked network: ${netSpec.networkDisplayName} · Asset: ${netSpec.assetDisplayLabel} (Real-money transaction — cannot be reversed automatically).`)}
            </span>
          </div>
          <a
            href={netSpec.explorerBaseUrl}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[13px] underline font-semibold shrink-0"
          >
            Explorer: {netSpec.networkDisplayName} ↗
          </a>
        </div>
      </header>

      {/* Main Centered Checkout Card */}
      <main className="relative z-10 my-auto py-1 flex flex-col items-center">
        <div className="w-full max-w-[440px] bg-[var(--surface-card)] border border-slate-500/80 rounded-3xl p-4 sm:p-5 shadow-2xl space-y-3.5">
          {/* Card Top Header: Store Identity + NimTera Logo */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-full bg-[var(--surface-raised)] border border-slate-500 flex items-center justify-center text-xs font-bold text-[var(--gold-ink)] shrink-0">
                {order.storeName.slice(0, 1)}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--ink)] truncate">
                  {order.storeName}
                </div>
                <div className="text-[13px] text-slate-300">
                  merchant · {order.fulfillmentMode.replace('_', '-')} ·{' '}
                  <strong className={isTestnetOrder ? 'text-amber-300' : 'text-emerald-300'}>
                    {isTestnetOrder ? 'TESTNET' : 'MAINNET'}
                  </strong>
                </div>
              </div>
            </div>

            <BrandLogo variant="champagne" size="sm" onClick={() => onBackToStore(order.storeSlug)} />
          </div>

          {/* Slate-Blue Checkout Header Banner */}
          <div className="bg-[var(--surface-checkout)] text-[var(--ink)] rounded-2xl py-2.5 px-4 text-center">
            <h1 className="text-lg font-bold tracking-tight text-[var(--ink)]">
              {t.checkoutTitle} {isTestnetOrder ? '(TESTNET)' : '(MAINNET)'}
            </h1>
            <p className="text-xs font-semibold text-[var(--warning-ink)] tabular-nums">
              {t.orderNumberLabel} {order.orderNumber} · {netSpec.networkDisplayName}
            </p>
          </div>

          {/* Itemized Breakdown */}
          <div className="bg-[var(--surface-raised)] border border-slate-600/90 rounded-2xl p-3 space-y-2">
            <div className="flex items-start gap-3">
              {order.items[0]?.imageUrl && (
                <img
                  src={order.items[0].imageUrl}
                  alt={order.items[0].name}
                  referrerPolicy="no-referrer"
                  className="w-12 h-12 rounded-xl object-cover shrink-0 border border-slate-500/60"
                />
              )}
              <div className="flex-1 min-w-0 space-y-1.5">
                {order.items.map((item) => (
                  <div
                    key={item.productId}
                    className="flex items-baseline justify-between gap-2 text-xs sm:text-sm"
                  >
                    <div className="min-w-0 truncate text-[var(--ink)] font-medium">
                      <span>{item.name}</span>{' '}
                      <span className="text-slate-300 tabular-nums">x{item.quantity}</span>
                    </div>
                    <div className="font-semibold text-[var(--ink)] tabular-nums shrink-0">
                      {formatAssetAmount(item.lineTotalBase, 'NIM', orderEnvironment)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {order.tableOrNote && (
              <div className="text-[13px] text-slate-300 pt-1.5 border-t border-slate-600/80">
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
                className="text-lg font-bold text-[var(--ink)] tabular-nums"
              >
                {order.amountFormatted}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span>{' '}{uiText(locale, "Jaringan Terkunci (Locked)")}{' '}</span>
              <span
                data-testid="checkout-locked-network"
                className="font-semibold text-[var(--teal-ink)] font-mono"
              >
                {order.network} {order.snapshotChainId ? `(Chain ID ${order.snapshotChainId})` : ''}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span>{uiChoice(locale,'Label aset','Asset label')}</span>
              <span className="font-bold">
                {order.assetLabel || netSpec.assetDisplayLabel}
              </span>
            </div>


          </div>

          {/* Recipient Box + Static QR Container */}
          <div className="bg-[var(--surface-raised)] border border-slate-600 rounded-2xl p-3.5 space-y-3">
            <div className="bg-[var(--surface-inset)] border border-slate-600/90 rounded-xl p-2.5 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--ink)] font-mono">
                  {t.recipientLabel} ({isTestnetOrder ? 'TESTNET' : 'MAINNET'}): {shortenedRecipient}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowFullRecipient(!showFullRecipient)}
                    className="text-[13px] text-[var(--teal-ink)] hover:underline cursor-pointer"
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
                  className="text-[13px] font-mono text-[var(--gold-ink)] break-all bg-[var(--surface-base)] p-2 rounded-lg border border-slate-600"
                >
                  {order.snapshotRecipient}
                </div>
              )}
              <p className="text-[13px] text-slate-300">{t.verifyRecipientHint}</p>
            </div>

            {/* Static High-Contrast QR Code with Network Identity Badge */}
            <div className="flex flex-col items-center space-y-2">
              <div
                data-testid="qr-network-badge"
                className={`px-3 py-0.5 rounded-full text-[13px] font-extrabold uppercase tracking-wider ${
                  isTestnetOrder
                    ? 'bg-amber-900 text-amber-100'
                    : 'bg-emerald-900 text-emerald-100'
                }`}
              >
                {isTestnetOrder
                  ? uiChoice(locale, `QR TESTNET · ${order.network.toUpperCase()} · BUKAN DANA ASLI`, `TESTNET QR · ${order.network.toUpperCase()} · NOT REAL FUNDS`)
                  : uiChoice(locale, `QR MAINNET · ${order.network.toUpperCase()} · DANA ASLI`, `MAINNET QR · ${order.network.toUpperCase()} · REAL FUNDS`)}
              </div>

              <div className="bg-white p-2.5 rounded-2xl shadow-md">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    data-testid="checkout-open-qr"
                    alt={transportText.alt}
                    className="w-36 h-36 block"
                  />
                ) : (
                  <div className="w-36 h-36 flex items-center justify-center text-xs text-slate-900">
                    Generating QR...
                  </div>
                )}
              </div>

              <h3 data-testid="checkout-qr-purpose" className="text-sm font-bold text-[var(--gold-ink)] text-center">{transportText.title}</h3>
              <p data-testid="checkout-qr-instructions" className="text-sm text-slate-300 text-center max-w-xs leading-snug">{transportText.scan}</p>
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
                  <strong>Izin Eksplisit Transaksi Mainnet:</strong>{' '}{uiText(locale, "Saya memahami pesanan ini berada di")}{' '}<strong>{netSpec.networkDisplayName}</strong>{' '}{uiText(locale, "dan menyetujui pengiriman")}{' '}{' '}
                  <strong>dana asli ({order.amountFormatted})</strong> langsung ke wallet merchant.
                </span>
              </label>
            )}

            <div data-testid="checkout-native-guidance" className="rounded-xl p-3 border border-slate-500 bg-[var(--surface-inset)] text-sm space-y-2 text-slate-300"><p>{transportText.fallback}</p><p>{transportText.inside}</p></div>

            {/* Action Buttons */}
            <div className="space-y-2.5 pt-1">
              <button
                type="button"
                data-testid="pay-in-wallet-btn"
                onClick={handlePayInNimiqPay}
                disabled={order.paymentStatus === 'confirmed'}
                className="w-full py-3 px-5 rounded-xl bg-[#14B8A6] hover:bg-[#0D9488] disabled:opacity-70 text-[#071318] font-semibold text-sm transition-colors cursor-pointer shadow"
              >
                {order.paymentStatus === 'confirmed'
                  ? `✓ ${t.statusConfirmed} (${order.network})`
                  : `${t.payInNimiqPay} · ${isTestnetOrder ? 'TESTNET' : 'MAINNET'}`}
              </button>

              <div className="grid grid-cols-2 gap-2">
                {checkoutTransport(checkoutShareUrl).openUrl&&<a data-testid="open-checkout-in-nimiq-pay" href={checkoutTransport(checkoutShareUrl).openUrl!} className="py-2 px-3 rounded-xl bg-[var(--surface-inset)] border border-slate-500/80 text-xs font-semibold text-[var(--gold-ink)] text-center">{transportText.open}</a>}

                <button
                  type="button"
                  onClick={() => handleCopy(checkoutShareUrl, 'link')}
                  className="py-2 px-3 rounded-xl bg-[var(--surface-inset)] border border-slate-500/80 hover:border-slate-600 text-xs font-medium text-slate-300 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
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
              className="rounded-xl p-3 bg-[var(--surface-inset)] border border-slate-600 text-xs space-y-2"
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
                <p className="text-[13px] text-amber-800 font-medium">{order.paymentReviewReason}</p>
              )}
              {order.paymentStatus === 'unpaid' && (
                <p className="text-[13px] text-slate-300">{t.awaitingPaymentNotice}</p>
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
              className="p-3 rounded-xl bg-[var(--surface-inset)] border border-slate-600 text-[13px] space-y-1.5"
            >
              <div className="flex items-center justify-between font-semibold text-[var(--ink)]">
                <span className="inline-flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                  <span>{uiText(locale,'Diagnostik Nimiq Pay dan ketersediaan testnet')}</span>
                </span>

              </div>
              <p className="text-slate-300 leading-relaxed">
                {capabilities.hostLimitationSummary}
              </p>
            </div>

            {/* On-chain Transaction Hash Verification Input */}
            <div className="pt-2 border-t border-slate-600/80 space-y-2">
              <label
                htmlFor="tx-hash-verify-input"
                className="block text-[13px] font-medium text-slate-300"
              >
                {t.txHashLabel}{' '}{uiText(locale, "(Diverifikasi ketat hanya di RPC")}{' '}<strong className="font-mono">{order.network}</strong>)
              </label>
              <div className="flex gap-2">
                <input
                  id="tx-hash-verify-input"
                  type="text"
                  value={txHashInput}
                  onChange={(e) => setTxHashInput(e.target.value)}
                  placeholder={`Transaction hash · ${order.network}…`}
                  className="flex-1 bg-[var(--surface-base)] border border-slate-500/80 rounded-xl px-3 py-1.5 text-xs font-mono text-[var(--ink)]"
                />
                <button
                  type="button"
                  disabled={verifying}
                  onClick={() => submitVerification()}
                  className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-[var(--ink)] shrink-0 cursor-pointer"
                >
                  {verifying ? '...' : 'Verify'}
                </button>
              </div>
            </div>

          </div>

          {/* Honest Disclaimers */}
          <div className="text-center text-[13px] text-slate-300 space-y-0.5 leading-relaxed">
            <p>{t.directNoEscrowNotice}</p>
            <p>{t.noConversionNotice}</p>
            <p className="text-slate-300">
              Standard network fees apply in your wallet. Expires:{' '}
              {new Date(order.expiresAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
        </div>
      </main>

      <footer className="relative z-10 text-center text-xs text-slate-300 pt-4">
        NimTera — {t.independentNotice}
      </footer>
    </div>
  );
};
