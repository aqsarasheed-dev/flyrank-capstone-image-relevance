# Design: AI Image Understanding & Content Matching Engine

## Problem
Given ~50 licensed-free animal images and a set of blog posts, automatically
tag each image, rank images per post by semantic relevance, and refuse to
suggest an image when it is not actually a good match. Refusal quality matters
more than match quality.

## Non-goal (explicit)
No frontend build. The review workflow is JSON API endpoints only. No image
generation, no multi-model comparison, no user accounts.

## Corpus
50 images, 5 categories x 10: fox, wolf, dog, bear, deer.
Filename prefix (`fox-1.jpg`) is the ground-truth label, used only for the
eval set — never fed to the model or the matcher.
Source: Unsplash / Pexels free licenses.

## Models (pinned via .env, swappable without code changes)
- Vision:     gemini-2.5-flash        (stable, free tier)
- Embeddings: gemini-embedding-001    (free tier, text)

## Image metadata schema
Every vision response is validated with Zod before it touches the database.
Invalid output is retried up to 3 times, then the image is marked `failed`.

```json
{
  "subject": "red fox",
  "category": "animal",
  "species": "fox",
  "attributes": ["orange fur", "wild", "forest"],
  "caption": "A red fox standing in a forest",
  "confidence": 0.94
}
```

`confidence < 0.7` sets `low_confidence = true`. Flagged images stay
searchable but can never be auto-approved.

## Matching strategy
1. Embed each image's `caption + subject + attributes` into `image_vectors`.
2. Embed each post's `title + body` into `post_vectors`.
3. Rank candidates by cosine similarity (arrays in Postgres; 50 images makes
   pgvector unnecessary at this scale).

## Mismatch guard
A candidate must clear all three gates or it is rejected with a reason:

| Gate | Rule | Rejection reason |
|---|---|---|
| Similarity | cosine >= SIMILARITY_THRESHOLD (0.62) | "Similarity 0.41 below threshold 0.62" |
| Species     | post topic species == detected species, when the post names one | "Animal category mismatch: expected fox, detected wolf" |
| Confidence  | tag confidence >= 0.7 | "Image classification confidence too low (0.55)" |

If no candidate clears all three: `{ "match": null, "reasons": [...] }`.
The species gate is what makes the wolf provably fail on a fox post even when
cosine similarity is high — visually and semantically, wolves and foxes are
close neighbours, so the threshold alone is not enough.

## Thresholds
Chosen from the labeled eval set, not guessed. Recorded in README with the
top-1 precision they produce.

## Data model
See `init.sql`. 10 tables: images, image_tags, posts, image_vectors,
post_vectors, suggestions, jobs, job_items, ai_calls, eval_labels.

## Layers
routes/ (HTTP + validation) -> services/ (matching, guard, eval)
-> repositories/ (SQL) -> db. Providers isolated in providers/gemini.js so
a model swap touches one file.

## Background processing
Vision and embedding calls run as batch jobs tracked in `jobs`/`job_items`
with per-item attempt counts and retry-on-failure. Re-running a job skips
items already `done`, making the job idempotent. Every AI call writes a row
to `ai_calls` with tokens, latency, and cost_usd.