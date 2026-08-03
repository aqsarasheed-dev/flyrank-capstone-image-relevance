require('dotenv').config();

const express = require('express');
const { pool } = require('./db/pool');
const routes = require('./routes');

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    service: 'AI Image Understanding & Content Matching Engine',
    status: 'running',
    visionModel: process.env.VISION_MODEL,
    embedModel: process.env.EMBED_MODEL,
    similarityThreshold: Number(process.env.SIMILARITY_THRESHOLD),
    confidenceThreshold: Number(process.env.LOW_CONFIDENCE_THRESHOLD),
    endpoints: [
      'GET  /health',
      'GET  /images?species=&flagged=',
      'GET  /images/:id',
      'GET  /posts',
      'GET  /posts/:idOrSlug/images?limit=&persist=',
      'GET  /posts/:idOrSlug/evaluate/:imageId',
      'GET  /suggestions?status=',
      'POST /suggestions/:id/review   {"decision":"approve"|"reject"}',
      'GET  /jobs',
      'GET  /costs',
    ],
  });
});

app.get('/health', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS tables FROM information_schema.tables WHERE table_schema = 'public'`
    );
    res.json({ status: 'ok', db: 'connected', tables: rows[0].tables });
  } catch (err) {
    res.status(503).json({ status: 'degraded', db: 'unreachable', error: err.message });
  }
});

app.use(routes);

app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));

// Errors never leak a stack trace to the client.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server listening on ${PORT}`));