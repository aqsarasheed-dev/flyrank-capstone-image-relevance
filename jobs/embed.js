require('dotenv').config();
const { query, pool } = require('../db/pool');
const { embed } = require('../providers/gemini');
const { imageEmbeddingText, postEmbeddingText } = require('../services/similarity');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  const { rows: jr } = await query(
    `INSERT INTO jobs (job_type, status, started_at) VALUES ('embedding','running',NOW()) RETURNING id`
  );
  const jobId = jr[0].id;

  // Idempotent on both sides: only embed what has no vector yet.
  const { rows: images } = await query(
    `SELECT i.id, t.subject, t.caption, t.attributes
       FROM images i
       JOIN image_tags t     ON t.image_id = i.id
       LEFT JOIN image_vectors v ON v.image_id = i.id
      WHERE v.id IS NULL ORDER BY i.id`
  );
  const { rows: posts } = await query(
    `SELECT p.id, p.title, p.body
       FROM posts p LEFT JOIN post_vectors v ON v.post_id = p.id
      WHERE v.id IS NULL ORDER BY p.id`
  );

  const total = images.length + posts.length;
  await query('UPDATE jobs SET total=$1 WHERE id=$2', [total, jobId]);
  console.log(`Job ${jobId}: ${images.length} images + ${posts.length} posts to embed`);

  let done = 0, failed = 0;

  for (const img of images) {
    try {
      const { vector, model } = await embed(imageEmbeddingText(img), { jobId, refType: 'image', refId: img.id });
      await query(
        `INSERT INTO image_vectors (image_id, embedding, dims, model) VALUES ($1,$2,$3,$4)
         ON CONFLICT (image_id) DO UPDATE SET embedding=EXCLUDED.embedding, dims=EXCLUDED.dims, model=EXCLUDED.model`,
        [img.id, vector, vector.length, model]
      );
      done++;
      console.log(`  image ${img.id} embedded (${vector.length}d)`);
    } catch (err) {
      failed++;
      console.error(`  image ${img.id} failed: ${err.message}`);
    }
    await sleep(200);
  }

  for (const p of posts) {
    try {
      const { vector, model } = await embed(postEmbeddingText(p), { jobId, refType: 'post', refId: p.id });
      await query(
        `INSERT INTO post_vectors (post_id, embedding, dims, model) VALUES ($1,$2,$3,$4)
         ON CONFLICT (post_id) DO UPDATE SET embedding=EXCLUDED.embedding, dims=EXCLUDED.dims, model=EXCLUDED.model`,
        [p.id, vector, vector.length, model]
      );
      done++;
      console.log(`  post ${p.id} embedded (${vector.length}d)`);
    } catch (err) {
      failed++;
      console.error(`  post ${p.id} failed: ${err.message}`);
    }
    await sleep(200);
  }

  await query(
    `UPDATE jobs SET status=$1, processed=$2, failed=$3, finished_at=NOW() WHERE id=$4`,
    [failed ? 'completed_with_errors' : 'completed', done, failed, jobId]
  );
  console.log(`Job ${jobId} done: ${done} embedded, ${failed} failed`);
}

if (require.main === module) {
  run().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
}
module.exports = { run };