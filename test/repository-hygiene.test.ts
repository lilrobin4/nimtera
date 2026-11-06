import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('AI Studio exports and unused Gemini dependency stay out of the application', () => {
  const root = new URL('../', import.meta.url);
  for (const path of ['.aistudio', 'public/assets/aistudio', 'src/assets/images', 'metadata.json', 'bun.lock']) {
    assert.equal(existsSync(new URL(path, root)), false, `Remove legacy export: ${path}`);
  }
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(pkg.dependencies['@google/genai'], undefined);
  const source = readFileSync(new URL('src/components/SellerConsole.tsx', root), 'utf8');
  for (const match of source.matchAll(/\/products\/([A-Za-z0-9_.-]+\.jpg)/g)) {
    assert.ok(existsSync(new URL(`public/products/${match[1]}`, root)), `Missing runtime photo: ${match[1]}`);
  }
});

test('public help cannot include deployment runbooks or misleading mainnet claims', async () => {
  const { PUBLIC_HELP } = await import('../src/lib/publicDocs');
  assert.equal(Object.keys(PUBLIC_HELP).length,6);
  for (const help of Object.values(PUBLIC_HELP)) {
    assert.deepEqual(Object.keys(help.tabs),['overview','security','privacy']);
    assert.doesNotMatch(JSON.stringify(help), /StakeSafe|DNS|APP_URL|SESSION_SECRET|DATABASE_URL|Hosting Load Balancer|scrypt|RFC 6238|Supported Mainnet Assets|demoTotp/i);
    for (const section of Object.values(help.content)) assert.equal(section.points.length,3);
  }
  assert.match(PUBLIC_HELP.en.content.overview.points.join(' '), /testnet only/);
});
