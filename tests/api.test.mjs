import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHTML, errorText, productImage, positiveId, money } from '../public/api.js';

test('escapes untrusted API strings before insertion in text and attributes', () => {
  assert.equal(escapeHTML('<img src=x onerror="bad()">'), '&lt;img src=x onerror=&quot;bad()&quot;&gt;');
  assert.equal(escapeHTML("'&"), '&#39;&amp;');
});

test('normalizes FastAPI nested and validation errors', () => {
  assert.equal(errorText({ detail: { message: 'Código inválido' } }), 'Código inválido');
  assert.equal(errorText({ detail: [{ loc: ['body', 'quantity'], msg: 'Must be at least 1' }] }), 'quantity: Must be at least 1');
});

test('rejects external image URLs and invalid IDs', () => {
  assert.equal(productImage('https://evil.test/p.png'), '');
  assert.equal(productImage('/uploads/products/../../secret.png'), '');
  assert.equal(productImage('/uploads/products/default.svg'), '/media/products/default.svg');
  for (const v of ['1x', 0, -1, 1.5, 'Infinity']) assert.equal(positiveId(v), null);
  assert.equal(positiveId('12'), 12);
  assert.match(money('32.90'), /32,90/);
});
