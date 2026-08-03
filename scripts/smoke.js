require('dotenv').config();
const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

(async () => {
  const b64 = fs.readFileSync('corpus/images/fox-1.jpg').toString('base64');
  const res = await ai.models.generateContent({
    model: process.env.VISION_MODEL,
    contents: [{
      parts: [
        { text: 'Describe the animal in this image in one sentence.' },
        { inlineData: { mimeType: 'image/jpeg', data: b64 } },
      ],
    }],
  });
  console.log(res.text);
})();