# NimTera

A Night Market-style storefront, cashier and order-management app for independent sellers. Non-custodial and independent; not an official Nimiq product.

**Live app:** [nimtera.store](https://nimtera.store) · **Status:** testnet beta

## What you can do

- Register a seller account and open the dashboard without mandatory 2FA. Optional authenticator setup is available in **Settings → Security**; once enabled, codes are required for sign-in and wallet changes.
- Manage products, prices, availability and orders from the seller workspace, including the inline cashier menu editor.
- Choose from **18 example product photos** or upload your own. Upload, replace or remove your shop logo in Settings; branding appears in the seller header and public storefront.
- Share your shop's `/s/your-shop-slug` link. Customers can browse and order without creating an account.
- Receive direct wallet payments with invoice-locked recipient, asset, amount and network details. A submitted hash is not payment confirmation: the server checks chain evidence.
- Use six interface/voice languages: English, Indonesian, Simplified Chinese, Vietnamese, Malay and Russian. Cashier speech defaults to Indonesian for English/Indonesian setups and can be changed independently. Short confirmations read the actual amount, for example **“Pembayaran diterima, seribu nim.”**

Photo uploads support JPG, PNG and WebP up to 5 MB / 16 MP, with optimization and metadata removal. The current library limit is 100 distinct uploads per shop, including logos. Uploaded images use durable database storage in the cloud; they are public assets, not private documents. [Example-photo credits](public/products/CREDITS.md).

## Try the seller flow

1. Open [seller registration](https://nimtera.store/seller/setup) and use your own email, a password of at least 15 characters, shop details and a matching testnet receiving address.
2. Add products and optionally upload your shop logo. Registration does **not** require an authenticator.
3. Share the storefront link or use the cashier. Check the invoice's network and recipient before testing a payment.
4. Enable cashier audio with a tap. Choose the speech language/voice in Settings. Device/browser voices determine quality; if no matching language voice exists, a visible notice explains the chime-only fallback.
5. Optionally enable 2FA in Settings → Security: confirm your password, scan the private authenticator QR, then confirm its code. Keep your backup safely; account recovery is not available yet.

## Networks and Nimiq Pay

**Mainnet payments are disabled.** The beta supports Nimiq TestAlbatross and, only when configured, an approved six-decimal TEST TOKEN on Polygon Amoy (80002). The Amoy token is not real USDT. No swaps, conversion, POL acceptance, custody or automatic refunds.

The app includes the Nimiq Pay Mini App SDK payment path. Native sends require a verified matching testnet host/chain and supported browser capabilities. Unknown/mainnet hosts are blocked; unknown transaction outcomes must be checked before retrying.

**Wallet binding, QR account pairing and wallet-signature seller login are not implemented yet.** Opening the app inside Nimiq Pay does not automatically authenticate a seller. Physical Nimiq Pay/testnet payment compatibility still needs on-device verification; do not treat the web deployment as proof of it.

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

Use `.env.example` for configuration. Never commit credentials or local data. The standalone server uses private local storage for one process; Vercel uses transactional PostgreSQL and does not fall back to temporary files for cloud accounts or uploads. Hosted operation requires a dedicated `DATABASE_URL`, `SESSION_SECRET` and correct `APP_URL`; Amoy configuration is optional. `npm run build:ui` is a separate sample-only build, not the working application.

## Verification and beta limitations

Latest application validation: **40 unit/security/SQL tests**, TypeScript/build/API smoke, and **10 local browser tests** passed. Real local API tests cover registration without 2FA, later optional activation, durable sessions, products, logos and tenant isolation. Production frontend checks passed with fixture merchant APIs; they are not real production-account or physical payment tests.

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
