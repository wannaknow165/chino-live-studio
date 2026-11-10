import * as T from 'three';
import {GLTFLoader}from'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment}from'three/addons/environments/RoomEnvironment.js';
const canvas=document.getElementById('view'),stage=document.getElementById('stage'),status=document.getElementById('status');
const renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'high-performance'});
renderer.setPixelRatio(1);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.85;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.setClearColor(0,0);
const scene=new T.Scene(),pmrem=new T.PMREMGenerator(renderer);scene.environment=pmrem.fromScene(new RoomEnvironment(),.04).texture;scene.environmentIntensity=.65;pmrem.dispose();
scene.add(new T.HemisphereLight(0xffead2,0x172b3c,.85));
const key=new T.DirectionalLight(0xffe7c8,2.6);key.position.set(-2,3,4);key.target.position.set(0,1.1,0);scene.add(key,key.target);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-1,right:1,top:1.1,bottom:-1.1,near:.1,far:10});key.shadow.normalBias=.001;key.shadow.bias=-.0001;
const fill=new T.DirectionalLight(0xcfe0ff,.65);fill.position.set(2,2,3);scene.add(fill);const rim=new T.DirectionalLight(0xffce8b,2);rim.position.set(1,2,-2);scene.add(rim);
const camera=new T.OrthographicCamera(-.35,.35,.62,-.62,.01,20);let angle=0;
function frame(){const half=.64;camera.left=-half*9/16;camera.right=half*9/16;camera.top=half;camera.bottom=-half;camera.position.set(Math.sin(angle)*4,1.12,Math.cos(angle)*4);camera.lookAt(0,1.12,0);camera.updateProjectionMatrix()}
function resize(){const b=stage.getBoundingClientRect();renderer.setSize(Math.min(1080,Math.round(b.width*devicePixelRatio)),Math.min(1920,Math.round(b.height*devicePixelRatio)),false)}new ResizeObserver(resize).observe(stage);frame();resize();
for(const button of document.querySelectorAll('[data-angle]'))button.onclick=()=>{angle=Number(button.dataset.angle);frame()};
let mode='idle';document.getElementById('motion').onchange=e=>mode=e.target.value;
const loader=new GLTFLoader();let lion,bones=new Map(),rest=new Map(),ready=false,error='',last=0,frames=0,sampleAt=0,fps=0,p95=[],triangles=0;
try{
 const [actor,set]=await Promise.all([loader.loadAsync('/assets/royal-hero.glb',e=>{if(e.total)status.textContent='טוען את האריה המפורט '+Math.round(e.loaded/e.total*100)+'%'}),loader.loadAsync('/assets/royal-chair.glb')]);
 lion=actor.scene;scene.add(lion,set.scene);lion.updateMatrixWorld(true);
 lion.traverse(o=>{if(o.isBone){const n=o.userData.name||o.name;bones.set(n,o);rest.set(n,o.quaternion.clone())}if(o.isMesh){o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false}});
 set.scene.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true}});
 scene.updateMatrixWorld(true);lion.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update()});
 ready=true;status.textContent='';
}catch(e){error=e.message;status.textContent='טעינת הדגם לא הושלמה: '+error}
const q=new T.Quaternion(),axis=new T.Vector3(),inverse=new T.Quaternion();
function rotateWorld(name,axisWorld,amount){const b=bones.get(name);if(!b)return;inverse.copy(b.getWorldQuaternion(new T.Quaternion())).invert();axis.copy(axisWorld).applyQuaternion(inverse).normalize();q.setFromAxisAngle(axis,amount);b.quaternion.multiply(q);b.updateMatrixWorld(true)}
const x=new T.Vector3(1,0,0),y=new T.Vector3(0,1,0),z=new T.Vector3(0,0,1);
function animate(now){requestAnimationFrame(animate);if(now-last<1000/30-.5)return;const dt=last?(now-last)/1000:1/30;last=now;p95.push(dt*1000);if(p95.length>180)p95.shift();frames++;if(now-sampleAt>2000){fps=frames*1000/(now-sampleAt);frames=0;sampleAt=now}if(!ready)return;
 for(const[name,b]of bones)b.quaternion.copy(rest.get(name));lion.updateMatrixWorld(true);
 const t=now/1000;
 if(mode!=='still'){
  rotateWorld('tripo::Spine_0',x,Math.sin(t*1.3)*.0025);
  rotateWorld('tripo::Head_1',x,Math.sin(t*.8)*.006);
  rotateWorld('tripo::Head_2',y,Math.sin(t*.31)*(mode==='look'?.075:.015));
  rotateWorld('tripo::Head_2',x,Math.sin(t*.58)*(mode==='look'?.025:.009));
  if(mode==='paw'){
   const lift=(.5-.5*Math.cos(t*1.2))*.20;
   rotateWorld('bone_9',x,-lift*.35);rotateWorld('bone_10',x,-lift);
   rotateWorld('tripo::0_Right_Limb_0',x,lift*.30);
  }
 }
 renderer.render(scene,camera);triangles=renderer.info.render.triangles;
}requestAnimationFrame(animate);
window.royalDiagnostics=()=>({ready,error,fps:Math.round(fps*10)/10,triangles,bones:bones.size,mode,angle,frameP95ms:[...p95].sort((a,b)=>a-b)[Math.floor(p95.length*.95)]||0,facialRigReady:false});
