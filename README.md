# 🎬 Video to ASCII Converter 🖥️

Bu proje normal videolarınızı harika ASCII sanat animasyonlarına dönüştürür. Gerçekten müthiş! 🔥

## 🌐 Çevrimiçi Olarak Hemen Deneyin!

**Hiçbir kurulum gerekmeden, hemen şimdi video yükleyin:**
[https://videotoascii.azurewebsites.net/](https://videotoascii.azurewebsites.net/)

Web sitemizde:
- Sadece videonuzu yükleyin
- Dönüşüm otomatik olarak yapılır
- Sonucu anında görüntüleyin ve indirin
- Kodlamayla uğraşmanıza gerek yok!

## 🖥️ Yerel Bilgisayarınızda Çalıştırmak İster misiniz?

Daha fazla kontrol ve özelleştirme için kendi bilgisayarınızda çalıştırabilirsiniz:

### ✨ Özellikler

- 💯 Herhangi bir video dosyasını ASCII sanatına dönüştürme
- 🎵 Orijinal videodan sesi koruma
- ⚡ Daha hızlı dönüşüm için paralel işleme
- 🎮 Senkronize sesle basit oynatma

### 🚀 Başlangıç

#### Gereksinimler
- Node.js (v16 veya üstü)
- NPM

#### Kurulum
```bash
# Bu depoyu klonlayın
git clone https://github.com/yourusername/videotoascii.git

# Bağımlılıkları yükleyin
npm install
```

### 🎮 Nasıl Kullanılır

1. Video dosyanızı `video.mp4` olarak proje dizinine yerleştirin
2. İşleyiciyi çalıştırın:
```bash
node render.js
```
3. ASCII videonuzu oynatın:
```bash
node index.js
```

### 🛠️ Konfigürasyon

`render.js` içinde bu ayarları özelleştirebilirsiniz:
- Video çözünürlüğü
- Kare hızı
- İşleme için toplu iş boyutu
- Paralel dönüşüm sayısı

### 💡 İpuçları

- Kısa videolar daha iyi çalışır
- Yüksek kontrastlı videolar ASCII'ye daha iyi dönüştürülür