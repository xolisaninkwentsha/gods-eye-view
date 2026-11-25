import assert from 'node:assert/strict';
import test from 'node:test';

import { errorLabel } from './errorLabel.js';

test('errorLabel is a string code, else a string cause code, else the name', () => {
  assert.equal(
    errorLabel(Object.assign(new Error('secret'), { code: 'ECONNRESET' })),
    'ECONNRESET',
  );
  assert.equal(
    errorLabel(new TypeError('secret', { cause: { code: 'ENOTFOUND' } })),
    'ENOTFOUND',
  );
  assert.equal(
    errorLabel(Object.assign(new RangeError('secret'), { code: 7 })),
    'RangeError',
  );
  assert.equal(errorLabel(undefined), 'Error');
  assert.equal(errorLabel('secret'), 'Error');
});

test('errorLabel is capped at 40 characters', () => {
  const long = 'X'.repeat(60);
  assert.equal(errorLabel({ code: long }), 'X'.repeat(40));
  assert.equal(errorLabel({ cause: { code: long } }), 'X'.repeat(40));
  assert.equal(errorLabel({ name: long }), 'X'.repeat(40));
});
