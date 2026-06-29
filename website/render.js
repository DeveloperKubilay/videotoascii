module.exports = async function render(video, callback, logger = console.log) {
    const IS_CLOUD = process.platform !== 'win32';
    const FPS = IS_CLOUD ? 15 : 30;
    const RESOLUTION = IS_CLOUD ? "426x240" : "640x360";
    const BATCH_SIZE = IS_CLOUD ? 60 : 200;
    const ASCII_BATCH_SIZE = IS_CLOUD ? 12 : 60;
    const MAX_DURATION = IS_CLOUD ? 90 : 300;
    const PROCESS_TIMEOUT = 540000;

    const memoryUsage = process.memoryUsage();
    logger(`Memory usage: ${Math.round(memoryUsage.rss / 1024 / 1024)}MB (RSS)`);

    const asciify = require('asciify-image');
    const ffmpeg = require('fluent-ffmpeg');
    const rimraf = require("rimraf");
    const fs = require('fs');
    const path = require('path');
    const { getVideoDurationInSeconds } = require('get-video-duration');

    if (process.platform !== 'win32') {
        const ffmpegPath = path.join(__dirname, 'ffmpeg');
        ensureBinaryExecutable(ffmpegPath);
        ffmpeg.setFfmpegPath(ffmpegPath);
        ffmpeg.setFfprobePath(ffmpegPath);
    }

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

        await logFfmpegDiagnostics(video);

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

    async function logFfmpegDiagnostics(videoPath) {
        const configuredPath = typeof ffmpeg._getFfmpegPath === 'function'
            ? ffmpeg._getFfmpegPath()
            : path.join(__dirname, 'ffmpeg');
        logger(`[ffmpeg] configured path: ${configuredPath}`);
        logger(`[ffmpeg] binary exists: ${fs.existsSync(configuredPath)}`);
        if (fs.existsSync(configuredPath)) {
            const stats = fs.statSync(configuredPath);
            logger(`[ffmpeg] binary mode: ${(stats.mode & 0o777).toString(8)}`);
        }

        const ffmpegVersion = await new Promise((resolve) => {
            ffmpeg.getAvailableFormats((error, formats) => {
                if (error) {
                    logger(`[ffmpeg] getAvailableFormats error: ${error.message}`);
                    return resolve(null);
                }

                const formatCount = formats ? Object.keys(formats).length : 0;
                logger(`[ffmpeg] available formats: ${formatCount}`);
                resolve(formatCount);
            });
        });

        await new Promise((resolve) => {
            ffmpeg.ffprobe(videoPath, (error, metadata) => {
                if (error) {
                    logger(`[ffmpeg] ffprobe error: ${error.message}`);
                    return resolve();
                }

                const duration = metadata?.format?.duration;
                const size = metadata?.format?.size;
                const streamSummary = (metadata?.streams || [])
                    .map((stream, index) => `${index}:${stream.codec_type || 'unknown'}:${stream.codec_name || 'n/a'}`)
                    .join(', ');

                logger(`[ffmpeg] probe duration=${duration || 'unknown'} size=${size || 'unknown'}`);
                logger(`[ffmpeg] probe streams=${streamSummary || 'none'}`);
                resolve(ffmpegVersion);
            });
        });
    }

    function ensureBinaryExecutable(binaryPath) {
        if (process.platform === 'win32' || !binaryPath || !fs.existsSync(binaryPath)) {
            return;
        }

        try {
            fs.chmodSync(binaryPath, 0o755);
        } catch (error) {
            logger(`[ffmpeg] chmod failed: ${error.message}`);
        }
    }

    async function extractAudio(videoPath) {
        const audioOutputPath = path.join(__dirname, 'audio.mp3');

        logger("Extracting audio from video...");

        return new Promise((resolve, reject) => {
            ffmpeg(videoPath)
                .addOption('-hide_banner')
                .addOption('-loglevel', 'warning')
                .outputOptions(['-threads', "4"])
                .output(audioOutputPath)
                .noVideo()
                .audioCodec('libmp3lame')
                .audioBitrate('128k')
                .on('start', (commandLine) => {
                    logger(`FFmpeg command: ${commandLine}`);
                })
                .on('stderr', (line) => {
                    if (shouldLogFfmpegStderr(line)) {
                        logger(`FFmpeg stderr: ${line}`);
                    }
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

        await processBatchesSequentially(videoPath, batches, totalFrames);

        rimraf.sync(renderDir);
        logger("Rendering complete!");

        logger("\n===========================");
        logger("Rendering is now complete!");
        logger("To start playback, run one of the following commands:");
        logger("   node index.js");
        logger("===========================\n");
    }

    async function processBatchesSequentially(videoPath, batches, totalFrames) {
        const outputFilePath = 'ascii_video.txt';
        fs.writeFileSync(outputFilePath, `ASCII VIDEO - ${totalFrames} FRAMES - FPS: ${FPS}\nUSAGE: node index.js [--combined/-c] [--sync/-s milliseconds]\n\n`);

        let completedFrames = 0;
        let processedFrameCount = 0;
        const totalBatchFrames = batches.reduce((sum, batch) => sum + batch.length, 0);

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const memUsage = process.memoryUsage();
            const memUsageMB = Math.round(memUsage.rss / 1024 / 1024);
            logger(`Memory usage before batch ${batchIndex}: ${memUsageMB}MB`);

            if (batchIndex % 3 === 0) {
                logger("Taking a break between batches to prevent timeouts");
            }

            if (memUsageMB > 420) {
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
                logger(`Processing video frames: ${completedFrames}/${totalBatchFrames} [${Math.floor(completedFrames / totalBatchFrames * 100)}%]`);

                const files = fs.readdirSync(batchDir);
                const frameFiles = files.filter(file => file.startsWith('frame_1_'));

                frameFiles.sort((a, b) => {
                    const numA = parseInt(a.replace('frame_1_', '').replace('.png', ''));
                    const numB = parseInt(b.replace('frame_1_', '').replace('.png', ''));
                    return numA - numB;
                });

                processedFrameCount += await appendBatchAsciiFrames(
                    frameFiles.map((file) => path.join(batchDir, file)),
                    batch,
                    outputFilePath
                );
                rimraf.sync(batchDir);
                logger(`Batch ${batchIndex} ASCII append complete. Total written frames: ${processedFrameCount}`);

            } catch (err) {
                logger(`Batch processing error: ${err.message}`);
            }

            if (batchIndex % 5 === 0) {
                logger("Taking a break between batches to prevent timeouts");
            }
        }

        logger("ASCII conversion complete!");
        logger(`Created ASCII file with ${processedFrameCount} frames`);
    }

    async function processFrameBatch(videoPath, batch, batchDir) {
        return new Promise((resolve, reject) => {
            const command = ffmpeg({ source: videoPath })
                .addOption('-hide_banner')
                .addOption('-loglevel', 'warning')
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
                .on('stderr', (line) => {
                    if (shouldLogFfmpegStderr(line)) {
                        logger(`FFmpeg screenshot stderr: ${line}`);
                    }
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

    async function appendBatchAsciiFrames(framePaths, batch, outputFilePath) {
        let processedFrameCount = 0;
        let completedCount = 0;
        const totalCount = Math.min(framePaths.length, batch.length);

        for (let i = 0; i < totalCount; i += ASCII_BATCH_SIZE) {
            const memUsage = process.memoryUsage();
            const memUsageMB = Math.round(memUsage.rss / 1024 / 1024);
            logger(`Memory usage during ASCII conversion: ${memUsageMB}MB`);

            if (memUsageMB > 420) {
                logger("Memory usage high during ASCII conversion, triggering garbage collection");
                global.gc && global.gc();
            }

            const chunkPaths = framePaths.slice(i, Math.min(i + ASCII_BATCH_SIZE, totalCount));
            const chunkTimes = batch.slice(i, Math.min(i + ASCII_BATCH_SIZE, totalCount));

            const results = await Promise.all(
                chunkPaths.map((imagePath, index) =>
                    processAsciiFrame(imagePath, parseFloat(chunkTimes[index]))
                )
            );

            let batchContent = '';
            results.forEach((result, index) => {
                if (result) {
                    const frameTime = parseFloat(chunkTimes[index]);
                    batchContent += `\n===FRAME ${frameTime.toFixed(3)}===\n\n`;
                    batchContent += result + '\n';
                    processedFrameCount++;
                }
            });

            fs.appendFileSync(outputFilePath, batchContent, 'utf8');

            completedCount += chunkPaths.length;
            logger(`Converting to ASCII: ${completedCount}/${totalCount} [${Math.floor(completedCount / totalCount * 100)}%]`);
        }

        return processedFrameCount;
    }

    async function processAsciiFrame(imagePath, timestamp) {
        try {
            const asciified = await asciify(imagePath, {
                fit: 'box',
                width: IS_CLOUD ? 72 : 100,
                height: IS_CLOUD ? 18 : 25,
                color: false,
                format: 'terminal' 
            });

            return asciified;
        } catch (error) {
            logger(`Error processing frame at ${timestamp}: ${error.message}`);
            return null;
        }
    }

    function shouldLogFfmpegStderr(line) {
        if (!line) {
            return false;
        }

        const normalized = line.toLowerCase();
        return (
            normalized.includes('error') ||
            normalized.includes('failed') ||
            normalized.includes('invalid') ||
            normalized.includes('unable') ||
            normalized.includes('warning')
        );
    }
}
