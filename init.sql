-- FlyRank Capstone: AI Image Understanding & Content Matching Engine
-- Runs automatically on first container start (empty volume only).

CREATE TABLE IF NOT EXISTS images (
  id            SERIAL PRIMARY KEY,
  filename      TEXT NOT NULL UNIQUE,
  category_hint TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS image_tags (
  id             SERIAL PRIMARY KEY,
  image_id       INTEGER NOT NULL UNIQUE REFERENCES images(id) ON DELETE CASCADE,
  subject        TEXT NOT NULL,
  category       TEXT NOT NULL,
  attributes     TEXT[] NOT NULL DEFAULT '{}',
  caption        TEXT NOT NULL,
  confidence     NUMERIC(4,3) NOT NULL,
  low_confidence BOOLEAN NOT NULL DEFAULT FALSE,
  model          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS posts (
  id         SERIAL PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  topic      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS image_vectors (
  id         SERIAL PRIMARY KEY,
  image_id   INTEGER NOT NULL UNIQUE REFERENCES images(id) ON DELETE CASCADE,
  embedding  DOUBLE PRECISION[] NOT NULL,
  dims       INTEGER NOT NULL,
  model      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS post_vectors (
  id         SERIAL PRIMARY KEY,
  post_id    INTEGER NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE,
  embedding  DOUBLE PRECISION[] NOT NULL,
  dims       INTEGER NOT NULL,
  model      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suggestions (
  id           SERIAL PRIMARY KEY,
  post_id      INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  image_id     INTEGER REFERENCES images(id) ON DELETE CASCADE,
  similarity   NUMERIC(6,5),
  rank         INTEGER,
  guard_passed BOOLEAN NOT NULL,
  guard_reason TEXT,
  status       TEXT NOT NULL DEFAULT 'suggested',
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Batch job bookkeeping: retries, progress, idempotency.
CREATE TABLE IF NOT EXISTS jobs (
  id          SERIAL PRIMARY KEY,
  job_type    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'queued',
  total       INTEGER NOT NULL DEFAULT 0,
  processed   INTEGER NOT NULL DEFAULT 0,
  failed      INTEGER NOT NULL DEFAULT 0,
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_items (
  id           SERIAL PRIMARY KEY,
  job_id       INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  ref_type     TEXT NOT NULL,
  ref_id       INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, ref_type, ref_id)
);

-- Per-call AI cost tracking.
CREATE TABLE IF NOT EXISTS ai_calls (
  id            SERIAL PRIMARY KEY,
  job_id        INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  call_type     TEXT NOT NULL,
  model         TEXT NOT NULL,
  ref_type      TEXT,
  ref_id        INTEGER,
  input_tokens  INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd      NUMERIC(12,8) NOT NULL DEFAULT 0,
  latency_ms    INTEGER,
  success       BOOLEAN NOT NULL DEFAULT TRUE,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS eval_labels (
  id                SERIAL PRIMARY KEY,
  post_id           INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  correct_image_id  INTEGER REFERENCES images(id) ON DELETE CASCADE,
  expect_no_match   BOOLEAN NOT NULL DEFAULT FALSE,
  note              TEXT
);

CREATE INDEX IF NOT EXISTS idx_images_status        ON images(status);
CREATE INDEX IF NOT EXISTS idx_image_tags_category  ON image_tags(category);
CREATE INDEX IF NOT EXISTS idx_image_tags_lowconf   ON image_tags(low_confidence);
CREATE INDEX IF NOT EXISTS idx_suggestions_post     ON suggestions(post_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_image    ON suggestions(image_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_status   ON suggestions(status);
CREATE INDEX IF NOT EXISTS idx_job_items_job        ON job_items(job_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_calls_job         ON ai_calls(job_id);
CREATE INDEX IF NOT EXISTS idx_ai_calls_created     ON ai_calls(created_at);