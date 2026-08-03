const { test } = require('node:test');
const assert = require('node:assert');
const { cosineSimilarity } = require('../services/similarity');

test('identical vectors score 1', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);
});

test('orthogonal vectors score 0', () => {
  assert.strictEqual(cosineSimilarity([1, 0], [0, 1]), 0);
});

test('opposite vectors score -1', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 0], [-1, 0]) + 1) < 1e-9);
});

test('magnitude does not affect direction', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 1], [10, 10]) - 1) < 1e-9);
});

test('zero vector does not divide by zero', () => {
  assert.strictEqual(cosineSimilarity([0, 0], [1, 1]), 0);
});

test('dimension mismatch throws', () => {
  assert.throws(() => cosineSimilarity([1, 2], [1, 2, 3]), /dimension mismatch/);
});