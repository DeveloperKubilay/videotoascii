const fs = require('fs');
run()
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