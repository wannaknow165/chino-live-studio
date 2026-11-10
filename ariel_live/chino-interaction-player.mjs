import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run=promisify(execFile);
async function probeMedia(file){const {stdout}=await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{windowsHide:true,timeout:15000,maxBuffer:1024*1024});return JSON.parse(stdout);}
async function muxAudio({video,source,output}){await run('ffmpeg',['-v','error','-nostdin','-n','-i',video,'-i',source,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','libopus','-metadata:s:v:0','alpha_mode=1','-shortest',output],{windowsHide:true,timeout:45000,maxBuffer:1024*1024});}
async function recoverTracking({root,helper,basename,output}){const args=[helper,basename,'comb','--out',output],options={cwd:root,windowsHide:true,timeout:60000,maxBuffer:1024*1024};let response;try{response=await run('python',args,options);}catch(e){if(e.code!=='ENOENT')throw e;response=await run('py',['-3.13',...args],options);}let result;try{result=JSON.parse(response.stdout.trim().split(/\r?\n/).at(-1));}catch{}if(result?.ok!==true)throw new Error('interaction_local_tracking_failed');}
const mediaDuration=(metadata,stream)=>{for(const raw of [stream?.duration,metadata?.format?.duration]){const n=Number(raw);if(Number.isFinite(n)&&n>0)return n;}return null;};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const pending=new Set(['preparing_tracking','preparing_audio','queued','playing']);
// Effects use the existing director/output owner. No provider, generation, new
// player, or arbitrary catalog entry is created by this coordinator.
export class ChinoInteractionPlayer {
  constructor({root,interactions,director,emit=()=>{},now=Date.now,probe=probeMedia,convertAudio=muxAudio,retrack=recoverTracking}){
    Object.assign(this,{root:fs.realpathSync(root),interactions,director,emit,now,probe,convertAudio,retrack});
    this.active=null;this.ticking=false;this.audioInflight=new Map();this.trackingInflight=new Map();
    const rows=interactions.requests.map(row=>pending.has(row.playback?.state)?{...row,state:'failed',playback:{...row.playback,state:'failed',reason:'interaction_restart_interrupted',finishedAt:now()}}:row);
    if(rows.some((row,i)=>row!==interactions.requests[i]))interactions.save(rows);
  }
  row(id){const row=this.interactions.requests.find(r=>r.id===id||r.requestId===id);if(!row)throw new Error('interaction_request_not_found');return row;}
  update(id,state,extra={}){
    const original=this.row(id);if(original.state==='cancelled')return original;const row={...original,state,playback:{...original.playback,state,...extra},rendered:extra.rendered===true||original.rendered===true};
    this.interactions.save(this.interactions.requests.map(r=>r.id===id?row:r));
    this.emit('interaction-playback',{id:row.id,requestId:row.requestId,state,rendered:row.rendered,generationSubmitted:false,...extra});return row;
  }
  response(row){return {queued:row.playback?.state==='queued',state:row.state,rendered:row.rendered===true,generationSubmitted:false,audioRestored:row.asset.playback?.audio===true,...(row.asset.trackingQuality?{trackingQuality:structuredClone(row.asset.trackingQuality)}:{}),...(row.asset.audioStatus?{audioStatus:structuredClone(row.asset.audioStatus)}:{}),...(row.playback?{playback:structuredClone(row.playback)}:{})};}
  saveAsset(id,changes){const row=this.row(id);if(row.state==='cancelled')return row;const next={...row,asset:{...row.asset,...changes}};this.interactions.save(this.interactions.requests.map(r=>r.id===id?next:r));return next;}
  audioSource(row){
    const basename=path.posix.basename(row.asset.sourceUrl).replace(/\.webm$/,'.mp4');if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}\.mp4$/.test(basename)||basename.includes('..'))throw new Error('invalid_interaction_audio_source');
    const base=path.resolve(this.root,'data','ovsrc')+path.sep;let file;try{file=fs.realpathSync(path.join(base,basename));}catch(e){if(e.code==='ENOENT')return null;throw new Error('interaction_audio_source_unavailable');}
    const stat=fs.statSync(file);if(!file.toLowerCase().startsWith(base.toLowerCase())||!stat.isFile()||stat.size>250*1024*1024)throw new Error('invalid_interaction_audio_source');
    return {file,stat,sha256:sha(fs.readFileSync(file))};
  }
  validatePlaybackAsset(row){
    const playback=row.asset.playback;if(!playback)return;
    const file=this.mediaFile(playback.url,/^\/media\/interactions\/incoming\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}\.audio\.webm$/);
    if(playback.audio!==true||playback.originalVideoSha256!==row.asset.sha256||!digest(playback.sha256)||!digest(playback.sourceAudioSha256)||sha(fs.readFileSync(file))!==playback.sha256)throw new Error('interaction_audio_snapshot_changed');
  }
  beginAudio(row){
    if(this.audioInflight.has(row.id))return true;
    let source;try{source=this.audioSource(row);}catch(e){this.saveAsset(row.id,{playback:undefined,audioStatus:{state:'unavailable',reason:e.message}});return false;}
    if(!source){this.saveAsset(row.id,{playback:undefined,audioStatus:{state:'unavailable',reason:'interaction_original_audio_missing'}});return false;}
    if(row.asset.playback?.sourceAudioSha256===source.sha256){this.validatePlaybackAsset(row);return false;}
    if(row.asset.audioStatus?.state==='unavailable'&&row.asset.audioStatus.sourceSha256===source.sha256)return false;
    // A verified derivative can be shared only by byte-identical transparent
    // video and the identical original sound container, never by face or name.
    for(const other of this.interactions.requests){if(other.id===row.id||other.asset?.sha256!==row.asset.sha256||other.asset.playback?.sourceAudioSha256!==source.sha256)continue;try{this.validatePlaybackAsset(other);this.saveAsset(row.id,{playback:structuredClone(other.asset.playback),audioStatus:{state:'restored',reusedFrom:other.id}});return false;}catch{}}
    this.update(row.id,'preparing_audio',{reason:''});
    const promise=Promise.resolve().then(()=>this.restoreAudio(row.id,source)).catch(e=>{let checkedSha=source.sha256;try{checkedSha=this.audioSource(this.row(row.id))?.sha256||checkedSha;}catch{}this.saveAsset(row.id,{playback:undefined,audioStatus:{state:'unavailable',reason:/^[a-z0-9_]+$/.test(e.message)?e.message:'interaction_audio_restore_failed',sourceSha256:checkedSha}});}).finally(()=>{this.audioInflight.delete(row.id);try{this.enqueue(row.id);}catch(e){this.update(row.id,'failed',{reason:/^[a-z0-9_]+$/.test(e.message)?e.message:'interaction_audio_queue_failed',finishedAt:this.now()});}});
    this.audioInflight.set(row.id,promise);return true;
  }
  async restoreAudio(id,source){
    const row=this.row(id),tolerance=1/row.asset.tracking.fps+.05,metadata=await this.probe(source.file),audio=metadata?.streams?.find(s=>s.codec_type==='audio');
    if(!audio||audio.codec_name!=='aac'||Math.abs((mediaDuration(metadata,audio)||Infinity)-row.asset.durationSeconds)>tolerance)throw new Error('interaction_original_audio_mismatch');
    const url='/media/interactions/incoming/'+randomUUID()+'.audio.webm',output=path.join(this.root,url.slice(1)),video=this.mediaFile(row.asset.url,/^\/media\/interactions\/incoming\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}\.webm$/);
    try{
      await this.convertAudio({video,source:source.file,output});
      const result=await this.probe(output),v=result?.streams?.find(s=>s.codec_type==='video'),a=result?.streams?.find(s=>s.codec_type==='audio');
      if(!v||!a||a.codec_name!=='opus'||v.width!==row.asset.width||v.height!==row.asset.height||String(v.tags?.alpha_mode??v.tags?.ALPHA_MODE??'')!=='1'||Math.abs((mediaDuration(result,v)||Infinity)-row.asset.durationSeconds)>tolerance)throw new Error('interaction_audio_output_invalid');
      const after=fs.statSync(source.file);if(after.size!==source.stat.size||after.mtimeMs!==source.stat.mtimeMs||sha(fs.readFileSync(source.file))!==source.sha256)throw new Error('interaction_audio_source_changed');
      this.validateAssets(this.row(id));const stat=fs.statSync(output);if(stat.size>250*1024*1024)throw new Error('interaction_audio_output_too_large');
      this.saveAsset(id,{playback:{url,sha256:sha(fs.readFileSync(output)),originalVideoSha256:row.asset.sha256,sourceAudioSha256:source.sha256,audio:true,audioCodec:'opus',durationSeconds:mediaDuration(result,v)},audioStatus:{state:'restored'}});
    }catch(e){try{fs.unlinkSync(output);}catch{}throw e;}
  }
  mediaFile(url,pattern){
    if(typeof url!=='string'||!pattern.test(url)||url.includes('..'))throw new Error('invalid_interaction_scene_path');
    let file;try{file=fs.realpathSync(path.resolve(this.root,url.slice(1)));}catch{throw new Error('interaction_scene_asset_missing');}
    const base=path.resolve(this.root,'media')+path.sep;
    if(!file.toLowerCase().startsWith(base.toLowerCase())||!fs.statSync(file).isFile())throw new Error('invalid_interaction_scene_path');return file;
  }
  readTemplate(row){
    const templateNames={tiny_on_paw:'tiny_on_paw',baby_bottle_feed:'baby_bottle_feed',chicken_blow:'chicken_blow',dancer_side_dance:'dancer_side_dance',chicken_comb_hold:'chicken_comb_hold',dancer_hand_hold:'dancer_hand_hold'};
    if(!Object.hasOwn(templateNames,row.preset))throw new Error('interaction_motion_unavailable');
    const url='/media/interactions/templates/'+templateNames[row.preset]+'.json';
    let template;try{const file=this.mediaFile(url,/^\/media\/interactions\/templates\/(?:tiny_on_paw|baby_bottle_feed|chicken_comb_hold|dancer_hand_hold|dancer_side_dance|chicken_blow)\.json$/);if(fs.statSync(file).size>1024*1024)throw new Error();template=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new Error('interaction_motion_unavailable');}
    if(template.version!==1||template.preset!==row.preset||template.enabled!==true||template.approvedForIntegratedOutput!==true||template.approvalScope!=='operator_approved_output')throw new Error('interaction_motion_not_approved');
    const p=template.profile;
    if(['dancer_side_dance','chicken_blow'].includes(row.preset)){
      const p=template.profile;if(p?.version!==1||p.reviewed!==true||p.sourceFile!==path.posix.basename(template.baseVideoUrl||'')||!Number.isFinite(p.duration)||p.duration<1||p.duration>60)throw new Error('invalid_interaction_motion_profile');if(row.preset==='dancer_side_dance'?(p.kind!=='side_dance'||p.place?.x!==.20||p.place?.y!==.78||p.place?.width!==.42||p.fadeIn!==.4||p.fadeOut!==.6):(p.kind!=='chicken_blow'||p.duration!==6||p.blowAt!==2.8||p.exitAt!==3.8||p.enterFrom!==.4||p.standAt!==2||p.groundY!==.65||p.standX!==.22||p.width!==.28))throw new Error('invalid_interaction_motion_profile');
      const f=this.mediaFile(template.baseVideoUrl,/^\/media\/(?:dance|generated)\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}\.mp4$/);if(!digest(template.baseVideoSha256)||sha(fs.readFileSync(f))!==template.baseVideoSha256)throw new Error('interaction_motion_changed');return template;
    }
    if(!p||p.version!==1||p.reviewed!==true||p.sourceFile!==path.posix.basename(template.baseVideoUrl||'')||!Number.isFinite(p.duration)||p.duration<=0||p.duration>60||!Number.isFinite(p.overlayStartTime)||p.overlayStartTime<0||!p.holdBaseLoop||!Number.isFinite(p.holdBaseLoop.from)||!Number.isFinite(p.holdBaseLoop.to)||p.holdBaseLoop.from<p.overlayStartTime||p.holdBaseLoop.to<=p.holdBaseLoop.from||p.holdBaseLoop.to>=p.duration||!Array.isArray(p.handTrack)||!Array.isArray(p.occluderTrack))throw new Error('invalid_interaction_motion_profile');
    const baseFile=this.mediaFile(template.baseVideoUrl,/^\/media\/generated\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}\.mp4$/);
    if(!digest(template.baseVideoSha256)||sha(fs.readFileSync(baseFile))!==template.baseVideoSha256)throw new Error('interaction_motion_changed');return template;
  }
  validateAssets(row,policy=this.readTemplate(row).profile){
    const asset=row.asset,tracking=asset?.tracking;
    if(row.preset==='tiny_on_paw'){const p=asset?.placement;if(!asset?.alpha||!digest(asset.sha256)||!p||p.sourceSha256!==asset.sha256||p.method!=='observed_alpha_feet'||p.width!==asset.width||p.height!==asset.height)throw new Error('interaction_foot_placement_required');const file=this.mediaFile(asset.url,/^\/media\/interactions\/incoming\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}\.webm$/);if(sha(fs.readFileSync(file))!==asset.sha256)throw new Error('interaction_snapshot_changed');const checked=this.interactions.validateTrack({...p,file:path.posix.basename(asset.sourceUrl)},row);if(!checked.detected||checked.detected.some(x=>!x)||checked.track[0][0]>.001||checked.track.at(-1)[0]+1/checked.fps+.002<asset.durationSeconds)throw new Error('interaction_tracking_review_required');return {...checked,quality:{trackingRequired:false,placementMethod:p.method}};}
    if(['dancer_side_dance','chicken_blow'].includes(row.preset)){
      if(!asset?.alpha||!digest(asset.sha256)||!Number.isFinite(asset.durationSeconds)||asset.durationSeconds<=0||asset.durationSeconds>30)throw new Error('interaction_asset_invalid_video');
      const f=this.mediaFile(asset.url,/^\/media\/interactions\/incoming\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}\.webm$/);if(sha(fs.readFileSync(f))!==asset.sha256)throw new Error('interaction_snapshot_changed');return {quality:{trackingRequired:false}};
    }
    if(!asset?.alpha||!digest(asset.sha256)||!Number.isFinite(asset.durationSeconds)||asset.durationSeconds<=0||asset.durationSeconds>30||!tracking||!digest(tracking.sha256))throw new Error('interaction_tracking_required');
    const overlayFile=this.mediaFile(asset.url,/^\/media\/interactions\/incoming\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}\.webm$/);
    const trackFile=this.mediaFile(tracking.url,/^\/media\/interactions\/incoming\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}\.(?:grab|hand|feed)\.json$/);
    if(sha(fs.readFileSync(overlayFile))!==asset.sha256||fs.statSync(trackFile).size>1024*1024||sha(fs.readFileSync(trackFile))!==tracking.sha256)throw new Error('interaction_snapshot_changed');
    let raw;try{raw=JSON.parse(fs.readFileSync(trackFile,'utf8'));}catch{throw new Error('invalid_interaction_track_json');}
    const validated=this.interactions.validateTrack(raw,row);
    if(validated.pointKind!=={chicken_comb_hold:'grabPoint',dancer_hand_hold:'handPoint',baby_bottle_feed:'feedPoint'}[row.preset]||validated.track[0][0]>.001||validated.track.at(-1)[0]+1/validated.fps+.002<asset.durationSeconds)throw new Error('interaction_full_tracking_required');
    // A trusted renderer policy may hold the last observed texture for a tiny
    // bounded occlusion. Keep false flags and inferred coordinates untouched.
    const limit=policy.maxUnobservedGapFrames??0;if(!Number.isInteger(limit)||limit<0||limit>2)throw new Error('invalid_interaction_gap_policy');
    if(!validated.detected)throw new Error('interaction_tracking_review_required');let gapFrames=0,gapRuns=0;
    for(let i=0;i<validated.detected.length;i++){if(validated.detected[i])continue;const start=i;while(i<validated.detected.length&&!validated.detected[i])i++;const length=i-start;if(start===0||i===validated.detected.length||length>limit)throw new Error('interaction_tracking_review_required');gapFrames+=length;gapRuns++;}
    validated.quality={shortGapsHeld:gapFrames,shortGapRuns:gapRuns,maxUnobservedGapFrames:limit};
    this.validatePlaybackAsset(row);
    return validated;
  }
  prepare(row){
    const template=this.readTemplate(row),tracking=this.validateAssets(row,template.profile);
    if(['dancer_side_dance','chicken_blow'].includes(row.preset))return {template,profile:structuredClone(template.profile),expectedDuration:template.profile.duration,trackingQuality:tracking.quality};
    const profile={...structuredClone(template.profile),sourceWindow:{from:0,to:row.asset.durationSeconds},repeatCount:2};
    const loop=profile.holdBaseLoop,sourceDuration=row.asset.durationSeconds*2;
    const expectedDuration=profile.duration+Math.ceil(Math.max(0,sourceDuration-(loop.to-profile.overlayStartTime))/(loop.to-loop.from))*(loop.to-loop.from);
    if(!Number.isFinite(expectedDuration)||expectedDuration>90)throw new Error('interaction_duration_too_long');
    return {template,profile,expectedDuration,trackingQuality:tracking.quality};
  }
  reuseReviewedTracking(row){
    for(const other of this.interactions.requests){
      if(other.id===row.id||other.preset!==row.preset||other.asset?.sha256!==row.asset.sha256||other.asset.width!==row.asset.width||other.asset.height!==row.asset.height||path.posix.basename(other.asset.sourceUrl)!==path.posix.basename(row.asset.sourceUrl)||!other.asset.tracking)continue;
      const revised={...row,asset:{...row.asset,tracking:structuredClone(other.asset.tracking),trackingReusedFrom:other.id}};
      try{this.validateAssets(revised);}catch{continue;}
      this.interactions.save(this.interactions.requests.map(r=>r.id===row.id?revised:r));return revised;
    }
    return row;
  }
  beginTrackingRecovery(row){
    if(row.preset!=='chicken_comb_hold')return false;
    let source,helper,helperSha,basename;
    try{
      basename=path.posix.basename(row.asset.sourceUrl).replace(/\.webm$/,'');if(!/^[a-zA-Z0-9_-]{1,180}$/.test(basename)||row.asset.sourceUrl!=='/media/overlays/'+basename+'.webm')return false;
      source=this.interactions.localFile(row.asset.sourceUrl);if(sha(fs.readFileSync(source.file))!==row.asset.sha256)throw new Error('interaction_track_asset_changed');
      helper=fs.realpathSync(path.join(this.root,'tools','chino_anchor.py'));if(helper.toLowerCase()!==path.join(this.root,'tools','chino_anchor.py').toLowerCase())throw new Error('invalid_interaction_tracking_helper');helperSha=sha(fs.readFileSync(helper));
    }catch(e){if(e.message==='interaction_track_asset_changed')this.saveAsset(row.id,{trackingRecovery:{state:'failed',reason:e.message}});return false;}
    const key=row.asset.sha256+':'+helperSha,running=this.trackingInflight.get(key),attempted=this.interactions.requests.some(r=>r.state!=='cancelled'&&r.asset.trackingRecovery?.state!=='waiting'&&r.asset.trackingRecovery?.key===key);
    if(!running&&attempted)return false;
    this.saveAsset(row.id,{trackingRecovery:{key,helperSha256:helperSha,assetSha256:row.asset.sha256,attemptedAt:this.now(),state:running?'waiting':'running'}});this.update(row.id,'preparing_tracking',{reason:''});
    if(running)return true;
    const outputUrl='/media/interactions/incoming/'+randomUUID()+'.grab.json',output=path.join(this.root,outputUrl.slice(1));
    const promise=Promise.resolve().then(async()=>{
      await this.retrack({root:this.root,helper,basename,output});
      const after=fs.statSync(source.file);if(after.size!==source.stat.size||after.mtimeMs!==source.stat.mtimeMs||sha(fs.readFileSync(source.file))!==row.asset.sha256)throw new Error('interaction_track_asset_changed');
      if(this.row(row.id).state==='cancelled')return;
      await this.interactions.attachTracking({id:row.id,trackUrl:outputUrl});this.validateAssets(this.row(row.id));
      this.saveAsset(row.id,{trackingRecovery:{...this.row(row.id).asset.trackingRecovery,state:'completed',outputUrl,finishedAt:this.now()}});
    }).catch(e=>{this.saveAsset(row.id,{trackingRecovery:{...this.row(row.id).asset.trackingRecovery,state:'failed',outputUrl,reason:/^[a-z0-9_]+$/.test(e.message)?e.message:'interaction_local_tracking_failed',finishedAt:this.now()}});}).finally(()=>{
      this.trackingInflight.delete(key);
      for(const waiting of this.interactions.requests.filter(r=>r.state==='preparing_tracking'&&r.asset.trackingRecovery?.key===key)){try{this.enqueue(waiting.id);}catch{this.update(waiting.id,'awaiting_review',{reason:'interaction_tracking_queue_failed'});}}
    });
    this.trackingInflight.set(key,promise);return true;
  }
  clearPending(){
    // Leave the current effect running; cancel only queued and waiting work.
    const states=new Set(['awaiting_lion_motion','needs_anchor','awaiting_review','preparing_tracking','preparing_audio','queued']);
    const ids=this.interactions.requests.filter(r=>r.id!==this.active?.id&&states.has(r.state)).map(r=>r.id);
    for(const id of ids)this.update(id,'cancelled',{reason:'operator_cleared',finishedAt:this.now()});
    return {cleared:ids.length,activePreserved:!!this.active,requestIds:ids.map(id=>this.row(id).requestId)};
  }
  enqueue(id){
    let row=this.row(id);
    // Retry of a sender request is an observation, never another playback.
    if(row.playback&&['queued','playing','completed','failed','cancelled'].includes(row.playback.state))return this.response(row);
    let prepared;
    try{prepared=this.prepare(row);}catch(e){
      if(['interaction_tracking_review_required','interaction_tracking_required'].includes(e.message)){
        row=this.reuseReviewedTracking(row);try{prepared=this.prepare(row);}catch{}
        if(!prepared&&this.beginTrackingRecovery(row))return this.response(this.row(row.id));
      }
      if(!prepared){
      const state=e.message==='interaction_tracking_review_required'?'awaiting_review':'awaiting_lion_motion';
      row=this.update(row.id,state,{reason:this.row(row.id).asset.trackingRecovery?.reason||e.message});return this.response(row);
      }
    }
    if(this.interactions.requests.filter(r=>['preparing_audio','queued'].includes(r.playback?.state)&&r.id!==row.id).length>=10){row=this.update(row.id,'awaiting_lion_motion',{reason:'interaction_queue_full'});return this.response(row);}
    row=this.saveAsset(row.id,{trackingQuality:prepared.trackingQuality});
    if(!['tiny_on_paw','dancer_side_dance','chicken_blow'].includes(row.preset)&&this.beginAudio(row))return this.response(this.row(row.id));row=this.row(row.id);
    const overlay=row.asset.playback||row.asset;
    const scene={version:1,id:row.id,requestId:row.requestId,preset:row.preset,approvalScope:'operator_approved_output',approvedForIntegratedOutput:true,publicApproved:prepared.template.publicApproved===true,baseVideoUrl:prepared.template.baseVideoUrl,baseVideoSha256:prepared.template.baseVideoSha256,overlayVideoUrl:overlay.url,overlaySha256:overlay.sha256,sourceTrackUrl:row.asset.tracking?.url,sourceTrackSha256:row.asset.tracking?.sha256,sourceMetadata:{width:row.asset.width,height:row.asset.height,durationSeconds:row.asset.durationSeconds,...(row.preset==='tiny_on_paw'?row.asset.placement:{})},trackingQuality:prepared.trackingQuality,participant:{...row.participant},profile:prepared.profile};
    const sceneUrl='/media/interactions/scenes/'+row.id+'.json',filename=path.join(this.root,sceneUrl.slice(1));
    fs.mkdirSync(path.dirname(filename),{recursive:true});const bytes=JSON.stringify(scene,null,2);fs.writeFileSync(filename+'.tmp',bytes);fs.renameSync(filename+'.tmp',filename);
    row=this.update(row.id,'queued',{sceneUrl,sceneSha256:sha(bytes),expectedDuration:prepared.expectedDuration,queuedAt:this.now(),reason:''});
    return this.response(row);
  }
  tick(){
    if(this.ticking||this.active)return;this.ticking=true;
    try{
      const d=this.director;if(!d.stageReady()||!d.canSpeak()||d.active||d.busy||d.otherSpeaking||d.muted||d.externalClip||d.showHoldUntil>this.now()||d.queue?.length)return;
      const row=this.interactions.requests.find(r=>r.playback?.state==='queued');if(!row)return;
      try{
        this.prepare(row);const sceneFile=this.mediaFile(row.playback.sceneUrl,/^\/media\/interactions\/scenes\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}\.json$/);
        if(sha(fs.readFileSync(sceneFile))!==row.playback.sceneSha256)throw new Error('interaction_scene_changed');
        const scene=JSON.parse(fs.readFileSync(sceneFile,'utf8'));
        const event={id:randomUUID(),type:'audience',text:'',uid:row.participant.id,room:d.room,t:this.now(),source:'operator_interaction',language:'he'};
        d.play({id:'interaction:'+row.id,text:'',file:scene.baseVideoUrl},event,{interactionScene:row.playback.sceneUrl,repeatCount:2,expectedDuration:row.playback.expectedDuration});
        this.active={id:row.id,playId:d.active.playId,stageId:d.active.stageId};this.update(row.id,'queued',{playId:this.active.playId,stageId:this.active.stageId,sentAt:this.now()});
      }catch(e){this.update(row.id,'failed',{reason:/^[a-z0-9_]+$/.test(e.message)?e.message:'interaction_play_failed',finishedAt:this.now()});}
    }finally{this.ticking=false;}
  }
  observe(type,data){
    const active=this.active;if(!active||data.playId!==active.playId)return;
    if(type==='director-cancel'){this.update(active.id,'failed',{reason:data.reason||'interaction_cancelled',finishedAt:this.now()});this.active=null;return;}
    if(type!=='director-playback'||data.stageId!==active.stageId)return;
    if(data.state==='started')this.update(active.id,'playing',{startedAt:this.now(),rendered:true});
    else if(data.state==='ended'&&this.row(active.id).playback.state==='playing'){this.update(active.id,'completed',{finishedAt:this.now()});this.active=null;}
    else if(['failed','interrupted'].includes(data.state)){this.update(active.id,'failed',{reason:'interaction_renderer_'+data.state,finishedAt:this.now()});this.active=null;}
  }
}
