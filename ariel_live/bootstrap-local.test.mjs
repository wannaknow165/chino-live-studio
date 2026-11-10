import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {bootstrap} from './tools/bootstrap-local.mjs';
test('portable bootstrap is additive and never overwrites local credentials or runtime state',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'chino-bootstrap-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'portable/seeds'),{recursive:true});fs.writeFileSync(path.join(root,'portable/seeds/settings.json'),'{}');fs.writeFileSync(path.join(root,'portable/seeds/bank.json'),'[]');fs.mkdirSync(path.join(root,'data'));fs.writeFileSync(path.join(root,'data/settings.json'),'local-settings-remain');
 const dry=bootstrap(root,{dryRun:true});assert.ok(dry.created.includes('bank.json'));assert.equal(fs.existsSync(path.join(root,'data/bank.json')),false);
 bootstrap(root);assert.equal(fs.readFileSync(path.join(root,'data/settings.json'),'utf8'),'local-settings-remain');assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'data/bank.json'))),[]);const cfg=JSON.parse(fs.readFileSync(path.join(root,'data/performer-config.json')));assert.ok(cfg.asset.startsWith(root));assert.equal(bootstrap(root).created.length,0);
});
