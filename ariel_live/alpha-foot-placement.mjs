import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
// Observe the lowest opaque silhouette, independently of face/name or sender
// coordinates. Each anchor remains tied to its actual decoded source frame.
export function feetFromAlpha(bytes,{width,height,fps}){
 const size=width*height;
 if(!Number.isInteger(size)||size<1||!Number.isFinite(fps)||fps<=0||bytes.length%size||bytes.length<size)throw new Error('interaction_foot_decode_invalid');
 const track=[],detected=[];
 for(let offset=0;offset<bytes.length;offset+=size){
  let bottom=-1;
  for(let y=height-1;y>=0&&bottom<0;y--)for(let x=0;x<width;x++)if(bytes[offset+y*width+x]>=24){bottom=y;break;}
  if(bottom<0){track.push([track.length/fps,.5,1]);detected.push(false);continue;}
  let sum=0,weight=0;const top=Math.max(0,bottom-Math.max(2,Math.round(height*.025)));
  for(let y=top;y<=bottom;y++)for(let x=0;x<width;x++){const a=bytes[offset+y*width+x];if(a>=24){sum+=(x+.5)*a;weight+=a;}}
  track.push([track.length/fps,sum/weight/width,(bottom+1)/height]);detected.push(true);
 }
 return {version:1,width,height,fps,frames:track.length,track,detected,method:'observed_alpha_feet'};
}
export async function measureFeet(file,{width,height,fps,duration}){
 if(width*height*fps*duration>96*1024*1024)throw new Error('interaction_foot_decode_too_large');
 const {stdout}=await run('ffmpeg',['-v','error','-nostdin','-c:v','libvpx-vp9','-i',file,'-an','-vf','alphaextract','-pix_fmt','gray','-f','rawvideo','pipe:1'],{encoding:'buffer',maxBuffer:100*1024*1024,timeout:45000,windowsHide:true});
 return feetFromAlpha(stdout,{width,height,fps});
}
