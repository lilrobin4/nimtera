// New sessions use a host-only HttpOnly cookie, not a JS-readable stored token.
// Retain a one-time migration path for existing tabs created before cookie sessions.
export const COOKIE_SESSION = 'cookie-session';
export function legacySellerToken(): string | null {
  try { return window.sessionStorage.getItem('nimtera_seller_token'); } catch { return null; }
}
export function clearLegacySellerToken() {
  try { window.sessionStorage.removeItem('nimtera_seller_token'); } catch {}
}
export function sellerAuthHeaders(token: string | null): Record<string,string> {
  return token && token !== COOKIE_SESSION ? { Authorization: `Bearer ${token}` } : {};
}
