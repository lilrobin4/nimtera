import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import { EXTRA_EN, uiText, uiChoice, categoryCopy, savedUiLocale } from '../src/lib/uiLocale';
import { LOCALE_METADATA } from '../src/lib/i18n';

test('legacy copy uses English when EN is selected and preserves Indonesian when ID is selected', () => {
  for (const [source, english] of Object.entries(EXTRA_EN)) {
    assert.equal(uiText('en', source), english);
    assert.equal(uiText('id', source), source);
    assert.ok(english.length > 0);
  }
  assert.equal(uiChoice('en', 'Pesanan', 'Orders'), 'Orders');
  assert.equal(uiChoice('id', 'Pesanan', 'Orders'), 'Pesanan');
  assert.equal(savedUiLocale({ getItem: () => 'invalid-value' }), 'en');
  assert.equal(savedUiLocale({ getItem: () => 'id' }), 'id');
});

test('all six category columns have explicit copy for all six supported locales', () => {
  for (const locale of Object.keys(LOCALE_METADATA) as Array<keyof typeof LOCALE_METADATA>) {
    for (const id of ['food','drinks','dessert','fruit','bakery','goods']) {
      const copy = categoryCopy(id, locale);
      assert.ok(copy.title && copy.subtitle, `${locale}/${id}`);
    }
  }
  assert.equal(categoryCopy('food','en').title, 'Food & Mains');
  assert.equal(categoryCopy('food','id').title, 'Makanan');
});

test('legacy Indonesian literals cannot bypass the locale helper in seller and customer views', () => {
  for (const name of ['SellerConsole','CustomerStorefront','CustomerCheckout']) {
    const source = readFileSync(new URL(`../src/components/${name}.tsx`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /col\.(titleId|subtitleId)/);
    const ast = parse(source, { sourceType:'module', plugins:['typescript','jsx'] });
    function walk(node: any) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'CallExpression' && ['uiText','uiChoice'].includes(node.callee?.name)) return;
      if (node.type === 'StringLiteral' || node.type === 'JSXText') {
        const value = node.value.trim().replace(/\s+/g, ' ');
        assert.ok(!EXTRA_EN[value], `${name}: untranslated copy: ${value}`);
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(walk);
        else if ((value as any)?.type) walk(value);
      }
    }
    walk(ast);
  }
});
