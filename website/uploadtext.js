const AWS = require('aws-sdk');
const fs = require('fs');
require('dotenv').config();

const filePath = './audio.mp3';
const fileContent = fs.readFileSync(filePath);



s3.putObject({
  Bucket: bucketName,
  Key: 'audio.mp3',
  Body: fileContent,
  ContentType: 'audio/mpeg',
  Metadata: {
    "expire-in": "3600", 
  }
}, function (err, data) {
  if (err) {
    console.error('Yükleme Hatası:', err);
  } else {
    console.log('Yüklendi bro ✅');
  }
});

s3.getObject({
    Bucket: bucketName,
    Key: 'audio.mp3'
}, function(err, data) {
    if (err) {
        console.error('İndirme Hatası:', err);
    } else {
        fs.writeFileSync('./downloaded_audio.mp3', data.Body);
        console.log('Dosya indirildi ✅');
    }
});
