import {spawn} from 'node:child_process';import {createInterface} from 'node:readline';
export class MusicMotion {
  constructor(script,emit){this.script=script;this.emit=emit;this.proc=null;this.error='';this.latest={energy:0,beat:0,bpm:null};}
  start(){if(this.proc)return;this.error='';const p=this.proc=spawn('py',['-3.13',this.script],{windowsHide:true,stdio:['ignore','pipe','ignore']});
    createInterface({input:p.stdout}).on('line',line=>{try{const d=JSON.parse(line);if(d.type==='features'){this.latest=d;this.emit(d)}}catch{}});
    p.on('error',()=>{this.error='music_input_unavailable';this.proc=null});p.on('exit',()=>{if(this.proc===p){this.proc=null;this.error='music_input_stopped'}this.latest={energy:0,beat:0,bpm:null};this.emit(this.latest)});
  }
  stop(){const p=this.proc;this.proc=null;p?.kill();this.latest={energy:0,beat:0,bpm:null};this.emit(this.latest)}
  status(){return{enabled:!!this.proc,error:this.error,source:'system_loopback',audioSaved:false,...this.latest}}
}
