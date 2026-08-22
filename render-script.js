const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const jobId = process.argv[2];
const promptData = JSON.parse(process.argv[3]);
const searchQuery = promptData.query || 'nature';
const CLIP_DURATION = 5;

const PEXELS_KEY = process.env.PEXELS_API_KEY;

async function main() {
  console.log(`Job: ${jobId}, Query: ${searchQuery}`);

  if (!fs.existsSync('output')) fs.mkdirSync('output');
  if (!fs.existsSync('temp')) fs.mkdirSync('temp');

  const searchRes = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(searchQuery)}&per_page=4`,
    { headers: { Authorization: PEXELS_KEY } }
  );
  const searchData = await searchRes.json();

  if (!searchData.videos || searchData.videos.length === 0) {
    throw new Error('No clips found for this query.');
  }

  console.log(`Found ${searchData.videos.length} clips. Downloading...`);

  const trimmedFiles = [];
  for (let i = 0; i < searchData.videos.length; i++) {
    const videoFiles = searchData.videos[i].video_files;
    const sdFile = videoFiles.find(f => f.quality === 'sd') || videoFiles[0];
    const fileRes = await fetch(sdFile.link);
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    const rawPath = path.join('temp', `raw${i}.mp4`);
    fs.writeFileSync(rawPath, buffer);
    console.log(`Downloaded raw${i}.mp4`);

    const trimmedPath = path.join('temp', `clip${i}.mp4`);
    // Normalize: same resolution (1280x720), same fps (30), same pixel format
    execSync(
      `ffmpeg -y -i ${rawPath} -t ${CLIP_DURATION} ` +
      `-vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30" ` +
      `-an -c:v libx264 -preset fast -pix_fmt yuv420p ${trimmedPath}`,
      { stdio: 'inherit' }
    );
    trimmedFiles.push(trimmedPath);
    console.log(`Normalized + trimmed clip${i}.mp4`);
  }

  const listContent = trimmedFiles.map(f => `file '${path.resolve(f)}'`).join('\n');
  fs.writeFileSync('temp/list.txt', listContent);

  const outputPath = path.join('output', `${jobId}.mp4`);
  console.log('Merging normalized clips...');
  execSync(`ffmpeg -y -f concat -safe 0 -i temp/list.txt -c copy ${outputPath}`, { stdio: 'inherit' });

  console.log(`Render complete: ${outputPath}`);
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
