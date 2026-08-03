# Evidence — Definition of Done

Each checkbox below will be filled with a pasted proof (test output, curl transcript, or log line) as each part is completed. Nothing here yet — filled in as we build each phase, not at the end.

## AI Processing
- [ ] Vision model produces structured output validated against a schema; invalid responses never trusted
- [ ] Low-confidence classifications are flagged instead of accepted

## Matching System
- [ ] Images processed through a batch background job with retries
- [ ] Vision and embedding costs tracked per call
- [ ] Image and post embeddings stored; posts return ranked image suggestions
- [ ] Semantic matching works for equivalent concepts ("red fox" matches "Vulpes vulpes")

## Safety Layer
- [ ] Mismatch guard rejects incorrect recommendations (wolf-on-fox-post case)
- [ ] Rejections include a human-readable explanation
- [ ] "No confident match" response when nothing clears the bar

## Backend
- [ ] Database models: images, tags, embeddings, posts, suggestions, approvals/rejections — with indexes
- [ ] API endpoints validated; review workflow (approve/reject/inspect) exists

## Quality & Documentation
- [ ] Automated tests: schema validation, mismatch rejection, matching accuracy
- [ ] Labeled evaluation dataset measures top-1 precision (number in README)
- [ ] README with architecture explanation and diagram