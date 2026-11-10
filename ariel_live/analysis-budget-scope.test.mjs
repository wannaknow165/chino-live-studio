import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {checkAnalysisBudget} from './video-director-server.mjs';
import {Budget} from './performer-core.mjs';
const spent={limitUSD:15,totalReservedUSD:15};
test('active broadcast keeps its approved analysis ceiling',()=>{assert.throws(()=>checkAnalysisBudget({liveActive:true,liveBudget:spent,usd:.05}),/live_budget_exhausted/);});
test('old inactive broadcast does not consume a new separately approved manual verification budget',()=>{assert.doesNotThrow(()=>checkAnalysisBudget({liveActive:false,liveBudget:spent,usd:.05}));});
test('inactive broadcast scope never bypasses the persistent project ceiling',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chino-budget-scope-'));try{
  const b=new Budget(path.join(dir,'budget.json'),.05);b.reserve('prior',.05);checkAnalysisBudget({liveActive:false,liveBudget:spent,usd:.05});assert.throws(()=>b.reserve('manual_review',.05),/budget_limit/);
 }finally{assert.ok(dir.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});}
});
