const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const jobId = process.argv[2];
const promptData = JSON.parse(process.argv[3]);
const aspect = promptData.aspect || '16:9';
const RESOLUTIONS = {
  '16:9': { w: 1280, h: 720 },
  '9:16': { w: 720, h: 1280 },
  '1:1': { w: 720, h: 720 }
};
const { w: OUT_W, h: OUT_H } = RESOLUTIONS[aspect] || RESOLUTIONS['16:9'];
const orientation = aspect === '9:16' ? 'portrait' : aspect === '1:1' ? 'square' : 'landscape';

const duration = promptData.duration || '30s';
const theme = promptData.theme || '';
const DURATION_SECONDS = { '15s': 15, '30s': 30, '60s': 60 };
const CLIP_DURATION = 5;
const NUM_CLIPS = Math.ceil((DURATION_SECONDS[duration] || 30) / CLIP_DURATION);

let searchQuery = promptData.query || 'nature';
searchQuery = searchQuery.split('\n')[0].split('.')[0].trim();
searchQuery = searchQuery.split(' ').slice(0, 5).join(' ');
if (theme) {
  searchQuery = `${searchQuery} ${theme}`;
}

const PEXELS_KEY = process.env.PEXELS_API_KEY;
const PIXABAY_KEY = process.env.PIXABAY_API_KEY;

const PERSON_KEYWORDS = ['boy', 'girl', 'man', 'woman', 'person', 'people', 'child', 'kid', 'guy', 'lady', 'human', 'men', 'women'];
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

function pickMusicFile(mood) {
  const allFiles = fs.readdirSync('.');
  let moodFiles = allFiles.filter(f =>
    f.toLowerCase().startsWith(`music-${mood.toLowerCase()}`) && f.endsWith('.mp3')
  );
  if (moodFiles.length === 0) {
    moodFiles = allFiles.filter(f => f.toLowerCase().startsWith('music-') && f.endsWith('.mp3'));
  }
  console.log(`Mood: ${mood} — ${moodFiles.length} track(s) available: ${moodFiles.join(', ')}`);
  return moodFiles[Math.floor(Math.random() * moodFiles.length)];
}

async function fetchFromPexels(query, count, orient) {
  const orientParam = orient ? `&orientation=${orient}` : '';
  const res = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${count}${orientParam}`,
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

async function downloadAndTrim(url, index) {
  const fileRes = await fetch(url);
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  const rawPath = path.join('temp', `raw${index}.mp4`);
  fs.writeFileSync(rawPath, buffer);

  const trimmedPath = path.join('temp', `clip${index}.mp4`);
  execSync(
    `ffmpeg -y -i ${rawPath} -t ${CLIP_DURATION} ` +
    `-vf "scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease,pad=${OUT_W}:${OUT_H}:(ow-iw)/2:(oh-ih)/2,fps=30" ` +
    `-an -c:v libx264 -preset fast -pix_fmt yuv420p ${trimmedPath}`,
    { stdio: 'inherit' }
  );
  return trimmedPath;
}

async function main() {
  console.log(`Job: ${jobId}, Query: ${searchQuery}, IsPerson: ${isPersonPrompt}, Duration: ${duration} (${NUM_CLIPS} clips), Aspect: ${aspect} (${orientation})`);

  if (isPersonPrompt) {
    throw new Error('PERSON_NOT_ALLOWED: Video generation featuring real people is not supported to protect individual privacy and identity. Please try a different prompt (nature, objects, animals, robots, anime, etc).');
  }

  const mood = detectMood(searchQuery);
  const musicFile = pickMusicFile(mood);

  if (!fs.existsSync('output')) fs.mkdirSync('output');
  if (!fs.existsSync('temp')) fs.mkdirSync('temp');

  console.log(`Trying Pexels first (orientation: ${orientation})...`);
  let clipUrls = await fetchFromPexels(searchQuery, NUM_CLIPS, orientation);

  if (clipUrls.length === 0 && PIXABAY_KEY) {
    console.log('Pexels had no results, trying Pixabay...');
    clipUrls = await fetchFromPixabay(searchQuery, NUM_CLIPS);
  }

  if (clipUrls.length === 0) {
    throw new Error('No clips found for this query.');
  }

  console.log(`Found ${clipUrls.length} clips. Downloading in parallel...`);

  const trimmedFiles = await Promise.all(
    clipUrls.map((url, i) => downloadAndTrim(url, i))
  );

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
