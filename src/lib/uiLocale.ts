import type { SupportedLocale } from './i18n';

// Legacy UI copy moved into an explicit English/Indonesian catalog.
// Other missing locale entries fall back to English, never silently to Indonesian.
export const EXTRA_EN: Record<string, string> = {
  "Arsip pesanan — hanya baca": "Archived order — read only",
  "Metode pembayaran ini tidak lagi aktif. Riwayat asli tetap disimpan. Jangan kirim pembayaran untuk pesanan ini.": "This payment method is no longer active. The original receipt is preserved. Do not send a payment for this order.",
  "Kembali ke toko": "Back to shop",
  "Diagnostik Nimiq Pay dan ketersediaan testnet": "Nimiq Pay host and testnet availability",
  "Harga NIM wajib diisi.": "A valid NIM price is required.",
  "Harga NIM belum tersedia": "NIM price not available",
  "Harga NIM": "NIM price",
  "Menggunakan Nimiq Testnet (NIM TESTNET). Pesanan uji terpisah dari penjualan nyata.": "Uses Nimiq Testnet (NIM TESTNET). Test orders are separate from real sales.",
  "Pembayaran Mainnet belum tersedia. Jangan mengirim dana asli.": "Mainnet payments are not enabled. Do not send real funds.",
  "Pilih kategori menu dan atur harga dalam NIM.": "Choose a menu category and set prices in NIM.",
  "Atur harga menu dalam NIM. Tidak ada konversi kurs otomatis.": "Set menu prices in NIM. No automatic exchange-rate conversion.",
  "Riwayat pembayaran NIM Mainnet terverifikasi. Pembayaran baru tetap dinonaktifkan.": "Verified historical NIM Mainnet payments. New Mainnet payments remain disabled.",
  "Nimiq Testnet — bukan dana asli dan tidak digabung ke omzet nyata": "Nimiq Testnet — not real funds, never combined with real revenue",
  "membuktikan kesiapan pembayaran Mainnet.": "prove Mainnet payment readiness.",

  "Format harga NIM tidak valid (maksimal 5 desimal).": "Invalid NIM price (up to 5 decimal places).",
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
  "Menu dipisahkan per kolom kategori: Makanan, Minuman, Dessert, Buah Segar, Bakery & Lainnya": "Browse categories: Food, Drinks, Desserts, Fresh Fruit, Bakery and Other Goods",
  "Tutup Form Menu": "Close item form",
  "+ Tambah Menu & Harga": "+ Add item and prices",
  "Edit Menu & Harga": "Edit item and prices",
  "Tambah Menu & Harga Baru": "Add a new item and prices",
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
  "Harga NIM (opsional)": "NIM price (optional)",
  "+ Simpan Menu & Harga ke Katalog": "+ Save item and prices to catalog",
  "Katalog Menu & Harga per Kolom (": "Catalog by category (",
  "Hapus menu": "Delete item",
  "· Laporan Testnet dipisahkan ketat dari penjualan nyata Mainnet.": "· Testnet reports are separate from real Mainnet sales.",
  "TESTNET · PENGUJIAN SANDBOX (BUKAN PENJUALAN NYATA)": "TESTNET · TESTING ONLY (NOT REAL SALES)",
  "Total NIM (TESTNET) Terverifikasi": "Total verified NIM (TESTNET)",
  "Pesanan Testnet Terverifikasi": "Verified testnet orders",
  "Khusus pengujian 2 perangkat · Bukan penjualan nyata": "For multi-device testing · Not real sales",
  "Profil wallet penerima disimpan terpisah untuk": "Recipient wallet profiles are stored separately for",
  "dan": "and",
  ". Setiap pesanan mengunci alamat penerima saat dibuat.": ". Each invoice locks its recipient address when created.",
  "1. Profil Wallet TESTNET (Default Pengujian)": "1. TESTNET wallet profile (default for testing)",
  "Larangan Keamanan:": "Security restriction:",
  "(Simpan Profil Testnet & Mainnet)": "(Save Testnet and Mainnet profiles)",
  "Sebelum produksi Mainnet, jalankan pemeriksaan konfigurasi dan uji Mainnet nominal kecil yang disetujui pengguna. Keberhasilan Testnet": "Before Mainnet use, complete configuration checks and authorized small-value testing. Testnet success",
  "tidak": "does not",
  "✗ Belum": "✗ Not ready",
  "Kolom": "Category",
  "di pesanan": "in your order",
  "PERINGATAN MAINNET: Pesanan ini berada di jaringan MAINNET (Dana Asli). Centang persetujuan eksplisit di atas tombol sebelum mengirim transaksi dana asli.": "MAINNET WARNING: This invoice uses real funds. Explicit authorization is required before any real-money transaction.",
  "Jaringan Terkunci (Locked)": "Locked network",
  "Belum dikonfigurasi (Kontrak 0xc213...8e8F dilarang)": "Not configured (contract 0xc213...8e8F is prohibited)",
  "Kontrak": "Contract",
  "belum dikonfigurasi pada toko ini. Sesuai aturan keamanan, NimTera": "is not configured for this shop. For safety, NimTera",
  "Saya memahami pesanan ini berada di": "I understand that this invoice is on",
  "dan menyetujui pengiriman": "and authorize sending",
  "Tidak terdeteksi": "Not detected",
  "(Diverifikasi ketat hanya di RPC": "(Verified only through the matching RPC",
  "Deskripsi": "Description",
  "Larangan Keamanan": "Security restriction",
  "TESTNET · BUKAN PENJUALAN NYATA": "TESTNET · NOT REAL SALES",
  "MAINNET · PENJUALAN NYATA (DANA ASLI)": "MAINNET · REAL SALES (REAL FUNDS)",
  "Pemeriksaan Kesiapan Produksi Mainnet": "Mainnet production readiness",
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
