import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

// Authored character performances belong to the director's answer library.
// The effects dashboard and its event bus are deliberately not involved.
export const performances=Object.freeze([Object.freeze({
  id:'kiss_audience',title:'נשיקות לכל הבנות',text:'נשיקות לכל הבנות שלנו!',
  seconds:10,roles:['audience','chat','opponent'],
  description:'צ׳ינו אומר את המשפט, שולח נשיקה בכף הקדמית, ונשיקות ורודות מתפרצות ממנה אל הקהל.',
  motion:'One continuous affectionate blowing-kiss performance. From 0.3 to 2.3 seconds say the exact supplied line to the audience. Then lift his RIGHT front paw from the armrest to his own lips, kiss the paw, and extend that same paw outward toward the camera with a clear opening/release gesture around 3.2 seconds. The left paw stays on the armrest. The paw must remain a believable furry lion paw, with no extra fingers or limbs. Lower the right paw naturally by 5 seconds, then hold the original seated pose until 10 seconds. Both eyes, muzzle, crown, mane, body and throne remain consistent. No floating lips, hearts or particles in the generated footage; these are composited later.',
  particles:'media/performances/chino-kiss-particles.webm',particleSeconds:5.8,
}),Object.freeze({
  id:'chicken_comb_lift',title:'הרמה ואחיזה מהקרקע',text:'תפסתי אותך!',
  seconds:8,roles:['audience','chat','opponent'],interactionMotion:true,
  description:'תבנית תנועה: צ׳ינו מתכופף עם הכף שבימין המסך לקרקע, סוגר אחיזת צביטה, מרים אותה ומחזיק. התרנגולת והפנים מתווספות בנפרד רק לאחר בדיקת התנועה ונקודות האחיזה.',
  motion:'One continuous photorealistic eight-second EMPTY INTERACTION MOTION TEMPLATE. The exact same approved lion remains seated on the same golden throne with the same stable face, sharp amber eyes, crown, mane, gold chains, room and lighting. Use his anatomical LEFT FRONT PAW, which is on the VIEWER-RIGHT / SCREEN-RIGHT at screen x around 0.77, as the action paw. The anatomical RIGHT paw on SCREEN-LEFT stays resting on its armrest. Do not swap sides or use the paw on screen-left. His own LEFT shoulder, upper arm, elbow, forearm, wrist and furry paw remain anatomically CONNECTED to his body in EVERY frame. Say exactly the supplied short line from 0.3 to 1.5 seconds. From 0.6 to 2.2 seconds, naturally lean just enough and reach that actual LEFT paw on SCREEN-RIGHT DOWN from the armrest toward an empty pickup point near normalized screen coordinates (0.77,0.75), with room below it for the future object feet to touch the floor at the bottom of the frame. At approximately 2.2 seconds the INNER PAW DIGITS close into a clear gentle PINCH at the TOP of the future composited object, as if grasping the top of a comb. Make this a believable closed grasp without human fingers or a human hand. From 2.2 to 3.6 seconds, raise the SAME closed pinch continuously to normalized screen coordinates around (0.72,0.46), articulating the shoulder and elbow naturally. Hold the pinch steady from 3.6 to 6.4 seconds with only small breathing motion so a separate struggling object can be attached to the grip. From 6.4 to 7.3 seconds lower that same closed pinch back to the pickup point; then open the digits to release and return the paw to its original armrest by 8 seconds. The raw template must show EMPTY AIR between the gripping digits. Render NO CHICKEN, NO BIRD, NO COMB, NO OBJECT and NO PROP anywhere in this template. No human face, extra face, glove, cigarette, smoking prop, floating hand, detached paw, duplicate limb, hand swap, anatomical melting, text, particles or graphic overlay. An external transparent asset with interchangeable faces will be added AFTER the actual grip path is reviewed. Do not render the external asset or its face. Keep the camera locked and the original lion identity, seated body and throne stable throughout.',
  particles:null,interactionOrigin:Object.freeze({x:.77,y:.75}),
}),Object.freeze({
  id:'dancer_side_dance_motion',title:'ריקוד ידיים לצד הרקדנית',text:'תבנית ריקוד לצד הרקדנית',
  seconds:10,roles:['audience'],interactionMotion:true,silent:true,
  description:'האריה מבחין ברקדנית משמאל, מחייך ורוקד בשתי הכפות; הרקדנית מתווספת בשכבה נפרדת.',
  motion:'TEN SECOND FULL BODY SEATED DANCE MOTION, lion ALONE. Keep the exact reference lion, face, realistic furry anatomy, gold crown, chains, ornate throne and dark room. LOCKED camera and unchanged framing. First 0.0-0.6 seconds: exact reference home pose, both front paws on armrests. At 0.6-1.6 seconds NOTICE an imaginary dancer on VIEWER LEFT: turn head and eyes clearly toward lower SCREEN LEFT, smile playfully, make an acknowledging nod. At 1.6-8.2 seconds unmistakably DANCE WITH BOTH FRONT PAWS: lift both attached forearms from the armrests to chest height, perform at least FOUR clear alternating left/right paw lifts, rhythmically bob both shoulders and torso side to side. Each paw moves visibly at least one paw-width; this must be an energetic playful seated dance, NOT idle breathing or head-only nodding. Frequently glance toward the imaginary dancer at SCREEN LEFT while moving the paws, then look back toward camera with a grin. Keep both paws BELOW chin level and never bring either paw to the nose or mouth. No sniffing, licking, smoking, blowing, clapping against a person, reaching for, holding, lifting or touching any character. At 8.2-9.3 seconds gently lower both connected furry paws to the original armrests and face camera. At 9.3-10.0 seconds hold the EXACT original home pose. Lion stays seated. NO dancer, human, extra face, bird, props, additional limbs, floating paws, particles, captions or text. Keep foreground on viewer left clear for a separate transparent dancer that will be composited later. No speech, singing or music. Silent visual motion only.',
  particles:null,
})]);

export function performanceFor(id){
  if(!id)return null;
  const p=performances.find(x=>x.id===id);
  if(!p)throw new Error('invalid_performance');
  return p;
}

export function performanceMatches(clip,id){return (clip.performanceId||'')===(id||'');}

export function validatePerformanceCue(job,{releaseSeconds,originX,originY,particleSeconds}={}){
  const p=performanceFor(job.performanceId);
  if(!p)return null;
  if(originX===undefined)originX=p.interactionOrigin?.x??.5;
  if(originY===undefined)originY=p.interactionOrigin?.y??.39;
  if(p.interactionMotion){
    // releaseSeconds is the OBSERVED moment the pinch closes, not the moment
    // of final release. This template has no particle or overlay tail.
    if(!Number.isFinite(releaseSeconds)||releaseSeconds<.2||!Number.isFinite(job.validation?.duration)||releaseSeconds>=job.validation.duration||
       !Number.isFinite(originX)||originX<.1||originX>.9||!Number.isFinite(originY)||originY<.15||originY>.95||
       particleSeconds!==undefined&&particleSeconds!==0)throw new Error('performance_release_cue_required');
    return {releaseSeconds,originX,originY};
  }
  const tail=particleSeconds??p.particleSeconds;
  if(!Number.isFinite(tail)||tail<2||tail>p.particleSeconds||!Number.isFinite(releaseSeconds)||releaseSeconds<.2||
     !Number.isFinite(job.validation?.duration)||releaseSeconds+tail>job.validation.duration+.05||
     !Number.isFinite(originX)||originX<.2||originX>.8||
     !Number.isFinite(originY)||originY<.2||originY>.65)throw new Error('performance_release_cue_required');
  return {releaseSeconds,originX,originY,...(particleSeconds===undefined?{}:{particleSeconds})};
}

export async function composePerformance({root,job,decision,run=promisify(execFile)}){
  const p=performanceFor(job.performanceId),cue=validatePerformanceCue(job,decision);
  if(!p)return job.generated;
  if(p.interactionMotion){
    const original=job.generated;
    if(!original?.file||path.basename(original.file)!==original.file)throw new Error('generated_file_missing');
    // Retain the actual generated paw motion. There is deliberately no overlay
    // or independently animated fake hand here; attachment tracking is separate.
    return {...original,performanceId:p.id,performanceDescription:p.description,
      motionTemplate:true,sourceFile:original.file,performanceCue:cue};
  }
  const particles=path.join(root,p.particles);
  if(!fs.existsSync(particles))throw new Error('performance_particles_missing');
  const original=job.generated;
  if(!original?.file||path.basename(original.file)!==original.file)throw new Error('generated_file_missing');
  const id=original.id+'-performance',file=id+'.mp4';
  const destination=path.join(root,'media','generated',file);
  const x=Math.round((cue.originX-.5)*720),y=Math.round((cue.originY-.39)*1280);
  const speed=(cue.particleSeconds??p.particleSeconds)/p.particleSeconds;
  const filter=`[0:v]scale=720:1280,setsar=1[base];[1:v]setpts=(PTS-STARTPTS)*${speed}+${cue.releaseSeconds}/TB[burst];[base][burst]overlay=x=${x}:y=${y}:eof_action=pass:repeatlast=0:enable='gte(t,${cue.releaseSeconds})',format=yuv420p[out]`;
  await run('ffmpeg',['-v','error','-y','-i',path.join(root,'media','generated',original.file),
    '-c:v','libvpx-vp9','-i',particles,'-filter_complex',filter,'-map','[out]',
    '-map','0:a:0','-c:v','libx264','-preset','fast','-crf','18','-c:a','copy',
    '-movflags','+faststart',destination],{windowsHide:true,timeout:180000});
  return {...original,id,file,performanceId:p.id,performanceDescription:p.description,
    sourceFile:original.file,performanceCue:cue};
}
