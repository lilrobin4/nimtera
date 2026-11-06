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
