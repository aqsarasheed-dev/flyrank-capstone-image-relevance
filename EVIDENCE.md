# Evidence

One verbatim proof per Definition-of-Done requirement. All output copied from
actual runs, not reconstructed.

## 1. Structured understanding, validated

Every vision response is parsed against a Zod schema before it reaches the
database. `npm run tag`, job 4:

```
Job 4: 50 untagged images, batch size 5 => ~10 API calls
Batch 1/10: images 1, 2, 3, 4, 5
  retry 1/3 (transient), waiting 3s
  ok  bear-1.jpg: bear (0.98)
  ...
Job 4 completed
  tagged: 50   failed: 0   low-confidence flagged: 4
  API calls this run: 12   logged: 12   notional cost: $0.025348
```

50/50 tagged, 0 failed, 12 calls for 50 images (batching), and two transient
failures retried rather than dropped.

## 2. Low-confidence output is flagged, not silently accepted

`GET /images?flagged=true` → 4 images, all at confidence 0.050:

```json
{
  "count": 4,
  "images": [
    {
      "id": 17,
      "filename": "deer-6.jpg",
      "subject": "impala antelope",
      "species": "unknown",
      "attributes": ["curved horns", "tan coat", "slender neck", "grassy field"],
      "caption": "An impala stands attentively in a grassy field with lush foliage in the background.",
      "confidence": "0.050",
      "low_confidence": true,
      "model": "gemini-3.6-flash"
    }
  ]
}
```

Note what this proves twice over. The schema offered fox/wolf/dog/bear/deer;
the image is an impala; the model returned `species: unknown` at 0.05 instead of
forcing a wrong answer, and the system flagged it. It also revealed that four
of my own filenames are mislabelled.

## 3. Relevant image suggested for an article

`GET /posts/red-fox-behavior/images`:

```json
{
  "expectedSpecies": "fox",
  "threshold": 0.72,
  "match": {
    "imageId": 32,
    "filename": "fox-10.jpg",
    "species": "fox",
    "caption": "A red fox stands gracefully on a snowy ridge illuminated by warm sunlight.",
    "similarity": 0.8648,
    "confidence": 0.98
  },
  "refusal": null
}
```

Ranks 1–5 are `fox-10` (0.8648), `fox-5` (0.8484), `fox-4` (0.8439),
`fox-7` (0.8422), `fox-9` (0.8410) — all fox, all `guardPassed: true`.

## 4. Mismatch guard rejects a plausible but wrong image

The central requirement. `GET /posts/red-fox-behavior/evaluate/41`, forcing
`wolf-1.jpg` onto the fox article:

```json
{
  "candidate": {
    "imageId": 41,
    "filename": "wolf-1.jpg",
    "species": "wolf",
    "caption": "An Iberian wolf stands on a rocky mound looking alertly to the side.",
    "similarity": 0.7742,
    "confidence": 0.95
  },
  "result": "REJECTED",
  "gates": { "similarity": true, "species": false, "confidence": true },
  "reasons": ["Animal category mismatch: expected fox, detected wolf"]
}
```

0.7742 is **above** the 0.72 threshold and confidence is 0.95. A
similarity-only matcher would have published a wolf on an article about foxes.
Two gates pass; the species gate rejects.

## 5. Refusal when nothing is a confident match

`GET /posts/coral-reef-bleaching/images` — an article with no matching image in
the corpus:

```json
{
  "expectedSpecies": null,
  "threshold": 0.72,
  "match": null,
  "refusal": {
    "message": "No confident match found.",
    "bestCandidate": { "filename": "deer-7.jpg", "species": "unknown", "similarity": 0.7038 },
    "reasons": [
      "Similarity 0.704 below threshold 0.72",
      "Image classification confidence too low (0.05 < 0.7)"
    ]
  }
}
```

`match: null`, not a best guess. The runner-up `fox-10.jpg` at 0.7027 is
rejected by threshold alone — 0.017 of margin, which is exactly why the
threshold was tuned rather than guessed.

## 6. Threshold chosen from data

`npm run tune` sweeps 0.40 → 0.90:

```
  0.40 - 0.70    5/6     83.3%
  0.72 - 0.78    6/6    100.0%   <-- selected
  0.80 - 0.84    5/6     83.3%
  0.86           3/6     50.0%
  0.88 - 0.90    1/6     16.7%
Best threshold: 0.72 at 100.0% precision
```

The band is bounded below by `fox-10.jpg` at 0.7027 on the coral article and
above by `dog-9.jpg` at 0.789 on its correct article.

## 7. Measured accuracy against ground truth

`npm run eval` at 0.72:

```
      post                   expected   result
------------------------------------------------------------------------------
PASS  red-fox-behavior       fox        fox-10.jpg -> fox (0.865)
PASS  wolf-pack-structure    wolf       wolf-5.jpg -> wolf (0.850)
PASS  choosing-a-family-dog  dog        dog-9.jpg -> dog (0.789)
PASS  bears-before-winter    bear       bear-7.jpg -> bear (0.846)
PASS  deer-in-woodland       deer       deer-2.jpg -> deer (0.878)
PASS  coral-reef-bleaching   REFUSE     REFUSED
------------------------------------------------------------------------------
top-1 precision (matchable posts): 5/5  100.0%
refusal accuracy (no-match posts): 1/1  100.0%
overall:                           6/6  100.0%
```

Precision and refusal accuracy are reported separately on purpose: averaging
them lets a system that refuses everything look respectable.

## 8. Unit tests

```
$ npm test
> node --test tests/*.test.js
...
# pass 14
# fail 0
```

8 guard tests, 6 similarity tests. The load-bearing one:

```
REJECTS a wolf on a fox post even at high similarity
  asserts r.gates.similarity === true   (similarity alone would have accepted)
  asserts r.gates.species    === false  (the species gate is what refuses)
```

## 9. Background processing, resumable

`GET /jobs` shows job rows with `total`, `processed`, `failed`, and status.
Job 2 records a fatal abort:

```
Job 2 aborted_bad_model
  tagged: 0   failed: 0
  Aborting without further AI calls. Items left pending; re-run to resume.
```

Items were left `pending` rather than `failed`, so the re-run (job 4) picked
them all up. `createJob()` only queues images with no `image_tags` row, so
re-running is idempotent.

## 10. Cost and token ledger

`GET /costs`:

```json
{
  "total": { "calls": 219, "cost_usd": "0.025753" },
  "breakdown": [
    { "call_type": "embedding",    "model": "gemini-embedding-001", "calls": 56,  "input_tokens": 2704,  "output_tokens": 0,    "cost_usd": "0.000406", "failures": 0 },
    { "call_type": "vision",       "model": "gemini-2.5-flash",     "calls": 150, "input_tokens": 0,     "output_tokens": 0,    "cost_usd": "0.000000", "failures": 150 },
    { "call_type": "vision_batch", "model": "gemini-2.5-flash",     "calls": 1,   "input_tokens": 0,     "output_tokens": 0,    "cost_usd": "0.000000", "failures": 1 },
    { "call_type": "vision_batch", "model": "gemini-3.6-flash",     "calls": 12,  "input_tokens": 56101, "output_tokens": 3407, "cost_usd": "0.025348", "failures": 2 }
  ]
}
```

The 150 failed `gemini-2.5-flash` rows are the quota incident in BUILDLOG.md,
kept deliberately as evidence. Failed calls show 0 tokens because the API
returns no `usageMetadata` on error — correct, not a logging gap.

## 11. Secrets never committed

`.gitignore` contains `.env` from before the first commit. `.env.example` ships
placeholders only. `GEMINI_API_KEY` is read from the environment in
`providers/gemini.js` and passed to the container via
`GEMINI_API_KEY: ${GEMINI_API_KEY}` in `docker-compose.yml` — never a literal.

## 12. Health check

```json
{ "status": "ok", "db": "connected", "tables": 10 }
```
