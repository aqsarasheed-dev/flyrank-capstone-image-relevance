const { test } = require('node:test');
const assert = require('node:assert');
const { evaluate, inferPostSpecies } = require('../services/guard');

const foxPost  = { title: 'The Behavior of Red Foxes', body: 'Red foxes hunt alone. A fox is smaller than a wolf.', topic: 'fox' };
const reefPost = { title: 'Why Coral Reefs Are Bleaching', body: 'Rising sea temperatures expel symbiotic algae.', topic: null };
const OPTS = { similarityThreshold: 0.62, confidenceThreshold: 0.7 };

test('accepts a confident fox image on a fox post', () => {
  const r = evaluate({ species: 'fox', confidence: 0.94, lowConfidence: false, similarity: 0.81 }, foxPost, OPTS);
  assert.strictEqual(r.passed, true);
  assert.deepStrictEqual(r.reasons, []);
});

test('REJECTS a wolf on a fox post even at high similarity', () => {
  const r = evaluate({ species: 'wolf', confidence: 0.93, lowConfidence: false, similarity: 0.79 }, foxPost, OPTS);
  assert.strictEqual(r.passed, false);
  assert.strictEqual(r.gates.similarity, true, 'similarity alone would have let it through');
  assert.strictEqual(r.gates.species, false);
  assert.match(r.reasons[0], /expected fox, detected wolf/);
});

test('rejects a dog on a fox post', () => {
  const r = evaluate({ species: 'dog', confidence: 0.9, lowConfidence: false, similarity: 0.66 }, foxPost, OPTS);
  assert.strictEqual(r.passed, false);
  assert.match(r.reasons.join(' '), /expected fox, detected dog/);
});

test('rejects a correct species below the similarity threshold', () => {
  const r = evaluate({ species: 'fox', confidence: 0.95, lowConfidence: false, similarity: 0.41 }, foxPost, OPTS);
  assert.strictEqual(r.passed, false);
  assert.match(r.reasons[0], /below threshold/);
});

test('rejects a low-confidence classification even when species matches', () => {
  const r = evaluate({ species: 'fox', confidence: 0.55, lowConfidence: true, similarity: 0.80 }, foxPost, OPTS);
  assert.strictEqual(r.passed, false);
  assert.match(r.reasons.join(' '), /confidence too low/);
});

test('rejects unknown species on a species-specific post', () => {
  const r = evaluate({ species: 'unknown', confidence: 0.9, lowConfidence: false, similarity: 0.7 }, foxPost, OPTS);
  assert.strictEqual(r.passed, false);
  assert.match(r.reasons.join(' '), /unknown/);
});

test('post naming no species is refused on similarity, not species', () => {
  const r = evaluate({ species: 'fox', confidence: 0.95, lowConfidence: false, similarity: 0.22 }, reefPost, OPTS);
  assert.strictEqual(r.passed, false);
  assert.strictEqual(r.gates.species, true);
  assert.match(r.reasons[0], /below threshold/);
});

test('inferPostSpecies picks the subject, not a passing mention', () => {
  assert.strictEqual(inferPostSpecies(foxPost), 'fox');
  assert.strictEqual(inferPostSpecies(reefPost), null);
  assert.strictEqual(inferPostSpecies({ title: 'Wolf Packs', body: 'Wolves hunt together. Wolves are large.', topic: null }), 'wolf');
});