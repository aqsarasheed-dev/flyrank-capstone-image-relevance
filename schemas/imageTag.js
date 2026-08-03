const { z } = require('zod');

const ImageTagSchema = z.object({
  subject: z.string().min(2).max(80),
  category: z.string().min(2).max(40),
  species: z.string().min(2).max(40),
  attributes: z.array(z.string().min(1).max(40)).min(1).max(8),
  caption: z.string().min(10).max(300),
  confidence: z.number().min(0).max(1),
});

// Batch responses carry a position so we can map results back to inputs
// even if the model reorders them.
const BatchImageTagSchema = ImageTagSchema.extend({
  index: z.number().int().min(0),
});

module.exports = { ImageTagSchema, BatchImageTagSchema };