import { Pool, type PoolConfig } from 'pg';
import { SUPABASE_CA } from './supabaseCa.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { requestState, type RequestState } from './requestState.js';

export interface StateEnvelope {
  version: 1;
  database: any;
  walletChallenges?: [string, any][];
  sessions: [string, any][];
  loginRateLimits: [string, any][];
  publicEndpointRateLimits: [string, any][];
}
export interface SqlClient { query: (sql: string, values?: any[]) => Promise<any>; release: () => void }
export interface SqlPool { connect: () => Promise<SqlClient> }
let pool: Pool | undefined;
let prepared: Promise<void> | undefined;
export function parseDatabaseUrl(value: string): URL {
  // Accept pasted .env assignments / quoted values without ever logging credentials.
  let input = value.trim().replace(/^DATABASE_URL\s*=\s*/i, '');
  if ((input.startsWith('"') && input.endsWith('"')) || (input.startsWith("'") && input.endsWith("'"))) input = input.slice(1, -1).trim();
  const url = new URL(input);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw Object.assign(new Error('Invalid database URL'), { code: 'ERR_INVALID_URL' });
  return url;
}
export function databaseConnectionConfig(connectionString: string, cloud = Boolean(process.env.VERCEL)): PoolConfig {
  const url = parseDatabaseUrl(connectionString);
  if (decodeURIComponent(url.password).includes('[YOUR-PASSWORD]')) throw Object.assign(new Error('Database password placeholder remains'), { code: 'DATABASE_PASSWORD_PLACEHOLDER' });
  if (cloud && !url.searchParams.has('sslmode')) url.searchParams.set('sslmode', 'verify-full');
  if (cloud && !['require', 'verify-full', 'verify-ca'].includes(url.searchParams.get('sslmode') || '')) throw new Error('TLS is required for the cloud database');
  const config: PoolConfig = { connectionString: url.toString(), max: 1, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, allowExitOnIdle: true };
  if (url.hostname.endsWith('.pooler.supabase.com') || /^db\.[a-z0-9-]+\.supabase\.co$/.test(url.hostname)) {
    // URL ssl parameters otherwise overwrite node-postgres' explicit CA configuration.
    // The official provider CA is public trust material, never a private credential.
    for (const key of ['sslmode','sslrootcert','sslcert','sslkey','uselibpqcompat']) url.searchParams.delete(key);
    config.connectionString = url.toString();
    config.ssl = { ca: SUPABASE_CA, rejectUnauthorized: true, servername: url.hostname };
  }
  return config;
}
export function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) throw new Error('PostgreSQL is not configured');
  pool = new Pool(databaseConnectionConfig(connectionString));
  pool.on('error', () => { /* No credentials or SQL state in public logs. */ });
  return pool;
}
export const schemaSql = `CREATE TABLE IF NOT EXISTS nimtera_testnet_state (
  id text PRIMARY KEY CHECK (id = 'testnet'),
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE nimtera_testnet_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE nimtera_testnet_state FROM PUBLIC;
CREATE TABLE IF NOT EXISTS nimtera_product_images (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{32}$'),
  owner_slug text NOT NULL,
  digest text NOT NULL,
  content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 160000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_slug,digest)
);
ALTER TABLE nimtera_product_images ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE nimtera_product_images FROM PUBLIC;
`;
export async function prepareDatabase(initial: any): Promise<void> {
  if (!prepared) prepared = (async () => {
    const client = await getPool().connect();
    try {
      await client.query(schemaSql);
      await client.query("INSERT INTO nimtera_testnet_state (id,state) VALUES ('testnet',$1::jsonb) ON CONFLICT (id) DO NOTHING", [JSON.stringify(emptyEnvelope(initial))]);
    } finally { client.release(); }
  })().catch(error => { prepared = undefined; throw error; });
  await prepared;
}
export function emptyEnvelope(database: any): StateEnvelope {
  return { version: 1, database, sessions: [], loginRateLimits: [], publicEndpointRateLimits: [] };
}
function deserialize(e: StateEnvelope): RequestState {
  if (e?.version !== 1 || !Array.isArray(e.database?.sellers) || !Array.isArray(e.database?.stores) || !Array.isArray(e.database?.orders)) throw new Error('Invalid database schema');
  const now = Date.now();
  return {
    database: structuredClone(e.database),
    walletChallenges: new Map((e.walletChallenges || []).filter(([,v])=>v.expiresAt > now)),
    sessions: new Map(e.sessions.filter(([,v]) => v.expiresAt > now)),
    loginRateLimits: new Map(e.loginRateLimits.filter(([,v]) => (v.updatedAtMs || v.lockedUntilMs || 0) > now - 3600000)),
    publicEndpointRateLimits: new Map(e.publicEndpointRateLimits.filter(([,v]) => v.windowStartMs > now - 60000)),
  };
}
function serialize(s: RequestState): StateEnvelope {
  if ([s.walletChallenges?.size || 0, s.sessions.size, s.loginRateLimits.size, s.publicEndpointRateLimits.size].some(n => n > 10000)) throw new Error('Testnet capacity reached');
  return { version: 1, database: s.database, walletChallenges: [...(s.walletChallenges || new Map())], sessions: [...s.sessions], loginRateLimits: [...s.loginRateLimits], publicEndpointRateLimits: [...s.publicEndpointRateLimits] };
}
/** One PostgreSQL row serializes mutations across instances. Intentionally a bounded testnet architecture, not a high-volume design. */
export async function transaction<T>(sqlPool: SqlPool, action: (state: RequestState) => Promise<T>, shouldRestoreDatabase: (result: T) => boolean = () => false): Promise<T> {
  const client = await sqlPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    const result = await client.query("SELECT state FROM nimtera_testnet_state WHERE id='testnet' FOR UPDATE");
    if (!result.rows?.[0]) throw new Error('Run database initialization first');
    const envelope = result.rows[0].state as StateEnvelope;
    const state = deserialize(envelope);
    state.sqlClient = client;
    const output = await requestState.run(state, () => action(state));
    // Invalid business requests cannot partially change products/orders. Auth failure counters still persist.
    if (shouldRestoreDatabase(output)) state.database = envelope.database;
    const encoded = JSON.stringify(serialize(state));
    if (Buffer.byteLength(encoded) > 16 * 1024 * 1024) throw new Error('Testnet storage capacity reached');
    await client.query("UPDATE nimtera_testnet_state SET state=$1::jsonb,updated_at=now() WHERE id='testnet'", [encoded]);
    await client.query('COMMIT');
    return output;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
export type ApiApplication = (req: IncomingMessage, res: ServerResponse) => unknown;
/** Do not send success until COMMIT succeeds. No streaming is supported by this JSON API. */
export async function serveDurableRequest(req: IncomingMessage, res: ServerResponse, app: ApiApplication, sqlPool: SqlPool): Promise<void> {
  const originalEnd = res.end;
  const originalWrite = res.write;
  let endArgs: any[] | undefined;
  let status = 500;
  try {
    await transaction(sqlPool, async () => {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const fail = (error: Error) => { if (!settled) { settled = true; clearTimeout(timer); req.removeListener('aborted', aborted); reject(error); } };
        const aborted = () => fail(new Error('Request aborted'));
        const timer = setTimeout(() => fail(new Error('Request deadline exceeded')), 50000); timer.unref();
        req.once('aborted', aborted);
        res.write = (() => { fail(new Error('Streaming is not supported')); return false; }) as any;
        res.end = ((...args: any[]) => {
          if (settled) return res;
          settled = true; clearTimeout(timer); req.removeListener('aborted', aborted);
          status = res.statusCode; endArgs = args;
          if (status >= 500) reject(new Error('API operation failed'));
          else resolve();
          return res;
        }) as any;
        try { app(req, res); } catch (error) { fail(error instanceof Error ? error : new Error('API failed')); }
      });
      return status;
    }, code => code >= 400);
    res.end = originalEnd; res.write = originalWrite;
    originalEnd.apply(res, endArgs as any);
  } catch {
    res.end = originalEnd; res.write = originalWrite;
    if (!res.headersSent && !res.destroyed) {
      for (const key of res.getHeaderNames()) res.removeHeader(key);
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Retry-After', '5');
      res.end(JSON.stringify({ error: 'Service temporarily unavailable. No operation success has been confirmed. Retry the read before repeating a payment.' }));
    }
  }
}
