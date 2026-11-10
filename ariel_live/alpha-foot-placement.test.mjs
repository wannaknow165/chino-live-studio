import test from 'node:test';
import assert from 'node:assert/strict';
import {feetFromAlpha} from './alpha-foot-placement.mjs';
test('feet follow lowest opaque silhouette, not waving arms or transparent padding',()=>{
 const bytes=Buffer.alloc(2*20*20);for(let frame=0;frame<2;frame++){const o=frame*400;bytes[o+2*20]=255;for(let y=16;y<19;y++)for(let x=8+frame;x<12+frame;x++)bytes[o+y*20+x]=255;}
 const p=feetFromAlpha(bytes,{width:20,height:20,fps:24});assert.equal(p.frames,2);assert.deepEqual(p.detected,[true,true]);assert.equal(p.track[0][1],.5);assert.equal(p.track[1][1],.55);assert.equal(p.track[0][2],.95);
});
test('empty alpha frame remains unobserved, malformed decoder buffers fail closed',()=>{
 const p=feetFromAlpha(Buffer.alloc(400),{width:20,height:20,fps:24});assert.deepEqual(p.detected,[false]);assert.throws(()=>feetFromAlpha(Buffer.alloc(1),{width:20,height:20,fps:24}),/decode_invalid/);
});
