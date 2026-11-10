import {test} from 'node:test';
import assert from 'node:assert/strict';
import {materialInput,materialResult} from './learning-material.mjs';
test('material analysis preserves full text beyond the former 500-character cutoff and rejects oversize',()=>{
 const text='A'.repeat(3500)+' evidence at the end';assert.equal(materialInput({text,images:[]}).text,text);
 assert.throws(()=>materialInput({text:'x'.repeat(64001),images:[]}),/invalid_learning_material/);
});
test('invented supporting quotes cannot become grounded text skills or spoken answers',()=>{
 const skills=[{policy:'Invented',evidenceQuote:'not present',reply_he:'wrong',trigger:'x'},{policy:'Supported',evidenceQuote:'actual evidence',reply_he:'שלום',trigger:'greeting'}];
 const r=materialResult({summary:'summary',skills}, {text:'the actual evidence is here',images:[]});assert.equal(r.skills.length,1);assert.equal(r.lines[0].text,'שלום');assert.equal(r.checks.behaviorTested,false);
});
test('visual lessons retain the visual-evidence distinction rather than claiming text verification',()=>{
 const r=materialResult({summary:'slide',skills:[{policy:'Look at slide',evidenceQuote:'observed visual text'}]},{text:'',images:['image']});assert.equal(r.checks.visualSource,true);assert.equal(r.checks.quotesMatchedToText,false);
});
