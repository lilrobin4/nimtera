import {AUTO_PAYMENT_COPY} from '../lib/automaticPaymentCopy';
import {AddressPaymentReview} from './AddressPaymentReview';
import {WalletAuthPanel} from './WalletAuthPanel';
import {WalletAccountSettings} from './WalletAccountSettings';
import {WALLET_COPY} from '../lib/walletCopy';
import { CashierAudioSettings, useCashierAudioStatus } from './CashierAudioSettings';
import { StoreLogoSettings } from './StoreLogoSettings';
import { PRODUCT_IMAGE_PRESETS } from '../lib/productImages';
import { ProductImagePicker } from './ProductImagePicker';
import { COOKIE_SESSION, legacySellerToken, clearLegacySellerToken, sellerAuthHeaders } from '../lib/sellerSession';
import { uiText, uiChoice, categoryCopy } from '../lib/uiLocale';
import { SecuritySettings, optional2faHint } from './SecuritySettings';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutGrid,
  ReceiptText,
  Tag,
  BarChart3,
  Settings,
  Search,
  Plus,
  Minus,
  Volume2,
  VolumeX,
  Globe,
  LogOut,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Download,
  Lock,
  Info,
  ArrowRight,
  KeyRound,
  Pencil,
  Trash2,
  Sparkles,
  X,
} from 'lucide-react';
import {
  calculateCartTotals,
  DEFAULT_NETWORK_ENV,
  formatAssetAmount,
  formatLunaToNim,
  isActiveNimOrder,
  MENU_CATEGORY_COLUMNS,
  parseNimToLuna,
  shouldTriggerAudioAnnouncement,
  type CartItemInput,
  type FulfillmentStatus,
  type NetworkEnvironment,
  type OrderSnapshot,
  type PaymentAsset,
  type ProductCategory,
  type ProductRecord,
} from '../lib/domain';
import { LOCALE_METADATA, TRANSLATIONS, type SupportedLocale } from '../lib/i18n';
import { cashierAudio } from '../lib/audio';
import { BrandLogo } from './BrandLogo';
import { OrderStatusBadge } from './ui/OrderStatusBadge';

export type SellerTab = 'counter' | 'orders' | 'products' | 'reports' | 'settings';


interface StoreRecord {
  logoUrl?: string;
  slug: string;
  name: string;
  activeEnvironment?: NetworkEnvironment;
  nimiqAddress: string | null;
  nimiqTestnetAddress?: string | null;
  supportsPickup: boolean;
  supportsDelivery: boolean;
  supportsDineIn: boolean;
  defaultLocale: SupportedLocale;
  voiceLocale: SupportedLocale;
}

interface AuditLogEntry {
  id: string;
  storeSlug: string;
  sellerEmail: string;
  action: string;
  details: string;
  oldValue?: string;
  newValue?: string;
  createdAt: string;
}

interface SellerConsoleProps {
  activeRoute: 'login' | 'setup' | SellerTab;
  locale: SupportedLocale;
  onChangeLocale: (locale: SupportedLocale) => void;
  onNavigateTab: (tab: 'login' | 'setup' | SellerTab) => void;
  onOpenStorefront: (slug: string) => void;
  onOpenOrderCheckout: (slug: string, publicToken: string) => void;
  onOpenDocsModal: () => void;
}

export const SellerConsole: React.FC<SellerConsoleProps> = ({
  activeRoute,
  locale,
  onChangeLocale,
  onNavigateTab,
  onOpenStorefront,
  onOpenOrderCheckout,
  onOpenDocsModal,
}) => {
  const t = TRANSLATIONS[locale] || TRANSLATIONS.en;

  // Session state
  const [sessionToken, setSessionTokenState] = useState<string | null>(legacySellerToken);
  const sessionRevision = useRef(0);
  const setSessionToken = (token: string | null) => { sessionRevision.current++; setSessionTokenState(token); };
  const [sessionChecked, setSessionChecked] = useState(false);
  const [sessionRestoreError, setSessionRestoreError] = useState(false);
  const [sessionRestoreAttempt, setSessionRestoreAttempt] = useState(0);
  const [sellerEmail, setSellerEmail] = useState<string>('');
  const [store, setStore] = useState<StoreRecord | null>(null);
  const [activeEnv, setActiveEnv] = useState<NetworkEnvironment>(DEFAULT_NETWORK_ENV);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [orders, setOrders] = useState<OrderSnapshot[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [metrics, setMetrics] = useState<{
    confirmedNimFormatted: string;
    confirmedOrdersCount: number;
    totalOrdersCount: number;
  } | null>(null);
  const [testnetMetrics, setTestnetMetrics] = useState<{
    confirmedNimFormatted: string;
    confirmedOrdersCount: number;
    totalOrdersCount: number;
  } | null>(null);
  const [mainnetReadiness, setMainnetReadiness] = useState<{
    readyForMainnet: boolean;
    checks: Record<string, boolean>;
    warning: string;
  } | null>(null);

  // Login & Setup form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginTotp, setLoginTotp] = useState('');
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Inline Restaurant Name Editor in Seller Header
  const [editingRestoName, setEditingRestoName] = useState(false);
  const [restoNameDraft, setRestoNameDraft] = useState('');

  // Onboarding / New Store Registration state
  const [regStoreName, setRegStoreName] = useState('');
  const [regStoreSlug, setRegStoreSlug] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regNimiqAddr, setRegNimiqAddr] = useState('');
  const [regPickup, setRegPickup] = useState(true);
  const [regDelivery, setRegDelivery] = useState(false);

  // Cashier POS state
  const [posCategory, setPosCategory] = useState<'all' | ProductCategory>('all');
  const [posSearch, setPosSearch] = useState('');
  const [posAsset, setPosAsset] = useState<PaymentAsset>('NIM');
  const [posTableNote, setPosTableNote] = useState('Dine-in · Table 7');
  const [posCart, setPosCart] = useState<CartItemInput[]>([
    { productId: 'prod_iced_latte', quantity: 2 },
    { productId: 'prod_croissant', quantity: 1 },
  ]);
  const [posSubmitting, setPosSubmitting] = useState(false);
  const [posError, setPosError] = useState<string | null>(null);

  // Product & Menu Price Manager state (Create + Edit + Delete)
  const [editingProdId, setEditingProdId] = useState<string | null>(null);
  const [showPosMenuForm, setShowPosMenuForm] = useState(false);
  const [newProdName, setNewProdName] = useState('');
  const [newProdDesc, setNewProdDesc] = useState('');
  const [newProdCat, setNewProdCat] = useState<ProductCategory>('food');
  const [newProdNim, setNewProdNim] = useState('40');
  const [newProdImg, setNewProdImg] = useState(PRODUCT_IMAGE_PRESETS[0].url);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [prodFeedback, setProdFeedback] = useState<string | null>(null);

  // Reports date filter state
  const [reportDateFilter, setReportDateFilter] = useState<'all' | 'today' | '7d'>('all');

  // Wallet & Settings state (Separated Testnet and Mainnet Profiles)
  const [walletNimInput, setWalletNimInput] = useState('');
  const [walletTestnetNimInput, setWalletTestnetNimInput] = useState('');
  const [walletConfirmPass, setWalletConfirmPass] = useState('');
  const [walletConfirmTotp, setWalletConfirmTotp] = useState('');
  const [walletFeedback, setWalletFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(
    null
  );

  // Feedback is a snapshot of the language at action time, not merchant content.
  useEffect(() => {
    setAuthError(null);
    setPosError(null);
    setProdFeedback(null);
    setWalletFeedback(null);
  }, [locale]);

  // Audio preferences are scoped to the shop; browser unlock remains an explicit gesture.
  const audioStatus=useCashierAudioStatus();
  const {unlocked:audioUnlocked,muted:audioMuted}=audioStatus;
  const audioActive=audioUnlocked&&!audioMuted&&audioStatus.volume>0&&audioStatus.isPrimaryDevice;
  useEffect(()=>{if(store?.slug)cashierAudio.setScope(store.slug,store.voiceLocale||locale);else cashierAudio.stop();},[store?.slug]);
  useEffect(()=>()=>cashierAudio.stop(),[]);
  const announcedEventsRef = useRef<Set<string>>(new Set());
  const sessionStartMsRef = useRef<number>(Date.now());

  const fetchDashboardData = async (tokenToUse = sessionToken) => {
    if (!tokenToUse) return;
    const revision = sessionRevision.current;
    try {
      const resp = await fetch('/api/seller/dashboard', {
        headers: { ...sellerAuthHeaders(tokenToUse) },
      });
      if (revision !== sessionRevision.current) return;
      if (resp.status === 401) {
        clearLegacySellerToken();
        setSessionToken(null);

        onNavigateTab('login');
        return;
      }
      if (!resp.ok) return;
      const data = await resp.json();
      setStore(data.store);
      if (data.store?.activeEnvironment) {
        setActiveEnv(data.store.activeEnvironment);
      }
      if(data.security)setMfaEnabled(data.security.totpEnabled===true);
      setProducts(data.products || []);
      setAuditLogs(data.auditLogs || []);
      setMetrics(data.metrics || null);
      setTestnetMetrics(data.testnetMetrics ? {confirmedNimFormatted:data.testnetMetrics.confirmedNimTestnetFormatted,confirmedOrdersCount:data.testnetMetrics.confirmedTestnetOrdersCount,totalOrdersCount:data.testnetMetrics.totalTestnetOrdersCount} : null);

      const incomingOrders: OrderSnapshot[] = data.orders || [];
      setOrders(incomingOrders);

      // Initialize separated Mainnet and Testnet wallet form inputs once
      setWalletNimInput((prev) => prev || data.store?.nimiqAddress || '');
      setWalletTestnetNimInput(
        (prev) => prev || data.store?.nimiqTestnetAddress || ''
      );

      // Check for newly confirmed orders in the active environment to trigger deduplicated audio announcement
      const currentEnv = data.store?.activeEnvironment || 'testnet';
      for (const ord of incomingOrders) {
        const ordEnv =
          ord.environment ||
          (ord.network === 'nimiq-testnet'
            ? 'testnet'
            : 'mainnet');
        if (isActiveNimOrder(ord) && ord.paymentStatus === 'confirmed' && ordEnv === currentEnv) {
          const shouldPlay = shouldTriggerAudioAnnouncement({
            orderId: `${ordEnv}_${ord.id}`,
            eventType: 'payment_confirmed',
            orderCreatedAtIso: ord.verifiedAt || ord.createdAt,
            sessionStartedAtMs: sessionStartMsRef.current,
            announcedKeys: announcedEventsRef.current,
          });
          if (shouldPlay && ord.verifiedAt && Date.parse(ord.verifiedAt) >= sessionStartMsRef.current - 10_000) {
            cashierAudio.announcePaymentConfirmed(
              ordEnv === 'testnet' ? `[TESTNET] ${ord.amountFormatted}` : ord.amountFormatted,
              ord.orderNumber
            );
          }
        }
      }
    } catch {
      // Ignore transient poll error
    }
  };

  useEffect(() => {
    let live = true;
    setSessionRestoreError(false);
    const restore = async () => {
      try {
        let response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store', headers: sellerAuthHeaders(legacySellerToken()) });
        if (response.status === 401 && legacySellerToken()) response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
        if (!live) return;
        if (response.status === 401) { clearLegacySellerToken(); setSessionToken(null); setSessionChecked(true); return; }
        if (!response.ok) throw new Error('Session service unavailable');
        const data = await response.json();
        if (!live) return;
        clearLegacySellerToken(); setSessionToken(COOKIE_SESSION);
        setSellerEmail(data.seller.email); setStore(data.store); setRestoNameDraft(data.store.name);
        setActiveEnv(data.store.activeEnvironment || 'testnet');
        setMfaEnabled(data.seller.totpEnabled===true);
        if (activeRoute === 'login' || activeRoute === 'setup') onNavigateTab('counter');
        setSessionChecked(true);
      } catch { if (live) setSessionRestoreError(true); }
    };
    void restore();
    return () => { live = false; sessionRevision.current++; };
  }, [sessionRestoreAttempt]);

  useEffect(() => {
    if (!sessionToken || !sessionChecked) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await fetchDashboardData(sessionToken); if (!stopped) timer = setTimeout(poll, 4000); };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [sessionToken, sessionChecked]);

  const handleSwitchEnvironment = async (nextEnv: NetworkEnvironment) => {
    if (!sessionToken) return;
    setActiveEnv(nextEnv);
    try {
      const resp = await fetch('/api/seller/network-environment', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...sellerAuthHeaders(sessionToken),
        },
        body: JSON.stringify({ environment: nextEnv }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setStore(data.store);
        setActiveEnv(data.store.activeEnvironment || nextEnv);
      }
    } catch {
      // Ignore network hiccup
    }
  };

  const handleCheckMainnetReadiness = async () => {
    if (!sessionToken) return;
    try {
      const resp = await fetch('/api/seller/mainnet-readiness', {
        headers: { ...sellerAuthHeaders(sessionToken) },
      });
      if (resp.ok) {
        const data = await resp.json();
        setMainnetReadiness(data);
      }
    } catch {
      // Ignore network hiccup
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      const resp = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword,
          totpCode: loginTotp,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setAuthError(data.error || 'Login failed.');
        setAuthLoading(false);
        return;
      }
      clearLegacySellerToken();
      setSessionToken(COOKIE_SESSION);
      setSellerEmail(data.seller.email);
      setStore(data.store);
      setActiveEnv(data.store?.activeEnvironment || 'testnet');
      setRestoNameDraft(data.store?.name || '');
      setWalletNimInput(data.store?.nimiqAddress || '');
      setWalletTestnetNimInput(
        data.store?.nimiqTestnetAddress || ''
      );
      setAuthLoading(false);
      setMfaEnabled(data.seller.totpEnabled===true);
      await fetchDashboardData(COOKIE_SESSION);
      onNavigateTab('counter');
    } catch {
      setAuthError('Network error while signing in.');
      setAuthLoading(false);
    }
  };

  const handleSaveRestoNameInline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionToken || !restoNameDraft.trim()) return;
    try {
      const resp = await fetch('/api/seller/store-name', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...sellerAuthHeaders(sessionToken),
        },
        body: JSON.stringify({ storeName: restoNameDraft.trim() }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setStore(data.store);
        setEditingRestoName(false);
      }
    } catch {
      // Ignore network hiccup
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      const resp = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: regEmail,
          password: regPassword,
          storeName: regStoreName,
          storeSlug: regStoreSlug,
          nimiqAddress: regNimiqAddr,
          supportsPickup: regPickup,
          supportsDelivery: regDelivery,
          defaultLocale: locale,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setAuthError(data.error || 'Store setup failed.');
        setAuthLoading(false);
        return;
      }
      clearLegacySellerToken();
      setSessionToken(COOKIE_SESSION);
      setSellerEmail(data.seller.email);
      setStore(data.store);
      setAuthLoading(false);
      setMfaEnabled(data.seller.totpEnabled===true);
      await fetchDashboardData(COOKIE_SESSION);
      onNavigateTab('counter');
    } catch {
      setAuthError('Network error during store registration.');
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    cashierAudio.stop();
    sessionRevision.current++;
    if (sessionToken) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sellerAuthHeaders(sessionToken) },
        body: JSON.stringify({}),
      }).catch(() => {});
    }
    clearLegacySellerToken();
    setSessionToken(null);

    setStore(null);
    onNavigateTab('login');
  };

  // Cashier POS Cart Logic
  const validPosCart = useMemo(() => {
    const ids = new Set(products.map((p) => p.id));
    return posCart.filter((c) => ids.has(c.productId) && c.quantity > 0);
  }, [posCart, products]);

  const posCalculation = useMemo(
    () => calculateCartTotals(validPosCart, products, posAsset, activeEnv),
    [validPosCart, products, posAsset, activeEnv]
  );

  const filteredPosProducts = useMemo(() => {
    return products.filter((p) => {
      if (posCategory !== 'all' && p.category !== posCategory) return false;
      if (posSearch.trim()) {
        const q = posSearch.toLowerCase();
        return p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
      }
      return true;
    });
  }, [products, posCategory, posSearch]);

  const updatePosQty = (productId: string, delta: number) => {
    setPosError(null);
    setPosCart((prev) => {
      const existing = prev.find((i) => i.productId === productId);
      if (!existing) {
        return delta > 0 ? [...prev, { productId, quantity: delta }] : prev;
      }
      const next = existing.quantity + delta;
      if (next <= 0) return prev.filter((i) => i.productId !== productId);
      return prev.map((i) => (i.productId === productId ? { ...i, quantity: next } : i));
    });
  };

  const handlePosCreatePayment = async () => {
    if (!store || !posCalculation.compatible) {
      setPosError(t.incompatibleAssetWarning);
      return;
    }
    setPosSubmitting(true);
    setPosError(null);
    try {
      const resp = await fetch(`/api/public/stores/${encodeURIComponent(store.slug)}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: validPosCart,
          asset: posAsset,
          environment: activeEnv,
          fulfillmentMode: 'dine_in',
          tableOrNote: posTableNote,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setPosError(data.error || 'Could not create order.');
        setPosSubmitting(false);
        return;
      }
      setPosSubmitting(false);
      // Trigger single invoice-ready chime + voice announcement on Cashier
      if (
        shouldTriggerAudioAnnouncement({
          orderId: `${activeEnv}_${data.order.id}`,
          eventType: 'payment_ready',
          orderCreatedAtIso: data.order.createdAt,
          sessionStartedAtMs: sessionStartMsRef.current,
          announcedKeys: announcedEventsRef.current,
        })
      ) {
        cashierAudio.announcePaymentReady(
          activeEnv === 'testnet'
            ? `[TESTNET] ${data.order.amountFormatted}`
            : data.order.amountFormatted,
          data.order.orderNumber
        );
      }
      await fetchDashboardData();
      onOpenOrderCheckout(store.slug, data.order.publicToken);
    } catch {
      setPosError('Network error creating payment.');
      setPosSubmitting(false);
    }
  };

  const handleUpdateFulfillment = async (
    orderId: string,
    fulfillmentStatus?: FulfillmentStatus,
    manualPaymentNote?: string
  ) => {
    if (!sessionToken) return;
    await fetch(`/api/seller/orders/${encodeURIComponent(orderId)}/fulfillment`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...sellerAuthHeaders(sessionToken),
      },
      body: JSON.stringify({ fulfillmentStatus, manualPaymentNote }),
    });
    await fetchDashboardData();
  };

  const handleStartEditProduct = (prod: ProductRecord, openInPos = false) => {
    if (photoBusy) return;
    setEditingProdId(prod.id);
    setNewProdName(prod.name);
    setNewProdDesc(prod.description || '');
    setNewProdCat(prod.category);
    setNewProdNim(prod.priceNimLuna ? formatLunaToNim(prod.priceNimLuna) : '');
    setNewProdImg(prod.imageUrl || PRODUCT_IMAGE_PRESETS[0].url);
    setProdFeedback(null);
    if (openInPos) {
      setShowPosMenuForm(true);
    }
  };

  const handleResetProductForm = () => {
    if (photoBusy) return;
    setEditingProdId(null);
    setNewProdName('');
    setNewProdDesc('');
    setNewProdCat('drinks');
    setNewProdNim('40');
    setNewProdImg(PRODUCT_IMAGE_PRESETS[0].url);
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionToken || photoBusy) return;
    setProdFeedback(null);
    const nimLuna = newProdNim.trim() ? parseNimToLuna(newProdNim) : null;

    if (newProdNim.trim() && !nimLuna) {
      setProdFeedback(uiText(locale, "Format harga NIM tidak valid (maksimal 5 desimal)."));
      return;
    }
    if (!nimLuna) { setProdFeedback(uiText(locale,'Harga NIM wajib diisi.')); return; }

    const isEditing = Boolean(editingProdId);
    const endpoint = isEditing
      ? `/api/seller/products/${encodeURIComponent(editingProdId!)}`
      : '/api/seller/products';
    const method = isEditing ? 'PUT' : 'POST';

    const resp = await fetch(endpoint, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...sellerAuthHeaders(sessionToken),
      },
      body: JSON.stringify({
        name: newProdName,
        description: newProdDesc,
        category: newProdCat,
        imageUrl: newProdImg,
        available: true,
        priceNimLuna: nimLuna ? nimLuna.toString() : null,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      setProdFeedback(data.error || uiText(locale, "Gagal menyimpan menu & harga."));
      return;
    }
    handleResetProductForm();
    setProdFeedback(
      isEditing
        ? uiChoice(locale, `✓ Menu & harga "${data.product.name}" berhasil diperbarui!`, `✓ Item and prices "${data.product.name}" updated successfully!`)
        : uiChoice(locale, `✓ Menu baru "${data.product.name}" berhasil ditambahkan ke katalog!`, `✓ New item "${data.product.name}" added to the catalog!`)
    );
    await fetchDashboardData();
  };

  const handleDeleteProduct = async (prodId: string) => {
    if (!sessionToken) return;
    const resp = await fetch(`/api/seller/products/${encodeURIComponent(prodId)}`, {
      method: 'DELETE',
      headers: {
        ...sellerAuthHeaders(sessionToken),
      },
    });
    if (resp.ok) {
      if (editingProdId === prodId) {
        handleResetProductForm();
      }
      setProdFeedback(uiText(locale, "Menu berhasil dihapus dari katalog."));
      await fetchDashboardData();
    }
  };

  const handleToggleProductAvailability = async (prod: ProductRecord) => {
    if (!sessionToken) return;
    await fetch(`/api/seller/products/${encodeURIComponent(prod.id)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...sellerAuthHeaders(sessionToken),
      },
      body: JSON.stringify({ available: !prod.available }),
    });
    await fetchDashboardData();
  };

  const handleWalletSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionToken) return;
    setWalletFeedback(null);
    const resp = await fetch('/api/seller/wallets', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...sellerAuthHeaders(sessionToken),
      },
      body: JSON.stringify({
        currentPassword: walletConfirmPass,
        totpCode: walletConfirmTotp,
        nimiqAddress: walletNimInput,
        nimiqTestnetAddress: walletTestnetNimInput,
        activeEnvironment: activeEnv,
        storeName: store?.name,
        defaultLocale: locale,
        voiceLocale:audioStatus.voiceLocale,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      setWalletFeedback({ type: 'err', msg: data.error || 'Failed to update wallet settings.' });
      return;
    }
    setStore(data.store);
    setAuditLogs(data.auditLogs || []);
    setWalletConfirmPass('');
    setWalletFeedback({
      type: 'ok',
      msg: uiText(locale, "Profil wallet Testnet & Mainnet berhasil diverifikasi dan disimpan secara terpisah. Pesanan yang sudah dibuat tetap mengunci alamat wallet saat pesanan dibuat."),
    });
  };

  const handleExportCsv = () => {
    const headers = [
      'OrderNumber',
      'Environment',
      'CreatedAt',
      'AssetLabel',
      'Network',
      'AmountBaseUnits',
      'AmountFormatted',
      'SnapshotRecipient',
      'PaymentStatus',
      'FulfillmentStatus',
      'TxHash',
    ];
    const rows = filteredOrdersForReports.map((o) =>
      [
        o.orderNumber,
        o.environment || (o.network === 'nimiq-testnet' ? 'testnet' : 'mainnet'),
        o.createdAt,
        o.assetLabel || o.asset,
        o.network,
        o.amountBase,
        o.amountFormatted,
        `"${o.snapshotRecipient}"`,
        o.paymentStatus,
        o.fulfillmentStatus,
        o.txHash || '',
      ].join(',')
    );
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nimtera-${store?.slug || 'store'}-${activeEnv}-orders.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredOrdersForReports = useMemo(() => {
    const now = Date.now();
    return orders.filter((o) => {
      if (reportDateFilter === 'today') {
        return now - Date.parse(o.createdAt) <= 24 * 3600 * 1000;
      }
      if (reportDateFilter === '7d') {
        return now - Date.parse(o.createdAt) <= 7 * 24 * 3600 * 1000;
      }
      return true;
    });
  }, [orders, reportDateFilter]);

  // ============================================================================
  // UN-AUTHENTICATED VIEW: SELLER LOGIN OR ONBOARDING SETUP
  // ============================================================================
  if (!sessionChecked) return <main className="min-h-screen bg-[var(--surface-base)] text-slate-200 grid place-items-center p-6"><section role="status" className="space-y-4 text-center"><p>{sessionRestoreError ? uiChoice(locale, 'Koneksi sesi belum tersedia. Sesi Anda tidak dihapus.', 'Session connection is unavailable. Your session has not been cleared.') : uiChoice(locale, 'Memulihkan sesi toko…', 'Restoring your shop session…')}</p>{sessionRestoreError && <button className="rounded-xl bg-teal-400 text-slate-950 px-5 py-2" onClick={() => { setSessionRestoreError(false); setSessionRestoreAttempt(value => value + 1); }}>{uiChoice(locale, 'Coba lagi', 'Try again')}</button>}</section></main>;



  if (!sessionToken) {
    const isSetup = activeRoute === 'setup';
    return (
      <div className="min-h-screen bg-[var(--surface-base)] text-[var(--ink)] flex flex-col justify-between p-4 sm:p-8">
        <header className="max-w-5xl w-full mx-auto flex flex-wrap gap-3 items-center justify-between">
          <BrandLogo
            variant="champagne"
            size="md"
            onClick={() => onOpenStorefront('moonlight-cafe')}
          />
          <div className="flex items-center gap-3">
            <select
              aria-label="Language"
              value={locale}
              onChange={(e) => onChangeLocale(e.target.value as SupportedLocale)}
              className="bg-[var(--surface-card)] border border-slate-500 rounded-lg px-2.5 py-1.5 text-xs text-[var(--ink)]"
            >
              {(Object.keys(LOCALE_METADATA) as SupportedLocale[]).map((loc) => (
                <option key={loc} value={loc}>
                  {LOCALE_METADATA[loc].label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => onOpenStorefront('moonlight-cafe')}
              className="px-3.5 py-1.5 rounded-lg bg-[var(--surface-card)] border border-slate-500 text-xs font-medium text-slate-300 hover:text-white cursor-pointer"
            >
              ← Storefront
            </button>
          </div>
        </header>

        <main className="my-auto py-8 flex items-center justify-center">
          <div className="w-full max-w-lg bg-[var(--surface-card)] border border-slate-600 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-slate-600 pb-4">
              <div>
                <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[var(--gold-ink)]">
                  {isSetup ? t.sellerSetupTitle : t.sellerLoginTitle}
                </h1>
                <p className="text-xs text-slate-300 mt-1">
                  {WALLET_COPY[locale].subtitle}
                </p>
              </div>
              <Lock className="w-6 h-6 text-[var(--teal-ink)] shrink-0" />
            </div>

            <WalletAuthPanel locale={locale} mode={isSetup ? 'register' : 'login'} />
            <p className="text-xs text-slate-300 text-center">{WALLET_COPY[locale].emailRoute}</p>

            {/* Authentication security status */}
            <div className="p-3.5 rounded-xl bg-[var(--surface-base)] border border-slate-600/90 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-[var(--teal-ink)]" />
                  <span>Security & Verification Status</span>
                </span>
                <span className="text-[13px] font-mono text-[var(--teal-ink)]">
                  Password · optional 2FA
                </span>
              </div>
              <p className="text-slate-300 text-[13px] leading-relaxed">Strong passwords and login-attempt limits protect seller accounts. You can enable optional 2FA later in Settings → Security.</p>


            </div>

            {!isSetup ? (
              <form onSubmit={handleLoginSubmit} className="space-y-4">

                <div>
                  <label
                    htmlFor="seller-email-input"
                    className="block text-xs font-medium text-slate-300 mb-1"
                  >
                    {t.emailLabel}
                  </label>
                  <input
                    id="seller-email-input"
                    type="email"
                    autoComplete="username"
                    required
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    className="w-full bg-[var(--surface-base)] border border-slate-500 rounded-xl px-3.5 py-2.5 text-sm text-[var(--ink)]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="seller-password-input"
                    className="block text-xs font-medium text-slate-300 mb-1"
                  >
                    {t.passwordLabel}
                  </label>
                  <input
                    id="seller-password-input"
                    type="password"
                    autoComplete="current-password"
                    required
                    minLength={15}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    className="w-full bg-[var(--surface-base)] border border-slate-500 rounded-xl px-3.5 py-2.5 text-sm text-[var(--ink)]"
                  />
                  <p className="text-[13px] text-slate-300 mt-1">{t.passwordPolicyHint}</p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label
                      htmlFor="seller-totp-input"
                      className="text-xs font-medium text-slate-300"
                    >
                      {t.totpCodeLabel}
                    </label>

                  </div>
                  <input
                    id="seller-totp-input"
                    type="text"
                    inputMode="numeric"
                    pattern="\d{6}"
                    value={loginTotp}
                    onChange={(e) => setLoginTotp(e.target.value)}
                    placeholder="6-digit code"
                    className="w-full bg-[var(--surface-base)] border border-slate-500 rounded-xl px-3.5 py-2.5 text-sm font-mono tracking-widest text-[var(--ink)]"
                  />
                  <p className="text-xs text-slate-300 mt-1">{optional2faHint(locale)}</p>
                </div>

                {authError && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-rose-950/70 border border-rose-700 text-rose-200 text-xs"
                  >
                    {authError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full py-3 px-6 rounded-xl bg-[#14B8A6] hover:bg-[#0D9488] text-[#071318] font-semibold text-sm transition-colors cursor-pointer"
                >
                  {authLoading ? 'Verifying session...' : t.signInBtn}
                </button>

                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthError(null);
                      onNavigateTab('setup');
                    }}
                    className="text-xs text-[var(--gold-ink)] hover:underline cursor-pointer"
                  >
                    New merchant? Configure your store & wallets once →
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Store Name
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Lantern Tea House"
                      value={regStoreName}
                      onChange={(e) => {
                        setRegStoreName(e.target.value);
                        if (!regStoreSlug) {
                          setRegStoreSlug(
                            e.target.value
                              .toLowerCase()
                              .replace(/[^a-z0-9]+/g, '-')
                              .replace(/^-|-$/g, '')
                          );
                        }
                      }}
                      className="w-full bg-[var(--surface-base)] border border-slate-500 rounded-xl px-3 py-2 text-xs text-[var(--ink)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Unique Store Slug (/s/slug)
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="lantern-tea"
                      value={regStoreSlug}
                      onChange={(e) => setRegStoreSlug(e.target.value)}
                      className="w-full bg-[var(--surface-base)] border border-slate-500 rounded-xl px-3 py-2 text-xs font-mono text-[var(--ink)]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {t.emailLabel}
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="owner@lanterntea.store"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    className="w-full bg-[var(--surface-base)] border border-slate-500 rounded-xl px-3 py-2 text-xs text-[var(--ink)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {t.passwordLabel}
                  </label>
                  <input
                    type="password"
                    required
                    minLength={15}
                    placeholder="At least 15 characters..."
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    className="w-full bg-[var(--surface-base)] border border-slate-500 rounded-xl px-3 py-2 text-xs text-[var(--ink)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Nimiq Testnet Recipient Address (NQ... MOD-97-10 validated)
                  </label>
                  <input
                    type="text"
                    placeholder="NQ..."
                    value={regNimiqAddr}
                    onChange={(e) => setRegNimiqAddr(e.target.value)}
                    className="w-full bg-[var(--surface-base)] border border-slate-500 rounded-xl px-3 py-2 text-xs font-mono text-[var(--ink)]"
                  />
                </div>



                <div className="flex items-center gap-4 text-xs text-slate-300">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={regPickup}
                      onChange={(e) => setRegPickup(e.target.checked)}
                      className="accent-[#14B8A6]"
                    />
                    <span>Enable Pickup</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={regDelivery}
                      onChange={(e) => setRegDelivery(e.target.checked)}
                      className="accent-[#14B8A6]"
                    />
                    <span>Enable Delivery</span>
                  </label>
                </div>

                {authError && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-rose-950/70 border border-rose-700 text-rose-200 text-xs"
                  >
                    {authError}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full py-3 px-6 rounded-xl bg-[#14B8A6] hover:bg-[#0D9488] text-[#071318] font-semibold text-sm transition-colors cursor-pointer"
                >
                  {authLoading ? 'Creating Store...' : t.registerStoreBtn}
                </button>

                <div className="text-center pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthError(null);
                      onNavigateTab('login');
                    }}
                    className="text-xs text-slate-300 hover:text-white cursor-pointer"
                  >
                    ← Back to Seller Sign In
                  </button>
                </div>
              </form>
            )}
          </div>
        </main>

        <footer className="text-center text-xs text-slate-300">
          NimTera — {t.independentNotice}
        </footer>
      </div>
    );
  }

  // ============================================================================
  // AUTHENTICATED SELLER WORKSPACE
  // ============================================================================
  const currentTab: SellerTab = activeRoute === 'login' || activeRoute === 'setup' ? 'counter' : activeRoute;
  const activeOrdersCount = orders.filter(
    (o) => o.fulfillmentStatus !== 'completed' && o.fulfillmentStatus !== 'canceled'
  ).length;

  return (
    <div className="min-h-screen bg-[var(--surface-base)] text-[var(--ink)] flex flex-col lg:flex-row">
      {/* Left Sidebar Navigation */}
      <aside className="w-full lg:w-60 bg-[var(--surface-inset)] border-b lg:border-b-0 lg:border-r border-slate-600/90 flex flex-col justify-between p-4 lg:p-5 shrink-0">
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <BrandLogo
              variant="champagne"
              size="md"
              onClick={() => onNavigateTab('counter')}
            />
            <button
              type="button"
              onClick={onOpenDocsModal}
              className="lg:hidden text-xs text-slate-300 hover:text-white"
            >
              {t.navPolicies}
            </button>
          </div>

          <nav
            aria-label="Seller workspace navigation"
            className="flex lg:flex-col gap-1.5 overflow-x-auto pb-1 lg:pb-0"
          >
            {(
              [
                { id: 'counter', label: t.navCashier, icon: LayoutGrid },
                {
                  id: 'orders',
                  label: t.navOrders,
                  icon: ReceiptText,
                  badge: activeOrdersCount,
                },
                { id: 'products', label: t.navProducts, icon: Tag },
                { id: 'reports', label: t.navReports, icon: BarChart3 },
                { id: 'settings', label: t.navSettings, icon: Settings },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const active = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigateTab(item.id)}
                  className={`flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-[var(--surface-selected)] text-[var(--teal-ink)] border border-[#14B8A6]/40'
                      : 'text-slate-300 hover:text-[var(--ink)] hover:bg-[var(--surface-card)]'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </span>
                  {'badge' in item && item.badge !== undefined && item.badge > 0 && (
                    <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-amber-600/30 text-amber-300 tabular-nums">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Seller Profile & Storefront Link */}
        <div className="hidden lg:flex flex-col gap-3 pt-6 border-t border-slate-600/80 text-xs">
          <div className="flex items-center justify-between text-slate-300">
            <span className="truncate">{sellerEmail || store?.slug}</span>
            <button
              type="button"
              onClick={handleLogout}
              aria-label={t.logoutBtn}
              className="text-slate-300 hover:text-rose-400 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
          {store && (
            <button
              type="button"
              onClick={() => onOpenStorefront(store.slug)}
              className="w-full py-2 px-3 rounded-xl bg-[var(--surface-card)] border border-slate-600 hover:border-slate-500 text-slate-300 flex items-center justify-between cursor-pointer"
            >
              <span className="truncate">/s/{store.slug}</span>
              <ExternalLink className="w-3.5 h-3.5 text-[var(--teal-ink)] shrink-0" />
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Workspace Header */}
        <header className="bg-[var(--surface-base)] border-b border-slate-600/80 px-4 sm:px-8 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            {editingRestoName ? (
              <form onSubmit={handleSaveRestoNameInline} className="flex items-center gap-2">
                <input
                  type="text"
                  data-testid="header-resto-name-input"
                  value={restoNameDraft}
                  onChange={(e) => setRestoNameDraft(e.target.value)}
                  placeholder={uiText(locale, "Nama Resto...")}
                  className="bg-[var(--surface-card)] border border-slate-600 rounded-xl px-3 py-1 text-xs font-semibold text-[var(--ink)]"
                />
                <button
                  type="submit"
                  className="px-2.5 py-1 rounded-lg bg-[#14B8A6] text-[#071318] text-xs font-semibold cursor-pointer"
                >{' '}{uiText(locale, "Simpan")}{' '}</button>
                <button
                  type="button"
                  onClick={() => setEditingRestoName(false)}
                  className="px-2 py-1 rounded-lg bg-[var(--surface-card)] text-xs text-slate-300 cursor-pointer"
                >{' '}{uiText(locale, "Batal")}{' '}</button>
              </form>
            ) : (
              <>
                <button
                  type="button"
                  data-testid="seller-header-store-btn"
                  onClick={() => store && onOpenStorefront(store.slug)}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--surface-card)] border border-slate-600 text-sm font-semibold text-[var(--ink)] hover:border-slate-500 truncate cursor-pointer"
                >
                  {store?.logoUrl && <img src={store.logoUrl} alt="" data-testid="seller-shop-logo" className="w-9 h-9 rounded-lg bg-white object-contain p-1 shrink-0"/>}
                  <span className="truncate">{store?.name || 'Your shop'}</span>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRestoNameDraft(store?.name || 'Your shop');
                    setEditingRestoName(true);
                  }}
                  className="px-2.5 py-1.5 rounded-xl bg-[var(--surface-card)] border border-slate-600 text-xs text-[var(--gold-ink)] hover:border-slate-500 inline-flex items-center gap-1 cursor-pointer"
                  title={uiText(locale, "Ubah Nama Resto")}
                >
                  <Pencil className="w-3 h-3" />
                  <span className="hidden sm:inline">{' '}{uiText(locale, "Ubah Nama Resto")}{' '}</span>
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {/* Language Selector */}
            <div className="flex items-center gap-1.5 bg-[var(--surface-card)] border border-slate-500/80 rounded-full px-3 py-1.5">
              <Globe className="w-3.5 h-3.5 text-slate-300" />
              <select
                aria-label="Seller UI Language"
                value={locale}
                onChange={(e) => onChangeLocale(e.target.value as SupportedLocale)}
                className="bg-transparent text-xs font-medium text-[var(--ink)] focus:outline-none cursor-pointer"
              >
                {(Object.keys(LOCALE_METADATA) as SupportedLocale[]).map((loc) => (
                  <option key={loc} value={loc} className="bg-[var(--surface-card)]">
                    {LOCALE_METADATA[loc].shortLabel}
                  </option>
                ))}
              </select>
            </div>

            {/* Audio Quick-Unlock & Mute Button */}
            <button
              type="button"
              onClick={async () => {
                if (!audioActive) {
                  cashierAudio.setConfig({muted:false,...(audioStatus.volume===0?{volume:.8}:{})});
                  if(await cashierAudio.unlock())cashierAudio.playInvoiceReadyChime();
                } else cashierAudio.setConfig({muted:true});
              }}
              aria-label={audioActive ? 'Mute cashier audio' : 'Activate cashier audio'}
              className={`w-9 h-9 rounded-full border flex items-center justify-center transition-colors cursor-pointer ${
                audioActive
                  ? 'bg-[var(--surface-selected)] border-[#14B8A6] text-[var(--teal-ink)]'
                  : 'bg-[var(--surface-card)] border-slate-500 text-slate-300'
              }`}
            >
              {audioActive ? (
                <Volume2 className="w-4 h-4" />
              ) : (
                <VolumeX className="w-4 h-4" />
              )}
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="px-3 py-1.5 rounded-full bg-[var(--surface-card)] border border-slate-600 text-xs text-slate-300 hover:text-white cursor-pointer"
            >
              {t.logoutBtn}
            </button>
          </div>
        </header>

        {/* STRICT TESTNET / MAINNET SELLER WORKSPACE BANNER */}
        <div
          data-testid="seller-env-banner"
          className={`border-b px-4 sm:px-8 py-2.5 text-xs ${
            activeEnv === 'testnet'
              ? 'bg-amber-100 border-amber-400 text-amber-950'
              : 'bg-emerald-100 border-emerald-500 text-emerald-950'
          }`}
        >
          <div className="max-w-[1320px] mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span
                className={`px-2.5 py-0.5 rounded-full font-extrabold uppercase tracking-wider text-[13px] ${
                  activeEnv === 'testnet'
                    ? 'bg-amber-900 text-amber-100'
                    : 'bg-emerald-900 text-emerald-100'
                }`}
              >
                {activeEnv === 'testnet'
                  ? 'SELLER DASHBOARD · TESTNET MODE (DEFAULT)'
                  : 'SELLER DASHBOARD · MAINNET MODE (DANA ASLI)'}
              </span>
              <span className="font-medium">
                {activeEnv === 'testnet'
                  ? uiText(locale, "Menggunakan Nimiq Testnet (NIM TESTNET). Pesanan uji terpisah dari penjualan nyata.")
                  : uiText(locale, "Pembayaran Mainnet belum tersedia. Jangan mengirim dana asli.")}
              </span>
            </div>

            <div className="inline-flex max-w-full flex-wrap items-center gap-1 bg-white/90 border border-stone-300 rounded-lg p-0.5 shrink-0">
              <button
                type="button"
                data-testid="seller-switch-testnet"
                onClick={() => handleSwitchEnvironment('testnet')}
                className={`px-2.5 py-1 rounded-md text-[13px] font-bold transition-colors cursor-pointer ${
                  activeEnv === 'testnet'
                    ? 'bg-amber-700 text-white'
                    : 'text-stone-700 hover:bg-stone-100'
                }`}
              >
                NIM TESTNET
              </button>
              <button
                type="button"
                data-testid="seller-switch-mainnet"
                onClick={() => handleSwitchEnvironment('mainnet')}
                className={`px-2.5 py-1 rounded-md text-[13px] font-bold transition-colors cursor-pointer ${
                  activeEnv === 'mainnet'
                    ? 'bg-emerald-800 text-white'
                    : 'text-stone-700 hover:bg-stone-100'
                }`}
              >
                NIM MAINNET
              </button>
            </div>
          </div>
        </div>

        {/* Tab Viewport */}
        <main className="relative flex-1 p-4 sm:p-8 overflow-y-auto">
          {/* Lively Floating Warm Cream & Champagne Ambient Orbs */}
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 overflow-hidden z-0"
          >
            <div className="animate-float-orb absolute top-12 left-[22%] w-72 h-72 rounded-full bg-[#DFC496]/25 blur-3xl" />
            <div className="animate-float-orb-reverse absolute bottom-12 right-[10%] w-80 h-80 rounded-full bg-[#14B8A6]/12 blur-3xl" />
          </div>

          {/* ==================================================================
              TAB 1: CASHIER POS
          ================================================================== */}
          {currentTab === 'counter' && (
            <div className="relative z-10 max-w-[1320px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Left 8 Columns: Cashier Catalog */}
              <div className="lg:col-span-8 space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h1 className="text-3xl font-bold text-[var(--ink)] tracking-tight">
                      {t.navCashier} — {store?.name || 'Your shop'}{' '}
                      <span className="text-sm font-mono uppercase px-2.5 py-0.5 rounded-full bg-amber-100 border border-amber-400 text-amber-950 align-middle">
                        {activeEnv}
                      </span>
                    </h1>
                    <p className="text-xs text-slate-300 mt-0.5">{' '}{uiText(locale, "Menu dipisahkan per kolom kategori: Makanan, Minuman, Dessert, Buah Segar, Bakery & Lainnya")}{' '}</p>
                  </div>

                  <button
                    type="button"
                    data-testid="open-add-menu-btn"
                    onClick={() => {
                      if (!showPosMenuForm) {
                        handleResetProductForm();
                        setProdFeedback(null);
                      }
                      setShowPosMenuForm((prev) => !prev);
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#14B8A6] hover:bg-[#0D9488] text-[#071318] font-semibold text-xs sm:text-sm transition-all cursor-pointer active:scale-95 animate-pulse-glow"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>
                      {showPosMenuForm ? uiText(locale, "Tutup Form Menu") : uiText(locale, "+ Tambah Menu & Harga")}
                    </span>
                  </button>
                </div>

                {/* Quick Add / Edit Menu & Price Panel directly inside Cashier */}
                {showPosMenuForm && (
                  <div
                    data-testid="pos-menu-form-panel"
                    className="animate-card-in bg-[var(--surface-card)] border border-slate-500 rounded-3xl p-5 space-y-4 shadow-2xl"
                  >
                    <div className="flex items-center justify-between border-b border-slate-500 pb-3">
                      <div>
                        <h2 className="text-base font-bold text-[var(--gold-ink)] flex items-center gap-2">
                          <Tag className="w-4 h-4 text-[var(--teal-ink)]" />
                          <span>
                            {editingProdId
                              ? uiText(locale, "Edit Menu & Harga")
                              : uiText(locale, "Tambah Menu & Harga Baru")}
                          </span>
                        </h2>
                        <p className="text-xs text-slate-300 mt-0.5">{' '}{uiText(locale, "Pilih kategori menu dan atur harga dalam NIM.")}{' '}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setShowPosMenuForm(false);
                          handleResetProductForm();
                        }}
                        className="p-1.5 rounded-full bg-[var(--surface-raised)] text-slate-300 hover:text-[var(--ink)] cursor-pointer"
                        aria-label="Close menu form"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <form onSubmit={handleCreateProduct} className="space-y-3.5">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-medium text-slate-300 mb-1">{' '}{uiText(locale, "Nama Menu / Produk")}{' '}</label>
                          <input
                            type="text"
                            required
                            data-testid="pos-menu-name-input"
                            value={newProdName}
                            onChange={(e) => setNewProdName(e.target.value)}
                            placeholder={uiText(locale, "Contoh: Nasi Goreng Kampung / Es Kopi Krim")}
                            className="w-full bg-[var(--surface-raised)] border border-slate-500 rounded-xl px-3.5 py-2 text-xs text-[var(--ink)]"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-300 mb-1">{' '}{uiText(locale, "Kolom Kategori Menu")}{' '}</label>
                          <select
                            value={newProdCat}
                            onChange={(e) =>
                              setNewProdCat(e.target.value as ProductCategory)
                            }
                            className="w-full bg-[var(--surface-raised)] border border-slate-500 rounded-xl px-3 py-2 text-xs text-[var(--ink)]"
                          >
                            <option value="food">{categoryCopy('food', locale).title}</option>
                            <option value="drinks">{categoryCopy('drinks', locale).title}</option>
                            <option value="dessert">{categoryCopy('dessert', locale).title}</option>
                            <option value="fruit">{categoryCopy('fruit', locale).title}</option>
                            <option value="bakery">{categoryCopy('bakery', locale).title}</option>
                            <option value="goods">{categoryCopy('goods', locale).title}</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-[var(--gold-ink)] mb-1">{' '}{uiText(locale, "Harga NIM (")}{' '}{activeEnv === 'testnet' ? 'NIM TESTNET' : 'Nimiq Mainnet'})
                          </label>
                          <input
                            type="text"
                            data-testid="pos-menu-nim-input"
                            value={newProdNim}
                            onChange={(e) => setNewProdNim(e.target.value)}
                            placeholder="45"
                            className="w-full bg-[var(--surface-raised)] border border-slate-500 rounded-xl px-3.5 py-2 text-xs font-mono text-[var(--ink)]"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-300 mb-1">{' '}{uiText(locale, "Deskripsi Singkat")}{' '}</label>
                          <input
                            type="text"
                            value={newProdDesc}
                            onChange={(e) => setNewProdDesc(e.target.value)}
                            placeholder={uiText(locale, "Racikan spesial resto")}
                            className="w-full bg-[var(--surface-raised)] border border-slate-500 rounded-xl px-3.5 py-2 text-xs text-[var(--ink)]"
                          />
                        </div>
                      </div>

                      <ProductImagePicker value={newProdImg} onChange={setNewProdImg} locale={locale} token={sessionToken} onBusyChange={setPhotoBusy} />

                      {prodFeedback && (
                        <div
                          role="status"
                          className="p-2.5 rounded-xl bg-[var(--surface-selected)] border border-[#14B8A6]/50 text-[var(--teal-ink)] text-xs font-medium"
                        >
                          {prodFeedback}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                        {editingProdId && (
                          <button
                            type="button"
                            onClick={handleResetProductForm}
                            className="px-4 py-2 rounded-xl bg-[var(--surface-raised)] text-slate-300 text-xs font-medium cursor-pointer"
                          >{' '}{uiText(locale, "Batal Edit")}{' '}</button>
                        )}
                        <button
                          type="submit"
                          data-testid="pos-save-menu-btn" disabled={photoBusy}
                          className="px-5 py-2.5 rounded-xl bg-[#14B8A6] hover:bg-[#0D9488] text-[#071318] font-semibold text-xs cursor-pointer active:scale-95 transition-transform"
                        >
                          {editingProdId
                            ? uiText(locale, "✓ Simpan Perubahan Menu & Harga")
                            : uiText(locale, "+ Simpan Menu & Harga Baru")}
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {/* Filter Pills + Search Input */}
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    <button
                      type="button"
                      onClick={() => setPosCategory('all')}
                      className={`px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all whitespace-nowrap cursor-pointer active:scale-95 ${
                        posCategory === 'all'
                          ? 'bg-[#14B8A6] text-[#071318] font-semibold shadow-md'
                          : 'bg-[var(--surface-card)] border border-slate-600 text-slate-300'
                      }`}
                    >{' '}{uiText(locale, "Semua Kolom (")}{' '}{products.length})
                    </button>
                    {MENU_CATEGORY_COLUMNS.map((col) => {
                      const active = posCategory === col.id;
                      const count = products.filter((p) => p.category === col.id).length;
                      return (
                        <button
                          key={col.id}
                          type="button"
                          onClick={() => setPosCategory(col.id)}
                          className={`px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all whitespace-nowrap cursor-pointer active:scale-95 ${
                            active
                              ? 'bg-[#14B8A6] text-[#071318] font-semibold shadow-md'
                              : 'bg-[var(--surface-card)] border border-slate-600 text-slate-300'
                          }`}
                        >
                          {categoryCopy(col.id, locale).title} ({count})
                        </button>
                      );
                    })}
                  </div>

                  <div className="relative w-full sm:w-64">
                    <Search className="w-4 h-4 text-slate-300 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="search"
                      aria-label={t.searchProductsPlaceholder}
                      placeholder={t.searchProductsPlaceholder}
                      value={posSearch}
                      onChange={(e) => setPosSearch(e.target.value)}
                      className="w-full bg-[var(--surface-card)] border border-slate-600 rounded-full pl-9 pr-4 py-1.5 text-xs sm:text-sm text-[var(--ink)] placeholder:text-slate-300"
                    />
                  </div>
                </div>

                {/* Separated Multi-Column Menu Category Boards in Cashier POS */}
                <div
                  data-testid="pos-category-columns"
                  className={`grid grid-cols-1 ${
                    posCategory === 'all' ? 'md:grid-cols-2 xl:grid-cols-3' : 'md:grid-cols-1'
                  } gap-5 items-start`}
                >
                  {MENU_CATEGORY_COLUMNS.filter(
                    (col) => posCategory === 'all' || posCategory === col.id
                  ).map((col) => {
                    const colProducts = filteredPosProducts.filter(
                      (p) => p.category === col.id
                    );
                    const nimLabel = activeEnv === 'testnet' ? 'NIM (TESTNET)' : 'NIM';
                    return (
                      <div
                        key={col.id}
                        data-testid={`pos-column-${col.id}`}
                        className="bg-[var(--surface-card)] border border-slate-500 rounded-3xl p-4 space-y-3.5 shadow-sm"
                      >
                        <div className="flex items-center justify-between border-b border-[#E8DFD1] pb-2.5">
                          <div>
                            <h2 className="text-base font-bold text-[var(--ink)]">
                              {categoryCopy(col.id, locale).title}
                            </h2>
                            <p className="text-[13px] text-slate-300">{categoryCopy(col.id, locale).subtitle}</p>
                          </div>
                          <span className="px-2.5 py-0.5 rounded-full bg-[var(--surface-raised)] border border-slate-500 text-xs font-bold text-[var(--gold-ink)] tabular-nums">
                            {colProducts.length} menu
                          </span>
                        </div>

                        {colProducts.length === 0 ? (
                          <div className="py-5 text-center text-xs text-slate-300">{' '}{uiText(locale, "Belum ada menu di kolom")}{' '}{categoryCopy(col.id, locale).title}.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {colProducts.map((prod, idx) => {
                              const priceBadge = prod.priceNimLuna ? `${formatLunaToNim(prod.priceNimLuna)} ${nimLabel}` : uiText(locale,'Harga NIM belum tersedia');

                              return (
                                <div
                                  key={prod.id}
                                  style={{ animationDelay: `${idx * 45}ms` }}
                                  className="group menu-card-live animate-card-in bg-[var(--surface-raised)] border border-slate-500 rounded-2xl p-2.5 flex items-center justify-between gap-3"
                                >
                                  <div className="flex items-center gap-3 min-w-0">
                                    <img
                                      src={prod.imageUrl}
                                      alt={prod.name}
                                      referrerPolicy="no-referrer"
                                      className="w-14 h-14 rounded-xl object-cover shrink-0 transition-transform duration-500 group-hover:scale-105"
                                    />
                                    <div className="min-w-0">
                                      <div className="text-sm font-semibold text-[var(--ink)] truncate">
                                        {prod.name}
                                      </div>
                                      <div className="text-xs font-bold text-[var(--gold-ink)] tabular-nums mt-0.5">
                                        {priceBadge}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => handleStartEditProduct(prod, true)}
                                        className="mt-1 text-[13px] text-slate-300 hover:text-[var(--ink)] inline-flex items-center gap-1 cursor-pointer"
                                      >
                                        <Pencil className="w-2.5 h-2.5 text-[var(--gold-ink)]" />
                                        <span>{' '}{uiText(locale, "Edit Harga")}{' '}</span>
                                      </button>
                                    </div>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => updatePosQty(prod.id, 1)}
                                    aria-label={`Add ${prod.name} to cashier order`}
                                    className="w-9 h-9 rounded-full bg-[#14B8A6] hover:bg-[#0D9488] active:scale-90 text-[#071318] flex items-center justify-center shrink-0 cursor-pointer transition-transform"
                                  >
                                    <Plus className="w-4 h-4 stroke-[2.5]" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right 4 Columns: Cashier Order Panel */}
              <div className="lg:col-span-4 bg-[var(--surface-card)] border border-slate-600 rounded-3xl p-6 space-y-5 shadow-xl">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold text-[var(--ink)] tracking-tight">
                    {t.orderNumberLabel} {activeEnv === 'testnet' ? '#T-POS' : '#POS'}
                  </h2>
                  <span className="text-xs text-slate-300 font-mono">
                    {store?.slug} · {activeEnv.toUpperCase()}
                  </span>
                </div>

                <div>
                  <label htmlFor="pos-table-note" className="sr-only">
                    Order table or note
                  </label>
                  <input
                    id="pos-table-note"
                    type="text"
                    value={posTableNote}
                    onChange={(e) => setPosTableNote(e.target.value)}
                    className="w-full bg-[var(--surface-raised)] border border-slate-500/80 rounded-xl px-3.5 py-2 text-xs text-slate-200"
                  />
                </div>

                {/* Line Items */}
                <div className="space-y-3 divide-y divide-slate-800/80">
                  {validPosCart.map((entry) => {
                    const prod = products.find((p) => p.id === entry.productId);
                    if (!prod) return null;
                    const nimLabel = activeEnv === 'testnet' ? 'NIM (TESTNET)' : 'NIM';
                    const unitStr = prod.priceNimLuna ? `${formatLunaToNim(prod.priceNimLuna)} ${nimLabel} each` : `No ${nimLabel} price`;
                    const lineStr = prod.priceNimLuna ? `${formatLunaToNim(BigInt(prod.priceNimLuna) * BigInt(entry.quantity))} ${nimLabel}` : 'N/A';

                    return (
                      <div
                        key={entry.productId}
                        className="pt-3 first:pt-0 flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <img
                            src={prod.imageUrl}
                            alt={prod.name}
                            referrerPolicy="no-referrer"
                            className="w-11 h-11 rounded-xl object-cover shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-[var(--ink)] truncate">
                              {prod.name}
                            </div>
                            <div className="text-xs text-slate-300 tabular-nums">{unitStr}</div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5 shrink-0">
                          <div className="flex items-center gap-1.5 bg-[var(--surface-base)] border border-slate-600 rounded-full px-2 py-1">
                            <button
                              type="button"
                              onClick={() => updatePosQty(prod.id, -1)}
                              aria-label={`Decrease ${prod.name}`}
                              className="w-5 h-5 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center cursor-pointer"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="w-4 text-center text-xs font-semibold tabular-nums">
                              {entry.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => updatePosQty(prod.id, 1)}
                              aria-label={`Increase ${prod.name}`}
                              className="w-5 h-5 rounded-full bg-[var(--surface-selected)] text-[var(--teal-ink)] flex items-center justify-center cursor-pointer"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>

                          <div className="text-xs sm:text-sm font-bold text-[var(--ink)] tabular-nums w-24 text-right">
                            {lineStr}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Total */}
                <div className="pt-3 border-t border-slate-600 flex items-baseline justify-between">
                  <span className="text-base text-slate-300">{t.totalLabel}</span>
                  <span className="text-2xl font-bold text-[var(--gold-ink)] tabular-nums">
                    {posCalculation.totalFormatted}
                  </span>
                </div>

                {/* Payment Method Cards */}
                <div className="space-y-2">
                  <span className="text-xs text-slate-300 block">
                    {t.paymentMethod} ({activeEnv.toUpperCase()})
                  </span>
                  <div className="grid grid-cols-1 gap-3">
                    <button
                      type="button"
                      onClick={() => setPosAsset('NIM')}
                      className={`p-3.5 rounded-2xl border text-left transition-colors cursor-pointer ${
                        posAsset === 'NIM'
                          ? 'bg-[var(--surface-selected)]/70 border-[#14B8A6] text-[var(--ink)]'
                          : 'bg-[var(--surface-base)] border-slate-600 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs sm:text-sm font-bold">
                          {activeEnv === 'testnet' ? 'NIM (TESTNET)' : 'NIM'}
                        </span>
                        <span className="text-xs text-[var(--teal-ink)]">✓</span>
                      </div>
                      <div className="text-xs text-slate-300 mt-1">
                        {activeEnv === 'testnet' ? 'Nimiq Testnet (ID 5)' : 'Nimiq Mainnet'}
                      </div>
                    </button>


                  </div>
                </div>

                <div className="text-xs text-slate-300 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                  <span>{t.pricesSetByMerchant}</span>
                </div>

                {posError && (
                  <div className="p-3 rounded-xl bg-rose-950/70 border border-rose-700 text-rose-200 text-xs">
                    {posError}
                  </div>
                )}

                <button
                  type="button"
                  disabled={posSubmitting || !posCalculation.compatible}
                  onClick={handlePosCreatePayment}
                  className="w-full py-3.5 px-6 rounded-2xl bg-[#14B8A6] hover:bg-[#0D9488] disabled:opacity-45 text-[#071318] font-semibold text-base flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-lg"
                >
                  <span>
                    {posSubmitting
                      ? 'Creating...'
                      : `${t.createPayment} (${activeEnv.toUpperCase()})`}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <div className="text-center text-xs text-slate-300 space-y-0.5">
                  <p>Direct to your {activeEnv} wallet profile.</p>
                  <p>🔒 {t.nativeConfirmRequired}</p>
                </div>
              </div>
            </div>
          )}

          {/* ==================================================================
              TAB 2: ORDERS & VERIFICATION CONSOLE (/seller/orders)
              Strictly separates Testnet Orders from Mainnet Real Sales
          ================================================================== */}
          {currentTab === 'orders' && (
            <div className="max-w-6xl mx-auto space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold text-[var(--ink)]">
                    {t.navOrders} —{' '}
                    <span className={activeEnv === 'testnet' ? 'text-amber-700' : 'text-emerald-700'}>
                      {activeEnv === 'testnet'
                        ? uiText(locale, "Daftar Pesanan TESTNET (Bukan Penjualan Nyata)")
                        : uiText(locale, "Daftar Pesanan MAINNET (Penjualan Nyata)")}
                    </span>
                  </h1>
                  <p className="text-xs text-slate-300 mt-0.5">{' '}{uiText(locale, "Pesanan Testnet (#T...) dan Mainnet (#...) dipisahkan secara ketat. Status pembayaran diverifikasi hanya pada jaringan pesanan tersebut.")}{' '}</p>
                </div>

                {/* High-contrast Payment Status Legend */}
                <div
                  aria-label="Payment status color legend"
                  className="flex flex-wrap items-center gap-2 bg-[var(--surface-card)] border border-slate-600 rounded-2xl px-3.5 py-2"
                >
                  <OrderStatusBadge status="unpaid" locale={locale} size="sm" />
                  <OrderStatusBadge status="pending" locale={locale} size="sm" />
                  <OrderStatusBadge status="confirmed" locale={locale} size="sm" />
                  <OrderStatusBadge status="needs_review" locale={locale} size="sm" />
                  <OrderStatusBadge status="failed" locale={locale} size="sm" />
                  <OrderStatusBadge status="expired" locale={locale} size="sm" />
                </div>
              </div>

              <div className="space-y-4">
                {orders
                  .filter((ord) => {
                    const ordEnv =
                      ord.environment ||
                      (ord.network === 'nimiq-testnet'
                        ? 'testnet'
                        : 'mainnet');
                    return ordEnv === activeEnv;
                  })
                  .map((ord) => {
                    const isTestOrd =
                      ord.environment === 'testnet' ||
                      ord.network === 'nimiq-testnet';
                    return (
                      <div
                        key={ord.id}
                        data-testid={`seller-order-card-${ord.orderNumber}`}
                        className="bg-[var(--surface-card)] border border-slate-600 rounded-2xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                      >
                        <div className="space-y-2 max-w-2xl">
                          <div className="flex flex-wrap items-center gap-2.5 text-xs">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[13px] font-extrabold uppercase ${
                                isTestOrd
                                  ? 'bg-amber-900 text-amber-100'
                                  : 'bg-emerald-900 text-emerald-100'
                              }`}
                            >
                              {isTestOrd ? uiText(locale, "TESTNET · BUKAN PENJUALAN NYATA") : 'MAINNET · DANA ASLI'}
                            </span>
                            <span className="text-base font-bold text-[var(--gold-ink)] tabular-nums">
                              {ord.orderNumber}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-semibold text-[var(--ink)] tabular-nums">
                              {ord.amountFormatted}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-slate-300">
                              {ord.network}{' '}
                              {ord.snapshotChainId ? `(Chain ${ord.snapshotChainId})` : ''}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="text-slate-300 uppercase">{ord.fulfillmentMode}</span>
                            {ord.tableOrNote && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-slate-300">{ord.tableOrNote}</span>
                              </>
                            )}
                          </div>

                          <div className="text-xs text-slate-300">
                            {ord.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}
                          </div>

                          {ord.deliveryInfo && (
                            <div className="text-xs text-slate-300 bg-[var(--surface-base)] p-2.5 rounded-xl border border-slate-600">
                              <strong className="text-slate-200">Delivery Recipient:</strong>{' '}
                              {ord.deliveryInfo.recipientName} ({ord.deliveryInfo.phone}) —{' '}
                              {ord.deliveryInfo.address}
                            </div>
                          )}

                          <div className="text-[13px] font-mono text-slate-300">
                            Snapshot Wallet ({isTestOrd ? 'TESTNET' : 'MAINNET'}):{' '}
                            {ord.snapshotRecipient}
                          </div>

                          {ord.asset==='NIM'&&ord.network==='nimiq-testnet'&&ord.environment!=='mainnet'&&ord.paymentStatus!=='confirmed'&&<AddressPaymentReview locale={locale} orderId={ord.id} token={sessionToken} totpRequired={mfaEnabled} onComplete={()=>{void fetchDashboardData();}}/>}

                          {ord.matchingMode==='unique-amount-v1'&&<div data-testid={`auto-status-${ord.id}`} className="text-xs text-slate-300 space-y-1"><p>{AUTO_PAYMENT_COPY[locale].code}: +{formatAssetAmount(ord.paymentCodeLuna!,'NIM','testnet')}</p><p>{ord.paymentStatus==='confirmed'?AUTO_PAYMENT_COPY[locale].confirmed:ord.autoMatchState==='unavailable'?AUTO_PAYMENT_COPY[locale].unavailable:ord.autoMatchState==='limited'?AUTO_PAYMENT_COPY[locale].limited:ord.autoMatchState==='needs_review'?AUTO_PAYMENT_COPY[locale].review:AUTO_PAYMENT_COPY[locale].watching}</p></div>}

                          {ord.paymentReviewReason && (
                            <div className="text-xs text-amber-800 font-medium flex items-center gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                              <span>{ord.paymentReviewReason}</span>
                            </div>
                          )}

                          {ord.manualPaymentNote && (
                            <div className="text-xs text-sky-300">
                              Manual Cashier Note (Audit Logged): {ord.manualPaymentNote}
                            </div>
                          )}
                        </div>

                        {/* Right Side: Separated Payment Status & Fulfillment Controls */}
                        <div className="flex flex-col sm:flex-row lg:flex-col items-start sm:items-center lg:items-end gap-3 shrink-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-slate-300">Payment:</span>
                            <OrderStatusBadge
                              status={ord.paymentStatus}
                              locale={locale}
                            />
                            <span className="text-slate-300 ml-1">Fulfillment:</span>
                            <OrderStatusBadge
                              status={ord.fulfillmentStatus}
                              locale={locale}
                            />
                          </div>

                          {/* Fulfillment Progression Stepper */}
                          <div className="flex flex-wrap items-center gap-1.5">
                            {(
                              [
                                { id: 'new', label: t.fulfillNew },
                                { id: 'preparing', label: t.fulfillPreparing },
                                { id: 'ready', label: 'Ready' },
                                { id: 'completed', label: t.fulfillCompleted },
                                { id: 'canceled', label: t.fulfillCanceled },
                              ] as const
                            ).map((st) => (
                              <button
                                key={st.id}
                                type="button"
                                disabled={!isActiveNimOrder(ord)}
                                onClick={() => handleUpdateFulfillment(ord.id, st.id)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                                  ord.fulfillmentStatus === st.id
                                    ? 'bg-[#14B8A6] text-[#071318] font-semibold'
                                    : 'bg-[var(--surface-base)] border border-slate-600 text-slate-300 hover:text-white'
                                }`}
                              >
                                {st.label}
                              </button>
                            ))}
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                store && onOpenOrderCheckout(store.slug, ord.publicToken)
                              }
                              className="text-xs text-[var(--teal-ink)] hover:underline flex items-center gap-1 cursor-pointer"
                            >
                              <span>{isActiveNimOrder(ord) ? `Open QR / Checkout (${ord.network})` : uiText(locale,'Arsip pesanan — hanya baca')}</span>
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* ==================================================================
              TAB 3: PRODUCTS & PRICE MANAGER (/seller/products)
          ================================================================== */}
          {currentTab === 'products' && (
            <div className="relative z-10 max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              <div className="lg:col-span-5 bg-[var(--surface-card)] border border-slate-600 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-[var(--ink)]">
                    {editingProdId ? uiText(locale, "Edit Menu & Harga") : uiText(locale, "Tambah Menu & Harga Baru")}
                  </h2>
                  {editingProdId && (
                    <button
                      type="button"
                      onClick={handleResetProductForm}
                      className="text-xs text-slate-300 hover:text-[var(--ink)] underline cursor-pointer"
                    >
                      Reset
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-300">{' '}{uiText(locale, "Atur harga menu dalam NIM. Tidak ada konversi kurs otomatis.")}{' '}</p>

                <form onSubmit={handleCreateProduct} className="space-y-3.5">
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">{' '}{uiText(locale, "Nama Menu / Produk")}{' '}</label>
                    <input
                      type="text"
                      required
                      value={newProdName}
                      onChange={(e) => setNewProdName(e.target.value)}
                      placeholder="Cardamom Cold Brew"
                      className="w-full bg-[var(--surface-raised)] border border-slate-500 rounded-xl px-3 py-2 text-xs text-[var(--ink)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">{' '}{uiText(locale, "Deskripsi")}{' '}</label>
                    <input
                      type="text"
                      value={newProdDesc}
                      onChange={(e) => setNewProdDesc(e.target.value)}
                      placeholder="Spiced night market signature coffee"
                      className="w-full bg-[var(--surface-raised)] border border-slate-500 rounded-xl px-3 py-2 text-xs text-[var(--ink)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">{' '}{uiText(locale, "Kolom Kategori Menu")}{' '}</label>
                    <select
                      value={newProdCat}
                      onChange={(e) =>
                        setNewProdCat(e.target.value as ProductCategory)
                      }
                      className="w-full bg-[var(--surface-raised)] border border-slate-500 rounded-xl px-3 py-2 text-xs text-[var(--ink)]"
                    >
                      <option value="food">{categoryCopy('food', locale).title}</option>
                      <option value="drinks">{categoryCopy('drinks', locale).title}</option>
                      <option value="dessert">{categoryCopy('dessert', locale).title}</option>
                      <option value="fruit">{categoryCopy('fruit', locale).title}</option>
                      <option value="bakery">{categoryCopy('bakery', locale).title}</option>
                      <option value="goods">{categoryCopy('goods', locale).title}</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <label className="block text-xs text-[var(--gold-ink)] font-medium mb-1">{' '}{uiText(locale, "Harga NIM")}{' '}</label>
                      <input
                        type="text"
                        value={newProdNim}
                        onChange={(e) => setNewProdNim(e.target.value)}
                        placeholder="40"
                        className="w-full bg-[var(--surface-raised)] border border-slate-500 rounded-xl px-3 py-2 text-xs font-mono text-[var(--ink)]"
                      />
                    </div>

                  </div>

                  <ProductImagePicker value={newProdImg} onChange={setNewProdImg} locale={locale} token={sessionToken} onBusyChange={setPhotoBusy} />

                  {prodFeedback && (
                    <div className="p-2.5 rounded-xl bg-[var(--surface-selected)] text-[var(--teal-ink)] text-xs">
                      {prodFeedback}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={photoBusy} className="w-full py-2.5 px-4 rounded-xl bg-[#14B8A6] hover:bg-[#0D9488] text-[#071318] font-semibold text-xs cursor-pointer active:scale-95 transition-transform"
                  >
                    {editingProdId
                      ? uiText(locale, "✓ Simpan Perubahan Menu & Harga")
                      : uiText(locale, "+ Simpan Menu & Harga ke Katalog")}
                  </button>
                </form>
              </div>

              <div className="lg:col-span-7 space-y-5">
                <h2 className="text-lg font-bold text-[var(--ink)]">{' '}{uiText(locale, "Katalog Menu & Harga per Kolom (")}{' '}{products.length})
                </h2>
                {MENU_CATEGORY_COLUMNS.map((col) => {
                  const colProds = products.filter((p) => p.category === col.id);
                  return (
                    <div
                      key={col.id}
                      className="bg-[var(--surface-card)] border border-slate-500 rounded-2xl p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between border-b border-[#E8DFD1] pb-2">
                        <div>
                          <h3 className="text-sm font-bold text-[var(--ink)]">{categoryCopy(col.id, locale).title}</h3>
                          <p className="text-[13px] text-slate-300">{categoryCopy(col.id, locale).subtitle}</p>
                        </div>
                        <span className="px-2.5 py-0.5 rounded-full bg-[var(--surface-raised)] text-xs font-bold text-[var(--gold-ink)]">
                          {colProds.length} menu
                        </span>
                      </div>

                      {colProds.length === 0 ? (
                        <p className="text-xs text-slate-300 py-2">{' '}{uiText(locale, "Belum ada menu di kolom")}{' '}{categoryCopy(col.id, locale).title}.
                        </p>
                      ) : (
                        colProds.map((prod) => (
                          <div
                            key={prod.id}
                            className="menu-card-live bg-[var(--surface-raised)] border border-slate-600 rounded-2xl p-3.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-4"
                          >
                            <div className="flex items-center gap-3.5 min-w-0">
                              <img
                                src={prod.imageUrl}
                                alt={prod.name}
                                referrerPolicy="no-referrer"
                                className="w-12 h-12 rounded-xl object-cover shrink-0"
                              />
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-[var(--ink)] truncate">
                                  {prod.name}
                                </div>
                                <div className="text-xs text-[var(--gold-ink)] font-medium tabular-nums">
                                  {prod.priceNimLuna
                                    ? `${formatLunaToNim(prod.priceNimLuna)} ${
                                        activeEnv === 'testnet' ? 'NIM (TESTNET)' : 'NIM'
                                      }`
                                    : 'No NIM'}
                                  {' · '}

                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleStartEditProduct(prod, false)}
                                className="px-3 py-1.5 rounded-xl bg-[var(--surface-card)] border border-slate-500 text-[var(--ink)] text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5 text-[var(--gold-ink)]" />
                                <span>{' '}{uiText(locale, "Edit Harga")}{' '}</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleToggleProductAvailability(prod)}
                                className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer ${
                                  prod.available
                                    ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/50'
                                    : 'bg-slate-800 text-slate-300'
                                }`}
                              >
                                {prod.available ? 'Available' : 'Unavailable'}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDeleteProduct(prod.id)}
                                aria-label={`Delete ${prod.name}`}
                                title={uiText(locale, "Hapus menu")}
                                className="p-1.5 rounded-xl bg-rose-950/70 hover:bg-rose-900 border border-rose-700/50 text-rose-200 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ==================================================================
              TAB 4: REPORTS & AUDIT LOG (/seller/reports)
              Strictly separates Mainnet Real Sales from Testnet Sandbox Totals
          ================================================================== */}
          {currentTab === 'reports' && (
            <div className="max-w-5xl mx-auto space-y-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold text-[var(--ink)]">{t.navReports}</h1>
                  <p className="text-xs text-slate-300 mt-0.5">
                    {t.noCombinedTotalNote}{' '}{uiText(locale, "· Laporan Testnet dipisahkan ketat dari penjualan nyata Mainnet.")}{' '}</p>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 bg-[var(--surface-card)] border border-slate-600 rounded-xl p-1 text-xs">
                    {(['all', 'today', '7d'] as const).map((range) => (
                      <button
                        key={range}
                        type="button"
                        onClick={() => setReportDateFilter(range)}
                        className={`px-2.5 py-1 rounded-lg font-medium cursor-pointer ${
                          reportDateFilter === range
                            ? 'bg-[var(--surface-raised)] text-[var(--gold-ink)]'
                            : 'text-slate-300'
                        }`}
                      >
                        {range === 'all' ? 'All Time' : range === 'today' ? '24h' : '7 Days'}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={handleExportCsv}
                    className="px-4 py-2 rounded-xl bg-[#14B8A6] hover:bg-[#0D9488] text-[#071318] font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{t.exportCsvBtn}</span>
                  </button>
                </div>
              </div>

              {/* SECTION A: MAINNET REAL VERIFIED SALES */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-900 text-emerald-100 text-[13px] font-extrabold uppercase">{' '}{uiText(locale, "MAINNET · PENJUALAN NYATA (DANA ASLI)")}{' '}</span>
                  <span className="text-xs text-slate-300">{' '}{uiText(locale, "Riwayat pembayaran NIM Mainnet terverifikasi. Pembayaran baru tetap dinonaktifkan.")}{' '}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <div className="bg-[var(--surface-card)] border border-slate-600 rounded-2xl p-5 space-y-1">
                    <div className="text-xs text-slate-300">{t.reportsNimTotal} (Mainnet)</div>
                    <div
                      data-testid="report-nim-total"
                      className="text-2xl font-bold text-[var(--gold-ink)] tabular-nums"
                    >
                      {metrics?.confirmedNimFormatted || '0 NIM'}
                    </div>
                    <div className="text-[13px] text-slate-300">Nimiq Mainnet (Direct to wallet)</div>
                  </div>



                  <div className="bg-[var(--surface-card)] border border-slate-600 rounded-2xl p-5 space-y-1">
                    <div className="text-xs text-slate-300">{t.reportsOrderCount} (Mainnet)</div>
                    <div className="text-2xl font-bold text-[var(--ink)] tabular-nums">
                      {metrics?.confirmedOrdersCount ?? 0} / {metrics?.totalOrdersCount ?? 0}
                    </div>
                    <div className="text-[13px] text-slate-300">Verified Mainnet settlements</div>
                  </div>
                </div>
              </div>

              {/* SECTION B: TESTNET SANDBOX ACTIVITY (NEVER MIXED WITH REAL SALES) */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-900 text-amber-100 text-[13px] font-extrabold uppercase">{' '}{uiText(locale, "TESTNET · PENGUJIAN SANDBOX (BUKAN PENJUALAN NYATA)")}{' '}</span>
                  <span className="text-xs text-slate-300">{' '}{uiText(locale, "Nimiq Testnet — bukan dana asli dan tidak digabung ke omzet nyata")}{' '}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <div className="bg-amber-50/90 border border-amber-300 rounded-2xl p-5 space-y-1">
                    <div className="text-xs text-amber-900 font-semibold">{' '}{uiText(locale, "Total NIM (TESTNET) Terverifikasi")}{' '}</div>
                    <div
                      data-testid="report-testnet-nim-total"
                      className="text-2xl font-bold text-amber-950 tabular-nums"
                    >
                      {testnetMetrics?.confirmedNimFormatted || '0 NIM (TESTNET)'}
                    </div>
                    <div className="text-[13px] text-amber-800">
                      Nimiq Testnet · Bukan Dana Asli
                    </div>
                  </div>



                  <div className="bg-amber-50/90 border border-amber-300 rounded-2xl p-5 space-y-1">
                    <div className="text-xs text-amber-900 font-semibold">{' '}{uiText(locale, "Pesanan Testnet Terverifikasi")}{' '}</div>
                    <div
                      data-testid="report-testnet-order-count"
                      className="text-2xl font-bold text-amber-950 tabular-nums"
                    >
                      {testnetMetrics?.confirmedOrdersCount ?? 0} /{' '}
                      {testnetMetrics?.totalOrdersCount ?? 0}
                    </div>
                    <div className="text-[13px] text-amber-800">{' '}{uiText(locale, "Khusus pengujian 2 perangkat · Bukan penjualan nyata")}{' '}</div>
                  </div>
                </div>
              </div>

              {/* Immutable Security & Wallet Audit Log */}
              <div className="bg-[var(--surface-card)] border border-slate-600 rounded-2xl p-6 space-y-4">
                <h2 className="text-base font-bold text-[var(--ink)]">
                  Security & Wallet Audit Log ({auditLogs.length})
                </h2>
                <div className="divide-y divide-slate-800/80 text-xs">
                  {auditLogs.map((log) => (
                    <div key={log.id} className="py-3 first:pt-0 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-semibold text-[var(--gold-ink)]">{log.action}</span>
                        <span className="text-slate-300 tabular-nums">
                          {new Date(log.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-slate-300">{log.details}</p>
                      {log.oldValue && (
                        <div className="font-mono text-[13px] text-slate-300">
                          Previous: {log.oldValue}
                        </div>
                      )}
                      {log.newValue && (
                        <div className="font-mono text-[13px] text-[var(--teal-ink)]">
                          Updated: {log.newValue}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ==================================================================
              TAB 5: SETTINGS (SEPARATED TESTNET & MAINNET WALLETS + MAINNET READINESS)
          ================================================================== */}
          {currentTab === 'settings' && (
            <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              <WalletAccountSettings locale={locale} />
              <SecuritySettings locale={locale} token={sessionToken} onEnabled={()=>setMfaEnabled(true)} />
              {store && <StoreLogoSettings logo={store.logoUrl} name={store.name} locale={locale} token={sessionToken} onSaved={setStore} />}
              {/* Left 7 Columns: Separated Testnet & Mainnet Wallet Profiles with Re-Auth + 2FA */}
              <div className="lg:col-span-7 bg-[var(--surface-card)] border border-slate-600 rounded-2xl p-6 space-y-5">
                <div>
                  <h2 className="text-lg font-bold text-[var(--ink)]">{t.walletSettingsTitle}</h2>
                  <p className="text-xs text-slate-300 mt-0.5">{' '}{uiText(locale, "Profil wallet penerima disimpan terpisah untuk")}{' '}<strong>TESTNET</strong>{' '}{uiText(locale, "dan")}{' '}{' '}
                    <strong>MAINNET</strong>{' '}{uiText(locale, ". Setiap pesanan mengunci alamat penerima saat dibuat.")}{' '}</p>
                </div>

                <form onSubmit={handleWalletSave} className="space-y-5">
                  {/* PROFIL WALLET TESTNET */}
                  <div className="p-4 rounded-2xl bg-amber-50/90 border border-amber-300 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-amber-900 text-amber-100">{' '}{uiText(locale, "1. Profil Wallet TESTNET (Default Pengujian)")}{' '}</span>
                      <span className="text-[13px] font-mono text-amber-900">
                        Nimiq Testnet
                      </span>
                    </div>

                    <div>
                      <label
                        htmlFor="settings-testnet-nim-wallet"
                        className="block text-xs font-semibold text-amber-950 mb-1"
                      >
                        Nimiq Testnet Recipient Address (MOD-97-10 validated)
                      </label>
                      <input
                        id="settings-testnet-nim-wallet"
                        type="text"
                        value={walletTestnetNimInput}
                        onChange={(e) => setWalletTestnetNimInput(e.target.value)}
                        className="w-full bg-white border border-amber-400 rounded-xl px-3.5 py-2 text-xs font-mono text-stone-900"
                      />
                    </div>




                  </div>

                  {/* PROFIL WALLET MAINNET */}
                  <div className="p-4 rounded-2xl bg-emerald-50/90 border border-emerald-300 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-900 text-emerald-100">
                        2. Profil Wallet MAINNET (Dana Asli Produksi)
                      </span>
                      <span className="text-[13px] font-mono text-emerald-900">
                        Nimiq Mainnet (disabled)
                      </span>
                    </div>

                    <div>
                      <label
                        htmlFor="settings-nim-wallet"
                        className="block text-xs font-semibold text-emerald-950 mb-1"
                      >
                        Nimiq Mainnet Recipient Address (MOD-97-10 checksum verified)
                      </label>
                      <input
                        id="settings-nim-wallet"
                        type="text"
                        value={walletNimInput}
                        onChange={(e) => setWalletNimInput(e.target.value)}
                        className="w-full bg-white border border-emerald-400 rounded-xl px-3.5 py-2 text-xs font-mono text-stone-900"
                      />
                    </div>


                  </div>

                  <div className="p-4 rounded-xl bg-[var(--surface-base)] border border-slate-600 space-y-3">
                    <div className="text-xs font-semibold text-[var(--gold-ink)]">
                      Re-Authentication Required for Wallet Changes
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[13px] text-slate-300 mb-1">
                          Current Seller Password
                        </label>
                        <input
                          type="password"
                          required
                          value={walletConfirmPass}
                          onChange={(e) => setWalletConfirmPass(e.target.value)}
                          placeholder="Enter current password"
                          className="w-full bg-[var(--surface-card)] border border-slate-500 rounded-lg px-3 py-1.5 text-xs text-[var(--ink)]"
                        />
                      </div>
                      {mfaEnabled && (                      <div>
                        <label className="block text-[13px] text-slate-300 mb-1">
                          2FA Authenticator Code
                        </label>
                        <input
                          type="text"
                          required
                          value={walletConfirmTotp}
                          onChange={(e) => setWalletConfirmTotp(e.target.value)}
                          placeholder="6-digit TOTP"
                          className="w-full bg-[var(--surface-card)] border border-slate-500 rounded-lg px-3 py-1.5 text-xs font-mono text-[var(--ink)]"
                        />
                      </div>)}
                    </div>
                  </div>

                  {walletFeedback && (
                    <div
                      className={`p-3 rounded-xl text-xs ${
                        walletFeedback.type === 'ok'
                          ? 'bg-emerald-950/70 border border-emerald-700 text-emerald-200'
                          : 'bg-rose-950/70 border border-rose-700 text-rose-200'
                      }`}
                    >
                      {walletFeedback.msg}
                    </div>
                  )}

                  <button
                    type="submit"
                    className="py-2.5 px-5 rounded-xl bg-[#14B8A6] hover:bg-[#0D9488] text-[#071318] font-semibold text-xs cursor-pointer"
                  >
                    {t.saveChangesBtn}{' '}{uiText(locale, "(Simpan Profil Testnet & Mainnet)")}{' '}</button>
                </form>
              </div>

              {/* Right 5 Columns: Mainnet Readiness Verification + Cashier Audio */}
              <div className="lg:col-span-5 space-y-6">
                {/* Mainnet Pre-Production Readiness Check Card */}
                <div className="bg-[var(--surface-card)] border border-slate-600 rounded-2xl p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-bold text-[var(--ink)] flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-[var(--teal-ink)]" />
                      <span>{' '}{uiText(locale, "Pemeriksaan Kesiapan Produksi Mainnet")}{' '}</span>
                    </h2>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">{' '}{uiText(locale, "Sebelum produksi Mainnet, jalankan pemeriksaan konfigurasi dan uji Mainnet nominal kecil yang disetujui pengguna. Keberhasilan Testnet")}{' '}{' '}
                    <strong>{' '}{uiText(locale, "tidak")}{' '}</strong>{' '}{uiText(locale, "membuktikan kesiapan pembayaran Mainnet.")}{' '}</p>

                  <button
                    type="button"
                    data-testid="check-mainnet-readiness-btn"
                    onClick={handleCheckMainnetReadiness}
                    disabled={photoBusy} className="w-full py-2.5 px-4 rounded-xl bg-[#14B8A6] hover:bg-[#0D9488] text-[#071318] font-semibold text-xs cursor-pointer"
                  >{' '}{uiText(locale, "Jalankan Pemeriksaan Konfigurasi Mainnet")}{' '}</button>

                  {mainnetReadiness && (
                    <div
                      data-testid="mainnet-readiness-result"
                      className="p-3.5 rounded-xl bg-[var(--surface-base)] border border-slate-600 text-xs space-y-2"
                    >
                      <div className="flex items-center justify-between font-bold">
                        <span>{' '}{uiText(locale, "Status Kesiapan Mainnet:")}{' '}</span>
                        <span
                          className={
                            mainnetReadiness.readyForMainnet ? 'text-emerald-700' : 'text-amber-700'
                          }
                        >
                          {mainnetReadiness.readyForMainnet ? uiText(locale, "✓ SIAP UJI NOMINAL KECIL") : uiText(locale, "⚠ PERLU DILENGKAPI")}
                        </span>
                      </div>
                      <ul className="space-y-1 text-[13px] font-mono">
                        {Object.entries(mainnetReadiness.checks).map(([k, v]) => (
                          <li key={k} className="flex items-center justify-between">
                            <span>{k}</span>
                            <span>{v ? '✓ OK' : uiText(locale, "✗ Belum")}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="text-[13px] text-amber-800 font-medium pt-1 border-t border-slate-600">
                        {mainnetReadiness.warning}
                      </p>
                    </div>
                  )}
                </div>

                <CashierAudioSettings locale={locale} activeEnv={activeEnv} />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
