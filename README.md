# NimTera — Your shop. Every payment.

**Canonical Production Domain:** `https://nimtera.store`

NimTera is an independent point-of-sale (cashier) and order management web application for in-person and online shops with native payment checkout in **Nimiq Pay**. NimTera is not an official Nimiq product and is a completely separate project from StakeSafe.

---

## 1. Supported Mainnet Networks & Assets (v1)

1. **NIM on Nimiq Mainnet**
   - Base unit arithmetic: `1 NIM = 100,000 Luna` (`5` decimals) stored and calculated using `BigInt`.
   - Address format: `NQ` + 2 check digits + 32 base-32 characters validated via IBAN **MOD-97-10** checksum.
   - Native Pay integration: Uses `@nimiq/mini-app-sdk` / `window.nimiq` (`sendBasicTransactionWithData` / `sendBasicTransaction`) inside Nimiq Pay WebView, and standardized `nimiq:<address>?amount=<NIM>&message=<memo>` URIs.

2. **USDT on Polygon Mainnet (Chain ID 137)**
   - Verified Token Contract: `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` (`6` decimals, `1 USDT = 1,000,000 micro-USDT`).
   - Native Pay integration: Uses injected EIP-1193 provider (`window.ethereum`), enforces Chain ID `137` (`0x89`) wrong-chain guard, and encodes direct ERC-20 `transfer(address,uint256)` calldata (`0xa9059cbb...`) without requesting token allowances.
   - On-chain verification: Inspects transaction receipt (`status === "0x1"`) and verifies the `Transfer(address,address,uint256)` event topic (`0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef`) emitted specifically by `0xc2132D05D31c914a87C6611C10748AEb04B58e8F`.

### Out of Scope in v1 (By Design)
- No automatic NIM ↔ USDT swaps or exchange-rate conversions.
- No POL payments.
- No custodial escrow, server-side wallets, or automatic refunds.
- Never requests seed phrases or private keys.

---

## 2. Application Routes

### Customer (No Login Required)
- `/s/:storeSlug` — Storefront, menu catalog, cart, and asset selector (e.g., `/s/moonlight-cafe` and `/s/aurora-roasters`).
- `/s/:storeSlug/order/:publicToken` — Order checkout, static QR code, Nimiq Pay launch button, and live payment/fulfillment status (e.g., `/s/moonlight-cafe/order/nt_ord_moonlight024`).

### Seller (Authenticated + 2FA)
- `/seller/login` — Merchant login (15+ character password, breached-password rejection, Turnstile CAPTCHA check, progressive backoff, and 6-digit RFC 6238 TOTP 2FA).
- `/seller/setup` — One-time store & recipient wallet onboarding.
- `/seller/counter` — In-person Cashier POS.
- `/seller/orders` — Live order queue & on-chain verification console.
- `/seller/products` — Product catalog & manual dual-asset pricing manager.
- `/seller/reports` — Strictly separated NIM & Polygon USDT volume reports, CSV export, and Audit Log.
- `/seller/settings` — Re-authenticated + 2FA wallet updates and 6-language audio/voice announcement settings.

---

## 3. Running Locally & Testing

```bash
# Run unit tests (monetary math, address checksums, cart compatibility, payment reconciliation)
npm test

# Start full-stack Express + Vite server on port 3000
npm run dev

# Production build
npm run build
```
