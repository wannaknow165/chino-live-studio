import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

// Reuse the installed OBS camera driver and the project's Windows frame bridge.
// This does not launch OBS Studio or start a public broadcast.
export class ProjectVirtualCamera {
  constructor({root,spawnImpl=spawn,now=Date.now,platform=process.platform}){
    Object.assign(this,{root,spawnImpl,now,platform});this.child=null;this.error='';
    this.statusFile=path.join(root,'data','video-director','virtual-camera.json');
    this.python=path.join(process.env.LOCALAPPDATA||'','Programs','Python','Python313','python.exe');
  }
  status(){
    let frame;try{frame=JSON.parse(fs.readFileSync(this.statusFile,'utf8'));}catch{}
    const on=!!this.child;
    const fresh=on&&frame?.pid===this.child.pid&&this.now()-frame.updatedAt<3500;
    return {on,ready:!!(fresh&&frame.state==='streaming'&&frame.frames>0),state:on?(fresh?frame.state:'starting'):'stopped',error:this.error,device:'OBS Virtual Camera',width:1080,height:1920,fps:30,frames:fresh?frame.frames:0};
  }
  start(){
    if(this.platform!=='win32')throw new Error('camera_platform_unsupported');
    if(this.child)return this.status();
    if(!fs.existsSync(this.python))throw new Error('camera_python_missing');
    fs.mkdirSync(path.dirname(this.statusFile),{recursive:true});this.error='';
    const log=fs.openSync(path.join(path.dirname(this.statusFile),'virtual-camera.log'),'a');
    let child;
    try{child=this.spawnImpl(this.python,['-u',path.join(this.root,'tools','vcam.py'),'--title','CHINO CAMERA — Live Output','--url','http://127.0.0.1:7780/stage?vcam=1','--profile',path.join(this.root,'data','chrome_auto_camera'),'--require-frame-border','--status-file',this.statusFile],{cwd:this.root,windowsHide:true,stdio:['ignore',log,log]});}
    finally{fs.closeSync(log);}
    this.child=child;
    child.once('error',()=>{if(this.child===child){this.child=null;this.error='camera_start_failed';}});
    child.once('exit',code=>{if(this.child===child){this.child=null;this.error=code?'camera_stopped_unexpectedly':'';}});
    return this.status();
  }
  stop(){const child=this.child;if(child){child.kill();this.child=null;}this.error='';return this.status();}
}
