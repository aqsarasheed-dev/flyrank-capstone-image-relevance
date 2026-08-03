require('dotenv').config();
const { query, pool } = require('../db/pool');
const matching = require('../services/matching');
const { inferPostSpecies } = require('../services/guard');

/**
 * Top-1 precision on the labeled set.
 * Ground truth comes from the filename prefix (fox-1.jpg -> fox), which the
 * model never sees. Posts with topic=null are labeled "expect no match".
 */
async function buildLabels() {
  const { rows: posts } = await query('SELECT id, slug, title, body, topic FROM posts ORDER BY id');
  for (const p of posts) {
    const expectNoMatch = inferPostSpecies(p) === null;
    await query(
      `INSERT INTO eval_labels (post_id, correct_image_id, expect_no_match, note)
       VALUES ($1, NULL, $2, $3)
       ON CONFLICT DO NOTHING`,
      [p.id, expectNoMatch, expectNoMatch ? 'no suitable image in corpus' : `any image of ${p.topic}`]
    );
  }
  return posts;
}

async function run() {
  const posts = await buildLabels();

  const { rows: tagged } = await query('SELECT COUNT(*)::int AS n FROM image_vectors');
  if (tagged[0].n === 0) {
    console.error('No image vectors found. Run: npm run tag && npm run embed');
    process.exitCode = 1;
    return;
  }

  let correct = 0, total = 0, refusalsCorrect = 0, refusalsTotal = 0;
  const rows = [];

  for (const post of posts) {
    const expected = inferPostSpecies(post);
    const result = await matching.suggestFor(post.slug, { limit: 3 });
    const top = result.ranked[0] || null;
    total++;

    let verdict;
    if (expected === null) {
      refusalsTotal++;
      const ok = result.match === null;
      if (ok) { correct++; refusalsCorrect++; }
      verdict = ok ? 'PASS (correctly refused)' : `FAIL (suggested ${result.match.filename})`;
    } else {
      const ok = result.match !== null && result.match.species === expected;
      if (ok) correct++;
      verdict = ok
        ? `PASS (${result.match.filename})`
        : result.match === null
          ? `FAIL (refused; best was ${top ? top.filename : 'none'} @ ${top ? top.similarity : '-'})`
          : `FAIL (suggested ${result.match.filename}, a ${result.match.species})`;
    }

    rows.push({
      post: post.slug,
      expected: expected ?? '(none — expect refusal)',
      top1: top ? `${top.filename} @ ${top.similarity}` : '-',
      verdict,
    });
  }

  const precision = total ? (correct / total) : 0;

  console.log('\nTop-1 precision evaluation');
  console.log('='.repeat(78));
  for (const r of rows) {
    console.log(`${r.post.padEnd(24)} expect=${String(r.expected).padEnd(22)} top1=${r.top1}`);
    console.log(`${' '.repeat(24)} ${r.verdict}`);
  }
  console.log('='.repeat(78));
  console.log(`Threshold:        ${process.env.SIMILARITY_THRESHOLD}`);
  console.log(`Correct:          ${correct}/${total}`);
  console.log(`TOP-1 PRECISION:  ${(precision * 100).toFixed(1)}%`);
  if (refusalsTotal) {
    console.log(`Refusal accuracy: ${refusalsCorrect}/${refusalsTotal} (posts with no suitable image)`);
  }
}

if (require.main === module) {
  run().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
}
module.exports = { run };