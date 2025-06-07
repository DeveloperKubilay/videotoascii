const fs = require('fs');
const path = require('path');

// Configuration
const FPS = 30; // Frames per second (should match render.js)
const frameInterval = 1000 / FPS; // ~33.33ms per frame

// Main function to run the playback
async function run() {
  // Check if output directory exists
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    console.error('Error: Output directory does not exist. Run render.js first.');
    process.exit(1);
  }

  // Read files from output directory
  const files = fs.readdirSync(outputDir);
  if (files.length === 0) {
    console.error('Error: No ASCII frames found in output directory. Run render.js first.');
    process.exit(1);
  }

  console.log(`Found ${files.length} ASCII frames. Starting playback at ${FPS} FPS...`);
  
  // Parse timestamps from filenames and sort
  const timestamps = files
    .map(file => ({
      time: parseFloat(file.replace('.txt', '')),
      file: path.join(outputDir, file)
    }))
    .sort((a, b) => a.time - b.time);
  
  // Initialize playback
  let frameIndex = 0;
  let lastFrameTime = Date.now();
  console.log('Press Ctrl+C to exit playback.');
  
  // Display function with accurate timing
  function displayNextFrame() {
    if (frameIndex >= timestamps.length) {
      console.log("\nPlayback complete!");
      process.exit(0);
      return;
    }
    
    try {
      // Read and display current frame
      const frame = timestamps[frameIndex];
      const frameContent = fs.readFileSync(frame.file, 'utf8');
      console.clear();
      console.log(frameContent);
      
      // Calculate appropriate delay for next frame
      const now = Date.now();
      const elapsed = now - lastFrameTime;
      const delay = Math.max(1, frameInterval - elapsed);
      
      frameIndex++;
      lastFrameTime = now;
      
      // Schedule next frame with adjusted timing
      setTimeout(displayNextFrame, delay);
    } catch (error) {
      console.error(`\nError displaying frame ${frameIndex}:`, error);
      frameIndex++;
      setTimeout(displayNextFrame, frameInterval);
    }
  }
  
  // Start playback
  displayNextFrame();
}

// Run the playback
run().catch(err => {
  console.error('Playback error:', err);
  process.exit(1);
});