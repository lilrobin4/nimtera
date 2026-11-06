# NimTera Security Policy

## 1. Non-Custodial Payment Architecture
- NimTera never holds, escrows, or routes customer or merchant funds through a server wallet.
- NimTera never asks for seed phrases, recovery words, or private keys.
- Every order stores an immutable **recipient wallet snapshot** (`snapshotRecipient`, `asset`, `network`, `amountBase`) at order creation time. If a merchant updates their wallet address later, existing orders are never silently redirected.

## 2. Merchant Authentication & Access Control
- **Password Policy:** Minimum 15 characters, supporting password managers and paste, verified against common breached password patterns, and hashed using salted `node:crypto` `scrypt` with constant-time comparison (`timingSafeEqual`).
- **Two-Factor Authentication (2FA):** RFC 6238 TOTP 6-digit verification is enforced on seller login and on any recipient wallet update.
- **Store Isolation:** Backend authorization middleware scopes all seller queries and mutations strictly to the authenticated seller's `storeSlug`. One merchant can never read or modify another merchant's products, wallets, or orders.

## 3. On-Chain Payment Verification & Anti-Replay
- Browser-submitted transaction hashes are treated as untrusted hints until verified against allowlisted Nimiq Mainnet or Polygon Mainnet RPC endpoints.
- **Polygon USDT Verification:** Verifies Chain ID `137`, `receipt.status === "0x1"`, and the `Transfer(address,address,uint256)` event log from contract `0xc2132D05D31c914a87C6611C10748AEb04B58e8F`.
- **Anti-Replay:** Every verified `txHash` is bound atomically to a single `orderId`. Attempting to reuse a transaction hash on a second order is rejected.
- **Ambiguous States (`needs_review`):** Underpayments, overpayments, wrong-contract transfers, and post-expiry confirmations are routed to `needs_review`. Upstream RPC timeouts keep the order in `pending` and never falsely mark a payment as failed.
