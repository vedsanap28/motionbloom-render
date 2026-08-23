const fs = require('fs');
const path = require('path');

const jobId = process.argv[2];
const promptData = JSON.parse(process.argv[3]);
let prompt = promptData.query || promptData.prompt || 'a beautiful scene';
prompt = prompt.split('\n')[0].split('.')[0].trim();
prompt = prompt.split(' ').slice(0, 6).join(' ');
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const PEXELS_KEY = process.env.PEXELS_IMAGE_API_KEY;
const PIXABAY_KEY = process.env.PIXABAY_API_KEY;

const PERSON_KEYWORDS = ['boy', 'girl', 'man', 'woman', 'person', 'people', 'child', 'kid', 'guy', 'lady', 'human', 'men', 'women'];
const isPersonPrompt = PERSON_KEYWORDS.some(word => prompt.toLowerCase().includes(word));

async function tryGemini(p) {
  console.log('Trying Gemini image generation...');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: p }] }] })
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    console.log(`Gemini failed: ${res.status} - ${errText.slice(0, 200)}`);
    return null;
  }
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find(pt => pt.inlineData);
  if (!imagePart) {
    console.log('Gemini returned no image data.');
    return null;
  }
  return Buffer.from(imagePart.inlineData.data, 'base64');
}

async function tryPexels(query) {
  console.log('Trying Pexels...');
  const res = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1`,
    { headers: { Authorization: PEXELS_KEY } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const photo = data.photos?.[0];
  if (!photo) return null;
  const imgRes = await fetch(photo.src.large);
  return Buffer.from(await imgRes.arrayBuffer());
}

async function tryPixabay(query) {
  console.log('Trying Pixabay...');
  const res = await fetch(
    `https://pixabay.com/api/?key=${PIXABAY_KEY}&q=${encodeURIComponent(query)}&per_page=3`
  );
  if (!res.ok) return null;
  const data = await res.json();
  const hit = data.hits?.[0];
  if (!hit) return null;
  const imgRes = await fetch(hit.largeImageURL);
  return Buffer.from(await imgRes.arrayBuffer());
}

async function main() {
  console.log(`Job: ${jobId}, Prompt: ${prompt}, IsPerson: ${isPersonPrompt}`);
  if (!fs.existsSync('output')) fs.mkdirSync('output');

  let imageBuffer = null;
  let source = 'none';

  try {
    imageBuffer = await tryGemini(prompt);
    if (imageBuffer) source = 'gemini';
  } catch (e) {
    console.log('Gemini error:', e.message);
  }

  if (!imageBuffer && isPersonPrompt) {
    console.log('Person prompt — skipping Pexels, going directly to Pixabay (AI generated people).');
    try {
      imageBuffer = await tryPixabay(`AI generated people ${prompt}`);
      if (imageBuffer) source = 'pixabay-ai-people';
    } catch (e) {
      console.log('Pixabay error:', e.message);
    }
  }

  if (!imageBuffer && !isPersonPrompt) {
    try {
      imageBuffer = await tryPexels(prompt);
      if (imageBuffer) source = 'pexels';
    } catch (e) {
      console.log('Pexels error:', e.message);
    }
    if (!imageBuffer) {
      try {
        imageBuffer = await tryPixabay(prompt);
        if (imageBuffer) source = 'pixabay';
      } catch (e) {
        console.log('Pixabay error:', e.message);
      }
    }
  }

  if (!imageBuffer) {
    throw new Error('All image sources failed (Gemini, Pexels, Pixabay).');
  }

  const outputPath = path.join('output', `${jobId}.png`);
  fs.writeFileSync(outputPath, imageBuffer);
  console.log(`Image saved from source: ${source} -> ${outputPath}`);
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
