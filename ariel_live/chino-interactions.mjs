import {measureFeet} from './alpha-foot-placement.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
async function probeFile(file){const {stdout}=await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{windowsHide:true,timeout:15000,maxBuffer:1024*1024});return JSON.parse(stdout);}
const receipt=(row,idempotent=false)=>({accepted:true,id:row.id,requestId:row.requestId,state:row.state,rendered:false,generationSubmitted:false,needsAnchor:row.state==='needs_anchor',hasTracking:!!row.asset.tracking,idempotent});
const presets={tiny_on_paw:{point:null,suffix:null},chicken_blow:{point:null,suffix:null},dancer_side_dance:{point:null,suffix:null},chicken_comb_hold:{point:'grabPoint',suffix:'.grab.json'},baby_bottle_feed:{point:'feedPoint',suffix:'.feed.json'},dancer_hand_hold:{point:'handPoint',suffix:'.hand.json'}};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function durationOf(metadata,video){
  const streamDuration=Number(video?.duration);if(Number.isFinite(streamDuration)&&streamDuration>0)return streamDuration;
  const label=video?.tags?.DURATION||video?.tags?.duration;
  if(typeof label==='string'){const m=/^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(label);if(m){const n=+m[1]*3600 + +m[2]*60 + +m[3];if(n>0)return n;}}
  // WebM container duration can include Opus padding beyond the last video
  // frame. Tracking and source loops are bounded by the video stream itself.
  const containerDuration=Number(metadata?.format?.duration);return Number.isFinite(containerDuration)&&containerDuration>0?containerDuration:null;
}
export class ChinoInteractions {
  constructor({root,emit=()=>{},probe=probeFile,placeFeet=measureFeet}){
    this.placeFeet=placeFeet;this.root=fs.realpathSync(root);this.emit=emit;this.probe=probe;this.inflight=new Map();this.trackInflight=new Map();this.file=path.join(this.root,'data','video-director','interactions.json');this.requests=[];
    if(fs.existsSync(this.file)){try{const saved=JSON.parse(fs.readFileSync(this.file,'utf8'));if(!Array.isArray(saved.requests))throw new Error();this.requests=saved.requests.slice(-200);}catch{throw new Error('interaction_store_invalid');}}
  }
  assetUrl(value,tracking=false){
    if(typeof value!=='string'||value.length>500)throw new Error('invalid_interaction_asset_url');
    let route=value;
    if(value.startsWith('http:')||value.startsWith('https:')){let u;try{u=new URL(value);}catch{throw new Error('invalid_interaction_asset_url');}if(u.origin!=='http://127.0.0.1:7777'||u.username||u.password||u.search||u.hash)throw new Error('interaction_asset_host_not_allowed');route=u.pathname;}
    let decoded;try{decoded=decodeURIComponent(route);}catch{throw new Error('invalid_interaction_asset_path');}
    const pattern=tracking?/^\/media\/(?:overlays|interactions\/incoming)\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}\.(?:grab|feed|hand)\.json$/:/^\/media\/(?:overlays|interactions\/incoming)\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}\.webm$/;
    if(!pattern.test(decoded)||decoded.includes('..'))throw new Error('invalid_interaction_asset_path');
    return decoded;
  }
  localFile(url){
    let file,stat;try{file=fs.realpathSync(path.resolve(this.root,url.slice(1)));stat=fs.statSync(file);}catch{throw new Error('interaction_asset_missing');}
    const allowed=['media/overlays','media/interactions/incoming'].map(dir=>path.resolve(this.root,dir)+path.sep);
    if(!allowed.some(base=>file.toLowerCase().startsWith(base.toLowerCase()))||!stat.isFile())throw new Error('invalid_interaction_asset_path');
    return {file,stat};
  }
  normalize(input){
    if(!input||typeof input.requestId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(input.requestId))throw new Error('invalid_interaction_request_id');
    const preset=presets[input.preset];if(!preset)throw new Error('unsupported_interaction_preset');
    const participant=input.participant?.id;if(!['string','number'].includes(typeof participant)||!String(participant).trim()||String(participant).length>128||/[\u0000-\u001f]/.test(String(participant)))throw new Error('invalid_interaction_participant');
    const decoded=this.assetUrl(input.asset?.url),point=input.asset?.[preset.point];
    if(preset.point&&point!==undefined&&(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.x>1||point.y<0||point.y>1))throw new Error(input.preset==='baby_bottle_feed'?'invalid_interaction_feed_point':input.preset==='dancer_hand_hold'?'invalid_interaction_hand_point':'invalid_interaction_grab_point');
    // Keep the legacy chicken fingerprint identical when tracking is auto-discovered.
    const result={requestId:input.requestId,preset:input.preset,assetUrl:decoded,participantId:String(participant).trim(),[preset.point]:point?{x:point.x,y:point.y}:null};
    if(!preset.point){delete result.null;if(input.asset?.trackUrl!==undefined)throw new Error('interaction_tracking_not_used');}
    if(input.asset?.trackUrl!==undefined)result.trackUrl=this.assetUrl(input.asset.trackUrl,true);
    return result;
  }
  save(next){fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify({version:1,requests:next},null,2));fs.renameSync(this.file+'.tmp',this.file);this.requests=next;}
  status(){const count=state=>this.requests.filter(row=>row.state===state).length;return {supportedPresets:Object.keys(presets).filter(p=>{if(!['chicken_blow','tiny_on_paw'].includes(p))return true;try{const t=JSON.parse(fs.readFileSync(path.join(this.root,'media/interactions/templates/'+p+'.json'),'utf8'));return t.enabled===true&&t.approvedForIntegratedOutput===true&&t.approvalScope==='operator_approved_output';}catch{return false;}}),requests:this.requests.map(row=>structuredClone(row)),pending:this.requests.filter(row=>['awaiting_lion_motion','needs_anchor','awaiting_review','preparing_tracking','preparing_audio','queued','playing'].includes(row.state)).length,preparingTracking:count('preparing_tracking'),preparingAudio:count('preparing_audio'),queued:count('queued'),playing:count('playing'),completed:count('completed'),failed:count('failed'),cancelled:count('cancelled'),rendered:this.requests.some(row=>row.rendered===true),generationSubmitted:false};}
  async receive(input){
    const normalized=this.normalize(input),fingerprint=JSON.stringify(normalized),existing=this.requests.find(row=>row.requestId===normalized.requestId);
    if(existing){if(existing.fingerprint!==fingerprint)throw new Error('interaction_request_conflict');return receipt(existing,true);}
    const pending=this.inflight.get(normalized.requestId);if(pending){if(pending.fingerprint!==fingerprint)throw new Error('interaction_request_conflict');return receipt(await pending.promise,true);}
    if(this.inflight.size>=4)throw new Error('interaction_intake_busy');
    const promise=this.accept(normalized,fingerprint);this.inflight.set(normalized.requestId,{fingerprint,promise});
    try{return receipt(await promise);}finally{this.inflight.delete(normalized.requestId);}
  }
  discoverTrack(assetUrl,preset){
    if(!presets[preset].suffix)return null;
    const candidate=assetUrl.replace(/\.webm$/,presets[preset].suffix);
    try{this.localFile(candidate);return candidate;}catch(e){if(e.message==='interaction_asset_missing')return null;throw e;}
  }
  validateTrack(raw,row){
    const definition=presets[row.preset],video=row.asset;
    if(!raw||raw.version!==1||raw.file!==path.posix.basename(video.sourceUrl)||raw.width!==video.width||raw.height!==video.height)throw new Error('interaction_track_video_mismatch');
    if(!Number.isFinite(raw.fps)||raw.fps<1||raw.fps>240)throw new Error('invalid_interaction_track_fps');
    if(!Array.isArray(raw.track)||raw.track.length<1||raw.track.length>20000)throw new Error('invalid_interaction_track_samples');
    if(raw.frames!==undefined&&(!Number.isInteger(raw.frames)||raw.frames!==raw.track.length))throw new Error('invalid_interaction_track_frames');
    const duration=video.durationSeconds;if(!Number.isFinite(duration)||duration<=0)throw new Error('interaction_track_video_duration_unavailable');
    let previous=-1;
    for(const point of raw.track){
      if(!Array.isArray(point)||point.length!==3||!point.every(Number.isFinite)||point[0]<0||point[0]<=previous||point[0]>duration+1/raw.fps+.001||point[1]<0||point[1]>1||point[2]<0||point[2]>1)throw new Error('invalid_interaction_track_sample');
      previous=point[0];
    }
    if(raw.detected!==undefined&&(!Array.isArray(raw.detected)||raw.detected.length!==raw.track.length||!raw.detected.every(v=>typeof v==='boolean')))throw new Error('invalid_interaction_track_detection');
    let stableWindow=null;
    if(raw.stableWindow!==undefined){const w=raw.stableWindow;if(!w||!Number.isFinite(w.from)||!Number.isFinite(w.to)||w.from<raw.track[0][0]||w.to<=w.from||w.to>Math.min(duration,previous+1/raw.fps)+.001)throw new Error('invalid_interaction_stable_window');stableWindow={from:w.from,to:w.to};}
    const point=raw[definition.point];if(point!==undefined&&(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.x>1||point.y<0||point.y>1))throw new Error('invalid_interaction_track_anchor');
    return {version:1,file:raw.file,width:raw.width,height:raw.height,fps:raw.fps,frames:raw.track.length,pointKind:definition.point,track:raw.track.map(p=>[...p]),detected:raw.detected===undefined?null:[...raw.detected],stableWindow};
  }
  snapshotTrack(trackUrl,row){
    const url=this.assetUrl(trackUrl,true),suffix=presets[row.preset].suffix;
    if(!url.endsWith(suffix))throw new Error('interaction_track_preset_mismatch');
    const {file,stat}=this.localFile(url);if(stat.size>1024*1024)throw new Error('interaction_track_too_large');
    const bytes=fs.readFileSync(file);const after=fs.statSync(file);if(stat.size!==after.size||stat.mtimeMs!==after.mtimeMs)throw new Error('interaction_track_changed');
    let raw;try{raw=JSON.parse(bytes.toString('utf8'));}catch{throw new Error('invalid_interaction_track_json');}
    const data=this.validateTrack(raw,row),fileData={...data};if(fileData.detected===null)delete fileData.detected;if(fileData.stableWindow===null)delete fileData.stableWindow;const snapshotBytes=Buffer.from(JSON.stringify(fileData)),digest=sha(snapshotBytes);
    if(row.asset.tracking?.sha256===digest)return {tracking:row.asset.tracking,idempotent:true,createdFile:null};
    const snapshotUrl='/media/interactions/incoming/'+randomUUID()+suffix,filename=path.join(this.root,snapshotUrl.slice(1));
    fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,snapshotBytes,{flag:'wx'});
    return {tracking:{...data,url:snapshotUrl,sourceUrl:url,sha256:digest,sourceSha256:sha(bytes),bytes:snapshotBytes.length},createdFile:filename,idempotent:false};
  }
  async accept(n,fingerprint){
    const {file,stat}=this.localFile(n.assetUrl);if(stat.size>250*1024*1024)throw new Error('interaction_asset_too_large');
    const id=randomUUID(),snapshotUrl='/media/interactions/incoming/'+id+'.webm',snapshot=path.join(this.root,snapshotUrl.slice(1));
    fs.mkdirSync(path.dirname(snapshot),{recursive:true});let trackFile=null,row;
    try{
      fs.copyFileSync(file,snapshot,fs.constants.COPYFILE_EXCL);let current=fs.statSync(file);
      if(current.size!==stat.size||current.mtimeMs!==stat.mtimeMs)throw new Error('interaction_asset_changed');
      let metadata;try{metadata=await this.probe(snapshot);}catch{throw new Error('interaction_asset_probe_failed');}
      const video=metadata?.streams?.find(stream=>stream.codec_type==='video');
      if(!video||!Number.isInteger(video.width)||!Number.isInteger(video.height)||video.width<1||video.height<1||Math.max(video.width,video.height)>8192)throw new Error('interaction_asset_invalid_video');
      if(String(video.tags?.alpha_mode??video.tags?.ALPHA_MODE??'')!=='1')throw new Error('interaction_asset_alpha_required');
      current=fs.statSync(file);if(current.size!==stat.size||current.mtimeMs!==stat.mtimeMs)throw new Error('interaction_asset_changed');
      const pointKey=presets[n.preset].point;
      row={id,requestId:n.requestId,preset:n.preset,asset:{url:snapshotUrl,sourceUrl:n.assetUrl,sha256:sha(fs.readFileSync(snapshot)),[pointKey]:n[pointKey],width:video.width,height:video.height,durationSeconds:durationOf(metadata,video),alpha:true,bytes:stat.size,mtimeMs:stat.mtimeMs},participant:{id:n.participantId},state:!pointKey||n[pointKey]?'awaiting_lion_motion':'needs_anchor',rendered:false,generationSubmitted:false,createdAt:Date.now(),fingerprint};
      if(!pointKey)delete row.asset.null;
      if(n.preset==='tiny_on_paw'){const [num,den]=String(video.avg_frame_rate||video.r_frame_rate||'24/1').split('/').map(Number),fps=num/(den||1);const feet=await this.placeFeet(snapshot,{width:video.width,height:video.height,fps,duration:row.asset.durationSeconds});row.asset.placement={...feet,sourceSha256:row.asset.sha256};}
      const trackUrl=n.trackUrl??this.discoverTrack(n.assetUrl,n.preset);
      if(trackUrl){const result=this.snapshotTrack(trackUrl,row);row.asset.tracking=result.tracking;trackFile=result.createdFile;}
      this.save([...this.requests,row].slice(-200));
    }catch(e){for(const filename of [snapshot,trackFile].filter(Boolean)){try{fs.unlinkSync(filename);}catch{}}throw e.message?.startsWith('interaction_')||e.message?.startsWith('invalid_')?e:new Error('interaction_store_write_failed');}
    this.emit('interaction-received',{id:row.id,requestId:row.requestId,preset:row.preset,asset:structuredClone(row.asset),participant:{...row.participant},state:row.state,rendered:false,generationSubmitted:false});return row;
  }
  async attachTracking({id,trackUrl}={}){
    const row=this.requests.find(r=>r.id===id||r.requestId===id);if(!row)throw new Error('interaction_request_not_found');
    const url=this.assetUrl(trackUrl,true),pending=this.trackInflight.get(row.id);
    if(pending){if(pending.url!==url)throw new Error('interaction_tracking_busy');return pending.promise;}
    const promise=this.attachTrack(row.id,url);this.trackInflight.set(row.id,{url,promise});try{return await promise;}finally{this.trackInflight.delete(row.id);}
  }
  async attachTrack(id,url){
    const original=this.requests.find(r=>r.id===id),row=structuredClone(original),asset=row.asset;
    const snapshot=this.localFile(asset.url);if(sha(fs.readFileSync(snapshot.file))!==asset.sha256)throw new Error('interaction_snapshot_changed');
    const source=this.localFile(asset.sourceUrl);if(sha(fs.readFileSync(source.file))!==asset.sha256)throw new Error('interaction_track_asset_changed');
    // Re-probe explicit tracking attachments as well as legacy missing values:
    // older receipts may have saved a finite, audio-padded container duration.
    let metadata;try{metadata=await this.probe(snapshot.file);}catch{throw new Error('interaction_asset_probe_failed');}const current=this.requests.find(r=>r.id===id);if(current.state==='cancelled')return {...receipt(current,true),trackingAttached:false};const video=metadata?.streams?.find(s=>s.codec_type==='video');asset.durationSeconds=durationOf(metadata,video);
    const result=this.snapshotTrack(url,row);if(result.idempotent){if(asset.durationSeconds!==original.asset.durationSeconds)this.save(this.requests.map(r=>r.id===id?row:r));return {...receipt(row,true),trackingAttached:true};}
    const previousTracking=asset.tracking;asset.tracking=result.tracking;
    if(previousTracking)asset.trackingRevisions=[...(asset.trackingRevisions||[]),{url:previousTracking.url,sha256:previousTracking.sha256}].slice(-5);
    try{this.save(this.requests.map(r=>r.id===id?row:r));}catch{if(result.createdFile){try{fs.unlinkSync(result.createdFile);}catch{}}throw new Error('interaction_store_write_failed');}
    this.emit('interaction-tracking-updated',{id:row.id,requestId:row.requestId,preset:row.preset,tracking:structuredClone(result.tracking),rendered:false,generationSubmitted:false});return {...receipt(row),trackingAttached:true};
  }
}
