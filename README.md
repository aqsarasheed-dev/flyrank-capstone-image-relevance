# AI Image Understanding & Content Matching Engine

Tags an image corpus with a vision model, embeds both images and articles into
one vector space, and suggests a relevant image per article — refusing to
suggest anything when nothing is a confident match.

FlyRank Backend Track capstone. No frontend (explicit non-goal). Runs entirely
on free-tier APIs; real spend $0, no credit card.

## What it does

1. **Understand** — every image is described by a vision model into a validated
   schema: subject, species, category, attributes, caption, confidence.
2. **Match** — captions and articles are embedded with `gemini-embedding-001`
   (768d) and ranked by cosine similarity.
3. **Refuse** — three independent gates must all pass before an image is
   suggested. If none pass, the API returns a refusal with reasons rather than
   a best guess.

## Architecture

```
corpus/images/  (50 jpg)
      │
      ▼
scripts/seedImages.js ─────────────► images
      │
      ▼
jobs/tagImages.js
  ├─ providers/gemini.js    5 images per call, budget-capped
  ├─ schemas/imageTag.js    Zod validation of every array element
  └─ jobs + job_items       resumable, idempotent
      │
      ▼
  image_tags ────┐
                 │
scripts/seedPosts.js ──────────────► posts
                 │                     │
                 ▼                     ▼
          jobs/embed.js  (gemini-embedding-001, 768d)
                 │                     │
          image_vectors           post_vectors
                 └──────────┬──────────┘
                            ▼
              services/similarity.js    pure cosine
                            ▼
              services/guard.js         3 gates, pure
                            ▼
              services/matching.js      rank + persist
                            ▼
              routes/index.js           review API
```

The guard and the similarity maths are pure functions with no database or
network access, which is what makes them unit-testable in isolation.

## Setup

```bash
cp .env.example .env
# add GEMINI_API_KEY from https://aistudio.google.com/app/apikey
npm install
docker compose up --build -d
```

Seed and process:

```bash
node scripts/seedImages.js   # 50 images
node scripts/seedPosts.js    # 6 articles
npm run tag                  # ~10 batched vision calls
npm run embed                # 56 embedding calls
npm run tune                 # threshold sweep
npm run eval                 # score against ground truth
npm test                     # 14 unit tests
```

### DATABASE_URL: localhost vs db

`.env` uses `localhost:5432` because the scripts run on the host.
`docker-compose.yml` sets `DATABASE_URL` to `db:5432` for the app service,
since the hostname `db` only resolves inside the Docker network. dotenv never
overrides an already-set process variable, so one `.env` serves both contexts.

## The guard

| Gate | Rejects | Example reason |
|---|---|---|
| Similarity | Irrelevant images | `Similarity 0.410 below threshold 0.72` |
| Species | Plausible but wrong images | `Animal category mismatch: expected fox, detected wolf` |
| Confidence | Images the model wasn't sure about | `Image classification confidence too low (0.05 < 0.7)` |

The species gate is the one that earns its place. Fox and wolf captions embed
close together, so similarity cannot separate them. Forcing `wolf-1.jpg` onto
the fox article scores **0.7742 — above the 0.72 threshold — at 0.95
confidence**. Similarity passes, confidence passes, species rejects. Thresholds
catch irrelevant images; only the species gate catches images that are
plausible and wrong.

The guard is enforced rather than advisory: `POST /suggestions/:id/review`
returns **409** if you try to approve a suggestion the guard rejected.

## Results

Threshold 0.72, confidence floor 0.7:

```
top-1 precision (matchable posts): 5/5  100.0%
refusal accuracy (no-match posts): 1/1  100.0%
overall:                           6/6  100.0%
```

Ground truth comes from the filename prefix (`fox-1.jpg` → `fox`) and is used
only for scoring — never shown to the model.

## Limitations

**The sample is too small for the headline number to mean much.** Six articles,
fifty images. 100% is a sanity check that the pipeline works, not a measured
precision.

**The threshold is tuned to this corpus and the safe band is narrow.** Only
0.72–0.78 scores 6/6. Below 0.71, `fox-10.jpg` (0.7027 against the coral-reef
article) gets published on an article about coral bleaching. At 0.80 and above,
the correct `dog-9.jpg` match (0.789) is lost. Both edges are set by single
data points, so the band is fragile.

**Four of the fifty ground-truth labels are wrong.** `deer-6` through `deer-9`
are impalas and Thomson's gazelles, not deer. The model identified them
correctly as African antelopes and returned `species: unknown` at confidence
0.05 — offered only fox/wolf/dog/bear/deer, it declined to force a sixth animal
into one of them. Filename-derived ground truth is only as good as the corpus
curation, and the eval harness could not see that its own labels were wrong. It
took the model disagreeing with me to surface it. Kept deliberately, because
the refusal behaviour it produces is a real result.

**The guard trusts the tag, so it cannot catch confident misclassification.**
`wolf-2`, `wolf-6` and `wolf-10` were tagged `dog` at 0.75–0.95 confidence. On
a dog article, the species gate compares detected `dog` against expected `dog`
and lets them through; confidence is high, so that gate passes too. Nothing in
the system catches this. Only filename ground truth does, which is why the eval
reads species from disk and never from `image_tags`.

**Cost figures are notional.** Per-token rates for `gemini-3.6-flash` in
`config/pricing.js` are carried over from `gemini-2.5-flash` and unverified.
Real spend on free tier is $0; `/costs` demonstrates the ledger, not billing.

**Species inference from article text is keyword counting**, not
classification. It works only because the corpus is five clearly separated
animals.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | DB connectivity + table count |
| GET | `/images?species=&flagged=` | Corpus with tags; `flagged=true` for low confidence |
| GET | `/images/:id` | One image and its tag |
| GET | `/posts` | Articles |
| GET | `/posts/:idOrSlug/images` | Ranked suggestions, or a refusal with reasons |
| GET | `/posts/:idOrSlug/evaluate/:imageId` | Gate-by-gate verdict for a forced pair |
| GET | `/suggestions?status=` | Persisted suggestions |
| POST | `/suggestions/:id/review` | Approve/reject; 409 on guard-rejected approve |
| GET | `/jobs` | Job history with counts |
| GET | `/costs` | Token and cost ledger by model |

## Stack

Node 24 (CommonJS), Express 5, Postgres 16, Docker Compose, Zod for schema
validation, `@google/genai` for vision and embeddings. Cosine similarity is
computed over `DOUBLE PRECISION[]` columns — pgvector is unnecessary at 50
images and would be premature here.
