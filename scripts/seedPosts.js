require('dotenv').config();
const { query, pool } = require('../db/pool');

const POSTS = [
  { slug: 'red-fox-behavior', topic: 'fox',
    title: 'The Behavior of Red Foxes',
    body: `Red foxes (Vulpes vulpes) are the most widely distributed wild carnivore on earth. They hunt alone rather than in packs, using a distinctive high pounce to catch rodents beneath snow. Their orange-red coat, white-tipped tail and slender frame distinguish them from larger canids. Foxes are highly adaptable, thriving in forests, farmland and increasingly in cities.` },

  { slug: 'wolf-pack-structure', topic: 'wolf',
    title: 'How Wolf Packs Are Organised',
    body: `Grey wolves live and hunt in family packs, typically a breeding pair and their offspring. Cooperative hunting lets them take prey far larger than themselves. Wolves are noticeably bigger and heavier than foxes, with broader skulls, longer legs and grey or grizzled coats. Howling coordinates the pack across long distances.` },

  { slug: 'choosing-a-family-dog', topic: 'dog',
    title: 'Choosing a Family Dog',
    body: `Domestic dogs come in enormous variety, from working breeds to companion lap dogs. Temperament, exercise needs and tolerance of children matter more than appearance when choosing a family pet. A dog raised around people is relaxed on a lead and comfortable indoors.` },

  { slug: 'bears-before-winter', topic: 'bear',
    title: 'What Bears Do Before Winter',
    body: `Bears enter hyperphagia in autumn, eating almost continuously to build fat reserves before denning. Their bulk, powerful shoulders and plantigrade walk make them unmistakable. Brown and black bears both den through the coldest months, though not in true hibernation.` },

  { slug: 'deer-in-woodland', topic: 'deer',
    title: 'Deer in Temperate Woodland',
    body: `Deer are browsing herbivores whose grazing shapes woodland understory. Males grow and shed antlers annually. Large ears and eyes set to the sides of the head give them wide awareness of approaching predators, and they freeze before fleeing in long bounds.` },

  // Deliberate no-match case: nothing in a 5-animal corpus should clear the bar.
  { slug: 'coral-reef-bleaching', topic: null,
    title: 'Why Coral Reefs Are Bleaching',
    body: `Rising sea temperatures cause corals to expel the symbiotic algae that give them colour and most of their energy, leaving bleached white skeletons. Reef systems support a quarter of all marine species. Recovery is possible if heat stress is brief, but repeated events across the Great Barrier Reef have left little time between bleaching episodes.` },
];

(async () => {
  for (const p of POSTS) {
    await query(
      `INSERT INTO posts (slug, title, body, topic) VALUES ($1,$2,$3,$4)
       ON CONFLICT (slug) DO UPDATE SET title=EXCLUDED.title, body=EXCLUDED.body, topic=EXCLUDED.topic`,
      [p.slug, p.title, p.body, p.topic]
    );
  }
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM posts');
  console.log(`Seeded posts. Total: ${rows[0].n}`);
  await pool.end();
})();