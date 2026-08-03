# Build Log — AI Usage Honesty

This log tracks where AI (Claude) helped build this capstone, where it was wrong, and what I changed. Updated as I build, not reconstructed at the end.

## Format
Each entry: what I asked for → what AI produced → what I verified/changed/corrected myself.

---

## Phase 1 — Design
*(entries added as design work happens)*
## Free-tier daily quota (blocking bug)

gemini-2.5-flash free tier allows 20 requests/day, not per minute. My first
batch job assumed a per-minute limit and paced calls 1.2s apart, then retried
each failure 3x — burning 150 requests against a 20/day allowance and tagging
zero images.

Fixes:
1. Error classification: daily-quota exhaustion is FATAL and aborts the job.
   Retrying a condition that cannot clear within the run is never correct.
   Items are left `pending`, so the next run resumes.
2. Multi-image batching: 5 images per request => 50 images in 10 calls.
3. Model choice is now a quota decision, not just a quality one.

Lesson: read the quotaId, not just the status code. "429" told me almost
nothing; "GenerateRequestsPerDayPerProjectPerModel" told me my whole retry
strategy was wrong.