import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
await build({
  entryPoints: ['api/index.ts', 'server.ts', 'src/server/postgres.ts', 'src/server/requestState.ts', 'src/server/supabaseCa.ts', 'src/server/payments.ts', 'src/lib/domain.ts'],
  outbase: '.', outdir: '.arena/api-check', bundle: false, format: 'esm', platform: 'node', target: 'node22',
});
const env = { ...process.env, NODE_ENV: 'test', VERCEL: '1' };
delete env.DATABASE_URL; delete env.POSTGRES_URL;
const result = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./.arena/api-check/api/index.js'); console.log('Compiled API ESM smoke PASS');"], { cwd: process.cwd(), env, encoding: 'utf8' });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status || 1);
