module.exports = function render(video, callback, logger = console.log) {
    const FPS = 30;
    const res = "512x288";
    const BATCH_SIZE = 350;

    const cores = require('os').cpus().length
    const asciify = require('asciify-image');
    const ffmpeg = require('fluent-ffmpeg');
    const rimraf = require("rimraf");
    const fs = require('fs');
    const path = require('path');
    const { getVideoDurationInSeconds } = require('get-video-duration');

    ffmpeg.setFfmpegPath(require('@ffmpeg-installer/ffmpeg').path);

    if (fs.existsSync('./render')) rimraf.sync('./render');

    logger(`Starting video to ASCII conversion for ${video}`);
    logger(`Using up to ${cores*2} parallel ASCII conversions (${cores} CPU cores available)`);

    if (!video || !fs.existsSync(video)) {
        const error = new Error(`Invalid video file path: ${video}`);
        logger(`Invalid video file path: ${video}`);
        return callback && callback(error);
    }

    logger("Extracting audio from video...");
    ffmpeg(video)
        .output('audio.mp3')
        .noVideo()
        .audioCodec('libmp3lame')
        .on('end', () => {
            logger("Audio extraction complete");
            processVideo();
        })
        .on('error', (err) => {
            logger(`Error extracting audio: ${err.message}`);
            processVideo();
        })
        .run();

    async function processVideo() {
        try {
            const duration = await getVideoDurationInSeconds(video);
            logger(`Video duration: ${duration.toFixed(2)} seconds`);

            const totalFrames = Math.floor(duration * FPS);
            const frameList = [];

            const timemarks = Array.from({ length: totalFrames }, (_, i) =>
                (i / FPS).toFixed(3)
            );

            logger(`Total frames to process: ${totalFrames}`);

            const batches = [];
            for (let i = 0; i < timemarks.length; i += BATCH_SIZE) {
                batches.push(timemarks.slice(i, i + BATCH_SIZE));
            }

            logger(`Processing in ${batches.length} batches of up to ${BATCH_SIZE} frames each`);

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

                await new Promise((resolve, reject) => {
                    ffmpeg({ source: video })
                        .takeScreenshots({
                            filename: `frame_%d.png`,
                            timemarks: batch,
                            size: res
                        }, batchDir)
                        .on('end', () => {
                            completedFrames += batch.length;
                            logger(`Processing video frames: ${completedFrames}/${totalFrames} [${Math.floor(completedFrames / totalFrames * 100)}%]`);

                            for (var i = 0; i < fs.readdirSync(batchDir).length; i++) {
                                frameList.push({
                                    source: path.join(batchDir, "frame_1_" + (i + 1) + ".png"),
                                    time: parseFloat(batch[i])
                                });
                            }

                            resolve();
                        })
                        .on('error', (err) => {
                            logger(`Error in batch ${batchIndex}: ${err.message}`);
                            reject(err);
                        });
                }).catch(err => {
                    logger(`Batch processing error: ${err.message}`);
                });
            }
            logger("All video frames extracted. Starting ASCII conversion...");

            frameList.sort((a, b) => a.time - b.time);

            const asciiFrames = [];

            const convertFramesToAscii = async () => {
                const frames = [...frameList];
                let completedCount = 0;
                const totalCount = frames.length;

                for (let i = 0; i < frames.length; i += cores*2) {
                    const chunk = frames.slice(i, i + cores*2);
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
                    logger(`Converting to ASCII: ${completedCount}/${totalCount} [${Math.floor(completedCount / totalCount * 100)}%]`);
                }

                logger("ASCII conversion complete!");
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
                    logger(`Error processing frame at ${timestamp}: ${error.message}`);
                    return null;
                }
            }

            await convertFramesToAscii();

            logger("Creating combined ASCII frame file...");
            await createCombinedFile(asciiFrames);

            rimraf.sync(renderDir);
            logger("Rendering complete!");

            logger("\n===========================");
            logger("Rendering is now complete!");
            logger("To start playback, run one of the following commands:");
            logger("   node index.js");
            logger("===========================\n");
            
            if (callback) callback(null, `Processed ${video} into ASCII`);

        } catch (err) {
            logger(`Error processing video: ${err.message}`);
            if (callback) callback(err);
        }
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
        logger(`Created combined ASCII file with ${asciiFrames.length} frames`);
    }
}