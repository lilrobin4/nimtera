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
    for (const section of Object.values(help.content)) assert.equal(section.points.length,4);
  }
  assert.match(PUBLIC_HELP.en.content.overview.points.join(' '), /testnet only/);
});
test('submission metadata and documentation preserve truthful wallet support and remove hardcoded demo navigation',()=>{
 const root=new URL('../',import.meta.url);
 for(const file of ['src/App.tsx','src/components/CustomerStorefront.tsx','src/components/CustomerCheckout.tsx','src/components/SellerConsole.tsx'])assert.doesNotMatch(readFileSync(new URL(file,root),'utf8'),/moonlight-cafe|aurora-roasters/);
 assert.match(readFileSync(new URL('LICENSE',root),'utf8'),/MIT License/);
 assert.match(readFileSync(new URL('.github/workflows/ci.yml',root),'utf8'),/npm test/);
 assert.doesNotMatch(readFileSync(new URL('SECURITY.md',root),'utf8'),/wallet-signature seller login are not available yet/);
 assert.match(readFileSync(new URL('PRIVACY.md',root),'utf8'),/public key/);
});
