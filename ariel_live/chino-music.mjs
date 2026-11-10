import fs from 'node:fs';
import path from 'node:path';

const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function loadLearnedSongs(root){
  let rows=[];try{rows=JSON.parse(fs.readFileSync(path.join(root,'data','songs.json'),'utf8'));}catch{}
  const clips=files=>(files||[]).filter(f=>typeof f==='string'&&/^[\w-]+\.mp4$/.test(f)&&fs.existsSync(path.join(root,'media','dance',f))).map(f=>'/media/dance/'+f);
  return rows.map(s=>({id:s.id,name:s.name,dances:clips(s.dances),sings:clips(s.sings),chorus:(s.chorus||[]).filter(c=>Array.isArray(c)&&c.length===2&&c.every(Number.isFinite)&&c[0]>=0&&c[1]>c[0]),bpm:Number(s.analysis?.bpm)||null})).filter(s=>s.dances.length||s.sings.length);
}

// Reuse only completed local clips. This component has no generation API.
export class ChinoMusic {
  constructor({songs,now=Date.now,settingsFile=null}){
    this.songs=songs;this.now=now;this.settingsFile=settingsFile;this.enabled=true;
    if(settingsFile){try{const saved=JSON.parse(fs.readFileSync(settingsFile,'utf8'));if(typeof saved.enabled==='boolean')this.enabled=saved.enabled;}catch{}}
    this.connected=false;this.source={};this.preview=null;this.rendered=null;
  }
  update(source){this.connected=true;this.source={title:String(source?.title||'').slice(0,240),playing:source?.playing===true,since:Number(source?.since)||0};}
  disconnect(){this.connected=false;this.source={};}
  setEnabled(on){
    if(typeof on!=='boolean')throw new Error('invalid_music_action');
    if(this.settingsFile){fs.mkdirSync(path.dirname(this.settingsFile),{recursive:true});const tmp=this.settingsFile+'.tmp';fs.writeFileSync(tmp,JSON.stringify({enabled:on}));fs.renameSync(tmp,this.settingsFile);}
    this.enabled=on;this.preview=null;return this.status();
  }
  stopPreview(){this.preview=null;return this.status();}
  startPreview(id){const song=this.songs.find(s=>s.id===id);if(!song)throw new Error('song_has_no_existing_motion');this.preview={id,until:this.now()+12000,since:this.now()};return this.status();}
  status(){
    const now=this.now();if(this.preview?.until<=now)this.preview=null;
    const song=this.preview?this.songs.find(s=>s.id===this.preview.id):this.enabled&&this.connected&&this.source.playing?this.songs.find(s=>normalize(s.name)===normalize(this.source.title)):null;
    const position=this.preview?(now-this.preview.since)/1000:Math.max(0,(now-(this.source.since||now))/1000);
    const chorus=!!song&&(this.preview?position>=6:song.chorus.some(([a,b])=>position>=a&&position<b));
    const phase=chorus&&song.sings.length?'chorus':'vibe';
    const files=song?(phase==='chorus'?song.sings:song.dances.length?song.dances:song.sings):[];
    return {enabled:this.enabled,connected:this.connected,preview:!!this.preview,playing:this.source.playing===true,title:this.source.title||'',song:song?{id:song.id,name:song.name}:null,position,phase,files,ready:files.length>0,timing:'existing_estimated_chorus_markers',rendered:this.rendered,songs:this.songs.map(s=>({id:s.id,name:s.name,dances:s.dances.length,sings:s.sings.length,bpm:s.bpm}))};
  }
  acknowledge(b){const s=this.status();if(!s.files.includes(b.file))return {ok:false};this.rendered={file:b.file,phase:s.phase,preview:b.preview===true,t:this.now()};return {ok:true};}
}
