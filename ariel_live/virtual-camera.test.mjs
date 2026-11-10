import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {ProjectVirtualCamera} from './virtual-camera.mjs';

test('camera starts once, only reports current producer frames, and stops its own producer',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'chino-camera-'));let calls=0,kills=0,now=10000;
 const child=new EventEmitter();child.pid=123;child.kill=()=>{kills++;return true;};
 const camera=new ProjectVirtualCamera({root,now:()=>now,spawnImpl:(_exe,args,options)=>{calls++;assert.ok(args.includes('--require-frame-border'));assert.equal(options.windowsHide,true);return child;}});
 camera.python=path.join(root,'python.exe');fs.writeFileSync(camera.python,'test only');
 try{
  assert.equal(camera.status().on,false);camera.start();camera.start();assert.equal(calls,1);assert.equal(camera.status().ready,false);
  const write=pid=>fs.writeFileSync(camera.statusFile,JSON.stringify({pid,updatedAt:10000,state:'streaming',frames:20}));
  write(777);assert.equal(camera.status().ready,false);write(123);assert.equal(camera.status().ready,true);
  now=14000;assert.equal(camera.status().ready,false);assert.equal(camera.stop().on,false);assert.equal(kills,1);assert.equal(camera.status().ready,false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('failed producer becomes retryable and old exit cannot clear its replacement',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'chino-camera-'));const children=[];
 const camera=new ProjectVirtualCamera({root,spawnImpl:()=>{const c=new EventEmitter();c.kill=()=>true;c.pid=500+children.length;children.push(c);return c;}});
 camera.python=path.join(root,'python.exe');fs.writeFileSync(camera.python,'test only');
 try{camera.start();children[0].emit('error',new Error('failed'));assert.equal(camera.status().error,'camera_start_failed');camera.start();children[0].emit('exit',1);assert.equal(camera.status().on,true);children[1].emit('exit',1);assert.equal(camera.status().error,'camera_stopped_unexpectedly');}finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('Mac can load the project without Windows environment variables, camera reports unsupported instead of spawning',()=>{const c=new ProjectVirtualCamera({root:os.tmpdir(),platform:'darwin',spawnImpl:()=>{throw new Error('must_not_spawn');}});assert.equal(c.status().on,false);assert.throws(()=>c.start(),/camera_platform_unsupported/);});
