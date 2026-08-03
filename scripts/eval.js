require('dotenv').config({ quiet: true });
const { pool, query } = require('../db/pool');
const { suggestFor } = require('../services/matching');

function speciesOf(filename) {
  return String(filename || '').split('-')[0].toLowerCase();
}

async function buildLabels() {
  const { rows: posts } = await query('SELECT id, slug, topic FROM posts ORDER BY id');

  // rebuilt from scratch each run so it stays idempotent
  // without depending on a unique constraint
  await query('DELETE FROM eval_labels');

  for (const p of posts) {
    if (!p.topic) {
      await query(
        `INSERT INTO eval_labels (post_id, correct_image_id, expect_no_match, note)
         VALUES ($1, NULL, TRUE, $2)`,
        [p.id, 'off-corpus topic: correct behaviour is refusal']
      );
      continue;
    }
    const { rows } = await query(
      `SELECT id FROM images WHERE filename LIKE $1 ORDER BY id LIMIT 1`,
      [`${p.topic}-%`]
    );
    await query(
      `INSERT INTO eval_labels (post_id, correct_image_id, expect_no_match, note)
       VALUES ($1, $2, FALSE, $3)`,
      [p.id, rows[0] ? rows[0].id : null, `expect species=${p.topic}`]
    );
  }
  return posts;
}

async function main() {
  const posts = await buildLabels();

  let matchable = 0, matchCorrect = 0;
  let refusable = 0, refuseCorrect = 0;
  const detail = [];

  for (const p of posts) {
    const out = await suggestFor(p.id, { limit: 5, persist: false });
    const top = out.match;

    if (!p.topic) {
      refusable++;
      const ok = top === null;
      if (ok) refuseCorrect++;
      detail.push({
        post: p.slug,
        expected: 'REFUSE',
        got: top ? `${top.filename} (${Number(top.similarity).toFixed(3)})` : 'REFUSED',
        ok
      });
      continue;
    }

    matchable++;
    const got = top ? speciesOf(top.filename) : null;
    const ok = got === p.topic;
    if (ok) matchCorrect++;
    detail.push({
      post: p.slug,
      expected: p.topic,
      got: top
        ? `${top.filename} -> ${got} (${Number(top.similarity).toFixed(3)})`
        : 'REFUSED (no confident match)',
      ok
    });
  }

  const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) + '%' : 'n/a');

  console.log(`\nthreshold: ${process.env.SIMILARITY_THRESHOLD}   confidence floor: ${process.env.LOW_CONFIDENCE_THRESHOLD}\n`);
  console.log('      post                   expected   result');
  console.log('-'.repeat(78));
  for (const d of detail) {
    console.log(
      `${d.ok ? 'PASS' : 'FAIL'}  ${d.post.padEnd(22)} ${String(d.expected).padEnd(9)}  ${d.got}`
    );
  }
  console.log('-'.repeat(78));
  console.log(`top-1 precision (matchable posts): ${matchCorrect}/${matchable}  ${pct(matchCorrect, matchable)}`);
  console.log(`refusal accuracy (no-match posts): ${refuseCorrect}/${refusable}  ${pct(refuseCorrect, refusable)}`);
  console.log(`overall:                           ${matchCorrect + refuseCorrect}/${posts.length}  ${pct(matchCorrect + refuseCorrect, posts.length)}\n`);

  await pool.end();
}

main().catch(async (e) => {
  console.error(e.message);
  await pool.end();
  process.exit(1);
});