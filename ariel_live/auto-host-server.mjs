import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createVideoDirector } from './video-director-server.mjs';
import { normalizeTikEvent } from './tiktools-events.mjs';
import { ProjectVirtualCamera } from './virtual-camera.mjs';
import { ChinoMusic, loadLearnedSongs } from './chino-music.mjs';
import {ChinoShow} from './chino-show.mjs';
import {ChinoInteractions} from './chino-interactions.mjs';
import {ChinoInteractionPlayer} from './chino-interaction-player.mjs';

const root=path.dirname(fileURLToPath(import.meta.url)), port=Number(process.env.CHINO_PORT||7780), boot=Date.now();
const camera=new ProjectVirtualCamera({root});
const music=new ChinoMusic({songs:loadLearnedSongs(root),settingsFile:path.join(root,'data','video-director','music-settings.json')});
const read=(f,d)=>{try{return JSON.parse(fs.readFileSync(path.join(root,'data',f),'utf8'));}catch{return d;}};
const clients=new Set();let show=null,interactionPlayer=null;
const emit=(type,data)=>{if(type==='director-cancel'&&show?.active?.playId===data.playId)show.stop(data.reason||'voice_cancelled');interactionPlayer?.observe(type,data);const line='data: '+JSON.stringify({type,...data})+'\n\n';for(const c of clients)c.write(line);};
let bridge={connected:false,room:'',status:'לא מחובר לצ׳אט'},opponent={name:'',handle:''},battle=null;

const system=createVideoDirector({root,port,bank:()=>read('bank.json',[]),emit,
 context:()=>({videoMode:true,opponent,battle:battle&&Date.now()-battle.receivedAt<30000?battle:null,audienceConnection:bridge}),
 onMode:()=>{},onSpoken:()=>{},
 productionEnabled:true,
});
show=new ChinoShow({director:system.director,emit});
const interactions=new ChinoInteractions({root,emit});
interactionPlayer=new ChinoInteractionPlayer({root,interactions,director:system.director,emit});
const showTimer=setInterval(()=>{show.tick();interactionPlayer.tick();},100);showTimer.unref();
const json=(res,value,code=200)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
async function body(req){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>32000)throw new Error('body_too_large');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString()||'{}');}
async function desk(route,data){const r=await fetch('http://127.0.0.1:7777'+route,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(10000)});const j=await r.json();if(!r.ok||j.error)throw new Error('effects_bridge_unavailable');return j;}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mp4':'video/mp4','.webm':'video/webm','.png':'image/png','.jpg':'image/jpeg'};
function file(req,res,f){if(!fs.existsSync(f)||!fs.statSync(f).isFile())return json(res,{error:'not_found'},404);const size=fs.statSync(f).size,headers={'Content-Type':mime[path.extname(f)]||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-cache'};let start=0,end=size-1,code=200;if(req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!m||+m[1]>=size||(m[2]&&+m[2]<+m[1])){res.writeHead(416,{'Content-Range':'bytes */'+size});return res.end();}start=+m[1];end=m[2]?Math.min(+m[2],size-1):end;headers['Content-Range']=`bytes ${start}-${end}/${size}`;code=206;}headers['Content-Length']=end-start+1;res.writeHead(code,headers);fs.createReadStream(f,{start,end}).pipe(res);}
const server=http.createServer(async(req,res)=>{
 const origin=req.headers.origin;
 if(!['localhost:'+port,'127.0.0.1:'+port].includes(req.headers.host||'')||(origin&&!['http://localhost:'+port,'http://127.0.0.1:'+port].includes(origin)))return json(res,{error:'origin_not_allowed'},403);
 res.setHeader('X-Content-Type-Options','nosniff');
 try{
  const u=new URL(req.url,'http://127.0.0.1'),route=decodeURIComponent(u.pathname);
  if(await system.handle(req,res,route))return;
  if(route==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});res.write('data: '+JSON.stringify({type:'hello',boot})+'\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return;}
  if(route==='/api/interactions/clear'&&req.method==='POST'){await body(req);return json(res,interactionPlayer.clearPending());}
  if(route==='/api/interactions'&&req.method==='GET'){const result=interactions.status();if(u.searchParams.get('summary')==='1')delete result.requests;return json(res,result);}
  if(route==='/api/interactions/tracking'&&req.method==='POST'){const result=await interactions.attachTracking(await body(req));return json(res,{...result,...interactionPlayer.enqueue(result.id)});}
  if(route==='/api/interactions/play'&&req.method==='POST'){const b=await body(req);return json(res,{accepted:true,...interactionPlayer.enqueue(b.id)},202);}
  if(route==='/api/interactions'&&req.method==='POST'){const result=await interactions.receive(await body(req));return json(res,{...result,...interactionPlayer.enqueue(result.id)},202);}
  if(route==='/api/show'&&req.method==='GET')return json(res,{...show.status(),musicPreview:music.status().preview});
  if(route==='/api/show/start'&&req.method==='POST'){const b=await body(req);return json(res,show.start(b.id));}
  if(route==='/api/show/stop'&&req.method==='POST'){await body(req);music.stopPreview();return json(res,show.stop());}
  if(route==='/api/show/render'&&req.method==='POST')return json(res,show.acknowledge(await body(req)));
  if(route==='/api/stage-assets')return json(res,{idles:fs.readdirSync(path.join(root,'media','idle')).filter(f=>/\.mp4$/.test(f)).map(f=>'/media/idle/'+f),poster:'/media/master.png'});
  if(route==='/api/music-motion'&&req.method==='GET')return json(res,music.status());
  if(route==='/api/music-motion'&&req.method==='POST'){const b=await body(req);return json(res,music.setEnabled(b.on));}
  if(route==='/api/music-motion/preview'&&req.method==='POST'){const b=await body(req);return json(res,music.startPreview(b.id));}
  if(route==='/api/music-motion/render'&&req.method==='POST')return json(res,music.acknowledge(await body(req)));
  if(route==='/api/virtual-camera'&&req.method==='GET')return json(res,camera.status());
  if(route==='/api/virtual-camera'&&req.method==='POST'){const b=await body(req);if(typeof b.on!=='boolean')throw new Error('invalid_camera_action');return json(res,b.on?camera.start():camera.stop());}
  if(route==='/api/operator/say'&&req.method==='POST'){const b=await body(req);return json(res,system.director.operatorSay(b.text));}
  if(route==='/api/reference-phrases/draft'&&req.method==='POST'){
    const b=await body(req),text=String(b.text||'').trim();if(!text||text.length>350)throw new Error('invalid_draft');
    const sources=JSON.parse(fs.readFileSync(path.join(root,'media','reference-library','previous-phrases.json'),'utf8'));
    if(!sources.items.some(x=>x.id===b.sourceId))throw new Error('invalid_reference_phrase');
    const d=system.director,prior=d.saved.inbox.find(r=>r.state==='pending'&&r.referenceId===b.sourceId&&r.draft===text);
    if(prior)return json(res,{saved:true,id:prior.id,generated:false});
    const event={id:crypto.randomUUID(),type:'audience',text:'נוסח מהפרויקט הקודם',source:'reference_import',room:d.room,uid:'',language:/[\u0590-\u05ff]/.test(text)?'he':'en',t:Date.now()};
    const row=d.missing(event,{text,reason:'reviewed_draft_video_missing'});row.referenceId=b.sourceId;row.referenceUrl=sources.sourceUrl;d.save();
    return json(res,{saved:true,id:row.id,generated:false});
  }
  if(route==='/api/tiktok/connect'&&req.method==='POST'){const b=await body(req);const user=String(b.user||'').replace(/^@/,'').trim();if(!/^[\w.]{2,50}$/.test(user))throw new Error('invalid_tiktok_handle');await desk('/api/tiktok/connect',{user});system.director.setRoom(user);bridge={...bridge,room:user,status:'מתחבר לצ׳אט'};return json(res,{ok:true,user});}
  if(route==='/api/tiktok/disconnect'&&req.method==='POST'){await desk('/api/tiktok/disconnect',{});bridge={...bridge,room:'',on:false,status:'מנותק'};system.director.setMode('manual');return json(res,{ok:true});}
  if(route==='/api/opponent'&&req.method==='POST'){const b=await body(req);opponent={name:String(b.name||'').slice(0,80),handle:String(b.handle||'').slice(0,100)};system.director.cancel('opponent_changed',true,true);system.director.endDialogue();return json(res,opponent);}
  if(route==='/')return file(req,res,path.join(root,'public','auto-host.html'));
  if(route==='/stage')return file(req,res,path.join(root,'public','auto-host-stage.html'));
  if(route==='/director.js')return file(req,res,path.join(root,'public','director.js'));
  if(route==='/virtual-camera.js')return file(req,res,path.join(root,'public','virtual-camera.js'));
  if(['/performances.js','/show-overlay.js','/show-panel.js'].includes(route))return file(req,res,path.join(root,'public',route.slice(1))); 
  if(route.startsWith('/media/')){const f=path.resolve(root,route.slice(1)),base=path.resolve(root,'media')+path.sep;if(!f.startsWith(base))return json(res,{error:'invalid_path'},403);return file(req,res,f);}
  json(res,{error:'not_found'},404);
 }catch(e){json(res,{error:/^[a-z0-9_]+$/.test(e.message)?e.message:'request_failed'},400);}
});
// Read-only reuse of the existing TikTools detector/effects bus. No effects are
// generated here. Studio events must belong to the explicitly connected room.
let bridgeController=null;
// Read the legacy detector without changing Spotify, learning flags, or effects.
let musicPolling=false;
async function pollMusic(){if(musicPolling)return;musicPolling=true;try{const s=await desk('/api/spotify');music.update(s.spotify);}catch{music.disconnect();}finally{musicPolling=false;}}
setInterval(pollMusic,4000).unref();pollMusic();
async function connectBridge(){
 bridgeController=new AbortController();
 try{const r=await fetch('http://127.0.0.1:7777/api/events',{signal:bridgeController.signal});if(!r.ok||!r.body)throw new Error('bridge');bridge.connected=true;
  const state=await desk('/api/tiktok').catch(()=>null);if(state?.on){bridge={...bridge,on:true,room:state.user,status:state.status};system.director.setRoom(state.user);}
  let buf='';const decoder=new TextDecoder();for await(const chunk of r.body){buf+=decoder.decode(chunk,{stream:true});let i;while((i=buf.indexOf('\n\n'))>=0){const block=buf.slice(0,i);buf=buf.slice(i+2);const line=block.split('\n').find(x=>x.startsWith('data: '));if(!line)continue;let m;try{m=JSON.parse(line.slice(6));}catch{continue;}
   if(m.type==='tiktok'){bridge={...bridge,connected:true,on:!!m.on,room:m.user||'',status:m.status||''};system.director.setRoom(m.user||'');}
   if(m.type==='spotify')music.update(m);
   if(m.type==='songs')music.songs=loadLearnedSongs(root);
   if(m.type==='chatmsg'&&bridge.on&&bridge.room){bridge.lastEventAt=Date.now();bridge.eventCount=(bridge.eventCount||0)+1;const type=m.kind==='gift'?'gift':!m.kind?'chat':null;if(type)system.director.receive({type,text:m.text,name:m.name,uid:m.uid,...(m.id?{id:m.id}:{}),source:'tiktools'});}
   if(m.type==='battle'){battle=normalizeTikEvent('battle',m,bridge.room);}
   if(m.type==='clip'&&m.audio)system.director.hold('externalClip',true);
   if(m.type==='clipState'&&!m.playing)system.director.hold('externalClip',false);
  }if(buf.length>1000000)buf='';}
 }catch{}finally{const wasLive=bridge.connected&&bridge.on;bridge.connected=false;bridge.on=false;bridge.status='גשר הצ׳אט מנותק';if(wasLive)system.director.cancel('chat_bridge_disconnected');setTimeout(connectBridge,5000).unref();}
}
server.listen(port,'127.0.0.1',()=>{console.log('Lion Auto Host: http://127.0.0.1:'+port+' (manual; existing effects dashboard unchanged)');connectBridge();});
for(const name of ['SIGTERM','SIGINT'])process.on(name,()=>{show.stop('shutdown');clearInterval(showTimer);camera.stop();bridgeController?.abort();system.close();server.close();process.exit(0);});
