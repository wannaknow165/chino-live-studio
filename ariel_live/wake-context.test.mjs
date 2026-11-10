import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VideoAnswerIndex} from './video-answer-index.mjs';
test('name-only wake cannot reuse a greeting interpretation with the same normalized fallback text',()=>{
 const index=new VideoAnswerIndex();const greeting={room:'room',type:'opponent',uid:'same-speaker',language:'he',text:'שלום'};
 index.rememberUnderstanding(greeting,{intent:'greeting',canonicalQuestion:'שלום',standalone:true,confidence:1},{source:'model'});
 const wake={...greeting,wakeOnly:true,rawText:'צ׳ינו'};
 assert.equal(index.understand(wake).intent,'wake');assert.equal(index.understand(greeting).intent,'greeting');
 index.rememberUnderstanding(wake,{intent:'wake',canonicalQuestion:'צינו',standalone:true,confidence:1},{source:'model'});
 assert.equal(index.understand(greeting).intent,'greeting');assert.equal(index.understand(wake).canonicalQuestion,'צינו');
});
