const video = 'video.mp4';
const FPS = 24;
const frameInterval = 1000 / FPS;
const BATCH_SIZE = 350;
const PARALLEL_CONVERSIONS = 8;

const asciify = require('asciify-image');
const ffmpeg = require('fluent-ffmpeg');
const rimraf = require("rimraf");
const fs = require('fs');
const path = require('path');
const { getVideoDurationInSeconds } = require('get-video-duration');

ffmpeg.setFfmpegPath(require('@ffmpeg-installer/ffmpeg').path);

['./render', './output'].forEach(dir => {
  if (fs.existsSync(dir)) rimraf.sync(dir);
  fs.mkdirSync(dir);
});

console.log(`Starting video to ASCII conversion for ${video}`);
console.log(`Using up to ${PARALLEL_CONVERSIONS} parallel ASCII conversions (${require('os').cpus().length} CPU cores available)`);

getVideoDurationInSeconds(video).then(async (duration) => {
  console.log(`Video duration: ${duration.toFixed(2)} seconds`);
  
  const totalFrames = Math.floor(duration * FPS);
  const frameList = [];
  
  const timemarks = Array.from({ length: totalFrames }, (_, i) => 
    (i / FPS).toFixed(3)
  );
  
  console.log(`Total frames to process: ${totalFrames}`);
  
  const batches = [];
  for (let i = 0; i < timemarks.length; i += BATCH_SIZE) {
    batches.push(timemarks.slice(i, i + BATCH_SIZE));
  }
  
  console.log(`Processing in ${batches.length} batches of up to ${BATCH_SIZE} frames each`);
  
  const renderDir = './render';
  if (!fs.existsSync(renderDir)) {
    fs.mkdirSync(renderDir, { recursive: true });
  }
  
  let batchPromises = [];
  let completedFrames = 0;
  
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const batchDir = `${renderDir}/batch${batchIndex}`;
    
    if (!fs.existsSync(batchDir)) {
      fs.mkdirSync(batchDir, { recursive: true });
    }
    
    process.stdout.write(`\rProcessing video frames: ${completedFrames}/${totalFrames} [${Math.floor(completedFrames/totalFrames*100)}%]`);
    
    await new Promise((resolve, reject) => {
      ffmpeg({ source: video })
          .takeScreenshots({ 
            filename: `frame_%d.png`, 
            timemarks: batch,
            size: `512x288`
        }, batchDir)
        .on('end', () => {
          completedFrames += batch.length;
          process.stdout.write(`\rProcessing video frames: ${completedFrames}/${totalFrames} [${Math.floor(completedFrames/totalFrames*100)}%]`);
          
          const files = fs.readdirSync(batchDir);
          files.forEach((file, i) => {
            if (i < batch.length) {
              frameList.push({
                source: path.join(batchDir, file),
                time: parseFloat(batch[i])
              });
            }
          });
          
          resolve();
        })
        .on('error', (err) => {
          console.error(`\nError in batch ${batchIndex}:`, err);
          reject(err);
        });
    }).catch(err => console.error('\nBatch processing error:', err));
  }
  
  console.log("\nAll video frames extracted. Starting ASCII conversion...");
  
  frameList.sort((a, b) => a.time - b.time);
  
  const convertFramesToAscii = async () => {
    const frames = [...frameList];
    let completedCount = 0;
    const totalCount = frames.length;
    
    for (let i = 0; i < frames.length; i += PARALLEL_CONVERSIONS) {
      const chunk = frames.slice(i, i + PARALLEL_CONVERSIONS);
      const chunkPromises = chunk.map(frame => 
        processAsciiFrame(frame.source, frame.time)
      );
      
      await Promise.all(chunkPromises);
      completedCount += chunk.length;
      process.stdout.write(`\rConverting to ASCII: ${completedCount}/${totalCount} [${Math.floor(completedCount/totalCount*100)}%]`);
    }
    
    console.log("\nASCII conversion complete!");
    return true;
  };
  
  async function processAsciiFrame(imagePath, timestamp) {
    try {
      const asciified = await asciify(imagePath, {
        fit: 'box',
        width: process.stdout.columns,
        height: process.stdout.rows,
        color: false
      });
      
      await fs.promises.writeFile(`output/${timestamp.toFixed(3)}.txt`, asciified);
      return true;
    } catch (error) {
      console.error(`\nError processing frame at ${timestamp}:`, error);
      return false;
    }
  }
  
  await convertFramesToAscii();
  
  rimraf.sync(renderDir);
  console.log("Starting playback...");
  run();
  
  function run() {
    const files = fs.readdirSync("output");
    const timestamps = files
      .map(file => parseFloat(file.replace(".txt", "")))
      .sort((a, b) => a - b);
    
    let frameIndex = 0;
    let lastFrameTime = Date.now();
    
    function displayNextFrame() {
      if (frameIndex >= timestamps.length) {
        console.log("Animation complete");
        process.exit(0);
        return;
      }
      
      const timestamp = timestamps[frameIndex];
      try {
        console.clear();
        console.log(fs.readFileSync(`output/${timestamp.toFixed(3)}.txt`, 'utf8'));
        
        const now = Date.now();
        const elapsed = now - lastFrameTime;
        const delay = Math.max(1, frameInterval - elapsed);
        
        frameIndex++;
        lastFrameTime = now;
        
        setTimeout(displayNextFrame, delay);
      } catch (error) {
        console.error(`\nError displaying frame ${frameIndex}:`, error);
        frameIndex++;
        setTimeout(displayNextFrame, frameInterval);
      }
    }
    
    displayNextFrame();
  }
});
