const express = require('express');
const { query } = require('../db/pool');
const matching = require('../services/matching');

const router = express.Router();

/** Validation at the boundary: bad input gets a clean 4xx, never a 500. */
function badRequest(res, message, details) {
  return res.status(400).json({ error: 'Bad request', message, details });
}

/* ---------------- Images ---------------- */

router.get('/images', async (req, res, next) => {
  try {
    const { species, flagged } = req.query;
    const where = [];
    const params = [];
    if (species) { params.push(species); where.push(`t.category = $${params.length}`); }
    if (flagged === 'true') where.push('t.low_confidence = TRUE');
    if (flagged === 'false') where.push('t.low_confidence = FALSE');

    const { rows } = await query(
      `SELECT i.id, i.filename, i.status, t.subject, t.category AS species,
              t.attributes, t.caption, t.confidence, t.low_confidence, t.model
         FROM images i LEFT JOIN image_tags t ON t.image_id = i.id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY i.id`,
      params
    );
    res.json({ count: rows.length, images: rows });
  } catch (e) { next(e); }
});

router.get('/images/:id', async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return badRequest(res, 'id must be an integer');
    const { rows } = await query(
      `SELECT i.id, i.filename, i.status, t.*
         FROM images i LEFT JOIN image_tags t ON t.image_id = i.id
        WHERE i.id = $1`, [Number(req.params.id)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Image not found' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

/* ---------------- Posts & matching ---------------- */

router.get('/posts', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT id, slug, title, topic FROM posts ORDER BY id');
    res.json({ count: rows.length, posts: rows });
  } catch (e) { next(e); }
});

/** Probe 2 & 4: ranked suggestions, or an explained refusal. */
router.get('/posts/:idOrSlug/images', async (req, res, next) => {
  try {
    const limit = Number(req.query.limit ?? 5);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return badRequest(res, 'limit must be an integer between 1 and 50');
    }
    const persist = req.query.persist === 'true';
    const result = await matching.suggestFor(req.params.idOrSlug, { limit, persist });
    if (!result) return res.status(404).json({ error: 'Post not found' });
    res.status(result.match ? 200 : 200).json(result);
  } catch (e) { next(e); }
});

/** Probe 3: force a specific image as a candidate and watch the guard refuse it. */
router.get('/posts/:idOrSlug/evaluate/:imageId', async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.imageId)) return badRequest(res, 'imageId must be an integer');
    const result = await matching.evaluatePair(req.params.idOrSlug, req.params.imageId);
    if (!result) return res.status(404).json({ error: 'Post not found' });
    if (result.error) return res.status(404).json(result);
    res.json(result);
  } catch (e) { next(e); }
});

/* ---------------- Review workflow ---------------- */

router.get('/suggestions', async (req, res, next) => {
  try {
    const { status } = req.query;
    const allowed = ['suggested', 'approved', 'rejected'];
    if (status && !allowed.includes(status)) {
      return badRequest(res, `status must be one of ${allowed.join(', ')}`);
    }
    const { rows } = await query(
      `SELECT s.id, s.post_id, p.slug, s.image_id, i.filename, s.similarity, s.rank,
              s.guard_passed, s.guard_reason, s.status, s.reviewed_at, s.created_at
         FROM suggestions s
         JOIN posts p  ON p.id = s.post_id
         LEFT JOIN images i ON i.id = s.image_id
        ${status ? 'WHERE s.status = $1' : ''}
        ORDER BY s.created_at DESC, s.rank`,
      status ? [status] : []
    );
    res.json({ count: rows.length, suggestions: rows });
  } catch (e) { next(e); }
});

/** Approve or reject. Idempotent: re-sending the same decision is a no-op. */
router.post('/suggestions/:id/review', async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return badRequest(res, 'id must be an integer');
    const { decision } = req.body || {};
    if (!['approve', 'reject'].includes(decision)) {
      return badRequest(res, "decision must be 'approve' or 'reject'");
    }
    const target = decision === 'approve' ? 'approved' : 'rejected';

    const { rows: existing } = await query('SELECT * FROM suggestions WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Suggestion not found' });

    if (existing[0].status === target) {
      return res.json({ ...existing[0], idempotent: true, message: 'Already in that state; no change made.' });
    }
    if (target === 'approved' && !existing[0].guard_passed) {
      return res.status(409).json({
        error: 'Cannot approve a suggestion the guard rejected',
        guardReason: existing[0].guard_reason,
      });
    }

    const { rows } = await query(
      `UPDATE suggestions SET status = $1, reviewed_at = NOW() WHERE id = $2 RETURNING *`,
      [target, req.params.id]
    );
    res.json({ ...rows[0], idempotent: false });
  } catch (e) { next(e); }
});

/* ---------------- Ops ---------------- */

router.get('/jobs', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM jobs ORDER BY id DESC LIMIT 20');
    res.json({ jobs: rows });
  } catch (e) { next(e); }
});

/** Probe 6: every AI call attributed with a cost. */
router.get('/costs', async (req, res, next) => {
  try {
    const { rows: byType } = await query(
      `SELECT call_type, model, COUNT(*)::int AS calls,
              SUM(input_tokens)::int AS input_tokens,
              SUM(output_tokens)::int AS output_tokens,
              ROUND(SUM(cost_usd)::numeric, 6) AS cost_usd,
              COUNT(*) FILTER (WHERE NOT success)::int AS failures
         FROM ai_calls GROUP BY call_type, model ORDER BY call_type`
    );
    const { rows: total } = await query(
      `SELECT COUNT(*)::int AS calls, ROUND(COALESCE(SUM(cost_usd),0)::numeric, 6) AS cost_usd FROM ai_calls`
    );
    res.json({ total: total[0], breakdown: byType });
  } catch (e) { next(e); }
});

module.exports = router;