import {TrackedInteraction} from './tracked-interaction.js';
import {validateMotionProfile,validatePointTrack} from './interaction-geometry.js';

const SCENE='/media/interactions/scenes/chicken-ahmadmardwi-mw9fsfu1-001.json';
const $=id=>document.getElementById(id),base=$('base'),overlay=$('overlay'),canvas=$('composite'),finished=$('finished');
let scene=null,sourceTrack=null,renderer=null,epoch=0,playing=false,loading=false,watch=0,hasLastFrame=false,hasPlayed=false;
const messages={
  on_ground:'בודקים את נקודת ההתחלה ואת הצמדת הכרבולת לכף.',
  holding:'צ׳ינו אוחז בכרבולת ומרים את התרנגולת.',
  lowering:'צ׳ינו מחזיר את התרנגולת מטה.',
  tracking_review_required:'התצוגה נעצרה לבדיקה: חסרה נקודת מעקב מאומתת.',
  awaiting_lion_motion:'תנועת האריה עדיין מחכה לבדיקה ולאישור.',
  invalid_lion_motion:'נתוני תנועת האריה אינם מוכנים להצגה.',
  overlay_playback_failed:'לא ניתן לנגן את האוברליי בדפדפן הזה.',
  interaction_media_failed:'אחד מקובצי הווידאו אינו ניתן לניגון.',
};
const errors={
  preview_scene_missing:'קובץ הסצנה עדיין לא זמין. אפשר לנסות שוב כשההכנה תסתיים.',
  preview_asset_missing:'אחד מקובצי הסצנה אינו זמין.',
  preview_media_failed:'קובץ וידאו לא נטען או שאינו נתמך בדפדפן.',
  preview_media_timeout:'טעינת הווידאו ארכה יותר מדי. נסה שוב.',
  preview_media_url_invalid:'הסצנה כוללת כתובת מדיה שאינה מותרת בתצוגה הפרטית.',
  awaiting_lion_motion:'תנועת האריה עדיין לא אושרה לצפייה. לא מוצגת תנועה חלופית.',
  pickup_anchor_discontinuity:'נקודת האחיזה טרם הותאמה לרגע ההרמה.',
  invalid_motion_timeline:'תזמון תנועת האריה דורש תיקון.',
  interaction_source_metadata_required:'חסרים נתוני המעקב של התרנגולת.',
  interaction_media_not_ready:'הווידאו ונתוני המעקב אינם תואמים עדיין.',
};
function message(text,{error=false,state}={}){$('status').textContent=text;$('status').dataset.error=String(error);if(state)$('stage').dataset.state=state;}
function failure(error){message(errors[error?.message]||messages[error?.message]||'התצוגה אינה מוכנה כרגע. אפשר לנסות טעינה מחדש.',{error:true,state:'error'});$('errorDetails').textContent='';$('retry').hidden=false;}
function mediaUrl(value){
  if(typeof value!=='string'||value.length>600)throw new Error('preview_media_url_invalid');
  const url=new URL(value,location.origin);
  if(url.origin!==location.origin||!url.pathname.startsWith('/media/')||url.username||url.password||url.search||url.hash)throw new Error('preview_media_url_invalid');
  return url.href;
}
async function json(url,{sceneFile=false}={}){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(sceneFile?'preview_scene_missing':'preview_asset_missing');return r.json();}
function loaded(video,url){
  return new Promise((resolve,reject)=>{
    let timeout;
    const cleanup=()=>{clearTimeout(timeout);video.removeEventListener('loadeddata',ok);video.removeEventListener('error',bad);};
    const ok=()=>{if(video.readyState<2)return;cleanup();resolve();};
    const bad=()=>{cleanup();reject(new Error('preview_media_failed'));};
    video.addEventListener('loadeddata',ok);video.addEventListener('error',bad);
    timeout=setTimeout(()=>{cleanup();reject(new Error('preview_media_timeout'));},30000);
    video.src=url;video.load();ok();
  });
}
function seek(video,time){
  if(Math.abs(video.currentTime-time)<.01&&!video.seeking)return Promise.resolve();
  return new Promise((resolve,reject)=>{
    let timeout;
    const clean=()=>{clearTimeout(timeout);video.removeEventListener('seeked',done);video.removeEventListener('error',bad);};
    const done=()=>{clean();resolve();};const bad=()=>{clean();reject(new Error('preview_media_failed'));};
    video.addEventListener('seeked',done,{once:true});video.addEventListener('error',bad,{once:true});
    timeout=setTimeout(()=>{clean();reject(new Error('preview_media_timeout'));},10000);video.currentTime=time;
  });
}
function stopWatch(){if(watch){cancelAnimationFrame(watch);watch=0;}}
function rememberLastFrame(){
  if(!playing||!scene)return;const time=base.currentTime-(scene.profile.baseStartSeconds||0),remaining=scene.profile.duration-time;
  if(remaining>0&&remaining<.16&&base.readyState>=2){
    const c=finished.getContext('2d'),w=finished.width,h=finished.height,scale=Math.max(w/base.videoWidth,h/base.videoHeight),sw=w/scale,sh=h/scale;
    c.clearRect(0,0,w,h);c.drawImage(base,(base.videoWidth-sw)/2,(base.videoHeight-sh)/2,sw,sh,0,0,w,h);c.drawImage(canvas,0,0,w,h);hasLastFrame=true;
  }
  watch=requestAnimationFrame(rememberLastFrame);
}
function stopped(reason='stopped'){
  playing=false;stopWatch();base.pause();$('stop').disabled=true;$('pause').disabled=true;$('pause').textContent='השהה לבדיקה';$('play').disabled=loading||!scene;$('play').textContent=hasPlayed?'נגן שוב עם קול':'הפעל תצוגה עם קול';
  if(reason==='finished'||reason==='base_video_ended'){
    finished.hidden=!hasLastFrame;message('התצוגה הסתיימה. אפשר לנגן שוב.',{state:'finished'});
  }else if(reason==='stopped')message('התצוגה נעצרה. אפשר לנגן שוב.',{state:'stopped'});
  else failure(new Error(reason));
}
function onState(s){
  if(!playing&&s.state!=='on_ground')return;
  $('stage').dataset.state=s.state;$('stage').dataset.sourceTime=String(s.sourceTime??'');
  if(messages[s.state])message(messages[s.state],{error:s.state==='tracking_review_required',state:s.state});
  if(s.state==='tracking_review_required'){playing=false;stopWatch();base.pause();$('stop').disabled=true;$('pause').disabled=true;$('play').disabled=false;}
}
async function play(){
  if(!scene||loading)return;const token=++epoch;
  playing=false;stopWatch();renderer?.stop();base.pause();finished.hidden=true;hasLastFrame=false;$('play').disabled=true;$('stop').disabled=true;$('pause').disabled=true;$('pause').textContent='השהה לבדיקה';$('retry').hidden=true;
  message('מכין את הפריים הראשון…',{state:'preparing'});
  try{
    await Promise.all([seek(base,scene.profile.baseStartSeconds||0),seek(overlay,scene.profile.stableWindow?.from||0)]);
    if(token!==epoch)return;
    base.muted=false;updateMute();playing=true;
    renderer.play({id:scene.id||scene.requestId||'private-chicken-preview',profile:scene.profile,sourceTrack});
    await base.play();if(token!==epoch){base.pause();renderer.stop();return;}
    hasPlayed=true;$('stop').disabled=false;$('pause').disabled=false;$('mute').disabled=false;rememberLastFrame();
  }catch(error){if(token!==epoch)return;playing=false;renderer?.stop();base.pause();stopWatch();failure(error);$('play').disabled=false;}
}
function updateMute(){$('mute').textContent=base.muted?'הפעל קול':'השתק קול';$('mute').setAttribute('aria-pressed',String(base.muted));}
async function load(){
  if(loading)return;const token=++epoch;loading=true;playing=false;stopWatch();renderer?.destroy();renderer=null;scene=null;sourceTrack=null;finished.hidden=true;base.pause();overlay.pause();$('play').disabled=true;$('stop').disabled=true;$('pause').disabled=true;$('mute').disabled=true;$('retry').hidden=true;
  message('טוען את תנועת האריה והתרנגולת…',{state:'loading'});
  try{
    const manifest=await json(SCENE,{sceneFile:true});if(token!==epoch)return;
    validateMotionProfile(manifest.profile);
    const baseUrl=mediaUrl(manifest.baseVideoUrl),overlayUrl=mediaUrl(manifest.overlayVideoUrl),trackUrl=mediaUrl(manifest.sourceTrackUrl);
    const track=await json(trackUrl);validatePointTrack(track.track,{detected:track.detected??null});
    base.muted=true;overlay.muted=true;updateMute();
    await Promise.all([loaded(base,baseUrl),loaded(overlay,overlayUrl)]);if(token!==epoch)return;
    if(track.width!==overlay.videoWidth||track.height!==overlay.videoHeight)throw new Error('interaction_media_not_ready');
    scene=manifest;sourceTrack=track;$('title').textContent=String(manifest.title||'צ׳ינו מרים את התרנגולת').slice(0,120);
    renderer=new TrackedInteraction({canvas,baseVideo:base,overlayVideo:overlay,onState,onFinish:({reason})=>stopped(reason)});
    message('מוכן לבדיקה פרטית. הפעל כדי לראות את האחיזה וההרמה.',{state:'ready'});$('play').disabled=false;$('mute').disabled=false;
  }catch(error){if(token===epoch)failure(error);}finally{if(token===epoch)loading=false;}
}
$('play').onclick=play;
$('stop').onclick=()=>{epoch++;renderer?.stop();stopped();};
$('pause').onclick=async()=>{
  if(!playing||!scene)return;
  if(base.paused){
    try{await base.play();$('pause').textContent='השהה לבדיקה';rememberLastFrame();}
    catch(error){failure(error);}
  }else{base.pause();stopWatch();$('pause').textContent='המשך תצוגה';message('מושהה לבדיקת הפריים והאחיזה.',{state:'paused'});}
};
$('mute').onclick=()=>{base.muted=!base.muted;updateMute();};
$('retry').onclick=load;
window.addEventListener('pagehide',()=>{epoch++;stopWatch();renderer?.destroy();base.pause();overlay.pause();});
load();
