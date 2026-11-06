# NimTera

A NIM-only storefront, cashier and order-management app for independent sellers. Non-custodial and independent; not an official Nimiq product.

**Live app:** [nimtera.store](https://nimtera.store) · **Status:** testnet beta

## What you can do

- Learn the seller/customer flow from the six-language homepage guide and a 20-second silent interface demo with English captions. The video uses illustrative data, not a real payment.

- Register with **email/password** in a browser or with a **signed Nimiq Pay wallet proof** inside Nimiq Pay. Both paths open the same seller account/store after linking; neither requires mandatory 2FA. Optional authenticator setup is available in **Settings → Security**; once enabled, codes are required for sign-in and wallet changes.
- Choose **Day / Night** appearance across the homepage, seller workspace, catalog and checkout. Day uses ivory/gold; Night retains the approved graphite/gold palette. The explicit choice is saved on the device and synchronized between tabs.
- Manage products, prices, availability and orders from the seller workspace, including the inline cashier menu editor.
- Choose from **18 example product photos** or upload your own. Upload, replace or remove your shop logo in Settings; branding appears in the seller header and public storefront.
- Share your shop's `/s/your-shop-slug` link, or let customers choose items on your shop/restaurant’s cashier screen. Customers do not need an account.
- Receive direct wallet payments with invoice-locked recipient, asset, amount and network details. A submitted hash is not payment confirmation: the server checks chain evidence.
- Use six interface/voice languages: English, Indonesian, Simplified Chinese, Vietnamese, Malay and Russian. Cashier speech defaults to Indonesian for English/Indonesian setups and can be changed independently. Short confirmations read the actual amount, for example **“Pembayaran diterima, seribu nim.”**

Photo uploads support JPG, PNG and WebP up to 5 MB / 16 MP, with optimization and metadata removal. The current library limit is 100 distinct uploads per shop, including logos. Uploaded images use durable database storage in the cloud; they are public assets, not private documents. [Example-photo credits](public/products/CREDITS.md).

## Try the seller flow

1. Open [seller registration](https://nimtera.store/seller/setup). Choose email/password (15+ characters) or Nimiq Pay. The wallet path requires native wallet approval and a signed, expiring ownership proof before completing email, shop details and a separate NIM Testnet recipient. A password is optional for wallet-first registration; set one before email/PC login.
2. Add products and optionally upload your shop logo. Registration does **not** require an authenticator.
3. Share the storefront link or use the cashier. Check the invoice's network and recipient before testing a payment.
4. Enable cashier audio with a tap. Choose the speech language/voice in Settings. Device/browser voices determine quality; if no matching language voice exists, a visible notice explains the chime-only fallback.
5. Optionally enable 2FA in Settings → Security: confirm your password, scan the private authenticator QR, then confirm its code. Keep your backup safely; account recovery is not available yet.

## Networks and Nimiq Pay

**NIM-only. Mainnet payments are disabled.** The beta supports Nimiq TestAlbatross only. No other payment networks, tokens, swaps, conversion, custody or automatic refunds. Original orders using retired payment methods are preserved as read-only history; they cannot create wallet requests or be reverified as NIM.

**Checkout QR contains the snapshotted receiving address**, in the same format as a Nimiq Pay Receive QR. Buyers scan with Nimiq Pay on **Testnet**, enter the exact displayed total, check the recipient and approve. The QR does not carry the amount or invoice identity. It never overrides a merchant's receiving address or enables mainnet. No link-opening step is required for this path.

**New invoices detect address-QR payments automatically using a reserved unique total.** The product subtotal stays unchanged. A separately disclosed payment code of 0.01–0.99 NIM, in 0.01 NIM steps is added to the payable total. New totals use two decimal places; subtotals with finer precision are first rounded upward to the next 0.01 NIM and the complete adjustment is disclosed in the code line. Existing five-decimal invoices retain their original amounts and automatic verification. There are 99 candidate totals per subtotal/recipient; exhaustion never reuses history. Pay **every decimal exactly**; do not round. The server reserves the final amount globally for that recipient/Testnet across all retained orders and shops, including expired invoices; it never reuses historical amounts. Exhausted capacity stops new invoice creation instead of silently reusing a code.

The cashier dashboard or customer invoice polls the server, which reads recent incoming Testnet transactions at most once per receiving address per ten seconds. Exact value, recipient, network, successful inclusion, invoice time window and no-replay must all verify before payment is marked paid. No routine hash entry is required. Wrong nonempty invoice memos, ambiguous reservations and multiple matching transfers do not automatically confirm. RPC outages and truncated history are visible; only the latest 500 transactions can be inspected in one scan. The original prices and all existing invoice totals remain immutable.

**Keep the cashier page open and enable its audio for live payment announcements.** Either the dashboard or an open customer invoice can trigger server checks; this is request-driven monitoring, not an always-on worker or push notifications while all browsers are closed. Browser background/locked-screen audio is not guaranteed. Timely payments may be discovered after invoice expiry, but new late payments cannot confirm.

**Legacy invoices without a unique code retain cashier receipt review.** In Seller → Orders, the cashier checks the payer/order relationship, enters the real hash and explicitly confirms the match (fresh 2FA if enabled). The server verifies the actual Testnet receipt before marking paid and writing an audit record. This is also the optional fallback for ambiguous cases. Public hash verification remains memo-strict. The optional Mini App Pay button retains exact-amount, memo-bound verification. Mainnet payments remain disabled.

The app includes the Nimiq Pay Mini App SDK payment path. Native sends require a verified matching Nimiq testnet host and supported browser capabilities. Unknown/mainnet hosts are blocked; unknown transaction outcomes must be checked before retrying.

Wallet sign-in uses the official Mini App SDK's account access and message signing. Opening Nimiq Pay, listing an address or typing a payment recipient is **not** ownership proof. The server verifies the Nimiq signed-message Ed25519 signature and the public-key-derived address against a five-minute, one-use challenge bound to origin, purpose, browser flow and (for account changes) the current authenticated session. Failed proofs consume their nonce too; challenges persist across cloud instances.

Email-first sellers link a wallet in **Settings → Wallet sign-in** with their current password and enabled 2FA. Wallet-first sellers set an email password there using a fresh proof from their linked wallet; password changes also require the old password when one exists. Removing a wallet requires an existing email password and enabled 2FA; the final sign-in method cannot be removed. An existing email or already-linked wallet is never automatically merged into another account. Optional 2FA remains enforced for wallet sign-in and sensitive changes once enabled. Credential changes revoke other sessions.

Wallet authentication is off-chain and can use a known mainnet or testnet Nimiq Pay host. **It does not send NIM or enable mainnet payments.** The receiving address remains separate; a mainnet login wallet is not automatically copied into the testnet recipient. QR account pairing is not implemented. Physical Nimiq Pay authentication/payment compatibility still needs on-device verification; SDK simulations and web deployment are not proof of it.

## Development

Requires Node.js **22.12+**.

```sh
npm ci
cp .env.example .env
# Configure a private, random SESSION_SECRET of at least 64 characters.
npm test
npm run build
npm run dev
```

Use `.env.example` for configuration. Never commit credentials or local data. The standalone server uses private local storage for one process; Vercel uses transactional PostgreSQL and does not fall back to temporary files for cloud accounts or uploads. Hosted operation requires a dedicated `DATABASE_URL`, `SESSION_SECRET` and correct `APP_URL`. `npm run build:ui` is a separate sample-only build, not the working application.

## Verification and beta limitations

Latest application validation: **53 unit/security/SQL/theme/wallet/checkout tests**, TypeScript/build/API smoke, and **21 local browser tests** passed (wallet approval is simulated with real Ed25519 proofs, not a physical device). Real local API tests cover registration without 2FA, later optional activation, durable sessions, products, logos, tenant isolation and preservation of retired-payment SQL history. Day/Night tests check saved preferences, cross-tab synchronization, all six theme labels, text contrast and phone-width layouts. Production frontend checks passed with fixture merchant APIs; they are not real production-account or physical payment tests.

```sh
npm run lint
npm test
npm run build
npx playwright install chromium
PLAYWRIGHT_BASE_URL= PLAYWRIGHT_AUTH_E2E=1 npm run test:browser
```

The isolated browser fixture creates no production accounts. Do not run real-account fixture tests against production. TTS tests simulate voices and cannot certify how a phone sounds.

This is a bounded testnet beta, not an audited high-volume production service. Account recovery, real-device payment validation and load/security review remain outstanding. Audio tab coordination is limited to the same browser profile. On Vercel, pending payments are reconciled when checkout/dashboard requests occur; there is no unattended permanent worker. Wallet changes affect future invoices only.

[Security](SECURITY.md) · [Privacy](PRIVACY.md)
