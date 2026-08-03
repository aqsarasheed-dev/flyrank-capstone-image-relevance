require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.get('/', (req, res) => {
  res.json({
    service: 'AI Image Understanding & Content Matching Engine',
    status: 'running',
    visionModel: process.env.VISION_MODEL,
    embedModel: process.env.EMBED_MODEL,
    similarityThreshold: Number(process.env.SIMILARITY_THRESHOLD),
  });
});

app.get('/health', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS tables FROM information_schema.tables WHERE table_schema = $1', ['public']);
    res.json({ status: 'ok', db: 'connected', tables: rows[0].tables });
  } catch (err) {
    res.status(503).json({ status: 'degraded', db: 'unreachable', error: err.message });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on ${PORT}`);
  console.log(`Vision model: ${process.env.VISION_MODEL} | Embed model: ${process.env.EMBED_MODEL}`);
});