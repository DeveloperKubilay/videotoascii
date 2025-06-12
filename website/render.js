module.exports = async function render(video, callback, logger = console.log) {
    const FPS = 30;
    const RESOLUTION = "640x360";
    const BATCH_SIZE = process.platform == "win32" ? 200 : 400;
    const ASCII_BATCH_SIZE = 300;
    const MAX_DURATION = 300;
    const PROCESS_TIMEOUT = 540000;

    const memoryUsage = process.memoryUsage();
    logger(`Memory usage: ${Math.round(memoryUsage.rss / 1024 / 1024)}MB (RSS)`);

    const asciify = require('asciify-image');
    const ffmpeg = require('fluent-ffmpeg');
    const rimraf = require("rimraf");
    const fs = require('fs');
    const path = require('path');
    const { getVideoDurationInSeconds } = require('get-video-duration');

    if (process.platform !== 'win32') ffmpeg.setFfmpegPath(path.join(__dirname, 'ffmpeg'));

    const renderDir = './render';
    if (fs.existsSync(renderDir)) rimraf.sync(renderDir);

    const processTimeout = setTimeout(() => {
        logger("Processing timeout reached. The operation might be taking too long.");
        if (callback) callback(new Error("Processing timeout"));
    }, PROCESS_TIMEOUT);

    try {
        logger(`Starting video to ASCII conversion for ${video}`);

        if (!video || !fs.existsSync(video)) {
            throw new Error(`Invalid video file path: ${video}`);
        }

        try {
            await extractAudio(video);
        } catch (audioErr) {
            logger(`Audio extraction had issues: ${audioErr.message}`);
        }

        await processVideo(video);

        clearTimeout(processTimeout);
        if (callback) callback(null, `Processed ${video} into ASCII`);
    } catch (err) {
        logger(`Error processing video: ${err.message}`);
        clearTimeout(processTimeout);
        if (callback) callback(err);
    }

    async function extractAudio(videoPath) {
        const audioOutputPath = path.join(__dirname, 'audio.mp3');

        logger("Extracting audio from video...");

        return new Promise((resolve, reject) => {
            ffmpeg(videoPath)
                .outputOptions(['-threads', "4"])
                .output(audioOutputPath)
                .noVideo()
                .audioCodec('libmp3lame')
                .audioBitrate('128k')
                .on('start', (commandLine) => {
                    logger(`FFmpeg command: ${commandLine}`);
                })
                .on('end', () => {
                    logger("Audio extraction complete");
                    resolve(audioOutputPath);
                })
                .on('error', (err) => {
                    logger(`Error extracting audio: ${err.message}`);
                    reject(err);
                })
                .run();
        });
    }

    async function processVideo(videoPath) {
        if (!fs.existsSync(renderDir)) {
            fs.mkdirSync(renderDir, { recursive: true });
        }

        const duration = await getVideoDurationInSeconds(videoPath);
        logger(`Video duration: ${duration.toFixed(2)} seconds`);

        const effectiveDuration = Math.min(duration, MAX_DURATION);
        if (duration > MAX_DURATION) {
            logger(`Cloud environment: limiting video to first ${MAX_DURATION} seconds of ${duration.toFixed(2)} seconds`);
        }

        const totalFrames = Math.floor(effectiveDuration * FPS);
        const timemarks = Array.from(
            { length: totalFrames },
            (_, i) => (i / FPS).toFixed(3)
        );

        logger(`Total frames to process: ${totalFrames}`);

        const batches = [];
        for (let i = 0; i < timemarks.length; i += BATCH_SIZE) {
            batches.push(timemarks.slice(i, i + BATCH_SIZE));
        }

        logger(`Processing in ${batches.length} batches of up to ${BATCH_SIZE} frames each`);

        const frameList = await processBatchesSequentially(videoPath, batches);
        logger("All video frames extracted. Starting ASCII conversion...");

        frameList.sort((a, b) => {
            if (Math.abs(a.time - b.time) < 0.001) {
                return a.index - b.index;
            }
            return a.time - b.time;
        });

        await convertFramesToAscii(frameList, totalFrames);

        rimraf.sync(renderDir);
        logger("Rendering complete!");

        logger("\n===========================");
        logger("Rendering is now complete!");
        logger("To start playback, run one of the following commands:");
        logger("   node index.js");
        logger("===========================\n");
    }

    async function processBatchesSequentially(videoPath, batches) {
        const frameList = [];
        let completedFrames = 0;

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const memUsage = process.memoryUsage();
            const memUsageMB = Math.round(memUsage.rss / 1024 / 1024);
            logger(`Memory usage before batch ${batchIndex}: ${memUsageMB}MB`);

            if (batchIndex % 3 === 0) {
                logger("Taking a break between batches to prevent timeouts");
            }

            if (memUsageMB > 700) {
                logger("Memory usage high, taking a short break to allow garbage collection");
                global.gc && global.gc();
            }

            const batch = batches[batchIndex];
            const batchDir = `${renderDir}/batch${batchIndex}`;

            if (!fs.existsSync(batchDir)) {
                fs.mkdirSync(batchDir, { recursive: true });
            }

            try {
                await processFrameBatch(videoPath, batch, batchDir);

                completedFrames += batch.length;
                logger(`Processing video frames: ${completedFrames}/${batches.flat().length} [${Math.floor(completedFrames / batches.flat().length * 100)}%]`);

                const files = fs.readdirSync(batchDir);
                const frameFiles = files.filter(file => file.startsWith('frame_1_'));

                frameFiles.sort((a, b) => {
                    const numA = parseInt(a.replace('frame_1_', '').replace('.png', ''));
                    const numB = parseInt(b.replace('frame_1_', '').replace('.png', ''));
                    return numA - numB;
                });

                for (let i = 0; i < frameFiles.length && i < batch.length; i++) {
                    frameList.push({
                        source: path.join(batchDir, frameFiles[i]),
                        time: parseFloat(batch[i]),
                        index: completedFrames - batch.length + i
                    });
                }

            } catch (err) {
                logger(`Batch processing error: ${err.message}`);
            }

            if (batchIndex % 5 === 0) {
                logger("Taking a break between batches to prevent timeouts");
            }
        }

        return frameList;
    }

    async function processFrameBatch(videoPath, batch, batchDir) {
        return new Promise((resolve, reject) => {
            const command = ffmpeg({ source: videoPath })
                .outputOptions(['-threads', '4']);

            command
                .takeScreenshots({
                    filename: `frame_%d.png`,
                    timemarks: batch,
                    size: RESOLUTION
                }, batchDir)
                .on('start', (commandLine) => {
                    logger(`FFmpeg screenshot command: ${commandLine}`);
                })
                .on('end', () => {
                    resolve();
                })
                .on('error', (err) => {
                    logger(`Error in batch: ${err.message}`);
                    reject(err);
                });
        });
    }

    async function convertFramesToAscii(frameList, totalFrames) {
        const outputFilePath = 'ascii_video.txt';
        fs.writeFileSync(outputFilePath, `ASCII VIDEO - ${totalFrames} FRAMES - FPS: ${FPS}\nUSAGE: node index.js [--combined/-c] [--sync/-s milliseconds]\n\n`);

        let processedFrameCount = 0;
        const frames = [...frameList];
        let completedCount = 0;
        const totalCount = frames.length;

        const termWidth = 70;
        const termHeight = 20;

        for (let i = 0; i < frames.length; i += ASCII_BATCH_SIZE) {
            const memUsage = process.memoryUsage();
            const memUsageMB = Math.round(memUsage.rss / 1024 / 1024);
            logger(`Memory usage during ASCII conversion: ${memUsageMB}MB`);

            if (memUsageMB > 700) {
                logger("Memory usage high during ASCII conversion, triggering garbage collection");
                global.gc && global.gc();
            }

            const chunk = frames.slice(i, Math.min(i + ASCII_BATCH_SIZE, frames.length));
            const chunkPromises = chunk.map(frame =>
                processAsciiFrame(frame.source, frame.time, termWidth, termHeight)
            );

            const results = await Promise.all(chunkPromises);

            let batchContent = '';
            results.forEach((result, index) => {
                if (result) {
                    const frameTime = chunk[index].time;
                    batchContent += `\n===FRAME ${frameTime.toFixed(3)}===\n\n`;
                    batchContent += result + '\n';
                    processedFrameCount++;
                }
            });

            fs.appendFileSync(outputFilePath, batchContent, 'utf8');

            completedCount += chunk.length;
            logger(`Converting to ASCII: ${completedCount}/${totalCount} [${Math.floor(completedCount / totalCount * 100)}%]`);
        }

        logger("ASCII conversion complete!");
        logger(`Created ASCII file with ${processedFrameCount} frames`);
    }

    async function processAsciiFrame(imagePath, timestamp, width, height) {
        try {
            const asciified = await asciify(imagePath, {
                fit: 'box',
                width: 100,
                height: 25,
                color: true,
                format: 'terminal' 
            });

            return asciified;
        } catch (error) {
            logger(`Error processing frame at ${timestamp}: ${error.message}`);
            return null;
        }
    }
}
