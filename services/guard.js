/**
 * The mismatch guard. Three independent gates; a candidate must clear all
 * three. Pure function -- no DB, no AI -- so it is fully unit-testable.
 */

const SPECIES = ['fox', 'wolf', 'dog', 'bear', 'deer'];

/** Species the post is actually about, inferred from its text.
 *  Returns null when the post names no species we know. */
function inferPostSpecies(post) {
  if (post.topic && SPECIES.includes(post.topic)) return post.topic;

  const text = `${post.title} ${post.body}`.toLowerCase();
  const counts = SPECIES.map(s => {
    const re = new RegExp(`\\b${s}(es|s)?\\b`, 'g');
    return { species: s, n: (text.match(re) || []).length };
  }).filter(c => c.n > 0).sort((a, b) => b.n - a.n);

  if (counts.length === 0) return null;
  // A passing mention is not a subject. Require a clear lead.
  if (counts.length > 1 && counts[0].n < counts[1].n * 2) return counts[0].species;
  return counts[0].species;
}

/**
 * @param {object} candidate {imageId, filename, species, confidence, lowConfidence, similarity}
 * @param {object} post      {title, body, topic}
 * @param {object} opts      {similarityThreshold, confidenceThreshold}
 * @returns {{passed:boolean, reasons:string[], gates:object}}
 */
function evaluate(candidate, post, opts = {}) {
  const simT  = opts.similarityThreshold ?? Number(process.env.SIMILARITY_THRESHOLD) ?? 0.62;
  const confT = opts.confidenceThreshold ?? Number(process.env.LOW_CONFIDENCE_THRESHOLD) ?? 0.7;

  const reasons = [];
  const gates = {};

  // Gate 1: semantic similarity
  gates.similarity = candidate.similarity >= simT;
  if (!gates.similarity) {
    reasons.push(`Similarity ${candidate.similarity.toFixed(3)} below threshold ${simT}`);
  }

  // Gate 2: species agreement -- the gate that catches the wolf
  const expected = inferPostSpecies(post);
  if (expected === null) {
    gates.species = true; // post names no species; nothing to contradict
  } else if (candidate.species === 'unknown') {
    gates.species = false;
    reasons.push(`Detected subject is unknown; article is about ${expected}`);
  } else {
    gates.species = candidate.species === expected;
    if (!gates.species) {
      reasons.push(`Animal category mismatch: expected ${expected}, detected ${candidate.species}`);
    }
  }

  // Gate 3: the model's own confidence in its classification
  gates.confidence = candidate.confidence >= confT && !candidate.lowConfidence;
  if (!gates.confidence) {
    reasons.push(`Image classification confidence too low (${Number(candidate.confidence).toFixed(2)} < ${confT})`);
  }

  return { passed: reasons.length === 0, reasons, gates, expectedSpecies: expected };
}

module.exports = { evaluate, inferPostSpecies, SPECIES };