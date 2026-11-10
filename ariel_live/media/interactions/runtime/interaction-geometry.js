const finite=n=>typeof n==='number'&&Number.isFinite(n);
const point=p=>p&&finite(p.x)&&finite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function validatePointTrack(track,{detected=null,maxSamples=20000}={}){
  if(!Array.isArray(track)||track.length<1||track.length>maxSamples)throw new Error('invalid_point_track');
  let previous=-1;
  for(const row of track){if(!Array.isArray(row)||row.length!==3||!finite(row[0])||row[0]<0||row[0]<=previous||!point({x:row[1],y:row[2]}))throw new Error('invalid_point_track');previous=row[0];}
  if(detected!==null&&(!Array.isArray(detected)||detected.length!==track.length||detected.some(x=>typeof x!=='boolean')))throw new Error('invalid_detection_flags');
  return true;
}
function interval(track,time){
  if(!finite(time))throw new Error('invalid_track_time');
  if(time<=track[0][0])return {a:0,b:0,mix:0};
  const last=track.length-1;if(time>=track[last][0])return {a:last,b:last,mix:0};
  let lo=0,hi=last;
  while(hi-lo>1){const mid=(lo+hi)>>1;if(track[mid][0]===time)return {a:mid,b:mid,mix:0};if(track[mid][0]<time)lo=mid;else hi=mid;}
  return {a:lo,b:hi,mix:(time-track[lo][0])/(track[hi][0]-track[lo][0])};
}
export function samplePointTrack(track,time,{detected=null}={}){
  const {a,b,mix}=interval(track,time),left=track[a],right=track[b];
  return {x:left[1]+(right[1]-left[1])*mix,y:left[2]+(right[2]-left[2])*mix,detected:!detected||(detected[a]===true&&detected[b]===true),source:a===b?'sample':'interpolated',sampleIndices:[a,b]};
}
// Only an interior, short observed-gap may reuse an already decoded texture.
// The returned permission never changes detection flags or supplies a point.
export function canHoldUnobservedSample(detected,sampleIndices,maxFrames=0){
  if(!Number.isInteger(maxFrames)||maxFrames<1||maxFrames>2||!Array.isArray(detected))return false;
  const missing=sampleIndices.filter(i=>detected[i]===false);if(!missing.length)return false;
  let first=Math.min(...missing),last=Math.max(...missing);
  while(first>0&&detected[first-1]===false)first--;
  while(last+1<detected.length&&detected[last+1]===false)last++;
  return first>0&&last+1<detected.length&&detected[first-1]===true&&detected[last+1]===true&&last-first+1<=maxFrames;
}
export function validateWindow(window,track,{tailSeconds=0}={}){
  // A decoded final frame remains valid for its frame interval. Callers may
  // allow that interval explicitly; the default still stops at the last sample.
  if(!finite(tailSeconds)||tailSeconds<0||tailSeconds>1||!window||!finite(window.from)||!finite(window.to)||window.from<track[0][0]||window.to>track.at(-1)[0]+tailSeconds||window.to-window.from<.1)throw new Error('invalid_stable_window');
  return {from:window.from,to:window.to};
}
// For offline compositors: fade the tail into the next head, pinning each
// texture's own anchor to the SAME target. This never blends the anchor positions.
export function loopSample(elapsed,window,{seamSeconds=.12}={}){
  if(!finite(elapsed)||!window||!finite(window.from)||!finite(window.to)||window.to<=window.from)throw new Error('invalid_loop_time');
  const length=window.to-window.from,seam=clamp(seamSeconds,0,length/3),cycle=length-seam;
  const local=Math.max(0,elapsed)%cycle,time=window.from+local;
  const fading=seam>0&&local<seam&&elapsed>=cycle;
  return {time,previousTime:fading?window.to-seam+local:null,previousWeight:fading?1-local/seam:0,iteration:Math.floor(Math.max(0,elapsed)/cycle)};
}
export function anchoredRect({anchor,target,sourceWidth,sourceHeight,renderWidth,crop=null}){
  if(!point(anchor)||!target||!finite(target.x)||!finite(target.y)||![sourceWidth,sourceHeight,renderWidth].every(v=>finite(v)&&v>0))throw new Error('invalid_anchor_placement');
  const c=crop||{x:0,y:0,width:sourceWidth,height:sourceHeight};
  if(![c.x,c.y,c.width,c.height].every(finite)||c.x<0||c.y<0||c.width<=0||c.height<=0||c.x+c.width>sourceWidth||c.y+c.height>sourceHeight)throw new Error('invalid_source_crop');
  const px=anchor.x*sourceWidth,py=anchor.y*sourceHeight;
  if(px<c.x||px>c.x+c.width||py<c.y||py>c.y+c.height)throw new Error('source_crop_excludes_anchor');
  const scale=renderWidth/c.width,offsetX=(px-c.x)*scale,offsetY=(py-c.y)*scale;
  return {x:target.x-offsetX,y:target.y-offsetY,width:renderWidth,height:c.height*scale,anchorOffsetX:offsetX,anchorOffsetY:offsetY,crop:{...c}};
}
export function samplePolygonTrack(track,time){
  if(!Array.isArray(track)||!track.length)return null;
  const {a,b,mix}=interval(track,time),left=track[a][1],right=track[b][1];
  if(left.length!==right.length)throw new Error('inconsistent_occluder_vertices');
  return left.map((p,i)=>[p[0]+(right[i][0]-p[0])*mix,p[1]+(right[i][1]-p[1])*mix]);
}
export function validateMotionProfile(profile){
  if(profile?.reviewed!==true)throw new Error('awaiting_lion_motion');
  if(profile.maxUnobservedGapFrames!==undefined&&(!Number.isInteger(profile.maxUnobservedGapFrames)||profile.maxUnobservedGapFrames<0||profile.maxUnobservedGapFrames>2))throw new Error('invalid_interaction_gap_policy');
  validatePointTrack(profile.handTrack);
  if(!finite(profile.pickupTime)||!finite(profile.holdUntil)||!finite(profile.duration)||profile.pickupTime<0||profile.holdUntil<profile.pickupTime||profile.duration<=profile.holdUntil||profile.duration>120||profile.handTrack[0][0]>0||profile.handTrack.at(-1)[0]<profile.duration)throw new Error('invalid_motion_timeline');
  if(!point(profile.groundAnchor)||!finite(profile.assetScale)||profile.assetScale<=0||profile.assetScale>1.5)throw new Error('invalid_motion_geometry');
  if(profile.baseStartSeconds!==undefined&&(!finite(profile.baseStartSeconds)||profile.baseStartSeconds<0))throw new Error('invalid_motion_start');
  if(profile.repeatCount!==undefined||profile.sourceWindow!==undefined||profile.overlayStartTime!==undefined||profile.holdBaseLoop!==undefined){
    const w=profile.sourceWindow,loop=profile.holdBaseLoop;
    if(!Number.isInteger(profile.repeatCount)||profile.repeatCount<1||profile.repeatCount>8||!w||!finite(w.from)||!finite(w.to)||w.from<0||w.to-w.from<.1||w.to-w.from>30||!finite(profile.overlayStartTime)||profile.overlayStartTime<profile.pickupTime||profile.overlayStartTime>profile.holdUntil)throw new Error('invalid_source_repeat_timeline');
    if(!loop||!finite(loop.from)||!finite(loop.to)||loop.from<profile.overlayStartTime||loop.to<=loop.from||loop.to>profile.holdUntil)throw new Error('invalid_base_hold_loop');
  }
  if(profile.foregroundWindow){const w=profile.foregroundWindow;if(!finite(w.from)||!finite(w.to)||w.from<0||w.to<=w.from||w.to>profile.duration)throw new Error('invalid_foreground_window');}
  const contact=samplePointTrack(profile.handTrack,profile.pickupTime);
  if(Math.hypot(contact.x-profile.groundAnchor.x,contact.y-profile.groundAnchor.y)>.025)throw new Error('pickup_anchor_discontinuity');
  if(profile.occluderTrack){
    let previous=-1,vertices=null;
    if(!Array.isArray(profile.occluderTrack)||!profile.occluderTrack.length)throw new Error('invalid_occluder_track');
    for(const row of profile.occluderTrack){if(!Array.isArray(row)||row.length!==2||!finite(row[0])||row[0]<0||row[0]<=previous||!Array.isArray(row[1])||row[1].length<3||row[1].length>40||row[1].some(p=>!Array.isArray(p)||p.length!==2||!point({x:p[0],y:p[1]})))throw new Error('invalid_occluder_track');if(vertices!==null&&vertices!==row[1].length)throw new Error('inconsistent_occluder_vertices');previous=row[0];vertices=row[1].length;}
    if(profile.occluderTrack[0][0]>0||profile.occluderTrack.at(-1)[0]<profile.duration)throw new Error('incomplete_occluder_track');
  }
  return true;
}
