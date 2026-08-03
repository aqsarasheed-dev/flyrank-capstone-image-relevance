require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const pricing = require('../config/pricing');
const { query } = require('../db/pool');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/* ------------------------------------------------------------------ *
 * Errors & classification
 * ------------------------------------------------------------------ */

class QuotaExhaustedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QuotaExhaustedError';
    this.fatal = true;
  }
}

class BudgetExceededError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BudgetExceededError';
    this.fatal = true;
  }
}

function parseRetryDelayMs(msg) {
  const m = String(msg).match(/"retryDelay":"(\d+)s"/);
  return m ? (Number(m[1]) + 1) * 1000 : 5000;
}

/**
 * Decide whether an error is worth retrying.
 * A daily-quota exhaustion cannot clear within the lifetime of a run,
 * so retrying it is never correct -- it only burns more quota.
 */
function classifyError(err) {
  const msg = String(err?.message || err || '');

  if (/PerDay|RequestsPerDay|GenerateRequestsPerDayPerProjectPerModel/.test(msg)) {
    return { kind: 'daily_quota', fatal: true };
  }
  if (/429|RESOURCE_EXHAUSTED/.test(msg)) {
    return { kind: 'rate_limit', fatal: false, retryAfterMs: parseRetryDelayMs(msg) };
  }
  if (/Schema validation|Unexpected token|JSON|batch length/i.test(msg)) {
    return { kind: 'invalid_output', fatal: false, retryAfterMs: 1000 };
  }
  if (/API key|API_KEY_INVALID|PERMISSION_DENIED|401|403/.test(msg)) {
    return { kind: 'auth', fatal: true };
  }
  if (/is not found|NOT_FOUND|404/.test(msg)) {
    return { kind: 'bad_model', fatal: true };
  }
  if (/500|503|UNAVAILABLE|INTERNAL|fetch failed|ETIMEDOUT|ECONNRESET/.test(msg)) {
    return { kind: 'transient', fatal: false, retryAfterMs: 3000 };
  }
  return { kind: 'unknown', fatal: false, retryAfterMs: 2000 };
}

/* ------------------------------------------------------------------ *
 * Cost tracking + per-run budget guard
 * ------------------------------------------------------------------ */

const MAX_REQUESTS_PER_RUN = Number(process.env.MAX_REQUESTS_PER_RUN) || 18;
let requestsThisRun = 0;

function assertBudget() {
  if (requestsThisRun >= MAX_REQUESTS_PER_RUN) {
    throw new BudgetExceededError(
      `Per-run request budget reached (${MAX_REQUESTS_PER_RUN}). Refusing further AI calls.`
    );
  }
  requestsThisRun++;
}

function getRequestsThisRun() {
  return requestsThisRun;
}

function costOf(model, inTok, outTok) {
  const p = pricing[model] || pricing._default;
  return (inTok / 1e6) * p.input + (outTok / 1e6) * p.output;
}

/**
 * One row per API call -- the API call is the unit that is actually billed,
 * so a batch of 5 images produces one row, not five.
 */
async function logCall({ jobId, callType, model, refType, refId, usage, latencyMs, success, error }) {
  const inTok = usage?.promptTokenCount ?? 0;
  const outTok = usage?.candidatesTokenCount ?? 0;
  await query(
    `INSERT INTO ai_calls (job_id, call_type, model, ref_type, ref_id,
       input_tokens, output_tokens, cost_usd, latency_ms, success, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [jobId, callType, model, refType, refId, inTok, outTok,
     costOf(model, inTok, outTok), latencyMs, success, error ? String(error).slice(0, 500) : null]
  );
}

/* ------------------------------------------------------------------ *
 * Vision: batched image tagging
 * ------------------------------------------------------------------ */

const BATCH_PROMPT = `You are an image cataloguing system. You will receive several images in order.
Return a JSON array with exactly one object per image, in the same order as the images were given.

For each image provide:
- "index": the 0-based position of the image in the input.
- "species": a single lowercase word naming the specific animal (fox, wolf, dog, bear, deer).
  If the animal is not one of these, or you are not reasonably sure, use "unknown".
- "subject": a short natural phrase, e.g. "red fox".
- "category": the broad type, e.g. "animal".
- "attributes": 3 to 6 short visual descriptors.
- "caption": one descriptive sentence.
- "confidence": your honest certainty from 0 to 1 about the species. Be conservative:
  if the animal could plausibly be a different species, lower the number.`;

const BATCH_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      index: { type: 'integer' },
      subject: { type: 'string' },
      category: { type: 'string' },
      species: { type: 'string' },
      attributes: { type: 'array', items: { type: 'string' } },
      caption: { type: 'string' },
      confidence: { type: 'number' },
    },
    required: ['index', 'subject', 'category', 'species', 'attributes', 'caption', 'confidence'],
  },
};

function mimeFor(filename) {
  if (/\.png$/i.test(filename)) return 'image/png';
  if (/\.webp$/i.test(filename)) return 'image/webp';
  return 'image/jpeg';
}

/**
 * Tag several images in a single request.
 * @param {Array<{imageId:number, filename:string, buffer:Buffer}>} items
 * @returns {Promise<{raw:string, model:string}>}
 */
async function tagImageBatch(items, { jobId = null } = {}) {
  const model = process.env.VISION_MODEL;
  const parts = [{ text: BATCH_PROMPT }];
  for (const it of items) {
    parts.push({ inlineData: { mimeType: mimeFor(it.filename), data: it.buffer.toString('base64') } });
  }

  assertBudget();
  const started = Date.now();
  try {
    const res = await ai.models.generateContent({
      model,
      contents: [{ parts }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: BATCH_SCHEMA,
        temperature: 0,
      },
    });
    await logCall({
      jobId, callType: 'vision_batch', model,
      refType: 'image_batch', refId: null,
      usage: res.usageMetadata, latencyMs: Date.now() - started, success: true,
    });
    return { raw: res.text, model };
  } catch (err) {
    await logCall({
      jobId, callType: 'vision_batch', model,
      refType: 'image_batch', refId: null,
      usage: null, latencyMs: Date.now() - started, success: false, error: err.message,
    });
    throw err;
  }
}

/* ------------------------------------------------------------------ *
 * Embeddings (separate quota from vision -- far more generous)
 * ------------------------------------------------------------------ */

async function embed(text, { jobId = null, refType = null, refId = null } = {}) {
  const model = process.env.EMBED_MODEL;
  const started = Date.now();
  try {
    const res = await ai.models.embedContent({
      model,
      contents: text,
      config: { taskType: 'SEMANTIC_SIMILARITY', outputDimensionality: 768 },
    });
    const vector = res.embeddings[0].values;
    await logCall({
      jobId, callType: 'embedding', model, refType, refId,
      usage: { promptTokenCount: Math.ceil(text.length / 4) },
      latencyMs: Date.now() - started, success: true,
    });
    return { vector, model };
  } catch (err) {
    await logCall({
      jobId, callType: 'embedding', model, refType, refId,
      usage: null, latencyMs: Date.now() - started, success: false, error: err.message,
    });
    throw err;
  }
}

module.exports = {
  tagImageBatch,
  embed,
  classifyError,
  getRequestsThisRun,
  QuotaExhaustedError,
  BudgetExceededError,
};