# NimTera Security

NimTera is an independent **testnet beta**, not an audited production payment service. Mainnet checkout and native mainnet sends are disabled.

## Accounts

- Seller passwords must contain at least 15 characters. Password managers and paste are supported; passwords are salted and hashed rather than stored as plain text.
- Authenticator 2FA is **optional at registration**. Enable it later in **Settings → Security** using your current password and a valid setup code. Once enabled, login and receiving-wallet changes require the authenticator code.
- Setup QR codes and keys are private. Setup requires reauthentication, expires after ten minutes and is tied to the initiating session. Enabling 2FA revokes other account sessions.
- Sessions use a host-only HttpOnly cookie valid for up to eight hours. Authentication, setup and sensitive actions have request limits; cookie-based mutations check browser origins.
- Backend authorization scopes seller operations to the authenticated shop. Optional 2FA does not remove password reauthentication for wallet changes.
- Automatic account recovery and self-service 2FA removal are not available. Keep your authenticator backup safely.

## Wallets and payments

- The app does not request seed phrases or private keys, hold merchant funds or initiate automatic refunds.
- Each invoice fixes its recipient, asset, amount, network and applicable token details. Later wallet edits do not redirect existing invoices.
- Browser-supplied hashes are untrusted hints. The server checks matching testnet chain evidence before confirming a payment and guards against reusing a verified transaction for another order.
- NIM Testnet is the only active payment route. Retired payment fields are rejected; stored legacy receipts remain read-only and are never relabeled as NIM.
- An RPC timeout or unknown wallet outcome is not evidence of failure. Check the order and wallet history before sending again.
- Wallet binding and wallet-signature seller login are not available yet. A wallet address alone is not proof of ownership.

## Uploads and privacy

Product photos and shop logos are public assets. Only upload images you are permitted to publish. Supported raster uploads are size-limited, validated and re-encoded without original metadata; SVG uploads are not accepted. The backend checks image ownership before attaching an uploaded image to a shop or product.

## Reporting a concern

Contact the [repository owner](https://github.com/lilrobin4) through an available private channel. Do not put passwords, tokens, authenticator keys, customer data or working exploit details in public issues. If no private channel is listed, request a private reporting method without including sensitive details.

Never reuse credentials from historical demo versions or commit real environment files. A passing test suite is not a security audit or a guarantee of physical wallet compatibility.
