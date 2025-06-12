# 🎬 Video to ASCII Converter 🖥️

This project converts your regular videos into awesome ASCII art animations. It's really amazing! 🔥

![vidtoascii](https://raw.githubusercontent.com/DeveloperKubilay/videotoascii/refs/heads/main/build/image.png)

## 🌐 Try It Online Right Now!

**No installation required, upload your video right now:**
[https://videotoascii.azurewebsites.net/](https://videotoascii.azurewebsites.net/)

On our website:
- Just upload your video
- Conversion happens automatically
- View and download the result instantly
- No need to deal with coding!

## 🖥️ Want to Run It on Your Local Computer?

For more control and customization, you can run it on your own computer:

### ✨ Features

- 💯 Convert any video file to ASCII art
- 🎵 Preserve audio from the original video
- ⚡ Parallel processing for faster conversion
- 🎮 Simple playback with synchronized sound

### 🚀 Getting Started

#### Requirements
- Node.js (v16 or higher)
- NPM

#### Installation
```bash
# Clone this repository
git clone https://github.com/yourusername/videotoascii.git

# Install dependencies
npm install
```

### 🎮 How to Use

1. Place your video file as `video.mp4` in the project directory
2. Run the renderer:
```bash
node render.js
```
3. Play your ASCII video:
```bash
node index.js
```

### 🛠️ Configuration

You can customize these settings in `render.js`:
- Video resolution
- Frame rate
- Batch size for processing
- Number of parallel conversions

### 💡 Tips

- Shorter videos work better
- Videos with high contrast convert better to ASCII