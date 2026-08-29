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
// Fetch extra candidates so we still have enough clips left after filtering out
// any that look like they contain people.
const FETCH_MULTIPLIER = 3;

let searchQuery = promptData.query || 'nature';
searchQuery = searchQuery.split('\n')[0].split('.')[0].trim();
searchQuery = searchQuery.split(' ').slice(0, 5).join(' ');
if (theme) {
  searchQuery = `${searchQuery} ${theme}`;
}

const PEXELS_KEY = process.env.PEXELS_API_KEY;
const PIXABAY_KEY = process.env.PIXABAY_API_KEY;

const PERSON_KEYWORDS = [
  'boy', 'boys',
  'girl', 'girls',
  'man', 'men', 'mens',
  'woman', 'women', 'womens',
  'person', 'persons',
  'people',
  'child', 'children', 'kid', 'kids',
  'guy', 'guys',
  'lady', 'ladies',
  'human', 'humans',
  'model', 'models',
  'face', 'faces',
  'family',
  'baby', 'babies',
  'crowd',
];

function containsPerson(text) {
  const lower = (text || '').toLowerCase();
  return PERSON_KEYWORDS.some((w) => new RegExp(`\\b${w}\\b`).test(lower));
}

const isPersonPrompt = containsPerson(searchQuery);

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

/**
 * Fetch candidate clips from Pexels along with whatever descriptive text is
 * available (the video's page URL contains a readable slug, e.g.
 * ".../video/a-man-riding-a-bicycle-1234/") so we can screen out clips that
 * look like they feature people before ever downloading them.
 */
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
    return { url: vf.link, text: v.url || '' };
  });
}

/**
 * Fetch candidate clips from Pixabay along with their real tag metadata,
 * which is the most reliable signal we have for screening out clips that
 * feature people.
 */
async function fetchFromPixabay(query, count) {
  const res = await fetch(
    `https://pixabay.com/api/videos/?key=${PIXABAY_KEY}&q=${encodeURIComponent(query)}&per_page=${count}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  if (!data.hits) return [];
  return data.hits.map(h => ({ url: h.videos.medium.url, text: h.tags || '' }));
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

  const wantCount = NUM_CLIPS * FETCH_MULTIPLIER;

  console.log(`Trying Pexels first (orientation: ${orientation})...`);
  let candidates = await fetchFromPexels(searchQuery, wantCount, orientation);

  if (candidates.length === 0 && PIXABAY_KEY) {
    console.log('Pexels had no results, trying Pixabay...');
    candidates = await fetchFromPixabay(searchQuery, wantCount);
  }

  if (candidates.length === 0) {
    throw new Error('No clips found for this query.');
  }

  // Screen out any candidate whose metadata/slug suggests it features a person.
  let safeCandidates = candidates.filter(c => !containsPerson(c.text));
  console.log(`Filtered ${candidates.length - safeCandidates.length} candidate(s) that looked like they contained people.`);

  // If filtering left us short, try Pixabay as a second source before giving up.
  if (safeCandidates.length < NUM_CLIPS && PIXABAY_KEY) {
    console.log('Not enough safe clips from the first source, trying Pixabay for more...');
    const extra = await fetchFromPixabay(searchQuery, wantCount);
    const extraSafe = extra.filter(c => !containsPerson(c.text));
    safeCandidates = safeCandidates.concat(extraSafe);
  }

  if (safeCandidates.length === 0) {
    throw new Error('No people-free clips found for this query. Please try a different prompt.');
  }

  const clipUrls = safeCandidates.slice(0, NUM_CLIPS).map(c => c.url);
  console.log(`Using ${clipUrls.length} people-free clip(s). Downloading in parallel...`);

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

