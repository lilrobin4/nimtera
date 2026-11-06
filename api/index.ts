import { readProductImage } from '../src/server/productImages.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp, emptyDatabase } from '../server.js';
import { getPool, prepareDatabase, serveDurableRequest } from '../src/server/postgres.js';

let app: ReturnType<typeof createApp> | undefined;
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  app ??= createApp({ apiOnly: true });
  const api = await app;
  const url = new URL(req.url || '/', 'https://nimtera.invalid');
  // Security configuration has no user data and remains visible without a configured DB.
  if (url.pathname === '/api/auth/security-status') return api(req, res);
  const photoId=url.pathname.match(/^\/api\/product-images\/([a-f0-9]{32})\.webp$/)?.[1];
  if (photoId && (req.method==='GET' || req.method==='HEAD')) {
    try {
      const bytes=await readProductImage(photoId,getPool());
      if(!bytes) {res.statusCode=404;res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({error:'Photo not found.'}));}
      res.setHeader('Content-Type','image/webp');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','public, max-age=31536000, immutable');res.setHeader('Content-Length',bytes.length);
      return res.end(req.method==='HEAD'?undefined:bytes);
    } catch {res.statusCode=503;res.setHeader('Cache-Control','no-store');return res.end();}
  }
  if (url.pathname === '/api/health') {
    const configured = {
      database: Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL),
      sessionSecret: Boolean(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 64),
      amoy: Boolean(process.env.POLYGON_AMOY_RPC_URL && process.env.POLYGON_AMOY_TEST_TOKEN_CONTRACT),
    };
    let databaseReachable = false;
    let databaseErrorCode: string | undefined;
    if (configured.database) {
      try { await getPool().query('SELECT 1'); databaseReachable = true; } catch (error: any) {
        const allowed = ['28P01','28000','3D000','ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ETIMEDOUT','ERR_INVALID_URL','SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID','DATABASE_PASSWORD_PLACEHOLDER'];
        databaseErrorCode = allowed.includes(error?.code) ? error.code : /timeout/i.test(String(error?.message)) ? 'CONNECTION_TIMEOUT' : 'CONNECTION_FAILED';
      }
    }
    const ready = configured.sessionSecret && databaseReachable;
    res.statusCode = ready ? 200 : 503;
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({ testnetOnly: true, ready, configured, databaseReachable, databaseErrorCode, nativeDeviceValidated: false }));
  }
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 64) {
    res.statusCode = 503; res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Authentication configuration is incomplete. No local fallback is allowed.' }));
  }
  try {
    await prepareDatabase(emptyDatabase());
    await serveDurableRequest(req, res, api, getPool());
  } catch {
    if (!res.headersSent) {
      res.statusCode = 503; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ error: 'Database unavailable. This application will not substitute temporary data or claim success.' }));
    }
  }
}
