const video = 'video.mp4';
const FPS = 30;
const res = "512x288";
const BATCH_SIZE = 350;
const PARALLEL_CONVERSIONS = 12;

const asciify = require('asciify-image');
const ffmpeg = require('fluent-ffmpeg');
const rimraf = require("rimraf");
const fs = require('fs');
const path = require('path');
const { getVideoDurationInSeconds } = require('get-video-duration');

ffmpeg.setFfmpegPath(require('@ffmpeg-installer/ffmpeg').path);

if (fs.existsSync('./render')) rimraf.sync('./render');

console.log(`Starting video to ASCII conversion for ${video}`);
console.log(`Using up to ${PARALLEL_CONVERSIONS} parallel ASCII conversions (${require('os').cpus().length} CPU cores available)`);

console.log("Extracting audio from video...");
ffmpeg(video)
  .output('audio.mp3')
  .noVideo()
  .audioCodec('libmp3lame')
  .on('end', () => {
    console.log("Audio extraction complete");
    processVideo();
  })
  .on('error', (err) => {
    console.error('Error extracting audio:', err);
    processVideo();
  })
  .run();

async function processVideo() {
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
              size: res
          }, batchDir)
          .on('end', () => {
            completedFrames += batch.length;
            process.stdout.write(`\rProcessing video frames: ${completedFrames}/${totalFrames} [${Math.floor(completedFrames/totalFrames*100)}%]`);
            
            for(var i = 0; i < fs.readdirSync(batchDir).length; i++) {
                frameList.push({
                  source: path.join(batchDir,"frame_1_" + (i + 1) + ".png"),
                  time: parseFloat(batch[i])
                });
            }
            
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
    
    const asciiFrames = [];
    
    const convertFramesToAscii = async () => {
      const frames = [...frameList];
      let completedCount = 0;
      const totalCount = frames.length;
      
      for (let i = 0; i < frames.length; i += PARALLEL_CONVERSIONS) {
        const chunk = frames.slice(i, i + PARALLEL_CONVERSIONS);
        const chunkPromises = chunk.map(frame => 
          processAsciiFrame(frame.source, frame.time)
        );
        
        const results = await Promise.all(chunkPromises);
        results.forEach((result, index) => {
          if (result) {
            asciiFrames.push({
              time: chunk[index].time,
              content: result
            });
          }
        });
        
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
        
        return asciified;
      } catch (error) {
        console.error(`\nError processing frame at ${timestamp}:`, error);
        return null;
      }
    }
    
    await convertFramesToAscii();
    
    console.log("Creating combined ASCII frame file...");
    await createCombinedFile(asciiFrames);
    
    rimraf.sync(renderDir);
    console.log("Rendering complete!");
    
    console.log("\n===========================");
    console.log("Rendering is now complete!");
    console.log("To start playback, run one of the following commands:");
    console.log("   node index.js");
    console.log("===========================\n");
  });
}

async function createCombinedFile(asciiFrames) {
  asciiFrames.sort((a, b) => a.time - b.time);
  
  let combinedContent = `ASCII VIDEO - ${asciiFrames.length} FRAMES - FPS: ${FPS}\n`;
  combinedContent += `USAGE: node index.js [--combined/-c] [--sync/-s milliseconds]\n\n`;
  
  for (const frame of asciiFrames) {
    combinedContent += `\n===FRAME ${frame.time.toFixed(3)}===\n\n`;
    combinedContent += frame.content + '\n';
  }
  
  await fs.promises.writeFile('ascii_video.txt', combinedContent);
  console.log(`Created combined ASCII file with ${asciiFrames.length} frames`);
}
