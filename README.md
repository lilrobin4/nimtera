# NimTera

A Night Market-style catalog, cashier and order-management app. Independent project; not an official Nimiq product.

## Current scope

**Testnet beta only.** NIM TestAlbatross and, after configuration, a six-decimal ERC-20 TEST TOKEN on Polygon Amoy (80002). Mainnet checkout and native sends are hard-disabled. No conversion, swaps, POL acceptance, custody or automatic refunds.

The full application source now includes a Vercel API adapter and transactional PostgreSQL persistence. This is **not a claim that database provisioning, cloud-runtime validation or real-device payments are complete**. `/api/health` and the real application homepage report missing service configuration instead of substituting a demo.

## Local development

Use Node.js 22.12+.

```sh
npm ci
cp .env.example .env
# Generate a random SESSION_SECRET (at least 64 characters),
# CAPTCHA is intentionally not used. Password, TOTP and rate limits remain enabled.
npm test
npm run build
npm run dev
```

The standalone local server uses private `.data/store.json` (one process only). Open `/seller/setup`, create your own account, scan the private authenticator QR, and confirm its code. Add products and share `/s/your-shop-slug`. No seeded accounts or public TOTP helper exist. CAPTCHA was removed from registration and login at the owner’s request.

Initial wallet addresses are testnet profiles. Wallet changes require password and TOTP and affect only future invoices. Invoice recipient, asset, amount, token and network snapshots stay locked.

## Full application on Vercel

`vercel.json` builds the **real application** with `npm run build`, serves `dist`, and routes `/api/*` to `api/index.ts`. Do not build `build:ui` for a functioning application.

Required private project environment variables:

- `DATABASE_URL` (or `POSTGRES_URL`): a dedicated pooled PostgreSQL TESTNET connection URL with TLS (`sslmode=verify-full` recommended). Never use another project's production data.
- `SESSION_SECRET`: random secret of at least 64 characters; do not rotate casually because existing sessions become invalid.
- `APP_URL`: the actual chosen application origin; not an unverified custom-domain claim.
- `NIMIQ_TESTNET_RPC_URL`: a working testnet node; the example provides a read-tested default, not an availability guarantee.
- Optional Amoy: `POLYGON_AMOY_RPC_URL` and `POLYGON_AMOY_TEST_TOKEN_CONTRACT`. Without these, Amoy checkout is unavailable, not routed to mainnet.

For Supabase hosts, the backend bundles the public official production CA and verifies both its certificate chain and hostname. URL SSL options cannot override this verified configuration.

No temporary filesystem fallback is permitted for cloud account creation. CAPTCHA is not required or contacted. Keep secrets in Vercel Environment Variables, not source, screenshots, chat or public files. Cloud health returns 503 until database connectivity and session security are present. Presence checks are not proof that credentials or payment flows work end-to-end.

### Persistence and concurrency

The bounded testnet implementation stores a versioned JSONB state in PostgreSQL (`migrations/001-testnet-state.sql`). Requests use row-level database transactions, AsyncLocalStorage-isolated request state, and shared persisted sessions/rate limits. HTTP success is released **only after COMMIT**. Invalid business requests cannot leave partial product/order changes; authentication failure counters remain durable. Errors roll back and return 503, not fabricated success. Missing or invalid cloud DB configuration never falls back to local JSON.

This is intentionally a serialized-write beta design with capacity/time limits, **not a high-volume production database schema**. Requests including RPC checks can contend for the testnet row; lock timeouts return retryable 503. Normalize tables and optimize read/write paths before high traffic. Managed database provisioning, network PostgreSQL concurrency and cloud deployment behavior still require validation against the chosen service.

### Payment reconciliation

Customers provide only hash hints. The server independently checks RPC evidence, network, recipient, invoice binding, amount and execution. Confirmed receipts are terminal; hashes bind only after successful verification. NIM uses the full invoice memo. Amoy binds a signed payer intent before send and checks matching transfer events, canonical receipt block and five confirmations.

A standalone server has an eight-second pending checker. On Vercel there is no permanent interval: checkout status reads and seller dashboard reads reconcile due pending hashes, with a persisted cooldown. If no client or seller is viewing, no continuous worker runs; an external authenticated scheduler is needed for unattended reconciliation. No background-process promise is implied.

Native sends require matching known host/chain metadata, official SDK support and Web Locks. Unknown outcomes are journaled locally to prevent blind replay. Do not clear a journal to resend an uncertain payment; inspect wallet history and verify its hash instead.

## Validation

```sh
npm run lint
npm test
npm run build
```

Tests include isolated HTTP auth/enrollment/catalog/order flows, cross-app-instance sessions, PGlite PostgreSQL-engine transaction/rollback/commit-failure tests, request-context isolation, and mock RPC/native host tests. PGlite tests are not proof of network PostgreSQL multi-connection behavior. Mocks are not real-device or chain-broadcast tests.

Still required before operational readiness: actual cloud DB setup and full browser validation, native Nimiq Pay testnet availability, real testnet payments, approved token decimal verification, six-language UI/audio completeness, account recovery, unattended scheduler choice, load/security review, HTTPS/domain approval. No mainnet transaction or custom-domain deployment is authorized by this README.

## UI-only preview (separate maintenance build)

`npm run build:ui` remains available for an explicitly labeled static sample catalog. It is not the full app. An older deployed UI-only snapshot does not update merely because local source changed. Confirm the exact Vercel deployment before treating a link as the full application.

## Historical secrets

Old demo credentials/database material existed in Git history. Current deletion does not erase history. Treat old credentials as compromised, never restore the demo DB, rotate anything reused and keep private backups outside the repository. Git history has not been rewritten.
