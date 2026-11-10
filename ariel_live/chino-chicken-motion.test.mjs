import test from 'node:test';
import assert from 'node:assert/strict';
import {performances,performanceFor,validatePerformanceCue,composePerformance} from './chino-performances.mjs';

const template=performanceFor('chicken_comb_lift');
const job=()=>({performanceId:template.id,generated:{id:'observed-motion',file:'observed-motion.mp4',text:template.text},validation:{duration:8}});

test('empty eight-second template moves the attached paw through pickup, lift, hold and release',()=>{
 assert.equal(template.text,'תפסתי אותך!');assert.equal(template.seconds,8);assert.equal(template.interactionMotion,true);assert.equal(template.particles,null);
 for(const instruction of ['LEFT FRONT PAW','CONNECT','0.3 to 1.5','0.6 to 2.2','(0.77,0.75)','2.2 to 3.6','(0.72,0.46)','3.6 to 6.4','6.4 to 7.3','INNER PAW DIGITS','PINCH','RIGHT paw on SCREEN-LEFT stays','NO CHICKEN','NO BIRD','NO COMB','No human face'])assert.ok(template.motion.includes(instruction),instruction);
});

test('observed grip accepts floor-level coordinates without needing a particle tail',()=>{
 assert.deepEqual(validatePerformanceCue(job(),{releaseSeconds:2.2}),{releaseSeconds:2.2,originX:.77,originY:.75});
 assert.deepEqual(validatePerformanceCue(job(),{releaseSeconds:2.35,originX:.78,originY:.81}),{releaseSeconds:2.35,originX:.78,originY:.81});
 assert.equal(validatePerformanceCue(job(),{releaseSeconds:7.8}).releaseSeconds,7.8);
});

test('missing, out-of-video and invalid grip cues are rejected before any composition',()=>{
 for(const cue of [{},{releaseSeconds:NaN},{releaseSeconds:8},{releaseSeconds:-1},{releaseSeconds:2.2,originY:1},{releaseSeconds:2.2,originX:-.1},{releaseSeconds:2.2,particleSeconds:3.2}])assert.throws(()=>validatePerformanceCue(job(),cue),/performance_release_cue_required/);
});

test('approved motion template retains the actual source file and adds no fake hand or prop',async()=>{
 const candidate=job();const result=await composePerformance({root:'unused-template-root',job:candidate,decision:{releaseSeconds:2.2},run:()=>assert.fail('empty template must not invoke ffmpeg or draw an overlay')});
 assert.equal(result.id,candidate.generated.id);assert.equal(result.file,candidate.generated.file);assert.equal(result.sourceFile,candidate.generated.file);assert.equal(result.motionTemplate,true);assert.equal(result.performanceId,template.id);assert.deepEqual(result.performanceCue,{releaseSeconds:2.2,originX:.77,originY:.75});
 assert.equal(candidate.generated.motionTemplate,undefined);
});

test('invalid source filenames and unreviewed grip cannot become templates',async()=>{
 await assert.rejects(composePerformance({root:'unused',job:job(),decision:{}}),/performance_release_cue_required/);
 await assert.rejects(composePerformance({root:'unused',job:{...job(),generated:{file:'../other.mp4'}},decision:{releaseSeconds:2.2}}),/generated_file_missing/);
});

test('kiss definition and particle-tail validation retain their previous contract',()=>{
 const kiss=performances[0];assert.equal(kiss.id,'kiss_audience');assert.equal(kiss.seconds,10);assert.equal(kiss.text,'נשיקות לכל הבנות שלנו!');assert.equal(kiss.particleSeconds,5.8);assert.equal(kiss.particles,'media/performances/chino-kiss-particles.webm');
 const candidate={performanceId:kiss.id,validation:{duration:10}};assert.deepEqual(validatePerformanceCue(candidate,{releaseSeconds:3.2}),{releaseSeconds:3.2,originX:.5,originY:.39});
 assert.throws(()=>validatePerformanceCue(candidate,{releaseSeconds:6}),/performance_release_cue_required/);
});
