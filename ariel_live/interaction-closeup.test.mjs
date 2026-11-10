import test from 'node:test';import assert from 'node:assert/strict';
import {closeupScale,applyCloseup} from './media/interactions/runtime/interaction-closeup.js';
const p={scale:3.4,afterSeconds:5,rampSeconds:.65,releaseUntil:3.05,focus:{x:.55,y:.45}};
test('shared closeup enlarges only near end of source passes and returns before hand lowers',()=>{
 assert.equal(closeupScale(p,{elapsed:2,time:2,sourceComplete:false}),1);
 assert.equal(closeupScale(p,{elapsed:6,time:2,sourceComplete:false}),3.4);
 assert.equal(closeupScale(p,{elapsed:8,time:3.05,sourceComplete:true}),1);
 const a={style:{}},b={style:{}};applyCloseup([a,b],p,3.4);assert.deepEqual(a.style,b.style);assert.equal(a.style.transform,'scale(3.4)');applyCloseup([a,b],p,1);assert.equal(a.style.transform,'');assert.equal(b.style.transformOrigin,'');
});
test('invalid closeup parameters fail closed',()=>{assert.throws(()=>closeupScale({...p,scale:10},{elapsed:6,time:2,sourceComplete:false}),/invalid_interaction_closeup/);});
