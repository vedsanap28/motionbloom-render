
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const jobId = process.argv[2];
const promptData = JSON.parse(process.argv[3]);
let searchQuery = promptData.query || 'nature';
searchQuery = searchQuery.split('\n')[0].split('.')[0].trim();
searchQuery = searchQuery.split(' ').slice(0, 5).join(' ');

const CLIP_DURATION = 5;
const PEXELS_KEY = process.env.PEXELS_API_KEY;
const PIXABAY_KEY = process.env.PIXABAY_API_KEY;

const PERSON_KEYWORDS = ['boy', 'girl', 'man', 'woman', 'person', 'people', 'child', 'kid', 'guy', 'lady', 'human', 'men', 'women'];
const FACE_SAFE_MODIFIERS = [
  'silhouette', 'faceless', 'from behind', 'back view',
  'helmet covered face', 'underwater distant shot', 'wearing mask',
  'obscured face', 'far away shot', 'shadow silhouette'
];
const isPersonPrompt = PERSON_KEYWORDS.some(word => searchQuery.toLowerCase().includes(word));

const MOOD_MAP = {
  motivational: ['motivat', 'success', 'inspir', 'goal', 'achieve', 'winner'],
  energetic: ['energetic', 'workout', 'gym', 'sport', 'run', 'action', 'fast'],
  calm: ['calm', 'relax', 'meditat', 'nature', 'slow'],
  peace: ['peace', 'peaceful', 'serene', 'tranquil', 'quiet'],
  emotional: ['sad', 'emotional', 'love', 'memory', 'cry', 'heart'],
  creativity: ['creative', 'art', 'design', 'idea', 'innovation'],
  Horrormix: ['horror', 'scary', 'fear', 'dark', 'ghost', 'night'],
  neutral: []
};

function detectMood(query) {
  const lowerQuery = query.toLowerCase();
  for (const [mood, keywords] of Object.entries(MOOD_MAP)) {
    if (keywords.some(kw => lowerQuery.includes(kw))) return mood;
  }
  return 'neutral';
}

async function fetchFromPexels(query, count) {
  const res = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${count}`,
    { headers: { Authorization: PEXELS_KEY } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  if (!data.videos) return [];
  return data.videos.map(v => {
    const vf = v.video_files.find(f => f.quality === 'sd') || v.video_files[0];
    return vf.link;
  });
}

async function fetchFromPixabay(query, count) {
  const res = await fetch(
    `https://pixabay.com/api/videos/?key=${PIXABAY_KEY}&q=${encodeURIComponent(query)}&per_page=${count}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  if (!data.hits) return [];
  return data.hits.map(h => h.videos.medium.url);
}

async function getClipUrls(query, isPerson) {
  let urls = [];

  if (isPerson) {
    console.log('Person detected — trying Pixabay AI generated videos first.');
    urls = await fetchFromPixabay(`AI generated ${query}`, 4);

    if (urls.length === 0) {
      console.log('No AI-generated match — falling back to face-safe real footage.');
      const modifier = FACE_SAFE_MODIFIERS[Math.floor(Math.random() * FACE_SAFE_MODIFIERS.length)];
      urls = await fetchFromPixabay(`${query} ${modifier}`, 4);
    }
    if (urls.length === 0) {
      urls = await fetchFromPexels(`${query} silhouette`, 4);
    }
  } else {
    console.log('Trying Pexels first...');
    urls = await fetchFromPexels(query, 4);
    if (urls.length === 0 && PIXABAY_KEY) {
      console.log('Pexels had no results, trying Pixabay...');
      urls = await fetchFromPixabay(query, 4);
    }
  }

  return urls;
}

async function main() {
  console.log(`Job: ${jobId}, Query: ${searchQuery}, IsPerson: ${isPersonPrompt}`);

  const mood = detectMood(searchQuery);
  const allFiles = fs.readdirSync('.');
  const moodFiles = allFiles.filter(f =>
    f.toLowerCase().startsWith(`music-${mood.toLowerCase()}`) && f.endsWith('.mp3')
  );
  const musicFile = moodFiles.length > 0
    ? moodFiles[Math.floor(Math.random() * moodFiles.length)]
    : `music-neutral.mp3`;

  console.log(`Available ${mood} tracks: ${moodFiles.join(', ')}`);
  console.log(`Using music: ${musicFile}`);

  if (!fs.existsSync('output')) fs.mkdirSync('output');
  if (!fs.existsSync('temp')) fs.mkdirSync('temp');

  const clipUrls = await getClipUrls(searchQuery, isPersonPrompt);

  if (clipUrls.length === 0) {
    throw new Error('No clips found for this query.');
  }

  console.log(`Found ${clipUrls.length} clips. Downloading...`);

  const trimmedFiles = [];
  for (let i = 0; i < clipUrls.length; i++) {
    const fileRes = await fetch(clipUrls[i]);
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    const rawPath = path.join('temp', `raw${i}.mp4`);
    fs.writeFileSync(rawPath, buffer);

    const trimmedPath = path.join('temp', `clip${i}.mp4`);
    execSync(
      `ffmpeg -y -i ${rawPath} -t ${CLIP_DURATION} ` +
      `-vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30" ` +
      `-an -c:v libx264 -preset fast -pix_fmt yuv420p ${trimmedPath}`,
      { stdio: 'inherit' }
    );
    trimmedFiles.push(trimmedPath);
  }

  const listContent = trimmedFiles.map(f => `file '${path.resolve(f)}'`).join('\n');
  fs.writeFileSync('temp/list.txt', listContent);

  const silentVideoPath = path.join('temp', 'silent.mp4');
  execSync(`ffmpeg -y -f concat -safe 0 -i temp/list.txt -c copy ${silentVideoPath}`, { stdio: 'inherit' });

  const outputPath = path.join('output', `${jobId}.mp4`);
  execSync(
    `ffmpeg -y -i ${silentVideoPath} -i ${musicFile} ` +
    `-c:v copy -c:a aac -shortest -map 0:v:0 -map 1:a:0 ${outputPath}`,
    { stdio: 'inherit' }
  );

  console.log(`Render complete: ${outputPath}`);
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
