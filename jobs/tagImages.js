require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, pool } = require('../db/pool');
const {
  tagImageBatch,
  classifyError,
  getRequestsThisRun,
  QuotaExhaustedError,
  BudgetExceededError,
} = require('../providers/gemini');
const { BatchImageTagSchema } = require('../schemas/imageTag');

const BATCH_SIZE   = Number(process.env.VISION_BATCH_SIZE) || 5;
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS) || 3;
const LOW_CONF     = Number(process.env.LOW_CONFIDENCE_THRESHOLD) || 0.7;
const IMAGE_DIR    = path.join(__dirname, '..', 'corpus', 'images');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/* ------------------------------------------------------------------ *
 * Job setup -- idempotent: only queues images with no tags yet
 * ------------------------------------------------------------------ */

async function createJob() {
  const { rows: pending } = await query(
    `SELECT i.id, i.filename
       FROM images i
       LEFT JOIN image_tags t ON t.image_id = i.id
      WHERE t.id IS NULL
      ORDER BY i.id`
  );

  const { rows } = await query(
    `INSERT INTO jobs (job_type, status, total, started_at)
     VALUES ('vision_tag', 'running', $1, NOW()) RETURNING id`,
    [pending.length]
  );
  const jobId = rows[0].id;

  for (const r of pending) {
    await query(
      `INSERT INTO job_items (job_id, ref_type, ref_id) VALUES ($1, 'image', $2)
       ON CONFLICT DO NOTHING`,
      [jobId, r.id]
    );
  }
  return { jobId, pending };
}

/* ------------------------------------------------------------------ *
 * Persist one validated tag
 * ------------------------------------------------------------------ */

async function saveTag(imageId, tag, model) {
  const lowConf = tag.confidence < LOW_CONF;
  await query(
    `INSERT INTO image_tags
       (image_id, subject, category, attributes, caption, confidence, low_confidence, model)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (image_id) DO UPDATE SET
       subject        = EXCLUDED.subject,
       category       = EXCLUDED.category,
       attributes     = EXCLUDED.attributes,
       caption        = EXCLUDED.caption,
       confidence     = EXCLUDED.confidence,
       low_confidence = EXCLUDED.low_confidence,
       model          = EXCLUDED.model`,
    [imageId, tag.subject, tag.species, tag.attributes, tag.caption, tag.confidence, lowConf, model]
  );
  await query(`UPDATE images SET status = 'tagged' WHERE id = $1`, [imageId]);
  return lowConf;
}

/* ------------------------------------------------------------------ *
 * Process one batch: call, validate every element, persist
 * ------------------------------------------------------------------ */

async function processBatch(jobId, batch) {
  const items = batch.map(row => ({
    imageId: row.id,
    filename: row.filename,
    buffer: fs.readFileSync(path.join(IMAGE_DIR, row.filename)),
  }));

  const { raw, model } = await tagImageBatch(items, { jobId });

  let arr;
  try {
    arr = JSON.parse(raw);
  } catch (e) {
    throw new Error(`JSON parse failed: ${e.message}`);
  }
  if (!Array.isArray(arr) || arr.length !== items.length) {
    throw new Error(`batch length mismatch: expected ${items.length}, got ${Array.isArray(arr) ? arr.length : typeof arr}`);
  }

  // Validate every element before trusting any of it.
  const validated = arr.map(el => {
    const parsed = BatchImageTagSchema.safeParse(el);
    if (!parsed.success) {
      const detail = parsed.error.issues.map(i => `${i.path.join('.')} ${i.message}`).join('; ');
      throw new Error(`Schema validation failed: ${detail}`);
    }
    return parsed.data;
  });

  const seen = new Set();
  const results = [];
  for (const tag of validated) {
    if (tag.index < 0 || tag.index >= items.length || seen.has(tag.index)) {
      throw new Error(`Schema validation failed: bad or duplicate index ${tag.index}`);
    }
    seen.add(tag.index);
    const target = items[tag.index];
    const lowConf = await saveTag(target.imageId, tag, model);
    results.push({ imageId: target.imageId, filename: target.filename, tag, lowConf });
  }
  return results;
}

/* ------------------------------------------------------------------ *
 * Runner
 * ------------------------------------------------------------------ */

async function run() {
  const { jobId, pending } = await createJob();
  console.log(`Job ${jobId}: ${pending.length} untagged images, batch size ${BATCH_SIZE} ` +
              `=> ~${Math.ceil(pending.length / BATCH_SIZE)} API calls`);

  if (pending.length === 0) {
    await query(`UPDATE jobs SET status='completed', finished_at=NOW() WHERE id=$1`, [jobId]);
    console.log('Nothing to do -- every image already has tags.');
    return;
  }

  const batches = chunk(pending, BATCH_SIZE);
  let done = 0, failed = 0, flagged = 0, aborted = null;

  outer:
  for (const [bi, batch] of batches.entries()) {
    const ids = batch.map(b => b.id);
    console.log(`\nBatch ${bi + 1}/${batches.length}: images ${ids.join(', ')}`);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await query(
        `UPDATE job_items SET attempts = $1, updated_at = NOW()
          WHERE job_id = $2 AND ref_id = ANY($3::int[])`,
        [attempt, jobId, ids]
      );

      try {
        const results = await processBatch(jobId, batch);
        await query(
          `UPDATE job_items SET status='done', updated_at=NOW()
            WHERE job_id=$1 AND ref_id = ANY($2::int[])`,
          [jobId, ids]
        );
        for (const r of results) {
          if (r.lowConf) flagged++;
          console.log(`  ok  ${r.filename}: ${r.tag.species} (${r.tag.confidence})` +
                      (r.lowConf ? '  [LOW CONFIDENCE -> flagged]' : ''));
        }
        done += results.length;
        break;

      } catch (err) {
        const cls = classifyError(err);

        if (cls.fatal || err instanceof BudgetExceededError) {
          // Leave items pending so the next run resumes instead of skipping.
          await query(
            `UPDATE job_items SET status='pending', last_error=$1, updated_at=NOW()
              WHERE job_id=$2 AND ref_id = ANY($3::int[])`,
            [`aborted: ${cls.kind}`, jobId, ids]
          );
          aborted = cls.kind;
          console.error(`\nFATAL (${cls.kind}): ${err.message}`);
          console.error('Aborting without further AI calls. Items left pending; re-run to resume.');
          break outer;
        }

        if (attempt === MAX_ATTEMPTS) {
          failed += ids.length;
          await query(
            `UPDATE job_items SET status='failed', last_error=$1, updated_at=NOW()
              WHERE job_id=$2 AND ref_id = ANY($3::int[])`,
            [err.message.slice(0, 500), jobId, ids]
          );
          await query(`UPDATE images SET status='failed' WHERE id = ANY($1::int[])`, [ids]);
          console.error(`  giving up on batch ${bi + 1}: ${err.message}`);
        } else {
          const wait = cls.retryAfterMs ?? 1000 * attempt * attempt;
          console.warn(`  retry ${attempt}/${MAX_ATTEMPTS} (${cls.kind}), waiting ${Math.round(wait / 1000)}s`);
          await sleep(wait);
        }
      }
    }

    await query(`UPDATE jobs SET processed=$1, failed=$2 WHERE id=$3`, [done, failed, jobId]);
    await sleep(1500);
  }

  const status = aborted ? `aborted_${aborted}` : (failed ? 'completed_with_errors' : 'completed');
  await query(
    `UPDATE jobs SET status=$1, processed=$2, failed=$3, finished_at=NOW() WHERE id=$4`,
    [status, done, failed, jobId]
  );

  const { rows: cost } = await query(
    `SELECT COUNT(*)::int AS calls, ROUND(COALESCE(SUM(cost_usd),0)::numeric, 6) AS usd
       FROM ai_calls WHERE job_id = $1`, [jobId]
  );

  console.log(`\nJob ${jobId} ${status}`);
  console.log(`  tagged: ${done}   failed: ${failed}   low-confidence flagged: ${flagged}`);
  console.log(`  API calls this run: ${getRequestsThisRun()}   logged: ${cost[0].calls}   notional cost: $${cost[0].usd}`);
  if (aborted) process.exitCode = 1;
}

if (require.main === module) {
  run()
    .catch(err => {
      if (err instanceof QuotaExhaustedError || err instanceof BudgetExceededError) {
        console.error(err.message);
        process.exitCode = 1;
      } else {
        console.error(err);
        process.exitCode = 1;
      }
    })
    .finally(() => pool.end());
}

module.exports = { run };