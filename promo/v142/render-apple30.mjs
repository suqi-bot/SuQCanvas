import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {once} from 'node:events';
const root=path.resolve('promo/v142');
const browser=await chromium.launch();
try{
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
await page.goto(pathToFileURL(path.join(root,'apple30.html')).href);await page.evaluate(()=>document.fonts.ready);
await page.waitForFunction(()=>Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0));
for(const [i,t] of [1.2,3.2,5.8,8.5,10.7,14.3,18.5,22,25.5,28.4].entries()){await page.evaluate(t=>window.seek(t),t);await page.screenshot({path:path.join(root,`apple30-preview-${i+1}.jpg`),quality:93,type:'jpeg'});}
if(process.argv.includes('--preview'))process.exitCode=0;
else{
const out=path.join(root,'SuQCanvas-1.4.2-AppleStyle-30s.mp4');
const ff=spawn('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','image2pipe','-vcodec','mjpeg','-framerate','30','-i','pipe:0','-stream_loop','-1','-i',path.resolve('promo/v142/apple30-score.wav'),'-t','30','-af','afade=t=out:st=28.5:d=1.5','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',out],{stdio:['pipe','inherit','inherit'],windowsHide:true});
const done=once(ff,'close');
ff.stdin.on('error',e=>console.error(e.message));
for(let i=0;i<900;i++){await page.evaluate(t=>window.seek(t),i/30);const b=await page.screenshot({type:'jpeg',quality:91});if(!ff.stdin.write(b))await once(ff.stdin,'drain');if(i%150===0)console.log(`Rendered ${i}/900`);}
ff.stdin.end();const [code]=await done;if(code!==0)throw Error(`ffmpeg ${code}`);console.log(out);
}
}finally{await browser.close()}
