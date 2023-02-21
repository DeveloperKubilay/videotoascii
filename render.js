var shardsize = 18
var video = 'video.mp4'

var asciify = require('asciify-image');
ffmpeg = require('fluent-ffmpeg');
rimraf = require("rimraf");
fs = require('fs');
rimraf.sync('./render');fs.mkdirSync("./render")
rimraf.sync('./output');fs.mkdirSync("./output")
ffmpeg.setFfmpegPath(require('@ffmpeg-installer/ffmpeg').path);
const { getVideoDurationInSeconds } = require('get-video-duration');
getVideoDurationInSeconds(video).then((duration) => {var seccond = []//shards
for (var i = 0; i < Number(duration.toFixed()); i++) {seccond.push(i)}
var shards = 0,shard = [];
seccond.map((x)=>{if(shards === shardsize) shards = 0;shards++;shard.push({number:x,shard:shards})})
console.log("Renderring shard:"+shardsize+"/"+shardsize)
for (var i = 1; i < shardsize+1; i++) { var rendershard = []
shard.filter(z=>z.shard === i).map(x=>rendershard.push(x.number))
render(rendershard,i)
}})

complated = 0,listsharddb  = []
async function render(seccond,c){//video to screenshots
  var tmpdb = []
  seccond.map((i)=>{
    tmpdb.push(
        i+0.033, i+0.066, i+0.099, i+0.132, i+0.165, i+0.198, i+0.231, i+0.264, i+0.297,
        i+0.330, i+0.363, i+0.396, i+0.426, i+0.462, i+0.495, i+0.528, i+0.561, i+0.594, 
        i+0.627, i+0.660, i+0.693, i+0.726, i+0.759, i+0.792, i+0.825, i+0.858, i+0.891, 
        i+0.924, i+0.957, i+0.990
    )})//.videoCodec('h264_amf')
await ffmpeg({source: video}).takeScreenshots({filename:"screen.png",timemarks:tmpdb},"render/render"+c)
.on('end', () => { 
  var nnumber = 0;
  var tmpnumber = 0;
for (var i = 0; i < fs.readdirSync("render/render"+c).length; i++) {
if(tmpnumber == 30 && seccond[nnumber+1]) {nnumber++;tmpnumber = 0;}
tmpnumber++;
listsharddb.push({source:"render/render"+c+"/screen_"+(i+1)+".png",img:seccond[nnumber]+(0.033*tmpnumber)})
};complated++;
console.log("Complated shard:"+complated)
if(complated === shardsize) {
console.log("Renderring")
listsharddb.sort(function(a, b) {return a.time - b.time;});
listsharddb.map((x)=>{
 asciirender(x.source,x.img)
})}
})
}

async function asciirender(x,y) {//screenshots to text
 await asciify(x, {fit: 'box',width: process.stdout.columns,height: process.stdout.rows})
 .then(async function (asciified) {
 await fs.writeFileSync("output/"+y+".txt",asciified)
 if(y === arr[arr.length]) {
    rimraf.sync('./render');
    console.log("Starting...")
    run()
 }}).catch(()=>{});
}

async function run(){//output
  var tempdb = []
  fs.readdirSync("output").map(async (x)=> tempdb.push(Number(x.replace(".txt",""))))
  tempdb.sort(function(a, b) {return a - b;});
  var frame = 0;
  setInterval(()=>{
      if(frame == tempdb.length) process.exit(0)
      console.clear()
      console.log(fs.readFileSync("output/"+String(tempdb[frame])+".txt").toString())
      frame++;
    },30.9999)
  }