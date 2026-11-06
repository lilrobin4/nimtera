import React, { useState } from 'react';
import { X, Shield, Lock, Globe, Smartphone, BookOpen } from 'lucide-react';
import { POLYGON_USDT_CONTRACT } from '../lib/domain';

interface DocsAndPoliciesModalProps {
  open: boolean;
  onClose: () => void;
}

export const DocsAndPoliciesModal: React.FC<DocsAndPoliciesModalProps> = ({ open, onClose }) => {
  const [tab, setTab] = useState<'readme' | 'security' | 'privacy' | 'domain' | 'demo'>('readme');

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="docs-modal-title"
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 overflow-y-auto"
    >
      <div className="bg-[#131C2E] border border-slate-700 rounded-2xl max-w-3xl w-full max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <BookOpen className="w-5 h-5 text-[#DFC496]" />
            <h2 id="docs-modal-title" className="text-lg font-semibold text-[#F3F4F6]">
              NimTera Architecture, Security, Privacy & Deployment Guide
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close documentation"
            className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 pt-3 border-b border-slate-800 flex items-center gap-2 overflow-x-auto">
          {(
            [
              { id: 'readme', label: 'README & Overview', icon: BookOpen },
              { id: 'security', label: 'Security Policy', icon: Shield },
              { id: 'privacy', label: 'Privacy Policy', icon: Lock },
              { id: 'domain', label: 'nimtera.store DNS & Deploy', icon: Globe },
              { id: 'demo', label: '3-Device Demo Guide', icon: Smartphone },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`px-3.5 py-2 text-xs font-medium rounded-t-lg border-b-2 flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                  active
                    ? 'border-[#14B8A6] text-[#2DD4BF] bg-[#182338]'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-4 text-xs sm:text-sm text-slate-300 leading-relaxed">
          {tab === 'readme' && (
            <div className="space-y-3">
              <h3 className="text-base font-semibold text-[#DFC496]">
                NimTera — Your shop. Every payment.
              </h3>
              <p>
                NimTera is an independent point-of-sale (cashier) and online order management mini
                app designed for native payments in <strong>Nimiq Pay</strong>. It is a standalone
                project and is not an official Nimiq product.
              </p>
              <div className="p-3.5 rounded-xl bg-[#0B101C] border border-slate-800 space-y-2">
                <div className="font-semibold text-[#F3F4F6]">Supported Mainnet Assets (v1):</div>
                <ul className="list-disc pl-5 space-y-1 text-xs">
                  <li>
                    <strong>NIM on Nimiq Mainnet</strong> — Precision: <code className="font-mono">1 NIM = 100,000 Luna</code> (5 decimals), MOD-97-10 IBAN checksum validated.
                  </li>
                  <li>
                    <strong>USDT on Polygon Mainnet (Chain ID 137)</strong> — Verified ERC-20 contract{' '}
                    <code className="font-mono text-[#2DD4BF]">{POLYGON_USDT_CONTRACT}</code>, Precision:{' '}
                    <code className="font-mono">6 decimals</code> (<code className="font-mono">1,000,000 micro-USDT</code>).
                  </li>
                </ul>
              </div>
              <p className="text-xs text-slate-400">
                <strong>Non-Custodial Scope:</strong> NimTera never asks for seed phrases or private
                keys, never holds merchant or customer funds in escrow, never performs automatic
                currency swaps or exchange-rate conversions, does not accept native POL as a payment
                asset, and never auto-broadcasts transactions without explicit user confirmation in
                Nimiq Pay.
              </p>
            </div>
          )}

          {tab === 'security' && (
            <div className="space-y-3">
              <h3 className="text-base font-semibold text-[#DFC496]">
                Security Policy & Cryptographic Controls
              </h3>
              <ul className="list-disc pl-5 space-y-2 text-xs">
                <li>
                  <strong>Merchant Authentication:</strong> Passwords must be at least 15 characters
                  long, checked against breached passphrase lists, and hashed server-side using
                  salted <code className="font-mono">node:crypto scrypt</code> with constant-time{' '}
                  <code className="font-mono">timingSafeEqual</code> verification.
                </li>
                <li>
                  <strong>2FA & Wallet Updates:</strong> Every merchant login and recipient wallet
                  change requires RFC 6238 6-digit TOTP 2FA verification. Changing a wallet logs both
                  the old and new addresses in the immutable Audit Log and never alters the
                  recipient snapshot of previously created orders.
                </li>
                <li>
                  <strong>Server-Authoritative Pricing & Reconciliation:</strong> The backend
                  recomputes all cart totals in smallest integer units (<code className="font-mono">BigInt</code>)
                  from trusted catalog records. On-chain transaction hashes are bound with a unique
                  atomic constraint so a single transaction hash can never settle two orders.
                </li>
                <li>
                  <strong>Polygon USDT Verification:</strong> The verifier inspects the transaction
                  receipt on Chain ID 137 and parses the ERC-20 <code className="font-mono">Transfer(address,address,uint256)</code>{' '}
                  event emitted specifically by <code className="font-mono">{POLYGON_USDT_CONTRACT}</code>.
                </li>
              </ul>
            </div>
          )}

          {tab === 'privacy' && (
            <div className="space-y-3">
              <h3 className="text-base font-semibold text-[#DFC496]">
                Privacy Policy & Customer Data Minimization
              </h3>
              <ul className="list-disc pl-5 space-y-2 text-xs">
                <li>
                  <strong>Zero Customer Account Requirement:</strong> Customers browse, order, and
                  pay without creating an account or logging in.
                </li>
                <li>
                  <strong>Unlisted Public Order Tokens:</strong> Each order is accessed via a
                  high-entropy capability token (<code className="font-mono">/s/:slug/order/:publicToken</code>).
                  Customers cannot enumerate or read the full order table.
                </li>
                <li>
                  <strong>Delivery Data Protection:</strong> When Delivery is selected, recipient
                  name, phone number, and address are stripped from public order endpoints and are
                  only visible to the authenticated merchant of that specific store.
                </li>
              </ul>
            </div>
          )}

          {tab === 'domain' && (
            <div className="space-y-3">
              <h3 className="text-base font-semibold text-[#DFC496]">
                Domain Configuration Guide — https://nimtera.store
              </h3>
              <p className="text-xs">
                Once deployment is approved, connect the apex domain{' '}
                <code className="font-mono text-[#2DD4BF]">nimtera.store</code> and redirect{' '}
                <code className="font-mono">www.nimtera.store</code> to{' '}
                <code className="font-mono">https://nimtera.store</code>:
              </p>
              <div className="p-3.5 rounded-xl bg-[#0B101C] border border-slate-800 font-mono text-xs space-y-1.5">
                <div className="text-slate-400"># Recommended DNS Records at your Registrar:</div>
                <div>Type: A     | Name: @   | Value: [Hosting Load Balancer IP] | TTL: 3600</div>
                <div>Type: CNAME | Name: www | Value: nimtera.store               | TTL: 3600</div>
              </div>
              <ul className="list-disc pl-5 space-y-1 text-xs text-slate-400">
                <li>Set environment variable <code className="font-mono">APP_URL="https://nimtera.store"</code>.</li>
                <li>Add <code className="font-mono">nimtera.store</code> to Cloudflare Turnstile allowed hostnames and configure <code className="font-mono">VITE_TURNSTILE_SITE_KEY</code> + <code className="font-mono">TURNSTILE_SECRET_KEY</code>.</li>
                <li>Do not modify any DNS, database, or deployment belonging to StakeSafe.</li>
              </ul>
            </div>
          )}

          {tab === 'demo' && (
            <div className="space-y-3">
              <h3 className="text-base font-semibold text-[#DFC496]">
                Three-Device Live Demo Walkthrough
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="p-3.5 rounded-xl bg-[#0B101C] border border-slate-800 space-y-1.5">
                  <div className="font-semibold text-[#2DD4BF]">Device 1 — Kiosk / Menu</div>
                  <p className="text-slate-400">
                    Open <code className="font-mono">/s/moonlight-cafe</code>. Select items, choose
                    NIM or Polygon USDT, and click <strong>Create payment</strong>.
                  </p>
                </div>
                <div className="p-3.5 rounded-xl bg-[#0B101C] border border-slate-800 space-y-1.5">
                  <div className="font-semibold text-[#2DD4BF]">Device 2 — Customer Wallet</div>
                  <p className="text-slate-400">
                    Scan the static QR or open the order link in Nimiq Pay. Verify the merchant
                    recipient address and confirm payment.
                  </p>
                </div>
                <div className="p-3.5 rounded-xl bg-[#0B101C] border border-slate-800 space-y-1.5">
                  <div className="font-semibold text-[#2DD4BF]">Device 3 — Seller Cashier</div>
                  <p className="text-slate-400">
                    Sign in at <code className="font-mono">/seller/login</code>, activate Cashier
                    Audio, watch the order arrive as Unpaid/New, hear the chime + voice when
                    Confirmed, and advance fulfillment <code className="font-mono">Preparing → Ready → Completed</code>.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
