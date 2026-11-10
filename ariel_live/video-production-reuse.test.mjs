import test from 'node:test';
import assert from 'node:assert/strict';
import {VideoProduction} from './video-production.mjs';
const meaning={intent:'wellbeing',canonicalQuestion:'מה שלומך?',confidence:1,standalone:true};
function setup(){
 let time=1000,clips=[],submissions=0,reviews=0;
 const d={room:'room',saved:{inbox:[]},library:()=>clips,eligible:()=>clips,bankRevision:()=>JSON.stringify(clips.map(c=>[c.id,c.text])),record(){},publish(){},resolve({id,clipId}){const row=this.saved.inbox.find(r=>r.id===id);row.state='bound';row.clipId=clipId;return row;},choose:async()=>{reviews++;throw new Error('unexpected_review');}};
 const p=new VideoProduction({director:d,now:()=>time,preflight:async()=>{},submit:async()=>{submissions++;throw new Error('fixture_no_network');}});
 p.authorizeLive({approved:true,budgetUSD:10,room:'room'});p.enableLive('room');
 const event=(id='e',extra={})=>({id,type:'opponent',text:'מה נשמע',room:'room',uid:'viewer',language:'he',source:'isolated_audio',t:1001,understanding:{...meaning},...extra});
 const decision=(e,text='וואלה מצוין')=>({action:'draft',text,confidence:1,bankReview:{provider:'openai',eventId:e.id,passes:2,noMatchConfirmed:true,libraryRevision:d.bankRevision(e),at:time}});
 const offer=(e,text='וואלה מצוין')=>{const value=decision(e,text),row={id:'r-'+e.id,event:e,draft:text,state:'pending'};d.saved.inbox.push(row);return {row,result:p.offerLive(row,e,value),decision:value};};
 return {d,p,event,decision,offer,add:c=>clips.push(c),clear:()=>clips=[],advance:n=>time+=n,counts:()=>({submissions,reviews}),review:fn=>d.choose=async e=>{reviews++;return fn(e);}};
}
test('equivalent standalone meanings merge pending rows without a second reservation',()=>{
 const s=setup();s.offer(s.event('one'),'וואלה מצוין');const second=s.offer(s.event('two',{text:'מה איתך אחי',uid:'other'}),'הכל טוב');
 assert.equal(second.result.merged,true);assert.equal(s.p.data.autoQueue.length,1);assert.equal(s.p.data.autoSession.reservedUSD,1.15);assert.deepEqual(s.p.data.autoQueue[0].rows,['r-one','r-two']);
});
test('personal and compound gaps do not collapse into one generic intent',()=>{
 const s=setup();for(const id of ['one','two'])s.offer(s.event(id,{text:'מה שלומך ומי מוביל?',understanding:{intent:'other',canonicalQuestion:'מה שלומך ומי מוביל?',confidence:1,standalone:false}}),'תשובה מורכבת '+id);
 assert.equal(s.p.data.autoQueue.length,2);assert.equal(s.p.data.autoSession.reservedUSD,2.3);
});
test('an obsolete reviewed inventory cannot reserve a new production',()=>{
 const s=setup(),e=s.event(),value=s.decision(e),row={id:'r',event:e,draft:value.text,state:'pending'};s.d.saved.inbox.push(row);s.add({id:'added',text:'משהו אחר',ready:true});
 assert.equal(s.p.offerLive(row,e,value).reason,'gpt_bank_review_required');assert.equal(s.p.data.autoSession.reservedUSD,0);
});
test('an exact recording added while queued is bound and its unsubmitted reservation released once',async()=>{
 const s=setup(),{row}=s.offer(s.event());s.add({id:'ready',text:'וואלה מצוין',ready:true});await s.p.tickLive();await s.p.tickLive();
 assert.equal(row.clipId,'ready');assert.equal(s.p.data.autoQueue[0].state,'reused');assert.equal(s.p.data.autoSession.reservedUSD,0);assert.equal(s.counts().submissions,0);
});
test('a changed library gets a fresh semantic decision before any paid submission',async()=>{
 const s=setup(),{row}=s.offer(s.event());s.add({id:'alternate',text:'אני בסדר',ready:true});s.review(()=>({action:'play',clipId:'alternate',text:'אני בסדר',confidence:1}));await s.p.tickLive();
 assert.equal(s.counts().reviews,1);assert.equal(s.counts().submissions,0);assert.equal(row.clipId,'alternate');assert.equal(s.p.data.autoSession.reservedUSD,0);
});
test('an aged queued review may be ignored and released without a video',async()=>{
 const s=setup();s.offer(s.event());s.advance(31000);s.review(()=>({action:'ignore',text:'',confidence:1}));await s.p.tickLive();assert.equal(s.counts().reviews,1);assert.equal(s.counts().submissions,0);assert.equal(s.p.data.autoSession.reservedUSD,0);assert.equal(s.p.data.autoQueue[0].state,'cancelled');
});
test('manual approval rechecks a recording that arrived after the quote',async()=>{
 const s=setup(),e=s.event(),row={id:'manual',event:e,draft:'תשובה מאושרת',state:'pending'};s.d.saved.inbox.push(row);const q=s.p.quote({id:row.id,text:row.draft});s.add({id:'arrived',text:row.draft,ready:true});
 const result=await s.p.approveQuote({quoteId:q.id,approved:true});assert.equal(result.cached,true);assert.equal(row.clipId,'arrived');assert.equal(s.counts().submissions,0);
});
test('a quote for an existing recording cannot turn into a paid generation when its file disappears',async()=>{
 const s=setup(),e=s.event(),row={id:'manual',event:e,draft:'תשובה מוכנה',state:'pending'};s.d.saved.inbox.push(row);s.add({id:'cached',text:row.draft,ready:true});const q=s.p.quote({id:row.id,text:row.draft});s.clear();await assert.rejects(s.p.approveQuote({quoteId:q.id,approved:true}),/production_quote_changed/);assert.equal(s.counts().submissions,0);assert.equal(q.consumed,undefined);
});
test('an exact recording that arrives during asynchronous preflight prevents submission',async()=>{
 const s=setup();s.offer(s.event());let release,entered;const ready=new Promise(r=>entered=r);s.p.preflight=()=>{entered();return new Promise(r=>release=r);};const pending=s.p.tickLive();await ready;s.add({id:'during',text:'וואלה מצוין',ready:true});release();await pending;assert.equal(s.counts().submissions,0);assert.equal(s.p.data.autoSession.reservedUSD,0);assert.equal(s.p.running,false);
});
test('a re-review cannot silently rewrite an operator approved draft',async()=>{
 const s=setup(),{row}=s.offer(s.event());row.operatorApprovedText=true;s.advance(31000);s.review(e=>s.decision(e,'הכל טוב'));await s.p.tickLive();assert.equal(s.counts().submissions,0);assert.equal(row.draft,'וואלה מצוין');assert.equal(s.p.data.autoSession.error,'draft_needs_review');
});
test('changing rooms cancels unsubmitted automatic work and frees only its reservation',async()=>{
 const s=setup();s.offer(s.event());s.d.room='other';await s.p.tickLive();assert.equal(s.counts().submissions,0);assert.equal(s.p.data.autoSession.reservedUSD,0);assert.equal(s.p.data.autoQueue[0].state,'cancelled');
});
test('stop during the initial semantic refresh cannot be undone by start resetting its flag',async()=>{
 const s=setup();s.offer(s.event());s.advance(31000);let finish,entered;const reviewing=new Promise(r=>entered=r);s.review(e=>{entered();return new Promise(r=>finish=()=>r(s.decision(e)));});const pending=s.p.tickLive();await reviewing;s.p.stop();finish();await pending;
 assert.equal(s.counts().submissions,0);assert.equal(s.p.running,false);assert.equal(s.p.data.autoSession.enabled,false);assert.equal(s.p.data.autoQueue[0].state,'cancelled');assert.equal(s.p.data.autoSession.reservedUSD,0);
});
test('stop in the first fresh-review await also prevents the preflight from starting',async()=>{
 const s=setup();s.offer(s.event());let preflight=0;s.p.preflight=async()=>preflight++;const pending=s.p.tickLive();s.p.stop();await pending;assert.equal(preflight,0);assert.equal(s.counts().submissions,0);assert.equal(s.p.data.autoQueue[0].state,'cancelled');
});
