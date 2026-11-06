import { savedUiLocale, UI_LOCALE_KEY } from './lib/uiLocale';
import { LandingPage } from './components/LandingPage';
import React, { useEffect, useState } from 'react';
import { CustomerStorefront, type PublicStoreInfo } from './components/CustomerStorefront';
import { CustomerCheckout } from './components/CustomerCheckout';
import { SellerConsole, type SellerTab } from './components/SellerConsole';
import { DocsAndPoliciesModal } from './components/DocsAndPoliciesModal';
import type { ProductRecord } from './lib/domain';
import type { SupportedLocale } from './lib/i18n';

type ParsedRoute =
  | { view: 'landing' }
  | { view: 'storefront'; storeSlug: string }
  | { view: 'checkout'; storeSlug: string; publicToken: string }
  | { view: 'seller'; tab: 'login' | 'setup' | SellerTab };

function parsePathname(pathname: string): ParsedRoute {
  const clean = pathname.replace(/\/+$/, '') || '/';

  // Match /s/:slug/order/:token
  const orderMatch = clean.match(/^\/s\/([^/]+)\/order\/([^/]+)$/);
  if (orderMatch) {
    return {
      view: 'checkout',
      storeSlug: decodeURIComponent(orderMatch[1]),
      publicToken: decodeURIComponent(orderMatch[2]),
    };
  }

  // Match /s/:slug
  const storeMatch = clean.match(/^\/s\/([^/]+)$/);
  if (storeMatch) {
    return {
      view: 'storefront',
      storeSlug: decodeURIComponent(storeMatch[1]),
    };
  }

  // Match /seller/*
  if (clean.startsWith('/seller')) {
    const sub = clean.replace(/^\/seller\/?/, '');
    if (sub === 'setup') return { view: 'seller', tab: 'setup' };
    if (sub === 'counter' || sub === 'dashboard') return { view: 'seller', tab: 'counter' };
    if (sub === 'orders') return { view: 'seller', tab: 'orders' };
    if (sub === 'products') return { view: 'seller', tab: 'products' };
    if (sub === 'reports') return { view: 'seller', tab: 'reports' };
    if (sub === 'settings') return { view: 'seller', tab: 'settings' };
    return { view: 'seller', tab: 'login' };
  }

  return { view: 'landing' };
}

export default function App() {
  const [route, setRoute] = useState<ParsedRoute>(() =>
    typeof window !== 'undefined'
      ? parsePathname(window.location.pathname)
      : { view: 'landing' }
  );
  const [locale, setLocale] = useState<SupportedLocale>(() => { try { return savedUiLocale(window.localStorage); } catch { return 'en'; } });
  useEffect(() => {
    document.documentElement.lang = locale;
    try { window.localStorage.setItem(UI_LOCALE_KEY, locale); } catch {}
  }, [locale]);
  const [docsOpen, setDocsOpen] = useState(false);

  const [storeInfo, setStoreInfo] = useState<PublicStoreInfo>({
    slug: 'moonlight-cafe',
    name: '',
    activeEnvironment: 'testnet',
    acceptsNim: true,
    acceptsUsdt: true,
    acceptsTestnetNim: true,
    acceptsTestnetUsdt: true,
    hasAmoyTestTokenContract: false,
    polygonAmoyTestTokenContract: null,
    supportsPickup: true,
    supportsDelivery: true,
    supportsDineIn: true,
    defaultLocale: 'en',
  });
  const [storeProducts, setStoreProducts] = useState<ProductRecord[]>([]);
  const [storeLoadError, setStoreLoadError] = useState('');
  const [storeLoaded, setStoreLoaded] = useState(false);

  const navigate = (nextPath: string) => {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', nextPath);
      setRoute(parsePathname(nextPath));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    const onPopState = () => {
      setRoute(parsePathname(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Load public store catalog whenever viewing a storefront
  useEffect(() => {
    if (route.view !== 'storefront') return;
    const slug = route.storeSlug;
    let current = true;
    setStoreLoadError(''); setStoreLoaded(false); setStoreProducts([]);
    fetch(`/api/public/stores/${encodeURIComponent(slug)}`)
      .then(async r => { if (!r.ok) throw new Error('This shop is not available. Open your seller-provided shop link, or create your own testnet shop.'); return r.json(); })
      .then((data) => {
        if (current && data.store) {
          setStoreInfo(data.store); setStoreLoaded(true);
          setStoreProducts(data.products || []);
        }
      })
      .catch(error => { if (current) setStoreLoadError(error.message || 'Unable to load shop'); });
    return () => { current = false; };
  }, [route]);

  return (
    <>
      {route.view === 'landing' && <LandingPage navigate={navigate} />}
      {route.view === 'storefront' && storeLoadError && <main className="min-h-screen bg-[#0B101C] text-white grid place-items-center p-6"><section className="max-w-lg space-y-5"><h1 className="text-4xl text-[#DFC496]">NimTera</h1><p>Testnet beta · No mainnet payments</p><p>{storeLoadError}</p><button className="bg-teal-500 text-slate-950 rounded-xl p-3" onClick={() => navigate('/seller/setup')}>Create a testnet shop</button><button className="block underline" onClick={() => navigate('/seller/login')}>Seller login</button></section></main>}
      {route.view === 'storefront' && !storeLoadError && !storeLoaded && <main className="min-h-screen bg-[#0B101C] text-[#DFC496] grid place-items-center">Loading shop…</main>}
      {route.view === 'storefront' && !storeLoadError && storeLoaded && (
        <CustomerStorefront
          store={storeInfo}
          products={storeProducts}
          locale={locale}
          onChangeLocale={setLocale}
          onSwitchStore={(slug) => navigate(`/s/${slug}`)}
          onNavigateSellerLogin={() => navigate('/seller/login')}
          onOpenDocsModal={() => setDocsOpen(true)}
          onOrderCreated={(publicToken) =>
            navigate(`/s/${storeInfo.slug}/order/${publicToken}`)
          }
        />
      )}

      {route.view === 'checkout' && (
        <CustomerCheckout
          publicToken={route.publicToken}
          locale={locale}
          onChangeLocale={setLocale}
          onBackToStore={(slug) => navigate(`/s/${slug}`)}
        />
      )}

      {route.view === 'seller' && (
        <SellerConsole
          activeRoute={route.tab}
          locale={locale}
          onChangeLocale={setLocale}
          onNavigateTab={(tab) => navigate(`/seller/${tab}`)}
          onOpenStorefront={(slug) => navigate(`/s/${slug}`)}
          onOpenOrderCheckout={(slug, token) => navigate(`/s/${slug}/order/${token}`)}
          onOpenDocsModal={() => setDocsOpen(true)}
        />
      )}

      <DocsAndPoliciesModal open={docsOpen} onClose={() => setDocsOpen(false)} />
    </>
  );
}
