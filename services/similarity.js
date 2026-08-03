/** Pure functions -- no I/O, no AI. Unit-testable and deterministic. */

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function norm(a) {
  return Math.sqrt(dot(a, a));
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) throw new Error('cosineSimilarity: arrays required');
  if (a.length !== b.length) throw new Error(`dimension mismatch: ${a.length} vs ${b.length}`);
  const d = norm(a) * norm(b);
  return d === 0 ? 0 : dot(a, b) / d;
}

/** Text fed to the embedding model for an image. Kept in one place so
 *  images and posts are embedded consistently. */
function imageEmbeddingText(tag) {
  return `${tag.subject}. ${tag.caption} Attributes: ${(tag.attributes || []).join(', ')}.`;
}

function postEmbeddingText(post) {
  return `${post.title}. ${post.body}`;
}

module.exports = { cosineSimilarity, imageEmbeddingText, postEmbeddingText };