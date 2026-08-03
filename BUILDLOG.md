# Build log

Problems hit while building, in order, with the fix and what it changed about
the design.

## 1. Repo directory owned by root

`mkdir: cannot create directory 'corpus/images': Permission denied` in a fresh
Codespace. Fixed with
`sudo chown -R $(whoami):$(whoami) /workspaces/flyrank-capstone-image-relevance`.
Trivial, but worth knowing before blaming the tooling.

## 2. Provider switch: Groq → Gemini

Started on Groq. The vision model I'd planned on
(`meta-llama/llama-4-scout-17b-16e-instruct`) had been deprecated for the free
and developer tiers, leaving only a preview model. Switched to Gemini Flash,
which the brief lists as a first-class $0 path. Because the model ID lived in
`.env` from the start, this was a configuration change, not a code change.

## 3. Schema changes didn't apply

`/health` reported `tables: 6` and `\dt` showed an old schema with a `pairings`
table long after `init.sql` had been rewritten. Postgres runs
`/docker-entrypoint-initdb.d/*.sql` **only when the data directory is empty**,
so every later edit was ignored. `docker compose down -v && docker compose up
--build -d` gave the expected 10 tables. Lesson: with a mounted init script,
schema iteration means destroying the volume, not restarting the container.

## 4. getaddrinfo ENOTFOUND db

`node scripts/seedImages.js` failed to resolve `db`. That hostname only exists
inside the Docker network; the scripts run on the host. Fixed by pointing
`.env` at `localhost:5432` and having `docker-compose.yml` set `DATABASE_URL`
to `db:5432` for the app service. dotenv does not override an already-set
process variable, so one `.env` correctly serves both contexts. Documented in
the README because it will confuse the next person otherwise.

## 5. The quota disaster — 150 requests against a 20/day limit

The worst bug of the build. First real tagging run:

```
Job 1 finished: 0 tagged, 50 failed
```

Every call returned 429 `RESOURCE_EXHAUSTED`. I had read the retry delay in the
error and added 1.2s pacing between images, assuming a per-minute rate limit.
The error body said otherwise:

```
"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"
"quotaValue": "20"
"quotaDimensions": { "model": "gemini-2.5-flash" }
```

Twenty requests **per day**, per model. My retry logic then made it
catastrophic: 50 images × 3 attempts = 150 requests against an allowance of 20,
all after the first 20 had already made success impossible. Pacing addressed a
limit that wasn't the binding one.

Three changes came out of it:

- **Error classification with fatal abort.** `classifyError()` splits failures
  into fatal (daily quota, auth, bad model) and retryable (rate limit, invalid
  output, transient). Retrying a daily-quota exhaustion is never correct,
  because the condition cannot clear within the run's lifetime. On fatal, the
  job stops immediately and makes no further calls.
- **Multi-image batching.** Five images per `generateContent` call took 50
  images from 50 requests to 10 — the difference between impossible and
  comfortable on a 20/day budget.
- **A hard budget cap.** `MAX_REQUESTS_PER_RUN=18`, enforced by an in-process
  counter that throws `BudgetExceededError`. A bug can no longer cost more than
  18 requests.

Cleanup reset `images.status`, `job_items` and `jobs`, but deliberately kept the
150 `ai_calls` rows. They're the evidence, and `/costs` still shows them.

## 6. Malformed package.json

`ERR_INVALID_PACKAGE_CONFIG`. Pasting a `scripts` block produced a **duplicate
`"scripts"` key** with a missing comma. `JSON.parse` tolerates duplicate keys
(last wins), so a syntax check reported the file as valid while npm refused it.
Rewrote it clean, and used `npm pkg set` for later script changes instead of
hand-editing JSON.

## 7. node --test resolved a directory as a module

`npm test` failed with `Cannot find module '.../tests'` while both test files
existed. The directory form `node --test tests/` tried to resolve `tests` as a
module. The glob form works:

```bash
npm pkg set scripts.test="node --test tests/*.test.js"
```

14/14 pass.

## 8. docker compose restart serves stale code

`/posts` and `/costs` returned `{"error":"Not found"}` after new routes were
added and the container restarted. `restart` reuses the existing image, and the
Dockerfile copies source at build time, so the container was running old code.
`docker compose up --build -d app` fixed it. Later added per-directory bind
mounts (`./routes`, `./services`, `./providers`, `./schemas`, `./config`,
`./db`, `./server.js`) so code edits land without a rebuild — mounted
individually rather than `./:/app`, which would shadow `node_modules`.

## 9. gemini-2.5-flash became unavailable entirely

Mid-build, the model started returning a different error:

```
404 This model models/gemini-2.5-flash is no longer available to new users.
```

Not quota — no access at all. Probed candidate models with a one-token text
call each and found `gemini-3.6-flash` returning 200. Because the quota is
scoped **per model per project**, switching models also meant a fresh daily
allowance. One line in `.env`, no code touched. This is the payoff of keeping
model IDs in configuration: a hard external break became a config edit.

Also added a pricing entry, because unknown models fall through to `_default`
at $0 and would have silently under-reported cost.

## 10. A literal placeholder became NaN

`npm run eval` refused all five matchable posts at 0/5 precision. The header
line gave it away: `threshold: 0.XX`. I had pasted a `sed` command containing
the placeholder `0.XX` instead of substituting the tuned value, so
`Number('0.XX')` was `NaN` and every `similarity >= NaN` comparison was false.
Not a matching failure — an unreadable gate. Fixed by writing the real value
and, more usefully, by always following `sed -i` with a `grep` to confirm the
edit landed. `sed -i` reports nothing when its pattern doesn't match.

## 11. A flat threshold sweep meant empty data, not a bad threshold

An earlier `npm run tune` printed identical 16.7% at all 26 thresholds. A sweep
that never moves has nothing to sweep: there were zero image vectors, so every
post refused, and the single "correct" result was the no-match post refusing by
accident. Now the first check on a flat sweep is
`SELECT count(*) FROM image_vectors`, not the threshold logic.

## 12. YAML indentation off by one space

Every `docker compose` command failed with `yaml: line 1: did not find expected
key`, which points at line 1 regardless of where the fault is. The real problem
was `volumes:` sitting at three spaces under `app` where its siblings sat at
four; the dedent read as closing the service block. Found it with
`cat -n docker-compose.yml` and comparing key alignment.

## 13. The model was right and my filenames were wrong

Four images came back `species: unknown` at confidence exactly 0.05. An
identical confidence across four images looked like the model degrading partway
through a batch, so I planned to re-tag them individually.

Reading the actual output killed that theory: `impala antelope`,
`Thomson gazelle`, `young impala`, `impala calf`, with attributes like
`black side stripe` and `dry savanna grassland`. They are African antelopes
that I had filed as `deer-6` through `deer-9`. Offered only
fox/wolf/dog/bear/deer, the model correctly declined to force a sixth animal
into one of them.

Two consequences. First, four of my fifty ground-truth labels are wrong, and
since ground truth is derived from the filename, the eval harness could not see
its own labels were wrong — it took the model disagreeing with me to surface
it. Second, I nearly spent quota "fixing" a correct answer on the strength of a
pattern I'd invented. Kept the images, and documented it in README limitations,
because the refusal behaviour they produce on the coral-reef article is a
genuine result.

## 14. The guard cannot catch confident misclassification

`wolf-2`, `wolf-6` and `wolf-10` were tagged `dog` at 0.75–0.95 confidence. On
a dog article the species gate compares detected `dog` against expected `dog`
and passes; confidence is high, so that gate passes too. The guard trusts the
tag, so nothing in the system catches this class of error. Only filename ground
truth does, which is why the eval reads species from disk and never from
`image_tags`. Recorded as a limitation rather than patched — a guard that
second-guessed its own tags would need a second independent classifier, which
is outside the scope here.

## What I'd do differently

Read the whole error body before designing around it. The quota incident, the
false batch-degradation theory, and the `NaN` threshold were all cases where
the answer was already printed on screen and I acted on an assumption instead.
The retry logic in particular was reasonable code applied to a
misunderstanding, which made it worse than no retry logic at all.
