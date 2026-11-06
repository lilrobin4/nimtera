import type { SupportedLocale } from './i18n';

// Legacy UI copy moved into an explicit English/Indonesian catalog.
// Other missing locale entries fall back to English, never silently to Indonesian.
export const EXTRA_EN: Record<string, string> = {
  "Format harga NIM tidak valid (maksimal 5 desimal).": "Invalid NIM price (up to 5 decimal places).",
  "Format harga USDT tidak valid (maksimal 6 desimal).": "Invalid USDT price (up to 6 decimal places).",
  "Wajib mengisi minimal satu harga (NIM atau Polygon USDT).": "Enter at least one price (NIM or Polygon USDT).",
  "Gagal menyimpan menu & harga.": "Could not save the item and prices.",
  "Menu berhasil dihapus dari katalog.": "Item removed from the catalog.",
  "Profil wallet Testnet & Mainnet berhasil diverifikasi dan disimpan secara terpisah. Pesanan yang sudah dibuat tetap mengunci alamat wallet saat pesanan dibuat.": "Testnet and Mainnet wallet profiles were verified and saved separately. Existing orders retain their original recipient addresses.",
  "Nama Resto / Toko Anda": "Your restaurant / shop name",
  "Contoh: Resto Nusantara / Moonlight Cafe": "Example: Riverside Kitchen / Moonlight Cafe",
  "Nama resto ini langsung tampil di halaman katalog pelanggan & kasir saat login.": "This name appears in your customer catalog and cashier workspace when you sign in.",
  "Nama Resto...": "Shop name…",
  "Simpan": "Save",
  "Batal": "Cancel",
  "Ubah Nama Resto": "Edit shop name",
  "Mode pengujian awal: Nimiq Testnet (NIM TESTNET) & Polygon Amoy (Chain ID 80002 · TEST TOKEN). Pesanan, laporan, & suara kasir testnet dipisahkan ketat dari penjualan nyata.": "Test mode: Nimiq Testnet (NIM TESTNET) and Polygon Amoy (chain 80002 · TEST TOKEN). Testnet orders, reports and announcements are kept separate from real sales.",
  "Mode produksi Mainnet: Nimiq Mainnet (NIM) & Polygon Mainnet (Chain ID 137 · USDT). Pastikan pemeriksaan kesiapan Mainnet lulus sebelum menerima dana asli.": "Mainnet is disabled during this testnet beta. Mainnet readiness and authorized testing are required before accepting real funds.",
  "Menu dipisahkan per kolom kategori: Makanan, Minuman, Dessert, Buah Segar, Bakery & Lainnya": "Browse categories: Food, Drinks, Desserts, Fresh Fruit, Bakery and Other Goods",
  "Tutup Form Menu": "Close item form",
  "+ Tambah Menu & Harga": "+ Add item and prices",
  "Edit Menu & Harga": "Edit item and prices",
  "Tambah Menu & Harga Baru": "Add a new item and prices",
  "Pilih kolom kategori (Makanan, Minuman, Dessert, Buah Segar, Bakery, Lainnya) & atur harga NIM / USDT.": "Choose a category (Food, Drinks, Desserts, Fresh Fruit, Bakery or Other Goods) and set NIM / USDT prices.",
  "Nama Menu / Produk": "Item / product name",
  "Kolom Kategori Menu": "Item category",
  "Makanan (Main Course)": "Food (Main Course)",
  "Minuman (Drinks & Coffee)": "Drinks & Coffee",
  "Dessert (Hidangan Penutup)": "Desserts",
  "Buah Segar (Fresh Fruit)": "Fresh Fruit",
  "Bakery & Roti (Pastry)": "Bakery & Pastries",
  "Lainnya / Merchandise": "Other Goods / Merchandise",
  "Harga NIM (": "NIM price (",
  "Harga": "Price",
  "Racikan spesial resto": "Your shop’s specialty",
  "Deskripsi Singkat": "Short description",
  "Pilih Foto Menu": "Choose an item photo",
  "Batal Edit": "Cancel editing",
  "✓ Simpan Perubahan Menu & Harga": "✓ Save item and price changes",
  "+ Simpan Menu & Harga Baru": "+ Save new item and prices",
  "Semua Kolom (": "All categories (",
  "Belum ada menu di kolom": "No items in this category:",
  "Edit Harga": "Edit prices",
  "Daftar Pesanan TESTNET (Bukan Penjualan Nyata)": "TESTNET orders (not real sales)",
  "Daftar Pesanan MAINNET (Penjualan Nyata)": "MAINNET orders (real sales)",
  "Pesanan Testnet (#T...) dan Mainnet (#...) dipisahkan secara ketat. Status pembayaran diverifikasi hanya pada jaringan pesanan tersebut.": "Testnet (#T...) and Mainnet (#...) orders are kept separate. Payments are verified only on the invoice’s own network.",
  "Atur harga manual dalam NIM dan/atau Polygon USDT (di Testnet ditampilkan sebagai NIM TESTNET & TEST TOKEN). NimTera tidak pernah melakukan konversi kurs otomatis.": "Set independent NIM and/or Polygon USDT prices (shown as NIM TESTNET and TEST TOKEN on testnet). NimTera never converts exchange rates automatically.",
  "Harga NIM (opsional)": "NIM price (optional)",
  "Harga USDT / TEST TOKEN (opsional)": "USDT / TEST TOKEN price (optional)",
  "+ Simpan Menu & Harga ke Katalog": "+ Save item and prices to catalog",
  "Katalog Menu & Harga per Kolom (": "Catalog by category (",
  "Hapus menu": "Delete item",
  "· Laporan Testnet dipisahkan ketat dari penjualan nyata Mainnet.": "· Testnet reports are separate from real Mainnet sales.",
  "Hanya menghitung pesanan Mainnet terverifikasi RPC (Nimiq Mainnet & Polygon Chain 137)": "Includes only RPC-verified Mainnet orders (Nimiq Mainnet and Polygon chain 137)",
  "TESTNET · PENGUJIAN SANDBOX (BUKAN PENJUALAN NYATA)": "TESTNET · TESTING ONLY (NOT REAL SALES)",
  "Nimiq Testnet & Polygon Amoy (Chain ID 80002 · TEST TOKEN) — Tidak pernah digabung ke omzet nyata": "Nimiq Testnet and Polygon Amoy (chain 80002 · TEST TOKEN) — never combined with real revenue",
  "Total NIM (TESTNET) Terverifikasi": "Total verified NIM (TESTNET)",
  "Pesanan Testnet Terverifikasi": "Verified testnet orders",
  "Khusus pengujian 2 perangkat · Bukan penjualan nyata": "For multi-device testing · Not real sales",
  "Profil wallet penerima disimpan terpisah untuk": "Recipient wallet profiles are stored separately for",
  "dan": "and",
  ". Setiap pesanan mengunci alamat penerima saat dibuat.": ". Each invoice locks its recipient address when created.",
  "1. Profil Wallet TESTNET (Default Pengujian)": "1. TESTNET wallet profile (default for testing)",
  "Kontrak ERC-20 TEST TOKEN di Polygon Amoy (Chain ID 80002 — Opsional)": "ERC-20 TEST TOKEN contract on Polygon Amoy (chain 80002 — optional)",
  "Kosongkan jika belum ada kontrak TEST TOKEN di Amoy": "Leave blank if no Amoy TEST TOKEN contract is configured",
  "Larangan Keamanan:": "Security restriction:",
  "Alamat kontrak USDT Mainnet (": "The Mainnet USDT contract (",
  ") otomatis ditolak di Amoy. Jika kontrak token uji belum tersedia, jelaskan dan minta persetujuan sebelum deployment kontrak baru.": ") is rejected on Amoy. Obtain approval before deploying a new test-token contract.",
  "Polygon Mainnet USDT Recipient Address (0x... Chain ID 137 · Kontrak": "Polygon Mainnet USDT recipient (0x... chain 137 · Contract",
  "(Simpan Profil Testnet & Mainnet)": "(Save Testnet and Mainnet profiles)",
  "Sebelum produksi Mainnet, jalankan pemeriksaan konfigurasi dan uji Mainnet nominal kecil yang disetujui pengguna. Keberhasilan Testnet": "Before Mainnet use, complete configuration checks and authorized small-value testing. Testnet success",
  "tidak": "does not",
  "membuktikan jalur USDT Mainnet, fee, atau relayer pasti berfungsi.": "prove that Mainnet USDT transfers, fees or relayers work.",
  "✗ Belum": "✗ Not ready",
  "Menggunakan Nimiq Testnet (NIM TESTNET) & Polygon Amoy (Chain ID 80002 · TEST TOKEN — Bukan USDT Asli). Pesanan testnet terpisah ketat & bukan penjualan nyata.": "Uses Nimiq Testnet (NIM TESTNET) and Polygon Amoy (chain 80002 · TEST TOKEN, not real USDT). Test orders are separate and do not represent real sales.",
  "Menggunakan Nimiq Mainnet (NIM) & Polygon Mainnet (Chain ID 137 · USDT Kontrak 0xc213...8e8F). Transaksi memakai dana asli.": "Uses Nimiq Mainnet (NIM) and Polygon Mainnet (chain 137 · USDT contract 0xc213...8e8F). Transactions involve real funds.",
  "Kolom": "Category",
  "di pesanan": "in your order",
  "Catatan Kontrak TEST TOKEN Amoy (Chain 80002):": "Amoy TEST TOKEN contract (chain 80002):",
  "Kontrak ERC-20 uji belum dikonfigurasi di Pengaturan Seller. Kontrak USDT Mainnet (": "No test ERC-20 contract is configured in Seller Settings. The Mainnet USDT contract (",
  ") dilarang dipakai di Amoy. Mintalah persetujuan terlebih dahulu sebelum melakukan deployment kontrak token uji.": ") must not be used on Amoy. Obtain approval before deploying a test-token contract.",
  "Kontrak TEST TOKEN Amoy belum dikonfigurasi. Menampilkan QR tautan pesanan dengan identitas jaringan terkunci.": "No Amoy TEST TOKEN contract is configured. Showing the checkout-link QR with the invoice network locked.",
  "PERINGATAN MAINNET: Pesanan ini berada di jaringan MAINNET (Dana Asli). Centang persetujuan eksplisit di atas tombol sebelum mengirim transaksi dana asli.": "MAINNET WARNING: This invoice uses real funds. Explicit authorization is required before any real-money transaction.",
  "Jaringan Terkunci (Locked)": "Locked network",
  "Belum dikonfigurasi (Kontrak 0xc213...8e8F dilarang)": "Not configured (contract 0xc213...8e8F is prohibited)",
  "Pengaman Kontrak Polygon Amoy (Chain ID 80002):": "Polygon Amoy contract guard (chain 80002):",
  "Kontrak": "Contract",
  "belum dikonfigurasi pada toko ini. Sesuai aturan keamanan, NimTera": "is not configured for this shop. For safety, NimTera",
  "menolak penggunaan alamat kontrak USDT Mainnet": "rejects the Mainnet USDT contract",
  ") di Amoy. Mintalah persetujuan sebelum melakukan deployment kontrak token uji baru, atau gunakan fitur verifikasi hash transaksi nyata pada jaringan testnet yang sesuai.": ") on Amoy. Obtain approval before deploying a test token, or verify a real transaction hash on the matching testnet.",
  "Saya memahami pesanan ini berada di": "I understand that this invoice is on",
  "dan menyetujui pengiriman": "and authorize sending",
  "Tidak terdeteksi": "Not detected",
  "(Diverifikasi ketat hanya di RPC": "(Verified only through the matching RPC",
  "Deskripsi": "Description",
  "Larangan Keamanan": "Security restriction",
  "TESTNET · BUKAN PENJUALAN NYATA": "TESTNET · NOT REAL SALES",
  "MAINNET · PENJUALAN NYATA (DANA ASLI)": "MAINNET · REAL SALES (REAL FUNDS)",
  "Pemeriksaan Kesiapan Produksi Mainnet": "Mainnet production readiness",
  "membuktikan jalur USDT Mainnet, fee, atau relayer pasti identik.": "prove that Mainnet USDT transfers, fees or relayers behave identically.",
  "Jalankan Pemeriksaan Konfigurasi Mainnet": "Run Mainnet configuration check",
  "Status Kesiapan Mainnet:": "Mainnet readiness:",
  "✓ SIAP UJI NOMINAL KECIL": "✓ READY FOR AUTHORIZED SMALL-VALUE TESTING",
  "⚠ PERLU DILENGKAPI": "⚠ SETUP INCOMPLETE"
};

EXTRA_EN['Contoh: Nasi Goreng Kampung / Es Kopi Krim'] = 'Example: Country Fried Rice / Creamy Iced Coffee';

export function uiText(locale: SupportedLocale, source: string): string {
  return locale === 'id' ? source : EXTRA_EN[source] ?? source;
}

export const UI_LOCALE_KEY = 'nimtera.ui.locale';
export function savedUiLocale(storage?: Pick<Storage, 'getItem'>): SupportedLocale {
  try { const value = storage?.getItem(UI_LOCALE_KEY); if (['en','id','zh-CN','vi','ms','ru'].includes(value || '')) return value as SupportedLocale; } catch {}
  return 'en';
}

export function uiChoice(locale: SupportedLocale, indonesian: string, english: string): string {
  return locale === 'id' ? indonesian : english;
}
const CATEGORIES: Record<SupportedLocale, Record<string, [string, string]>> = {
  en: { food: ['Food & Mains','Main dishes and hearty meals'], drinks: ['Drinks & Coffee','Coffee, matcha and refreshing drinks'], dessert: ['Desserts','Sweet treats'], fruit: ['Fresh Fruit','Fresh seasonal fruit'], bakery: ['Bakery & Pastries','Bread and freshly baked pastries'], goods: ['Other Goods','Merchandise and other products'] },
  id: { food: ['Makanan','Hidangan utama & sajian mengenyangkan'], drinks: ['Minuman','Kopi, matcha & minuman segar'], dessert: ['Dessert','Hidangan penutup & camilan manis'], fruit: ['Buah Segar','Buah segar musiman'], bakery: ['Bakery & Roti','Roti & pastry segar'], goods: ['Lainnya','Merchandise & produk lainnya'] },
  'zh-CN': { food: ['主食','主菜与丰盛餐点'], drinks: ['饮品与咖啡','咖啡、抹茶与清爽饮品'], dessert: ['甜品','甜点与小食'], fruit: ['新鲜水果','时令鲜果'], bakery: ['面包与糕点','新鲜烘焙的面包和糕点'], goods: ['其他商品','周边与其他商品'] },
  vi: { food: ['Món chính','Các món chính đầy đặn'], drinks: ['Đồ uống & cà phê','Cà phê, matcha và đồ uống mát'], dessert: ['Tráng miệng','Món ngọt và đồ ăn nhẹ'], fruit: ['Trái cây tươi','Trái cây tươi theo mùa'], bakery: ['Bánh mì & bánh nướng','Bánh mì và bánh nướng mới ra lò'], goods: ['Hàng khác','Đồ lưu niệm và sản phẩm khác'] },
  ms: { food: ['Makanan','Hidangan utama yang mengenyangkan'], drinks: ['Minuman & Kopi','Kopi, matcha dan minuman segar'], dessert: ['Pencuci Mulut','Manisan dan kudapan'], fruit: ['Buah Segar','Buah segar bermusim'], bakery: ['Roti & Pastri','Roti dan pastri yang baru dibakar'], goods: ['Barangan Lain','Cenderamata dan produk lain'] },
  ru: { food: ['Основные блюда','Сытные основные блюда'], drinks: ['Напитки и кофе','Кофе, матча и освежающие напитки'], dessert: ['Десерты','Сладости и десерты'], fruit: ['Свежие фрукты','Свежие сезонные фрукты'], bakery: ['Хлеб и выпечка','Свежий хлеб и выпечка'], goods: ['Другие товары','Сувениры и другие товары'] },
};
export function categoryCopy(id: string, locale: SupportedLocale): { title: string; subtitle: string } {
  const [title, subtitle] = CATEGORIES[locale]?.[id] || CATEGORIES.en[id] || ['Other Goods','Other products'];
  return { title, subtitle };
}
