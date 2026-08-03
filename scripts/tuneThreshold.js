require('dotenv').config();
const { query, pool } = require('../db/pool');
const matching = require('../services/matching');
const guard = require('../services/guard');

/** Sweep the similarity threshold and report precision at each value, so the
 *  number in README is chosen from data rather than guessed. */
async function run() {
  const { rows: posts } = await query('SELECT id, slug, title, body, topic FROM posts ORDER BY id');
  const candidatesByPost = new Map();
  for (const p of posts) candidatesByPost.set(p.id, await matching.candidatesFor(p));

  console.log('threshold  correct  precision');
  console.log('-'.repeat(34));

  let best = { t: null, precision: -1 };
  for (let t = 0.40; t <= 0.90001; t += 0.02) {
    let correct = 0;
    for (const p of posts) {
      const expected = guard.inferPostSpecies(p);
      const ranked = candidatesByPost.get(p.id);
      const accepted = ranked.find(c => guard.evaluate(c, p, { similarityThreshold: t }).passed) || null;
      if (expected === null ? accepted === null : (accepted && accepted.species === expected)) correct++;
    }
    const precision = correct / posts.length;
    const mark = precision > best.precision ? ' <-- best so far' : '';
    if (precision > best.precision) best = { t, precision };
    console.log(`  ${t.toFixed(2)}       ${correct}/${posts.length}     ${(precision * 100).toFixed(1)}%${mark}`);
  }

  console.log('-'.repeat(34));
  console.log(`Best threshold: ${best.t.toFixed(2)} at ${(best.precision * 100).toFixed(1)}% precision`);
  console.log('Set SIMILARITY_THRESHOLD in .env, then re-run: node scripts/eval.js');
}

if (require.main === module) {
  run().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
}