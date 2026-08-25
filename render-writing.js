const fs = require('fs');
const path = require('path');

const jobId = process.argv[2];
const promptData = JSON.parse(process.argv[3]);

const contentType = promptData.content_type || 'outline';
const tone = promptData.tone || 'professional';
const length = promptData.length || 'medium';
const idea = promptData.query || promptData.idea || 'a general topic';

const GEMINI_KEY = process.env.GEMINI_API_KEY;

const LENGTH_GUIDE = {
  short: 'Keep it very brief, 2-4 sentences or a short list.',
  medium: 'Write a moderate length response, a few short paragraphs or a clear list.',
  long: 'Write a detailed, thorough response with multiple paragraphs or sections.',
};

async function generateText() {
  const systemPrompt = `You are a professional content writer. Write a "${contentType}" in a "${tone}" tone. ${LENGTH_GUIDE[length] || LENGTH_GUIDE.medium} Do not include any preamble like "Here is your content" — just write the content directly.`;

  console.log(`Job: ${jobId}, Type: ${contentType}, Tone: ${tone}, Length: ${length}`);
  console.log(`Idea: ${idea}`);

  const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${systemPrompt}\n\nTopic/idea: ${idea}` }] }],
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini failed: ${res.status} - ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no text.');
  return text.trim();
}

async function main() {
  if (!fs.existsSync('output')) fs.mkdirSync('output');

  const text = await generateText();
  const outputPath = path.join('output', `${jobId}.txt`);
  fs.writeFileSync(outputPath, text, 'utf-8');

  console.log(`Render complete: ${outputPath}`);
  console.log(`Preview: ${text.slice(0, 100)}...`);
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
