const { query } = require('../db/pool');
const { cosineSimilarity } = require('./similarity');
const guard = require('./guard');

async function getPost(idOrSlug) {
  const isNum = /^\d+$/.test(String(idOrSlug));
  const { rows } = await query(
    `SELECT * FROM posts WHERE ${isNum ? 'id = $1' : 'slug = $1'}`,
    [isNum ? Number(idOrSlug) : idOrSlug]
  );
  return rows[0] || null;
}

async function candidatesFor(post) {
  const { rows: pv } = await query('SELECT embedding FROM post_vectors WHERE post_id = $1', [post.id]);
  if (!pv[0]) throw new Error(`Post ${post.id} has no embedding. Run: node jobs/embed.js`);
  const postVec = pv[0].embedding.map(Number);

  const { rows } = await query(
    `SELECT i.id AS image_id, i.filename, i.category_hint,
            t.subject, t.category AS species, t.caption, t.confidence, t.low_confidence,
            v.embedding
       FROM images i
       JOIN image_tags t    ON t.image_id = i.id
       JOIN image_vectors v ON v.image_id = i.id`
  );

  return rows.map(r => ({
    imageId: r.image_id,
    filename: r.filename,
    subject: r.subject,
    species: r.species,
    caption: r.caption,
    confidence: Number(r.confidence),
    lowConfidence: r.low_confidence,
    similarity: cosineSimilarity(r.embedding.map(Number), postVec),
  })).sort((a, b) => b.similarity - a.similarity);
}

/**
 * Rank every image for a post and run each through the guard.
 * Returns the best passing candidate, or an explained refusal.
 */
async function suggestFor(idOrSlug, { limit = 5, persist = false } = {}) {
  const post = await getPost(idOrSlug);
  if (!post) return null;

  const ranked = await candidatesFor(post);
  const evaluated = ranked.map((c, i) => {
    const g = guard.evaluate(c, post);
    return { ...c, rank: i + 1, guardPassed: g.passed, guardReasons: g.reasons, gates: g.gates };
  });

  const accepted = evaluated.find(c => c.guardPassed) || null;
  const top = evaluated[0] || null;

  const result = {
    post: { id: post.id, slug: post.slug, title: post.title, topic: post.topic },
    expectedSpecies: guard.inferPostSpecies(post),
    threshold: Number(process.env.SIMILARITY_THRESHOLD),
    match: accepted && {
      imageId: accepted.imageId,
      filename: accepted.filename,
      species: accepted.species,
      caption: accepted.caption,
      similarity: Number(accepted.similarity.toFixed(4)),
      confidence: accepted.confidence,
    },
    refusal: accepted ? null : {
      message: 'No confident match found.',
      bestCandidate: top && { filename: top.filename, species: top.species, similarity: Number(top.similarity.toFixed(4)) },
      reasons: top ? top.guardReasons : ['No tagged images available'],
    },
    ranked: evaluated.slice(0, limit).map(c => ({
      rank: c.rank,
      imageId: c.imageId,
      filename: c.filename,
      species: c.species,
      similarity: Number(c.similarity.toFixed(4)),
      confidence: c.confidence,
      guardPassed: c.guardPassed,
      guardReasons: c.guardReasons,
    })),
  };

  if (persist) {
    for (const c of evaluated.slice(0, limit)) {
      await query(
        `INSERT INTO suggestions (post_id, image_id, similarity, rank, guard_passed, guard_reason, status)
         VALUES ($1,$2,$3,$4,$5,$6,'suggested')`,
        [post.id, c.imageId, c.similarity, c.rank, c.guardPassed, c.guardReasons.join(' | ') || null]
      );
    }
  }
  return result;
}

/** Probe 3: force a specific image as a candidate and show the guard refuse it. */
async function evaluatePair(postIdOrSlug, imageId) {
  const post = await getPost(postIdOrSlug);
  if (!post) return null;
  const ranked = await candidatesFor(post);
  const c = ranked.find(x => x.imageId === Number(imageId));
  if (!c) return { error: 'Image not found or not yet tagged/embedded' };

  const g = guard.evaluate(c, post);
  return {
    post: { id: post.id, slug: post.slug, title: post.title },
    candidate: {
      imageId: c.imageId, filename: c.filename, species: c.species,
      caption: c.caption, similarity: Number(c.similarity.toFixed(4)), confidence: c.confidence,
    },
    result: g.passed ? 'ACCEPTED' : 'REJECTED',
    gates: g.gates,
    reasons: g.reasons,
  };
}

module.exports = { suggestFor, evaluatePair, candidatesFor, getPost };