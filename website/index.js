const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { ytmp4 } = require('@vreden/youtube_scraper');
const WebSocket = require('ws');
const ffmpeg = require('fluent-ffmpeg');
if (process.platform != 'win32') ffmpeg.setFfmpegPath(path.join(__dirname, 'ffmpeg'));
const render = require('./render');
const AWS = require('aws-sdk');
const rimraf = require("rimraf");
require('dotenv').config();

if (!fs.existsSync('./uploads'))
    fs.mkdirSync('./uploads', { recursive: true });

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
const port = process.env.PORT || 8080;
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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

function safeDeleteFile(filePath) {
    if (filePath && fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
            sendLog(`Deleted file: ${filePath}`, false);
        } catch (err) {
            console.error(`Failed to delete file ${filePath}: ${err.message}`);
        }
    }
}

app.post('/convert', upload.single('video'), async (req, res) => {
    if (!req.file && (!req.body.youtubeUrl || !req.body.youtubeUrl.trim())) {
        return res.status(400).json({ error: 'No video file uploaded or YouTube URL provided' });
    }

    res.status(200).json({ success: true, message: 'Processing started' });

    processVideoAndNotify(req);
});

async function processVideoAndNotify(req) {
    const abortController = new AbortController();
    const { signal } = abortController;

    const REQUEST_TIMEOUT = 900000;
    const timeoutId = setTimeout(() => {
        sendLog('Operation timed out, aborting conversion');
        abortController.abort();
    }, REQUEST_TIMEOUT);

    try {
        sendLog('Starting video conversion process');
        if (fs.existsSync(path.join(__dirname, 'ascii_video.txt')))
            fs.unlinkSync(path.join(__dirname, 'ascii_video.txt'));
        if (fs.existsSync(path.join(__dirname, 'audio.mp3')))
            fs.unlinkSync(path.join(__dirname, 'audio.mp3'));
        if (fs.existsSync('./render'))
            rimraf.sync('./render');

        var myfile = req.file;
        let filesToCleanup = [];

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
                        filesToCleanup.push(finalVideoPath);
                    } else {
                        sendLog('YouTube video found, starting download');
                        const tempVideoPath = path.join(__dirname, 'uploads', "temp_" + filename);
                        sendLog(`Downloading video to: ${tempVideoPath}`);

                        try {
                            const response = await fetch(video.download.url, { signal });
                            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

                            myfile = await processVideo(response, tempVideoPath);
                            filesToCleanup.push(myfile.path);
                        } catch (error) {
                            safeDeleteFile(tempVideoPath);
                            sendLog(`Download error: ${error.message}`);
                            throw error;
                        }
                    }
                } else {
                    throw new Error('YouTube video not found or download failed');
                }
            } catch (error) {
                sendLog(`Error: ${error.message}`);
                clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'error',
                            message: 'Failed to process YouTube video: ' + error.message
                        }));
                    }
                });
                clearTimeout(timeoutId);
                return;
            }
        } else if (myfile) {
            filesToCleanup.push(myfile.path);
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
                clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'error',
                            message: 'Video file not found'
                        }));
                    }
                });
                clearTimeout(timeoutId);
                return;
            }

            sendLog('Preparing to render the video to ASCII...');

            try {
                const result = await new Promise((resolve, reject) => {
                    const wrappedCallback = (err, result) => {
                        if (signal.aborted) {
                            reject(new Error('Operation was aborted'));
                        } else if (err) {
                            reject(err);
                        } else {
                            resolve(result);
                        }
                    };

                    render(myfile.path, wrappedCallback, (msg) => {
                        sendLog(msg, false);
                        if (signal.aborted) {
                            throw new Error('Operation was aborted');
                        }
                    });
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
                            if (!fs.existsSync(file.path)) {
                                sendLog(`Warning: ${file.path} does not exist, skipping upload`);
                                return resolve();
                            }

                            s3.putObject({
                                Bucket: bucketName,
                                Key: file.key,
                                Body: fs.readFileSync(file.path),
                                ContentType: file.contentType,
                                Metadata: { "expire-in": "2592000" }
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

                    sendLog(`Video information saved ${videoName}`);

                    clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'complete',
                                success: true,
                                command:`Windows: curl -sN https://videotoascii.azurewebsites.net/video/${randomId} | cmd<br>
Linux: curl -sN https://videotoascii.azurewebsites.net/video/${randomId}/1 | bash`,
                            }));
                        }
                    });
                    if (fs.existsSync('./render'))
                        rimraf.sync('./render');

                } catch (err) {
                    sendLog(`Failed to save video data to files: ${err.message}`);
                    clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'error',
                                message: 'Failed to save video data: ' + err.message
                            }));
                        }
                    });
                }
            } catch (err) {
                sendLog(`Error processing video: ${err.message}`);
                clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'error',
                            message: 'Failed to process video: ' + err.message
                        }));
                    }
                });
            } finally {
                filesToCleanup.forEach(safeDeleteFile);
                clearTimeout(timeoutId);
            }
        } else {
            filesToCleanup.forEach(safeDeleteFile);
            clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: 'error',
                        message: 'Failed to process video: Unknown error'
                    }));
                }
            });
            clearTimeout(timeoutId);
        }
    } catch (error) {
        sendLog(`Unexpected error: ${error.message}`);
        clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'error',
                    message: 'An unexpected error occurred: ' + error.message
                }));
            }
        });
        clearTimeout(timeoutId);
    }
};
app.get("/video/:sessionid/:type?", async (req, res) => {
    try {   
        if (req.params.type !== "1") {
            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Content-Disposition', `attachment; filename="ascii_file.bat"`);
            const batchScript = `@echo off
            cd /d %TEMP%
            
            curl -Lo videotoascii.exe https://github.com/DeveloperKubilay/videotoascii/raw/refs/heads/main/build/dist/videotoascii.exe
            curl -Lo ascii_video.txt https://videotoascii.azurewebsites.net/txt/${req.params.sessionid}
            curl -Lo audio.mp3 https://videotoascii.azurewebsites.net/audio/${req.params.sessionid}
            
            videotoascii.exe
            `;
            return res.send(batchScript);
        } else {
            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Content-Disposition', `attachment; filename="ascii_file.sh"`);
   const shellScript = `#!/bin/bash
# Önce /tmp klasörüne erişim olup olmadığını kontrol et
if [ -w "/tmp" ] && [ -x "/tmp" ]; then
    WORKDIR="/tmp"
else
    # /tmp'ye erişim yoksa, bulunduğumuz dizinde videoascii_temp klasörü oluştur
    WORKDIR="$(pwd)/videoascii_temp"
    mkdir -p "$WORKDIR"
fi

cd "$WORKDIR"
curl -Lo videotoascii https://github.com/DeveloperKubilay/videotoascii/raw/refs/heads/main/build/dist/videotoascii
chmod +x videotoascii
curl -Lo ascii_video.txt https://videotoascii.azurewebsites.net/txt/${req.params.sessionid}
curl -Lo audio.mp3 https://videotoascii.azurewebsites.net/audio/${req.params.sessionid}
./videotoascii

# İşlem bittikten sonra, eğer kendi oluşturduğumuz klasörü kullandıysak, temizlik yap
if [ "$WORKDIR" != "/tmp" ] && [ -d "$WORKDIR" ]; then
    cd ..
    rm -rf "$WORKDIR"
fi
`;
            return res.send(shellScript);
        }
    } catch (error) {
        return res.status(500).json({ error: 'Failed to retrieve video' });
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
        const uploadDir = path.join(__dirname, 'uploads');

        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

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

            const command = ffmpeg(filePath);
            command.outputOptions([
                '-movflags faststart',
                '-c:v copy',
                '-c:a copy',
                '-threads', '4'
            ])
                .on('start', (commandLine) => {
                    console.log(`FFmpeg command: ${commandLine}`);
                })
                .save(outputFilePath)
                .on('end', () => {
                    console.log(`Video processing completed: ${outputFilePath}`);
                    safeDeleteFile(filePath);

                    resolve({
                        path: outputFilePath,
                        originalname: path.basename(outputFilePath),
                    });
                })
                .on('error', (err) => {
                    console.error(`Video processing error: ${err.message}`);
                    safeDeleteFile(filePath);
                    safeDeleteFile(outputFilePath);
                    reject(err);
                });
        } catch (err) {
            console.error(`Error in download stream: ${err.message}`);
            fileStream.end();
            safeDeleteFile(filePath);
            reject(err);
        }

        fileStream.on('error', (err) => {
            console.error(`Error writing to file: ${err.message}`);
            safeDeleteFile(filePath);
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


