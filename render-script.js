const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const jobId = process.argv[2];
const promptData = JSON.parse(process.argv[3]);
const searchQuery = promptData.query || 'nature';

const PEXELS_KEY = process.env.PEXELS_API_KEY;

async function main() {
  console.log(`Job: ${jobId}, Query: ${searchQuery}`);

  if (!fs.existsSync('output')) fs.mkdirSync('output');
  if (!fs.existsSync('temp')) fs.mkdirSync('temp');

  console.log('Searching Pexels for clips...');
  const searchRes = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(searchQuery)}&per_page=3`,
    { headers: { Authorization: PEXELS_KEY } }
  );
  const searchData = await searchRes.json();

  if (!searchData.videos || searchData.videos.length === 0) {
    throw new Error('No clips found for this query.');
  }

  console.log(`Found ${searchData.videos.length} clips. Downloading...`);

  const downloadedFiles = [];
  for (let i = 0; i < searchData.videos.length; i++) {
    const videoFiles = searchData.videos[i].video_files;
    const sdFile = videoFiles.find(f => f.quality === 'sd') || videoFiles[0];
    const fileRes = await fetch(sdFile.link);
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    const filePath = path.join('temp', `clip${i}.mp4`);
    fs.writeFileSync(filePath, buffer);
    downloadedFiles.push(filePath);
    console.log(`Downloaded clip${i}.mp4`);
  }

  const listContent = downloadedFiles.map(f => `file '${path.resolve(f)}'`).join('\n');
  fs.writeFileSync('temp/list.txt', listContent);

  const outputPath = path.join('output', `${jobId}.mp4`);
  console.log('Merging clips with ffmpeg...');
  execSync(`ffmpeg -f concat -safe 0 -i temp/list.txt -c copy ${outputPath}`, { stdio: 'inherit' });

  console.log(`Render complete: ${outputPath}`);
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
