import {closeupScale,applyCloseup} from './interaction-closeup.js';
import {validatePointTrack,samplePointTrack,anchoredRect,validateWindow,validateMotionProfile,samplePolygonTrack,canHoldUnobservedSample} from './interaction-geometry.js';

const monotonic=()=>typeof performance!=='undefined'?performance.now():Date.now();
const limit=(n,a,b)=>Math.max(a,Math.min(b,n));
function buffer(width,height){
  const c=typeof OffscreenCanvas==='function'?new OffscreenCanvas(width,height):document.createElement('canvas');c.width=width;c.height=height;return c;
}
function coverRect(sw,sh,dw,dh){const scale=Math.max(dw/sw,dh/sh),width=dw/scale,height=dh/scale;return {x:(sw-width)/2,y:(sh-height)/2,width,height};}

/**
 * Transparent canvas over the existing baseVideo. Both videos are supplied and
 * already loaded by the stage. No fetch, generation, motion inference or audio.
 *
 * Profile coordinates: handTrack/groundAnchor/occluderTrack are normalized in the
 * STAGE; source track is normalized in the ORIGINAL overlay file. assetScale is
 * the rendered overlay width divided by stage width. crop is in source pixels.
 */
export class TrackedInteraction {
  constructor({canvas,baseVideo,overlayVideo,onState=()=>{},onFinish=()=>{},onOverlayComplete=()=>{},muteOverlay=true}){
    if(!canvas?.getContext||!baseVideo||!overlayVideo)throw new Error('interaction_renderer_inputs_required');
    this.canvas=canvas;this.ctx=canvas.getContext('2d');if(!this.ctx)throw new Error('interaction_canvas_unavailable');
    Object.assign(this,{baseVideo,overlayVideo,onState,onFinish,onOverlayComplete,muteOverlay});this.active=null;this.frame=0;this.destroyed=false;this.lastFrame=null;this.seam=null;this.loopPending=false;this.buffers=[];this.drawnOnce=false;
    this.tick=this.tick.bind(this);this.basePaused=()=>{if(this.active)this.overlayVideo.pause();};
    this.basePlaying=()=>{if(this.active){if(this.active.started&&!this.active.trackingBlocked&&!this.active.sourceComplete)this.beginOverlay();this.schedule();}};
    this.baseEnded=()=>{if(this.active)this.finish('base_video_ended');};
    this.baseSeeked=()=>{if(this.active){this.drawnOnce=false;this.schedule();}};
    this.mediaFailed=()=>{if(this.active)this.finish('interaction_media_failed');};
    this.overlaySeeked=()=>{if(!this.active||!this.loopPending)return;this.loopPending=false;if(this.seam)this.seam.startedAt=monotonic();if(!this.baseVideo.paused&&!this.active.trackingBlocked)this.beginOverlay();};
    baseVideo.addEventListener('pause',this.basePaused);baseVideo.addEventListener('playing',this.basePlaying);baseVideo.addEventListener('ended',this.baseEnded);baseVideo.addEventListener('seeked',this.baseSeeked);baseVideo.addEventListener('error',this.mediaFailed);overlayVideo.addEventListener('error',this.mediaFailed);overlayVideo.addEventListener('seeked',this.overlaySeeked);
    this.state={state:'idle',rendered:false,reviewed:false};this.clear();
  }
  play({id,profile,sourceTrack}){
    this.stop();
    if(this.destroyed)throw new Error('interaction_renderer_destroyed');
    try{validateMotionProfile(profile);}catch(e){this.publish({state:e.message==='awaiting_lion_motion'?'awaiting_lion_motion':'invalid_lion_motion',rendered:false,reviewed:false});throw e;}
    if(!sourceTrack||!Number.isInteger(sourceTrack.width)||!Number.isInteger(sourceTrack.height))throw new Error('interaction_source_metadata_required');
    validatePointTrack(sourceTrack.track,{detected:sourceTrack.detected??null});
    if(sourceTrack.fps!==undefined&&(!Number.isFinite(sourceTrack.fps)||sourceTrack.fps<=0||sourceTrack.fps>240))throw new Error('invalid_source_fps');
    const v=this.overlayVideo,b=this.baseVideo;
    if(v.readyState<2||b.readyState<2||v.videoWidth!==sourceTrack.width||v.videoHeight!==sourceTrack.height||!b.videoWidth||!b.videoHeight)throw new Error('interaction_media_not_ready');
    const stableWindow=validateWindow(profile.sourceWindow||profile.stableWindow||sourceTrack.stableWindow||{from:sourceTrack.track[0][0],to:sourceTrack.track.at(-1)[0]},sourceTrack.track,{tailSeconds:profile.repeatCount?1/(sourceTrack.fps||24)+.002:0});
    if(Number.isFinite(v.duration)&&stableWindow.to>v.duration+.001)throw new Error('source_track_exceeds_video');
    // Check every source sample within the loop. A crop must never clip away
    // the comb halfway through the asset, even when the first sample fits.
    const times=[stableWindow.from,stableWindow.to,...sourceTrack.track.filter(r=>r[0]>stableWindow.from&&r[0]<stableWindow.to).map(r=>r[0])];
    for(const t of times)anchoredRect({anchor:samplePointTrack(sourceTrack.track,t),target:{x:0,y:0},sourceWidth:sourceTrack.width,sourceHeight:sourceTrack.height,renderWidth:this.canvas.width*profile.assetScale,crop:profile.crop});
    this.priorMuted=v.muted;if(this.muteOverlay)v.muted=true;v.loop=false;v.pause();v.currentTime=stableWindow.from;
    this.lastFrame=null;this.seam=null;this.loopPending=false;this.buffers=[];this.drawnOnce=false;
    this.active={id:String(id||''),profile,sourceTrack,stableWindow,started:false,trackingBlocked:false,sourceComplete:false,completedRepeats:0};
    this.publish({state:'on_ground',rendered:false,reviewed:true,sourceFrameHeld:false,id:this.active.id,occlusion:profile.occluderTrack?'reviewed_polygon':'none',sourceTime:stableWindow.from});this.schedule();return this.status();
  }
  status(){return {...this.state,active:!!this.active};}
  publish(update){const previous=this.state?.state;this.state={...this.state,...update};if(previous!==this.state.state){try{this.onState(this.status());}catch{}}}
  schedule(){if(!this.frame&&this.active&&!this.destroyed&&(!this.baseVideo.paused||!this.drawnOnce))this.frame=requestAnimationFrame(this.tick);}
  beginOverlay(){
    if(!this.active||this.overlayVideo.seeking||this.active.trackingBlocked||this.active.sourceComplete||this.baseVideo.paused)return;
    const p=this.overlayVideo.play();p?.catch?.(()=>{if(this.active)this.finish('overlay_playback_failed');});
  }
  snapshot(anchor){
    const v=this.overlayVideo;if(v.seeking||v.readyState<2)return null;
    let image=this.buffers.find(c=>c!==this.seam?.image);if(!image){image=buffer(v.videoWidth,v.videoHeight);this.buffers.push(image);}const c=image.getContext('2d');c.clearRect(0,0,image.width,image.height);c.drawImage(v,0,0);return {image,anchor:{x:anchor.x,y:anchor.y,detected:anchor.detected},sourceTime:v.currentTime};
  }
  drawTexture(image,anchor,target,alpha=1){
    const a=this.active,p=a.profile,r=anchoredRect({anchor,target,sourceWidth:a.sourceTrack.width,sourceHeight:a.sourceTrack.height,renderWidth:this.canvas.width*p.assetScale,crop:p.crop}),c=this.ctx;
    c.save();c.globalAlpha=alpha;c.drawImage(image,r.crop.x,r.crop.y,r.crop.width,r.crop.height,r.x,r.y,r.width,r.height);c.restore();
  }
  foreground(time){
    const window=this.active.profile.foregroundWindow;if(window&&(time<window.from||time>window.to))return;
    const polygon=samplePolygonTrack(this.active.profile.occluderTrack,time);if(!polygon)return;
    const c=this.ctx,w=this.canvas.width,h=this.canvas.height,b=this.baseVideo,crop=coverRect(b.videoWidth,b.videoHeight,w,h);
    c.save();c.beginPath();c.moveTo(polygon[0][0]*w,polygon[0][1]*h);for(const point of polygon.slice(1))c.lineTo(point[0]*w,point[1]*h);c.closePath();c.clip();c.drawImage(b,crop.x,crop.y,crop.width,crop.height,0,0,w,h);c.restore();
  }
  tick(){
    this.frame=0;const a=this.active;if(!a||this.destroyed)return;this.drawnOnce=true;
    const p=a.profile,v=this.overlayVideo,b=this.baseVideo,time=b.currentTime-(p.baseStartSeconds||0),w=this.canvas.width,h=this.canvas.height;
    // Preserve the last aligned composite while the real base clip decodes a
    // seek. A hand target from the new timestamp must not precede its image.
    if(b.seeking){this.schedule();return;}
    if(p.holdBaseLoop&&a.started&&!a.sourceComplete&&!b.paused&&time>=p.holdBaseLoop.to){b.currentTime=(p.baseStartSeconds||0)+p.holdBaseLoop.from;this.schedule();return;}
    if(p.cameraCloseup){const elapsed=a.completedRepeats*(a.stableWindow.to-a.stableWindow.from)+Math.max(0,v.currentTime-a.stableWindow.from);const scale=closeupScale(p.cameraCloseup,{elapsed,sourceComplete:a.sourceComplete,time});applyCloseup([b,this.canvas],p.cameraCloseup,scale);this.canvas.dataset&&(this.canvas.dataset.zoom=String(scale));}
    this.clear();if(time>=p.duration){this.finish('finished');return;}
    if(time<0){this.schedule();return;}
    const onGround=time<p.pickupTime,hand=onGround?p.groundAnchor:samplePointTrack(p.handTrack,time),target={x:hand.x*w,y:hand.y*h};
    const sourceStart=p.overlayStartTime??p.pickupTime;
    if(time>=sourceStart&&!a.started){a.started=true;this.beginOverlay();}
    if(this.baseVideo.paused)v.pause();
    if(!a.started){v.pause();if(Math.abs(v.currentTime-a.stableWindow.from)>.025&&!v.seeking)v.currentTime=a.stableWindow.from;}
    let sourceTime=limit(v.currentTime,a.stableWindow.from,a.stableWindow.to),anchor=samplePointTrack(a.sourceTrack.track,sourceTime,{detected:a.sourceTrack.detected??null});
    if(!anchor.detected&&!a.trackingBlocked&&this.lastFrame?.anchor.detected&&canHoldUnobservedSample(a.sourceTrack.detected,anchor.sampleIndices,p.maxUnobservedGapFrames)){
      // Keep the source clock (and audio) running. Reuse only the last observed
      // decoded frame, pinned to the current paw, until the crest reappears.
      this.seam=null;this.drawTexture(this.lastFrame.image,this.lastFrame.anchor,target);this.foreground(time);
      this.publish({state:onGround?'on_ground':time<=p.holdUntil?'holding':'lowering',rendered:true,anchorObserved:false,sourceFrameHeld:true,sourceTime,target:{...target}});
      this.schedule();return;
    }
    if(!anchor.detected&&!a.trackingBlocked){a.trackingBlocked=true;v.pause();this.publish({state:'tracking_review_required',anchorObserved:false,rendered:!!this.lastFrame});if(this.active!==a)return;}
    if(a.trackingBlocked){if(this.lastFrame)this.drawTexture(this.lastFrame.image,this.lastFrame.anchor,target);this.foreground(time);this.schedule();return;}
    const frameDuration=1/(a.sourceTrack.fps||24);
    const endThreshold=p.repeatCount?a.stableWindow.to-.002:a.stableWindow.to-frameDuration;
    if(a.started&&!a.sourceComplete&&!this.loopPending&&!v.seeking&&(v.currentTime>=endThreshold||v.ended)){
      const previous=this.snapshot(anchor);if(previous){this.seam=p.repeatCount?null:{...previous,startedAt:null};this.lastFrame=previous;}
      if(p.repeatCount&&++a.completedRepeats>=p.repeatCount){
        a.sourceComplete=true;v.pause();this.seam=null;
        this.publish({sourceCompletedRepeats:a.completedRepeats,sourceRepeatCount:p.repeatCount,baseLoopReleased:true});
        try{this.onOverlayComplete({id:a.id,repeatCount:a.completedRepeats});}catch{}
        if(this.active!==a)return;
      }else{this.loopPending=true;v.pause();v.currentTime=a.stableWindow.from;}
    }
    if(v.seeking||this.loopPending){if(this.lastFrame)this.drawTexture(this.lastFrame.image,this.lastFrame.anchor,target);}
    else{
      sourceTime=limit(v.currentTime,a.stableWindow.from,a.stableWindow.to);anchor=samplePointTrack(a.sourceTrack.track,sourceTime,{detected:a.sourceTrack.detected??null});
      const oldWeight=this.seam?.startedAt!=null?Math.max(0,1-(monotonic()-this.seam.startedAt)/120):0;
      if(oldWeight>0)this.drawTexture(this.seam.image,this.seam.anchor,target,oldWeight);else this.seam=null;
      this.drawTexture(v,anchor,target,1-oldWeight);this.lastFrame=this.snapshot(anchor);
      this.publish({state:onGround?'on_ground':time<=p.holdUntil?'holding':'lowering',rendered:true,anchorObserved:true,sourceFrameHeld:false,sourceTime,target:{...target}});
    }
    if(this.active!==a)return;this.foreground(time);this.schedule();
  }
  clear(){const c=this.ctx;c.setTransform(1,0,0,1,0,0);c.globalAlpha=1;c.globalCompositeOperation='source-over';c.clearRect(0,0,this.canvas.width,this.canvas.height);}
  finish(reason){if(!this.active)return;const id=this.active.id;this.stop(reason);try{this.onFinish({id,reason});}catch{}}
  stop(reason='stopped'){
    if(this.frame){cancelAnimationFrame(this.frame);this.frame=0;}this.overlayVideo.pause();if(this.active?.profile.cameraCloseup)applyCloseup([this.baseVideo,this.canvas],this.active.profile.cameraCloseup,1);if(this.priorMuted!==undefined)this.overlayVideo.muted=this.priorMuted;this.priorMuted=undefined;this.active=null;this.lastFrame=null;this.seam=null;this.loopPending=false;this.buffers=[];this.clear();this.publish({state:reason==='stopped'?'idle':reason,rendered:false,reviewed:false});
  }
  destroy(){if(this.destroyed)return;this.stop();this.destroyed=true;this.baseVideo.removeEventListener('pause',this.basePaused);this.baseVideo.removeEventListener('playing',this.basePlaying);this.baseVideo.removeEventListener('ended',this.baseEnded);this.baseVideo.removeEventListener('seeked',this.baseSeeked);this.baseVideo.removeEventListener('error',this.mediaFailed);this.overlayVideo.removeEventListener('error',this.mediaFailed);this.overlayVideo.removeEventListener('seeked',this.overlaySeeked);}
}
