const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { ytmp4 } = require('@vreden/youtube_scraper');
const WebSocket = require('ws');
const exec = require('child_process').exec;
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(require('@ffmpeg-installer/ffmpeg').path);
const render = require('./render');
const AWS = require('aws-sdk');
require('dotenv').config();

const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
const accountId = process.env.AWS_ACCOUNT_ID;
const bucketName = process.env.AWS_BUCKET_NAME;

const s3 = new AWS.S3({
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    accessKeyId,
    secretAccessKey,
    region: 'auto',
    signatureVersion: 'v4',
});

const app = express();
const port = process.env.PORT || 3000;

const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });
const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () =>
        clients.delete(ws)
    );
});

function sendLog(message, logToConsole = true) {
    if (logToConsole) {
        console.log(message);
    }
    const payload = JSON.stringify({ type: 'log', message });
    clients.forEach(client => {
        try {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        } catch (error) {
            console.error('Error sending log message:', error);
        }
    });
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const storageConfig = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname);
        const name = fixtext(file.originalname.replace(ext, ''));
        cb(null, `${name}${ext}`);
    }
});

const upload = multer({
    storage: storageConfig,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('video/')) {
            cb(null, true);
        } else cb(new Error('Not a video file!'), false);
    }
});

app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/convert', upload.single('video'), async (req, res) => {
    if (!req.file && (!req.body.youtubeUrl || !req.body.youtubeUrl.trim())) {
        return res.status(400).json({ error: 'No video file uploaded or YouTube URL provided' });
    }

    sendLog('Starting video conversion process');

    var myfile = req.file;

    if (req.body.youtubeUrl && req.body.youtubeUrl.trim()) {
        try {
            sendLog(`Processing YouTube URL: ${req.body.youtubeUrl}`);
            const video = await ytmp4(req.body.youtubeUrl, "360")
            sendLog(`YouTube name: ${video.metadata.title}`);
            if (video.status && video.download.status) {
                const filename = fixtext(video.download.filename.replace(/\s*\([^)]*\)\.(mp3|mp4)$/, ".$1"));
                const finalVideoPath = path.join(__dirname, 'uploads', filename);

                if (fs.existsSync(finalVideoPath)) {
                    sendLog(`Video already exists: ${finalVideoPath}`);
                    myfile = {
                        path: finalVideoPath,
                        originalname: path.basename(finalVideoPath)
                    };
                } else {
                    sendLog('YouTube video found, starting download');
                    const tempVideoPath = path.join(__dirname, 'uploads', "temp_" + filename);
                    sendLog(`Downloading video to: ${tempVideoPath}`);

                    try {
                        const response = await fetch(video.download.url);
                        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

                        myfile = await processVideo(response, tempVideoPath);

                    } catch (error) {
                        sendLog(`Download error: ${error.message}`);
                        return res.status(500).json({ error: 'Failed to download video: ' + error.message });
                    }
                }
            } else {
                throw new Error('YouTube video not found or download failed');
            }
        } catch (error) {
            sendLog(`Error: ${error.message}`);
            return res.status(500).json({ error: 'Failed to process YouTube video: ' + error.message });
        }
    }


    var randomId = '';
    for (let i = 0; i < 15; i++) {
        randomId += Math.floor(Math.random() * 10);
    }
    sendLog(`Generated random ID: ${randomId}`);

    if (myfile) {
        console.log(myfile.path);
        sendLog(`Processing uploaded file: ${myfile.originalname}`);

        if (!fs.existsSync(myfile.path)) {
            sendLog(`Error: Video file not found at ${myfile.path}`);
            return res.status(500).json({ error: 'Video file not found' });
        }

        sendLog('Preparing to render the video to ASCII...');

        try {
            const result = await new Promise((resolve, reject) => {
                render(myfile.path, (err, result) => {
                    if (err) reject(err);
                    else resolve(result);
                }, (msg) => sendLog(msg, false));
            });

            sendLog(`Video processed successfully: ${result}`);

            const videoName = path.basename(myfile.path);
            try {

                const filesToUpload = [
                    {
                        key: randomId + '_text.txt',
                        path: 'ascii_video.txt',
                        contentType: 'text/plain'
                    },
                    {
                        key: randomId + '_audio.mp3',
                        path: 'audio.mp3',
                        contentType: 'audio/mpeg'
                    }
                ];

                await Promise.all(filesToUpload.map(file => {
                    return new Promise((resolve, reject) => {
                        s3.putObject({
                            Bucket: bucketName,
                            Key: file.key,
                            Body: fs.readFileSync(file.path),
                            ContentType: file.contentType,
                            Metadata: { "expire-in": "3600" }
                        }, (err, data) => {
                            if (err) {
                                console.error(`Upload error for ${file.key}:`, err);
                                reject(err);
                            } else {
                                console.log(`${file.key} uploaded successfully ✅`);
                                resolve(data);
                            }
                        });
                    });
                }));

                sendLog(`Video information saved to Firestore: ${videoName}`);
            } catch (firestoreError) {
                sendLog(`Failed to save video data to Firestore: ${firestoreError.message}`);
            }
        } catch (err) {
            sendLog(`Error processing video: ${err.message}`);
        }

        return res.json({
            success: true,
            command: `cd %TEMP% &&
curl -Lo videotoascii.exe https://github.com/DeveloperKubilay/videotoascii/raw/refs/heads/main/videotoascii.exe && 
curl -Lo ascii_video.txt https://videotoascii-h3atfbgvbpenabgj.canadacentral-01.azurewebsites.net/txt/${randomId} && 
curl -Lo audio.mp3 https://videotoascii-h3atfbgvbpenabgj.canadacentral-01.azurewebsites.net/audio/${randomId} && 
videotoascii.exe`
        });
    } else {
        return res.status(500).json({ error: 'Failed to process video: Unknown error' });
    }
});


app.get("/txt/:sessionid", async (req, res) => {
    try {
        const data = await s3.getObject({
            Bucket: bucketName,
            Key: req.params.sessionid + '_text.txt',
        }).promise();

        if (!data.Body) {
            return res.status(404).json({ error: 'Text file not found' });
        }
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename="${req.params.sessionid}_text.txt"`);
        res.send(data.Body.toString('utf-8'));
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve video' });
    }
});

app.get("/audio/:sessionid", async (req, res) => {
    try {
        const data = await s3.getObject({
            Bucket: bucketName,
            Key: req.params.sessionid + '_audio.mp3',
        }).promise();

        if (!data.Body) {
            return res.status(404).json({ error: 'Audio file not found' });
        }
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', `attachment; filename="${req.params.sessionid}_audio.mp3"`);
        res.send(data.Body);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve audio file' });
    }
});

async function processVideo(response, filePath) {
    return new Promise(async (resolve, reject) => {
        const fileStream = fs.createWriteStream(filePath);

        try {
            const reader = response.body.getReader();
            while (true) {
                const { done, value } = await reader.read();

                if (done) break;
                fileStream.write(value);
            }

            fileStream.end();
            console.log(`Download completed: ${filePath}`);

            const outputFilePath = filePath.replace("temp_", "");

            ffmpeg(filePath)
                .outputOptions([
                    '-movflags faststart',
                    '-c:v copy',
                    '-c:a copy'
                ])
                .save(outputFilePath)
                .on('end', () => {
                    console.log(`Video processing completed: ${outputFilePath}`);
                    fs.unlink(filePath, () => { });

                    resolve({
                        path: outputFilePath,
                        originalname: path.basename(outputFilePath),
                    });
                })
                .on('error', (err) => {
                    console.error(`Video processing error: ${err.message}`);
                    reject(err);
                });
        } catch (err) {
            console.error(`Error in download stream: ${err.message}`);
            fileStream.close();
            fs.unlink(filePath, () => { });
            reject(err);
        }

        fileStream.on('error', (err) => {
            console.error(`Error writing to file: ${err.message}`);
            fs.unlink(filePath, () => { });
            reject(err);
        });
    });
}

server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

function fixtext(text) {
    var temptext = ""
    alphabet = Array.from("0123456789AaÀàÁáÂâÃãÄäBbCcÇçDdÈèÉéÊêËëFfGgHhÌiìİEĞYŞÍíÎîÏïJjKkLlMmNnÑñOoÒòÓóÔôÕõÖöPpQqRrSsTtÙùÚúÛûÜüVvWwXxÝýŸÿZz ");
    for (i = 0; i < text.length; i++) { if (alphabet.filter((z) => z == text[i]).length) temptext += text[i] }
    return temptext.slice(0, -3) + "." + temptext.slice(-3)
}


