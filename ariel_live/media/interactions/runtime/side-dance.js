export function validateSideDance(p){
 if(p?.version!==1||p.kind!=='side_dance'||p.reviewed!==true||!Number.isFinite(p.duration)||p.duration<1||p.duration>60||p.place?.x!==.2||p.place?.y!==.78||p.place?.width!==.42||p.fadeIn!==.4||p.fadeOut!==.6)throw new Error('invalid_side_dance_profile');
 return p;
}
export function dancerRect(p,t,w,h,sw,sh){
 validateSideDance(p);if(![t,w,h,sw,sh].every(Number.isFinite)||w<=0||h<=0||sw<=0||sh<=0)throw new Error('invalid_side_dance_geometry');
 const width=w*p.place.width,height=width*sh/sw;
 return {x:w*p.place.x-width/2,y:h*p.place.y-height,width,height,alpha:Math.max(0,Math.min(1,t/p.fadeIn,(p.duration-t)/p.fadeOut))};
}
// Independent foreground layer; the existing stage owns lion motion and audio.
export class SideDance {
 constructor({canvas,baseVideo,overlayVideo,onState=()=>{},onFinish=()=>{},muteOverlay=true}){
  Object.assign(this,{canvas,baseVideo,overlayVideo,onState,onFinish,muteOverlay});this.ctx=canvas.getContext('2d');this.active=null;this.frame=0;
  this.draw=this.draw.bind(this);this.paused=()=>overlayVideo.pause();this.playing=()=>{if(this.active){this.startSource();this.schedule();}};this.ended=()=>this.finish('base_video_ended');this.failed=()=>this.finish('interaction_media_failed');
  baseVideo.addEventListener('pause',this.paused);baseVideo.addEventListener('playing',this.playing);baseVideo.addEventListener('ended',this.ended);baseVideo.addEventListener('error',this.failed);overlayVideo.addEventListener('error',this.failed);
 }
 validateProfile(profile){return validateSideDance(profile);}
 rectangle(profile,time,w,h,sw,sh){return dancerRect(profile,time,w,h,sw,sh);}
 play({id,profile,sourceTrack}){
  this.stop();this.validateProfile(profile);this.sourceStopped=false;const v=this.overlayVideo;
  if(v.readyState<2||this.baseVideo.readyState<2||v.videoWidth!==sourceTrack?.width||v.videoHeight!==sourceTrack?.height)throw new Error('interaction_media_not_ready');
  this.priorMuted=v.muted;this.priorLoop=v.loop;v.muted=this.muteOverlay;v.volume=.9;v.loop=true;v.currentTime=0;this.active={id,profile};this.onState({state:'dancing',rendered:false});if(!this.baseVideo.paused)this.startSource();this.schedule();
 }
 startSource(){if(this.sourceStopped)return;this.overlayVideo.play()?.catch(()=>{if(this.active)this.finish('overlay_playback_failed');});}
 schedule(){if(this.active&&!this.frame)this.frame=requestAnimationFrame(this.draw);}
 draw(){
  this.frame=0;if(!this.active)return;const b=this.baseVideo,v=this.overlayVideo,p=this.active.profile,t=b.currentTime;
  if(t>=p.duration||b.ended){this.finish('finished');return;}
  const r=this.rectangle(p,t,this.canvas.width,this.canvas.height,v.videoWidth,v.videoHeight);this.clear();if(r.visible!==false){this.ctx.save();this.ctx.globalAlpha=r.alpha;if(r.rotation){this.ctx.translate(r.pivotX,r.pivotY);this.ctx.rotate(r.rotation);this.ctx.drawImage(v,-r.width/2,-r.height,r.width,r.height);}else this.ctx.drawImage(v,r.x,r.y,r.width,r.height);this.ctx.restore();}else if(r.stopSource){this.sourceStopped=true;v.pause();}this.onState({state:r.state||'dancing',rendered:true,sourceTime:v.currentTime});
  if(b.paused)v.pause();else this.schedule();
 }
 clear(){this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);}
 stop(){if(this.frame)cancelAnimationFrame(this.frame);this.frame=0;this.active=null;this.overlayVideo.pause();if(this.priorMuted!==undefined)this.overlayVideo.muted=this.priorMuted;if(this.priorLoop!==undefined)this.overlayVideo.loop=this.priorLoop;this.clear();}
 finish(reason){if(!this.active)return;const id=this.active.id;this.stop();this.onFinish({reason,id});}
 destroy(){this.stop();const b=this.baseVideo;b.removeEventListener('pause',this.paused);b.removeEventListener('playing',this.playing);b.removeEventListener('ended',this.ended);b.removeEventListener('error',this.failed);this.overlayVideo.removeEventListener('error',this.failed);}
}
