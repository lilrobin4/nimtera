import { uiText, uiChoice, categoryCopy } from '../lib/uiLocale';
import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { Plus, Minus, ArrowLeft, SlidersHorizontal, AlertTriangle, ShoppingBag, Globe, ShieldCheck, FlaskConical } from 'lucide-react';
import {
  calculateCartTotals,
  DEFAULT_NETWORK_ENV,
  formatLunaToNim,
  MENU_CATEGORY_COLUMNS,
  type CartItemInput,
  type FulfillmentMode,
  type NetworkEnvironment,
  type PaymentAsset,
  type ProductCategory,
  type ProductRecord,
} from '../lib/domain';
import { LOCALE_METADATA, TRANSLATIONS, type SupportedLocale } from '../lib/i18n';
import { BrandLogo } from './BrandLogo';

const LazyNightMarketSculpture3D = React.lazy(() => import('./NightMarketSculpture3D'));

export interface PublicStoreInfo {
  slug: string;
  name: string;
  logoUrl?: string;
  activeEnvironment?: NetworkEnvironment;
  acceptsNim: boolean;
  acceptsTestnetNim?: boolean;
  supportsPickup: boolean;
  supportsDelivery: boolean;
  supportsDineIn: boolean;
  defaultLocale: SupportedLocale;
}

interface CustomerStorefrontProps {
  store: PublicStoreInfo;
  products: ProductRecord[];
  locale: SupportedLocale;
  onChangeLocale: (locale: SupportedLocale) => void;
  onSwitchStore: (slug: string) => void;
  onNavigateSellerLogin: () => void;
  onOpenDocsModal: () => void;
  onOrderCreated: (publicToken: string) => void;
}

export const CustomerStorefront: React.FC<CustomerStorefrontProps> = ({
  store,
  products,
  locale,
  onChangeLocale,
  onSwitchStore,
  onNavigateSellerLogin,
  onOpenDocsModal,
  onOrderCreated,
}) => {
  const t = TRANSLATIONS[locale] || TRANSLATIONS.en;

  const [selectedEnvironment, setSelectedEnvironment] = useState<NetworkEnvironment>(
    store.activeEnvironment || DEFAULT_NETWORK_ENV
  );

  useEffect(() => {
    if (store.activeEnvironment) {
      setSelectedEnvironment(store.activeEnvironment);
    }
  }, [store.activeEnvironment]);

  const isTestnet = selectedEnvironment === 'testnet';
  const nimUnitLabel = isTestnet ? 'NIM (TESTNET)' : 'NIM';

  const [selectedCategory, setSelectedCategory] = useState<'all' | ProductCategory>('all');
  const [selectedAsset, setSelectedAsset] = useState<PaymentAsset>(
    'NIM'
  );
  const [cart, setCart] = useState<CartItemInput[]>([
    { productId: 'prod_iced_latte', quantity: 1 },
    { productId: 'prod_croissant', quantity: 1 },
  ]);
  const [fulfillmentMode, setFulfillmentMode] = useState<FulfillmentMode>('dine_in');
  const [tableOrNote, setTableOrNote] = useState('Table 7');
  const [deliveryName, setDeliveryName] = useState('');
  const [deliveryPhone, setDeliveryPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});

  // Ensure cart items belong to current store; if switching stores, reset cart to first available item
  const validStoreCart = useMemo(() => {
    const storeProdIds = new Set(products.map((p) => p.id));
    const filtered = cart.filter((c) => storeProdIds.has(c.productId) && c.quantity > 0);
    return filtered;
  }, [cart, products]);

  const calculation = useMemo(
    () => calculateCartTotals(validStoreCart, products, selectedAsset, selectedEnvironment),
    [validStoreCart, products, selectedAsset, selectedEnvironment]
  );

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (!p.available) return false;
      if (selectedCategory === 'all') return true;
      return p.category === selectedCategory;
    });
  }, [products, selectedCategory]);

  const totalItemsCount = useMemo(
    () => validStoreCart.reduce((acc, item) => acc + item.quantity, 0),
    [validStoreCart]
  );

  const updateCartQuantity = (productId: string, delta: number) => {
    setErrorMsg(null);
    setCart((prev) => {
      const existing = prev.find((item) => item.productId === productId);
      if (!existing) {
        if (delta <= 0) return prev;
        return [...prev, { productId, quantity: delta }];
      }
      const nextQty = existing.quantity + delta;
      if (nextQty <= 0) {
        return prev.filter((item) => item.productId !== productId);
      }
      return prev.map((item) =>
        item.productId === productId ? { ...item, quantity: nextQty } : item
      );
    });
  };

  const handleCreateOrder = async () => {
    setErrorMsg(null);
    if (!calculation.compatible) {
      setErrorMsg(t.incompatibleAssetWarning);
      return;
    }
    if (fulfillmentMode === 'delivery') {
      if (!deliveryName.trim() || !deliveryPhone.trim() || !deliveryAddress.trim()) {
        setErrorMsg('Please complete recipient name, phone number, and delivery address.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const resp = await fetch(`/api/public/stores/${encodeURIComponent(store.slug)}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: validStoreCart,
          asset: selectedAsset,
          environment: selectedEnvironment,
          fulfillmentMode,
          tableOrNote,
          deliveryInfo:
            fulfillmentMode === 'delivery'
              ? {
                  recipientName: deliveryName,
                  phone: deliveryPhone,
                  address: deliveryAddress,
                }
              : undefined,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setErrorMsg(data.error || 'Failed to create order.');
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
      setMobileCartOpen(false);
      onOrderCreated(data.order.publicToken);
    } catch {
      setErrorMsg('Network error while creating order. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--surface-base)] text-[var(--ink)] flex flex-col">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-30 bg-[var(--surface-base)]/95 border-b border-slate-600/80 px-4 sm:px-8 py-4">
        <div className="max-w-[1360px] mx-auto flex flex-wrap items-center justify-between gap-4 sm:gap-8">
          {/* Zone 1: Brand Title */}
          <BrandLogo
            variant="champagne"
            size="md"
            onClick={() => onSwitchStore('moonlight-cafe')}
          />

          {/* Zone 2: Concise single-line navigation links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300" aria-label="Storefront navigation">
            <a
              href="#menu-catalog"
              className="hover:text-[var(--ink)] transition-colors whitespace-nowrap shrink-0"
            >
              {t.navMenu}
            </a>
            <a
              href="#order-panel"
              className="hover:text-[var(--ink)] transition-colors whitespace-nowrap shrink-0"
            >
              {t.navYourOrder} ({totalItemsCount})
            </a>
            <button
              type="button"
              onClick={onOpenDocsModal}
              className="hover:text-[var(--ink)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {t.navPolicies}
            </button>
            <div className="flex items-center gap-1.5 text-slate-300">
              <Globe className="w-3.5 h-3.5 text-[var(--gold-ink)]" aria-hidden="true" />
              <label htmlFor="storefront-lang-select" className="sr-only">
                Language
              </label>
              <select
                id="storefront-lang-select"
                aria-label="Language"
                value={locale}
                onChange={(e) => onChangeLocale(e.target.value as SupportedLocale)}
                className="bg-[var(--surface-card)] border border-slate-500/80 rounded-lg px-2.5 py-1 text-xs font-medium text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[#14B8A6] cursor-pointer"
              >
                {(Object.keys(LOCALE_METADATA) as SupportedLocale[]).map((loc) => (
                  <option key={loc} value={loc}>
                    {LOCALE_METADATA[loc].shortLabel} — {LOCALE_METADATA[loc].label}
                  </option>
                ))}
              </select>
            </div>
          </nav>

          {/* Zone 3: 1 Primary Action + Mobile Language Switcher */}
          <div className="flex items-center gap-2.5 shrink-0">
            <select
              aria-label="Mobile Language"
              value={locale}
              onChange={(e) => onChangeLocale(e.target.value as SupportedLocale)}
              className="md:hidden bg-[var(--surface-card)] border border-slate-500/80 rounded-lg px-2 py-1.5 text-xs font-medium text-[var(--ink)]"
            >
              {(Object.keys(LOCALE_METADATA) as SupportedLocale[]).map((loc) => (
                <option key={loc} value={loc}>
                  {LOCALE_METADATA[loc].shortLabel}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onNavigateSellerLogin}
              className="px-4 py-2 text-xs sm:text-sm font-medium text-[var(--ink)] bg-[var(--surface-card)] border border-slate-500/90 rounded-lg hover:border-[#DFC496]/60 hover:text-[var(--gold-ink)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {t.navSellerLogin}
            </button>
          </div>
        </div>
      </header>

      {/* STRICT TESTNET / MAINNET NETWORK ISOLATION BANNER */}
      <div
        data-testid="storefront-testnet-banner"
        className={`border-b px-4 sm:px-8 py-2.5 text-xs ${
          isTestnet
            ? 'bg-amber-100/95 border-amber-400 text-amber-950'
            : 'bg-emerald-100/95 border-emerald-400 text-emerald-950'
        }`}
      >
        <div className="max-w-[1360px] mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className={`px-2.5 py-0.5 rounded-full font-extrabold uppercase tracking-wider text-[13px] ${
                isTestnet
                  ? 'bg-amber-900 text-amber-100'
                  : 'bg-emerald-900 text-emerald-100'
              }`}
            >
              {isTestnet ? 'TESTNET MODE (DEFAULT DEV)' : 'MAINNET MODE (DANA ASLI)'}
            </span>
            <span className="font-medium">
              {isTestnet
                ? uiText(locale, "Menggunakan Nimiq Testnet (NIM TESTNET). Pesanan uji terpisah dari penjualan nyata.")
                : uiText(locale, "Pembayaran Mainnet belum tersedia. Jangan mengirim dana asli.")}
            </span>
          </div>

          <div className="inline-flex max-w-full flex-wrap items-center gap-1 bg-white/90 border border-stone-300 rounded-lg p-0.5 shrink-0">
            <button
              type="button"
              data-testid="storefront-switch-testnet"
              onClick={() => setSelectedEnvironment('testnet')}
              className={`px-2.5 py-1 rounded-md text-[13px] font-bold transition-colors cursor-pointer ${
                isTestnet
                  ? 'bg-amber-700 text-white'
                  : 'text-stone-700 hover:bg-stone-100'
              }`}
            >
              NIM TESTNET
            </button>
            <button
              type="button"
              data-testid="storefront-switch-mainnet"
              onClick={() => setSelectedEnvironment('mainnet')}
              className={`px-2.5 py-1 rounded-md text-[13px] font-bold transition-colors cursor-pointer ${
                !isTestnet
                  ? 'bg-emerald-800 text-white'
                  : 'text-stone-700 hover:bg-stone-100'
              }`}
            >
              NIM MAINNET
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Container */}
      <main className="relative flex-1 max-w-[1360px] w-full mx-auto px-4 sm:px-8 pt-6 pb-28 lg:pb-16">
        {/* Lively Floating Warm Cream & Champagne Ambient Orbs */}
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 overflow-hidden z-0"
        >
          <div className="animate-float-orb absolute -top-16 left-[8%] w-72 h-72 rounded-full bg-[#DFC496]/25 blur-3xl" />
          <div className="animate-float-orb-reverse absolute top-[38%] right-[6%] w-80 h-80 rounded-full bg-[#DFC496]/18 blur-3xl" />
          <div className="animate-float-orb absolute bottom-10 left-[32%] w-64 h-64 rounded-full bg-[#2DD4BF]/15 blur-3xl" />
        </div>

        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left 8 Columns: Hero + Category Filter + Product Grid */}
          <div className="lg:col-span-8 space-y-8">
            {/* Split Hero Section */}
            <section className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center pt-2 pb-4 border-b border-slate-600/70">
              <div className="md:col-span-7 space-y-4">
                <h1
                  className="font-display text-[var(--ink)] font-normal tracking-tight leading-[1.08]"
                  style={{ fontSize: 'clamp(2.35rem, 4.2vw, 3.85rem)', textWrap: 'balance' }}
                >
                  <span className="block">{t.heroHeadlineLine1}</span>
                  <span className="block text-[var(--gold-ink)]">{t.heroHeadlineLine2}</span>
                </h1>
                <p className="text-slate-200/90 text-base sm:text-lg max-w-xl leading-relaxed">
                  {t.heroSubtitle}
                </p>

                {/* Store Selector & Status Row */}
                <div className="pt-2 flex flex-wrap items-center gap-3">
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--surface-selected)]/85 border border-[#14B8A6]/60 text-[var(--ink)] text-sm font-medium animate-pulse-glow">
                    <span className="w-2 h-2 rounded-full bg-[#2DD4BF] animate-ping" aria-hidden="true" />
                    {store.logoUrl && <img src={store.logoUrl} alt={`${store.name} logo`} data-testid="customer-shop-logo" className="w-12 h-12 rounded-lg bg-white object-contain p-1 shrink-0"/>}
                    <span>{store.name}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-[var(--teal-ink)]">{t.openStatus}</span>
                  </div>


                </div>
              </div>

              {/* Right Hero Column: Lazy-Loaded Three.js Interlocking Sculpture */}
              <div className="md:col-span-5">
                <Suspense
                  fallback={
                    <div className="w-full h-64 md:h-80 flex items-center justify-center">
                      <div className="w-36 h-36 rounded-full border-4 border-[#DFC496]/30" />
                    </div>
                  }
                >
                  <LazyNightMarketSculpture3D />
                </Suspense>
              </div>
            </section>

            {/* Separated Menu Category Columns (Makanan, Minuman, Dessert, Buah, Bakery, Lainnya) */}
            <section id="menu-catalog" className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div
                  role="tablist"
                  aria-label="Product categories"
                  className="flex items-center gap-2 overflow-x-auto pb-1"
                >
                  <button
                    role="tab"
                    aria-selected={selectedCategory === 'all'}
                    type="button"
                    onClick={() => setSelectedCategory('all')}
                    className={`px-4 py-2 text-sm font-medium rounded-lg transition-all whitespace-nowrap shrink-0 cursor-pointer active:scale-95 ${
                      selectedCategory === 'all'
                        ? 'bg-[#14B8A6] text-[#071318] font-semibold shadow-sm'
                        : 'text-slate-300 hover:text-[var(--ink)] bg-[var(--surface-card)] border border-slate-500'
                    }`}
                  >{' '}{uiText(locale, "Semua Kolom (")}{' '}{products.filter((p) => p.available).length})
                  </button>
                  {MENU_CATEGORY_COLUMNS.map((col) => {
                    const active = selectedCategory === col.id;
                    const count = products.filter(
                      (p) => p.available && p.category === col.id
                    ).length;
                    return (
                      <button
                        key={col.id}
                        role="tab"
                        aria-selected={active}
                        type="button"
                        onClick={() => setSelectedCategory(col.id)}
                        className={`px-3.5 py-2 text-xs sm:text-sm font-medium rounded-lg transition-all whitespace-nowrap shrink-0 cursor-pointer active:scale-95 ${
                          active
                            ? 'bg-[#14B8A6] text-[#071318] font-semibold shadow-sm'
                            : 'text-slate-300 hover:text-[var(--ink)] bg-[var(--surface-card)] border border-slate-500'
                        }`}
                      >
                        {categoryCopy(col.id, locale).title} ({count})
                      </button>
                    );
                  })}
                </div>

                <div className="text-xs text-slate-300">
                  <span>{t.pricesSetByMerchant}</span>
                  <span aria-hidden="true"> · </span>
                  <span>{t.noConversionNotice}</span>
                </div>
              </div>

              {/* Multi-Column Menu Board: Separate columns for Makanan, Minuman, Dessert, Buah, Bakery, Lainnya */}
              <div
                data-testid="menu-category-columns"
                className={`grid gap-6 items-start ${
                  selectedCategory === 'all'
                    ? 'grid-cols-1 md:grid-cols-2'
                    : 'grid-cols-1'
                }`}
              >
                {MENU_CATEGORY_COLUMNS.filter((col) =>
                  selectedCategory === 'all' ? true : col.id === selectedCategory
                ).map((col) => {
                  const colProducts = filteredProducts.filter((p) => p.category === col.id);
                  if (colProducts.length === 0 && selectedCategory === 'all') return null;

                  return (
                    <div
                      key={col.id}
                      data-testid={`menu-column-${col.id}`}
                      className="bg-[var(--surface-card)] border border-slate-500 rounded-3xl p-4 sm:p-5 space-y-4 shadow-sm"
                    >
                      {/* Column Header */}
                      <div className="flex items-center justify-between gap-2 border-b border-[#EAE2D3] pb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${col.accentClass}`}
                            >{' '}{uiText(locale, "Kolom")}{' '}{categoryCopy(col.id, locale).title}
                            </span>
                            <span className="text-xs text-slate-300 font-medium tabular-nums">
                              {colProducts.length} menu
                            </span>
                          </div>
                          <p className="text-xs text-slate-300 mt-1">{categoryCopy(col.id, locale).subtitle}</p>
                        </div>
                      </div>

                      {/* Items inside this Category Column */}
                      {colProducts.length === 0 ? (
                        <div className="p-6 text-center text-xs text-slate-300">{' '}{uiText(locale, "Belum ada menu di kolom")}{' '}{categoryCopy(col.id, locale).title}.
                        </div>
                      ) : (
                        <div
                          className={`grid gap-4 ${
                            selectedCategory === 'all'
                              ? 'grid-cols-1'
                              : 'grid-cols-1 sm:grid-cols-2'
                          }`}
                        >
                          {colProducts.map((product, idx) => {
                            const inCart =
                              validStoreCart.find((i) => i.productId === product.id)?.quantity || 0;
                            const activeAssetPrice = product.priceNimLuna ? `${formatLunaToNim(product.priceNimLuna)} ${nimUnitLabel}` : null;
                            const secondaryAssetPrice = null;

                            const isBroken = brokenImages[product.id];

                            return (
                              <article
                                key={product.id}
                                style={{ animationDelay: `${idx * 45}ms` }}
                                className="group menu-card-live animate-card-in bg-[var(--surface-raised)] border border-slate-500 rounded-2xl p-3 flex items-center justify-between gap-3.5"
                              >
                                <div className="flex items-center gap-3.5 min-w-0">
                                  <div className="relative w-20 h-20 rounded-xl bg-[#EFE6D8] overflow-hidden shrink-0">
                                    {!isBroken ? (
                                      <img
                                        src={product.imageUrl}
                                        alt={product.name}
                                        referrerPolicy="no-referrer"
                                        onError={() =>
                                          setBrokenImages((prev) => ({
                                            ...prev,
                                            [product.id]: true,
                                          }))
                                        }
                                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                                      />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center p-2 text-center">
                                        <span className="font-display text-xs text-[var(--gold-ink)]">
                                          {product.name}
                                        </span>
                                      </div>
                                    )}
                                  </div>

                                  <div className="min-w-0 space-y-1">
                                    <div className="flex items-center gap-1.5 text-[13px] text-slate-300 uppercase tracking-wider">
                                      <span>{categoryCopy(col.id, locale).title}</span>
                                      {inCart > 0 && (
                                        <>
                                          <span aria-hidden="true">·</span>
                                          <span className="text-[var(--teal-ink)] font-bold">
                                            {inCart}{' '}{uiText(locale, "di pesanan")}{' '}</span>
                                        </>
                                      )}
                                    </div>
                                    <h2 className="text-sm sm:text-base font-semibold text-[var(--ink)] truncate">
                                      {product.name}
                                    </h2>
                                    <p className="text-xs text-slate-300 line-clamp-1">
                                      {product.description}
                                    </p>
                                    <div className="flex items-baseline gap-2 tabular-nums pt-0.5">
                                      {activeAssetPrice ? (
                                        <span className="text-sm font-bold text-[var(--gold-ink)]">
                                          {activeAssetPrice}
                                        </span>
                                      ) : (
                                        <span className="text-xs font-medium text-amber-700">
                                          {uiText(locale,'Harga NIM belum tersedia')}
                                        </span>
                                      )}
                                      {secondaryAssetPrice && (
                                        <span className="text-xs text-slate-300">
                                          · {secondaryAssetPrice}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => updateCartQuantity(product.id, 1)}
                                  aria-label={`Add ${product.name} to order`}
                                  className="w-10 h-10 rounded-full bg-[#14B8A6] hover:bg-[#0D9488] active:scale-90 text-[#081018] flex items-center justify-center transition-all shrink-0 cursor-pointer shadow-sm"
                                >
                                  <Plus className="w-5 h-5 stroke-[2.5]" />
                                </button>
                              </article>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* Right 4 Columns: "Your order" Card */}
          <aside
            id="order-panel"
            aria-label="Your order summary"
            className="lg:col-span-4 lg:sticky lg:top-24 bg-[var(--surface-card)] border border-slate-600/90 rounded-2xl p-6 space-y-5 shadow-xl"
          >
            {/* Header row */}
            <div className="flex items-center justify-between">
              <span className="w-8 h-8 rounded-full bg-[var(--surface-raised)] flex items-center justify-center text-slate-300">
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              </span>
              <span className="text-xs text-slate-300 font-mono tabular-nums">
                {store.slug} · {isTestnet ? 'TESTNET' : 'MAINNET'}
              </span>
              <span className="w-8 h-8 rounded-full bg-[var(--surface-raised)] flex items-center justify-center text-slate-300">
                <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
              </span>
            </div>

            <div>
              <h2 className="text-2xl font-semibold text-[var(--ink)] tracking-tight">
                {t.yourOrder}
              </h2>
              <p className="text-xs text-slate-300 mt-0.5 tabular-nums">
                {t.orderNumberLabel} {isTestnet ? '#T-New (Testnet)' : '#New (Mainnet)'} · {store.name}
              </p>
            </div>

            {/* Fulfillment Mode Selector (Dine-in / Pickup / Delivery) */}
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-[var(--surface-base)] rounded-xl border border-slate-600/80">
              {store.supportsDineIn && (
                <button
                  type="button"
                  onClick={() => setFulfillmentMode('dine_in')}
                  className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap truncate cursor-pointer ${
                    fulfillmentMode === 'dine_in'
                      ? 'bg-[var(--surface-raised)] text-[var(--ink)]'
                      : 'text-slate-300 hover:text-slate-200'
                  }`}
                >
                  {t.dineInOption}
                </button>
              )}
              {store.supportsPickup && (
                <button
                  type="button"
                  onClick={() => setFulfillmentMode('pickup')}
                  className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap truncate cursor-pointer ${
                    fulfillmentMode === 'pickup'
                      ? 'bg-[var(--surface-raised)] text-[var(--ink)]'
                      : 'text-slate-300 hover:text-slate-200'
                  }`}
                >
                  {t.pickupOption}
                </button>
              )}
              {store.supportsDelivery && (
                <button
                  type="button"
                  onClick={() => setFulfillmentMode('delivery')}
                  className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap truncate cursor-pointer ${
                    fulfillmentMode === 'delivery'
                      ? 'bg-[var(--surface-raised)] text-[var(--ink)]'
                      : 'text-slate-300 hover:text-slate-200'
                  }`}
                >
                  {t.deliveryOption}
                </button>
              )}
            </div>

            {/* Cart Items List */}
            {validStoreCart.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-300 border border-dashed border-slate-600 rounded-xl px-4">
                {t.emptyCartMessage}
              </div>
            ) : (
              <div className="space-y-3 divide-y divide-slate-800/70">
                {validStoreCart.map((entry) => {
                  const prod = products.find((p) => p.id === entry.productId);
                  if (!prod) return null;
                  const unitPriceStr = prod.priceNimLuna ? `${formatLunaToNim(BigInt(prod.priceNimLuna) * BigInt(entry.quantity))} ${nimUnitLabel}` : `N/A in ${nimUnitLabel}`;

                  return (
                    <div
                      key={entry.productId}
                      className="pt-3 first:pt-0 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex items-center gap-1 bg-[var(--surface-raised)] rounded-lg px-1.5 py-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => updateCartQuantity(prod.id, -1)}
                            aria-label={`Decrease quantity of ${prod.name}`}
                            className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:bg-slate-700 cursor-pointer"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="w-5 text-center text-xs font-semibold tabular-nums">
                            {entry.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateCartQuantity(prod.id, 1)}
                            aria-label={`Increase quantity of ${prod.name}`}
                            className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:bg-slate-700 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-[var(--ink)] truncate">
                            {prod.name}
                          </div>
                          <div className="text-[13px] text-slate-300">
                            {prod.category}
                          </div>
                        </div>
                      </div>

                      <div className="text-sm font-semibold tabular-nums text-right shrink-0">
                        {unitPriceStr}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Order Note or Delivery Form */}
            <div className="space-y-3 pt-1">
              <div>
                <label htmlFor="order-note-input" className="sr-only">
                  {t.orderNotePlaceholder}
                </label>
                <input
                  id="order-note-input"
                  type="text"
                  value={tableOrNote}
                  onChange={(e) => setTableOrNote(e.target.value)}
                  placeholder={t.orderNotePlaceholder}
                  maxLength={120}
                  className="w-full bg-[var(--surface-base)] border border-slate-600 rounded-xl px-3.5 py-2 text-xs text-[var(--ink)] placeholder:text-slate-300 focus-visible:outline-2 focus-visible:outline-[#14B8A6]"
                />
              </div>

              {fulfillmentMode === 'delivery' && (
                <div className="p-3.5 rounded-xl bg-[var(--surface-base)] border border-slate-600 space-y-2.5">
                  <div className="text-[13px] text-slate-300 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-[var(--teal-ink)] shrink-0" />
                    <span>{t.deliveryPrivacyNote}</span>
                  </div>
                  <input
                    type="text"
                    aria-label={t.deliveryNameLabel}
                    placeholder={t.deliveryNameLabel}
                    value={deliveryName}
                    onChange={(e) => setDeliveryName(e.target.value)}
                    className="w-full bg-[var(--surface-card)] border border-slate-500/80 rounded-lg px-3 py-1.5 text-xs text-[var(--ink)]"
                  />
                  <input
                    type="tel"
                    aria-label={t.deliveryPhoneLabel}
                    placeholder={t.deliveryPhoneLabel}
                    value={deliveryPhone}
                    onChange={(e) => setDeliveryPhone(e.target.value)}
                    className="w-full bg-[var(--surface-card)] border border-slate-500/80 rounded-lg px-3 py-1.5 text-xs text-[var(--ink)]"
                  />
                  <textarea
                    rows={2}
                    aria-label={t.deliveryAddressLabel}
                    placeholder={t.deliveryAddressLabel}
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    className="w-full bg-[var(--surface-card)] border border-slate-500/80 rounded-lg px-3 py-1.5 text-xs text-[var(--ink)]"
                  />
                </div>
              )}
            </div>

            {/* Total Row */}
            <div className="pt-3 border-t border-slate-600 flex items-baseline justify-between">
              <span className="text-base font-medium text-slate-300">{t.totalLabel}</span>
              <span
                data-testid="order-total-display"
                className="text-xl font-bold text-[var(--ink)] tabular-nums"
              >
                {calculation.totalFormatted}
              </span>
            </div>

            {/* NIM-only payment method */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-300">
                <span>{t.paymentMethod}</span>
                <span className="font-mono text-[13px] font-semibold">
                  {isTestnet ? 'Lingkungan: TESTNET' : 'Lingkungan: MAINNET'}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2.5">
                <button
                  type="button"
                  data-testid="select-asset-nim"
                  disabled={!store.acceptsNim}
                  onClick={() => setSelectedAsset('NIM')}
                  className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                    selectedAsset === 'NIM'
                      ? 'bg-[var(--surface-selected)]/60 border-[#14B8A6] text-[var(--ink)]'
                      : 'bg-[var(--surface-base)] border-slate-600 text-slate-300 hover:text-slate-200'
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      selectedAsset === 'NIM'
                        ? 'bg-[#14B8A6] text-[#081018]'
                        : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    ✓
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs sm:text-sm font-semibold leading-none truncate">
                      {nimUnitLabel}
                    </div>
                    <div className="text-[13px] text-slate-300 mt-1 truncate">
                      {isTestnet ? 'Nimiq Testnet (ID 5)' : 'Nimiq Mainnet (ID 24)'}
                    </div>
                  </div>
                </button>


              </div>


            </div>

            {/* Incompatible Asset Warning if Cart has Single-Asset Items */}
            {calculation.incompatibleProducts.length > 0 && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-amber-950/60 border border-amber-600/60 text-amber-200 text-xs space-y-1"
              >
                <div className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>{t.incompatibleAssetWarning}</span>
                </div>
                <p className="text-amber-300/90">
                  {calculation.incompatibleProducts.map((item) => item.name).join(', ')} does not
                  have a {selectedAsset} price. Switch payment asset or remove the item before
                  creating payment.
                </p>
              </div>
            )}

            {errorMsg && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-rose-950/70 border border-rose-600/60 text-rose-200 text-xs"
              >
                {errorMsg}
              </div>
            )}

            {/* Primary CTA Button */}
            <button
              type="button"
              disabled={submitting || !calculation.compatible}
              onClick={handleCreateOrder}
              className="w-full py-3.5 px-6 rounded-full bg-[#14B8A6] hover:bg-[#0D9488] disabled:opacity-45 disabled:pointer-events-none text-[#071318] font-semibold text-base transition-colors cursor-pointer shadow-lg"
            >
              {submitting ? 'Creating order...' : t.createPayment}
            </button>

            <div className="text-center space-y-0.5 text-xs text-slate-300">
              <p>{t.directToMerchantNotice}</p>
              <p>{t.noPaymentRequestedYet}</p>
            </div>
          </aside>
        </div>
      </main>

      {/* Mobile Sticky Bottom Cart Bar (Strictly <= 15% viewport height with safe-area padding) */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-[var(--surface-card)] border-t border-slate-600 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between gap-3 max-w-lg mx-auto">
          <button
            type="button"
            onClick={() => {
              setMobileCartOpen(!mobileCartOpen);
              document.getElementById('order-panel')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="flex items-center gap-2.5 text-left min-w-0 cursor-pointer"
          >
            <div className="w-9 h-9 rounded-xl bg-[var(--surface-selected)] text-[var(--teal-ink)] flex items-center justify-center shrink-0">
              <ShoppingBag className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-slate-300 truncate">
                {totalItemsCount} items · {selectedAsset}
              </div>
              <div className="text-sm font-bold text-[var(--ink)] tabular-nums">
                {calculation.totalFormatted}
              </div>
            </div>
          </button>

          <button
            type="button"
            disabled={submitting || !calculation.compatible}
            onClick={handleCreateOrder}
            className="px-5 py-2.5 rounded-full bg-[#14B8A6] hover:bg-[#0D9488] disabled:opacity-45 text-[#071318] font-semibold text-sm whitespace-nowrap shrink-0 cursor-pointer"
          >
            {t.createPayment}
          </button>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-600/80 py-6 px-4 sm:px-8 text-center text-xs text-slate-300 space-y-1">
        <p>
          <span className="text-[var(--gold-ink)] font-medium">NimTera</span> — {t.tagline} ·{' '}
          <span className="font-mono">https://nimtera.store</span>
        </p>
        <p>{t.independentNotice}</p>
      </footer>
    </div>
  );
};
