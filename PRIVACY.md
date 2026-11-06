# NimTera Privacy

**Updated:** 6 November 2026

**Current application:** https://nimtera.store

NimTera is an independent testnet beta. This notice describes the current app; the custom domain is active, but mainnet payment support remains disabled.

## Seller accounts

The service stores the seller email, password hash, shop profile, configured receiving addresses, products, orders and account-security state. Authenticator 2FA is optional and can be enabled in Settings → Security; its setup secret must be kept private. Passwords, wallet seed phrases and private keys should never be shared with other users or posted in the repository. NimTera does not ask for wallet seed phrases or private keys.

If you use wallet sign-in, the service also stores your linked public wallet address and public key, not private keys. Short-lived challenges and an essential browser-binding cookie are used to verify wallet approval. Linking a wallet does not merge separate accounts or replace the receiving address automatically.

Seller login uses an essential HttpOnly session cookie valid for up to eight hours. Device storage retains interface language, Day/Night appearance, audio preferences and limited audio-deduplication/tab-coordination information. Payment-attempt journals help prevent an uncertain native send from being repeated blindly; do not clear them to retry before checking wallet history.

## Customers and orders

Customers do not need an account to browse or place orders. Sellers receive the details needed to fulfill their own shop's orders. Delivery contact information is collected when delivery is selected and is excluded from public order responses.

Keep order links private: anyone holding an order link can view its public order summary and payment status. They are not a substitute for authenticated seller access. Public shop names, catalog details and prices are visible to visitors.

## Photos and logos

Uploaded product photos and shop logos are public assets, not private documents. Images are optimized and re-encoded without original metadata. Replacing/removing a logo or deleting a product removes its use in that location; it does not promise erasure of the immutable image file or already cached copies. Only upload images you have permission to publish.

## Wallets and speech

Wallet addresses, transaction hashes and transfer amounts can be public on the Nimiq test network. Mainnet payments are disabled in this release.

Cashier speech uses the browser/device's available voices. Depending on the selected voice and operating system, the speech provider may process announcement text using an online service. Current announcements contain payment status, nominal amount and asset, not email, delivery contact information or full order identifiers.

## Storage and account requests

Cloud account, order and uploaded-image data uses the configured application database; standalone development stores data locally. Do not put real customer information into sample or test accounts.

Self-service account deletion, automatic account recovery and an automated retention policy are not available in this beta. For account/privacy requests, contact the [repository owner](https://github.com/lilrobin4) through an available private channel without posting credentials or customer details publicly. Contact the relevant seller about fulfillment and order questions. No blanket guarantee of immediate deletion from database backups, browser caches or public blockchain records is made.
