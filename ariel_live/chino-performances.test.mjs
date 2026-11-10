import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {VideoDirector} from './video-director.mjs';
import {VideoProduction} from './video-production.mjs';
import {SingleAttemptVideoProvider} from './video-production-provider.mjs';
import {performances,validatePerformanceCue,composePerformance} from './chino-performances.mjs';
import {createVideoDirector} from './video-director-server.mjs';
import {Readable} from 'node:stream';

const performance=performances[0];
const temporary=()=>fs.mkdtempSync(path.join(os.tmpdir(),'chino-performance-'));
function setup(clips=[]){
  const director=new VideoDirector({catalog:()=>clips,providerStatus:()=>({configured:false})});
  const row=director.missing({id:'operator',type:'audience',text:performance.description,room:'',uid:'',language:'he',source:'operator'}, {text:performance.text});
  Object.assign(row,{performanceId:performance.id,productionExcluded:true});
  return {director,row,production:new VideoProduction({director})};
}
test('a matching spoken line without the gesture cannot satisfy a performance quote',()=>{
  const {production,row}=setup([{id:'speech-only',text:performance.text,ready:true}]);
  const quote=production.quote({id:row.id,text:performance.text});
  assert.equal(quote.existingClipId,null);
  assert.equal(quote.performanceId,performance.id);
  assert.equal(quote.requestedSeconds,10);
  assert.equal(quote.estimatedVideoUSD,.7);
  assert.equal(production.data.jobs.length,0);
  assert.ok(!production.plan().items.some(x=>x.rows.includes(row.id)));
  assert.throws(()=>production.quote({id:row.id,text:'נוסח אחר'}),/performance_text_changed/);
});
test('approved performed clip is reused and remains available to AI candidates',async()=>{
  const clip={id:'performed',text:performance.text,ready:true,performanceId:performance.id,performanceDescription:performance.description};
  const {production,director,row}=setup([clip]);
  production.submit=async()=>assert.fail('cached performance must not generate');
  const quote=production.quote({id:row.id,text:performance.text});
  assert.equal(quote.existingClipId,clip.id);
  const result=await production.approveQuote({quoteId:quote.id,approved:true});
  assert.equal(result.cached,true);
  director.updateClip(clip.id,true,performance.roles);
  assert.equal(director.eligible({type:'audience',text:'שלח נשיקות',room:'',uid:'',language:'he'},{semanticReview:true})[0].performanceDescription,performance.description);
});
test('quote approval binds the gesture and rejects a changed inbox item before spend',async()=>{
  const {production,row}=setup();
  const quote=production.quote({id:row.id,text:performance.text});
  delete row.performanceId;
  await assert.rejects(production.approveQuote({quoteId:quote.id,approved:true}),/production_quote_changed/);
  assert.equal(production.data.jobs.length,0);
});
test('one approved performance request stays out of the library until motion is reviewed',async()=>{
  const {production,row}=setup();let requests=0;
  production.preflight=async()=>{};
  production.submit=async job=>{requests++;assert.equal(job.performanceId,performance.id);job.generated={id:'raw',file:'raw.mp4'};};
  production.verify=async()=>{throw new Error('generated_performance_review_required');};
  const quote=production.quote({id:row.id,text:performance.text});
  await production.approveQuote({quoteId:quote.id,approved:true});
  while(production.running)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(production.data.jobs[0].state,'failed');
  assert.equal(production.data.jobs[0].error,'generated_performance_review_required');
  assert.equal(production.data.jobs[0].clipId,undefined);
  assert.equal((await production.approveQuote({quoteId:quote.id,approved:true})).alreadySubmitted,true);
  assert.equal(requests,1);
});
test('a gesture cannot be approved without an observed release cue and enough video tail',async()=>{
  const {production}=setup();let accepts=0;
  const job={id:'j',performanceId:performance.id,state:'failed',error:'generated_performance_review_required',generated:{id:'raw'},validation:{duration:10},text:performance.text,transcript:performance.text,review:{score:9,identityStable:true},rows:[],questions:['נשיקות'],roles:performance.roles};
  production.data.jobs.push(job);production.acceptReview=async()=>{accepts++;throw new Error('test_accept_reached');};
  const decision={id:'j',generatedId:'raw',accepted:true,sha256:'a'.repeat(64),note:'Reviewed the complete paw movement and exact release frame.'};
  for(const cue of [{},{releaseSeconds:6},{releaseSeconds:3.2,originX:9}])await assert.rejects(production.approveQualityReview({...decision,...cue}),/performance_release_cue_required/);
  assert.equal(accepts,0);
  assert.deepEqual(validatePerformanceCue(job,{releaseSeconds:3.2}),{releaseSeconds:3.2,originX:.5,originY:.39});
  await assert.rejects(production.approveQualityReview({...decision,releaseSeconds:3.2}),/test_accept_reached/);
  assert.equal(accepts,1);
});
test('provider preserves existing look and voice, replaces the resting-paw restriction, and submits once',async()=>{
  const root=temporary();try{
    fs.mkdirSync(path.join(root,'media'));fs.writeFileSync(path.join(root,'media','master.png'),'test image');
    const requests=[];
    const provider=new SingleAttemptVideoProvider({root,fetchImpl:async(url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({output_video:{data:Buffer.from('fixture only').toString('base64')}})};}});
    provider.key=()=> 'unit-test-only';
    await provider.generate({text:performance.text,performanceId:performance.id});
    assert.equal(requests.length,1);
    assert.equal(requests[0].response_format.duration,'10s');
    const prompt=requests[0].input[1].text;
    assert.ok(prompt.includes('RIGHT front paw'));
    assert.ok(prompt.includes('native Israeli accent'));
    assert.ok(!prompt.includes('Both paws rest'));
    await provider.generate({text:'שלום'});
    assert.ok(requests[1].input[1].text.includes('Both paws rest'));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('AI preparation endpoint persists one unpaid draft, with no playable placeholder or effect event',async()=>{
  const root=temporary();let system;const emitted=[];
  try{
    system=createVideoDirector({root,bank:()=>[],emit:(...args)=>emitted.push(args),context:()=>({}),onMode:()=>{},onSpoken:()=>{},productionEnabled:true,port:7780});
    async function request(route,body){
      const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);req.method=body?'POST':'GET';req.headers={host:'127.0.0.1:7780'};
      let value,code;await system.handle(req,{writeHead:c=>code=c,end:s=>value=JSON.parse(s)},'/api/director/'+route);return {code,value};
    }
    const first=await request('performance',{id:performance.id,prepareOnly:true});
    const second=await request('performance',{id:performance.id,prepareOnly:true});
    assert.equal(first.code,200);assert.equal(first.value.ready,false);
    assert.equal(first.value.item.id,second.value.item.id);
    assert.equal(first.value.quote.performanceId,performance.id);
    const production=(await request('production')).value;
    assert.equal(production.jobs.length,0);assert.equal(production.running,false);
    assert.equal((await request('library')).value.length,0);
    assert.ok(emitted.every(([type])=>!['fx','director-play'].includes(type)));
    assert.equal((await request('performances')).value[0].state,'needs_recording');
  }finally{system?.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('local edit rechecks the existing single attempt, preserves evidence, and cannot recheck twice',async()=>{
  const {production}=setup();let verifies=0;
  const job={id:'edit-job',performanceId:performance.id,state:'failed',error:'generated_words_review_required',generated:{id:'original',file:'original.mp4'},validation:{sha256:'a'.repeat(64),duration:10},transcript:performance.text+' הממ'};
  production.data.jobs.push(job);
  production.submit=async()=>assert.fail('local edit must never regenerate');
  production.prepareEdit=async()=>({id:'original-edited',file:'original-edited.mp4'});
  production.verify=async candidate=>{verifies++;assert.equal(candidate.transcript,undefined);candidate.transcript=performance.text;throw new Error('generated_performance_review_required');};
  const decision={id:job.id,generatedId:'original',sha256:'a'.repeat(64),editedFile:'original-edited.mp4',editedSha256:'b'.repeat(64),note:'Trimmed second gesture and removed trailing nonverbal hum.'};
  const result=await production.recheckEdited(decision);
  assert.equal(result.generationSubmitted,false);assert.equal(result.error,'generated_performance_review_required');
  assert.equal(job.originalGenerated.id,'original');assert.ok(job.originalTranscript.endsWith('הממ'));
  assert.equal(job.transcript,performance.text);assert.equal(production.running,false);
  await assert.rejects(production.recheckEdited(decision),/not_eligible/);assert.equal(verifies,1);
});
test('a shorter particle tail must still fit wholly within the reviewed performance',()=>{
  const job={performanceId:performance.id,validation:{duration:8.5}};
  assert.throws(()=>validatePerformanceCue(job,{releaseSeconds:3.6}),/release_cue/);
  assert.equal(validatePerformanceCue(job,{releaseSeconds:3.6,particleSeconds:4.5}).particleSeconds,4.5);
  for(const particleSeconds of [1,6,NaN])assert.throws(()=>validatePerformanceCue(job,{releaseSeconds:3.6,particleSeconds}),/release_cue/);
});
