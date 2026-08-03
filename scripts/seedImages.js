require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, pool } = require('../db/pool');

(async () => {
  const dir = path.join(__dirname, '..', 'corpus', 'images');
  const files = fs.readdirSync(dir).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort();

  for (const filename of files) {
    const hint = filename.split('-')[0].toLowerCase(); // ground truth, eval only
    await query(
      `INSERT INTO images (filename, category_hint) VALUES ($1, $2)
       ON CONFLICT (filename) DO NOTHING`,
      [filename, hint]
    );
  }
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM images');
  console.log(`Seeded. Images in DB: ${rows[0].n}`);
  await pool.end();
})();