// Local synthetic media verification only. No generation/provider requests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {composePerformance} from '../chino-performances.mjs';
const run=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'chino-composition-'));
const options={windowsHide:true,timeout:180000,maxBuffer:16*1024*1024,encoding:'buffer'};
try{
  fs.mkdirSync(path.join(temp,'media','generated'),{recursive:true});fs.mkdirSync(path.join(temp,'media','performances'));
  const particles=path.join(root,'media','performances','chino-kiss-particles.webm');
  fs.copyFileSync(particles,path.join(temp,'media','performances',path.basename(particles)));
  const raw=path.join(temp,'media','generated','fixture.mp4');
  await run('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=0x17302d:s=720x1280:r=15:d=10','-f','lavfi','-i','sine=frequency=440:duration=10','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac',raw],options);
  const job={performanceId:'kiss_audience',validation:{duration:10},generated:{id:'fixture',file:'fixture.mp4'}};
  const composite=await composePerformance({root:temp,job,decision:{releaseSeconds:3.2}});
  const final=path.join(temp,'media','generated',composite.file);
  const audio=async f=>(await run('ffmpeg',['-v','error','-i',f,'-map','0:a:0','-c:a','copy','-f','adts','-'],options)).stdout;
  assert.equal(crypto.createHash('sha256').update(await audio(raw)).digest('hex'),crypto.createHash('sha256').update(await audio(final)).digest('hex'),'audio packets must remain unchanged');
  const sample=async(f,t,alpha=false)=>(await run('ffmpeg',['-v','error',...(alpha?['-c:v','libvpx-vp9']:[]),'-ss',String(t),'-i',f,'-frames:v','1','-vf','scale=180:320','-f','rawvideo','-pix_fmt',alpha?'rgba':'rgb24','-'],options)).stdout;
  const diff=(a,b)=>a.reduce((sum,x,i)=>sum+Math.abs(x-b[i]),0)/a.length;
  const before=diff(await sample(raw,2),await sample(final,2));
  const during=diff(await sample(raw,4.3),await sample(final,4.3));
  const after=diff(await sample(raw,9.8),await sample(final,9.8));
  assert.ok(before<1&&after<1,'particles must not appear before cue or linger after tail');
  assert.ok(during>1,'particles must be visible after cue');
  const rgba=await sample(particles,1,true),a=[];for(let i=3;i<rgba.length;i+=4)a.push(rgba[i]);
  assert.ok(a.filter(x=>x===0).length>a.length*.6,'background must be transparent');
  assert.ok(a.some(x=>x>10&&x<245),'soft alpha edges required');
  const report={fixtureOnly:true,providerCalls:0,audioPacketsPreserved:true,releaseSeconds:3.2,beforeDifference:before,duringDifference:during,afterDifference:after,alphaDecoded:true,gestureVerified:false};
  const review=path.join(root,'data','video-director','kiss-review');fs.mkdirSync(review,{recursive:true});
  fs.writeFileSync(path.join(review,'ai-performance-composition-verification.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
