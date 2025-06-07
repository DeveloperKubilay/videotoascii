const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const FPS = 30;
const frameInterval = 1000 / FPS;
let playbackStartTime = 0;

__dirname= process.pkg ? path.dirname(process.execPath) : __dirname;


async function playCombinedFile(hasAudio) {
  const combinedFilePath = path.join(__dirname, 'ascii_video.txt');
  if (!fs.existsSync(combinedFilePath)) {
    console.error('Error: Combined ASCII file not found. Run render.js first.');
    process.exit(1);
  }

  console.log('Loading combined ASCII file for playback...');
  
  const content = fs.readFileSync(combinedFilePath, 'utf8');
  const frameMarkerRegex = /===FRAME (\d+\.\d+)===/g;
  const frames = [];
  
  let match;
  let lastIndex = 0;
  
  while ((match = frameMarkerRegex.exec(content)) !== null) {
    const timestamp = parseFloat(match[1]);
    const startIndex = match.index + match[0].length + 2;
    
    if (lastIndex > 0) {
      frames.push({
        time: frames[frames.length-1].time,
        content: content.substring(lastIndex, match.index).trim()
      });
    }
    
    frames.push({
      time: timestamp,
      content: ''
    });
    
    lastIndex = startIndex;
  }
  
  if (lastIndex < content.length) {
    frames.push({
      time: frames[frames.length-1].time,
      content: content.substring(lastIndex).trim()
    });
  }
  
  console.log(`Loaded ${frames.length/2} frames from combined file. Starting playback at ${FPS} FPS...`);
  
  if (hasAudio) {
    console.log('Starting audio player...');
    await playAndWaitForAudio(path.resolve(path.join(__dirname, 'audio.mp3')));
  }
  
  playbackStartTime = Date.now();
  let frameIndex = 1;
  console.log('Press Ctrl+C to exit playback.');
  
  function displayNextFrame() {
    if (frameIndex >= frames.length) {
      console.log("\nPlayback complete!");
      process.exit(0);
      return;
    }
    
    try {
      console.clear();
      console.log(frames[frameIndex].content);
      
      frameIndex += 2;
      
      if (frameIndex < frames.length) {
        const currentPlayTime = (Date.now() - playbackStartTime) / 1000;
        const nextFrameTime = frames[frameIndex].time;
        const timeUntilNextFrame = Math.max(1, (nextFrameTime - currentPlayTime) * 1000);
        
        setTimeout(displayNextFrame, timeUntilNextFrame);
      } else {
        setTimeout(displayNextFrame, frameInterval);
      }
    } catch (error) {
      console.error(`\nError displaying frame ${frameIndex}:`, error);
      frameIndex += 2;
      setTimeout(displayNextFrame, frameInterval);
    }
  }
  
  displayNextFrame();
}

async function playAndWaitForAudio(audioPath) {
  return new Promise((resolve) => {
    const absolutePath = path.resolve(audioPath);
    
    console.log(`Attempting to play audio: ${absolutePath}`);
    
    exec(`start /min "" "${absolutePath}"`, (error) => {
      if (error) {
        console.error('Failed to start audio playback:', error);
        
        const psCommand = `
          $player = New-Object System.Media.SoundPlayer;
          $player.SoundLocation = "${absolutePath.replace(/\\/g, "\\\\")};
          $player.PlaySync();
        `;
        
        console.log('Attempting alternative audio playback method...');
        exec(`powershell -Command "${psCommand}"`, (err) => {
          if (err) console.error('Alternative audio playback also failed:', err);
          setTimeout(resolve, 2000);
        });
        return;
      }
      
      console.log('Audio player launched. Waiting for playback to begin...');
      setTimeout(() => {
        console.log('Starting ASCII display...');
        resolve();
      }, 3000);
    });
  });
}

playCombinedFile(fs.existsSync(path.join(__dirname, 'audio.mp3'))).catch(err => {
  console.error('Playback error:', err);
  process.exit(1);
});