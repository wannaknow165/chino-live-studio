import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cuePose } from './performer-visemes.mjs';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createGestureRig } from './performer-gestures.mjs';

const q = new URLSearchParams(location.search), $ = id => document.getElementById(id);
if (q.has('vcam')) document.body.classList.add('vcam');
if (!q.has('captions')) document.body.classList.add('clean');
const preview = q.has('preview'); let stageId = '', ready = false, error = '', fps = 0, epoch = 0, ticket = null;
if(preview)document.body.classList.add('preview');
let designView='upper';
let gestureRig,gestureMode='idle';
let head, jaw, root, morphs = [], sceneState = {}, testPose = null, poseUntil = 0, focus = 'camera', emotion = 'neutral';
let bodyBones=[],headRest=new THREE.Quaternion(),music={energy:0,beat:0,at:0};const motionQ=new THREE.Quaternion(),motionEuler=new THREE.Euler();
let nextBlink = 1.5, blinkStart = -5, lastT = performance.now(), totalFrames = 0, sampleStart = lastT, dtHistory = [];
const ac = new AudioContext(), audio = new Audio(); audio.preload = 'auto';
const source = ac.createMediaElementSource(audio), analyser = ac.createAnalyser(), gain = ac.createGain();
analyser.fftSize = 1024; source.connect(analyser); analyser.connect(gain); gain.connect(ac.destination);
const recordingAudio = ac.createMediaStreamDestination();gain.connect(recordingAudio);
let recorder = null;
const samples = new Float32Array(analyser.fftSize), spectrum = new Uint8Array(analyser.frequencyBinCount);
const api = async (route, value) => {
  const r = await fetch('/api/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error); return j;
};
const renderer = new THREE.WebGLRenderer({ canvas: $('view'), alpha: true, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .95;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.setClearColor(0x000000, 0);
const world = new THREE.Scene();
const environment=new THREE.PMREMGenerator(renderer);world.environment=environment.fromScene(new RoomEnvironment(),.04).texture;world.environmentIntensity=.55;environment.dispose();
const camera = new THREE.OrthographicCamera(-.5625, .5625, 1, -1, .01, 20);
camera.position.set(0, 1, 4); camera.lookAt(0, 1, 0);
world.add(new THREE.HemisphereLight(0xffead4, 0x263547, .85));
const key = new THREE.DirectionalLight(0xffdfb4, 2.6); key.position.set(-2, 3, 4); world.add(key);
key.target.position.set(0,1,0);world.add(key.target);key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-1;key.shadow.camera.right=1;key.shadow.camera.top=1.2;key.shadow.camera.bottom=-1.2;key.shadow.camera.near=.1;key.shadow.camera.far=10;key.shadow.normalBias=.001;key.shadow.bias=-.00015;
const fill = new THREE.DirectionalLight(0xcbdfff, .9); fill.position.set(2, 1.8, 2); world.add(fill);
const rim = new THREE.DirectionalLight(0xffc372, 3); rim.position.set(.5, 2, -2); world.add(rim);
function resize() { const b = $('stage').getBoundingClientRect(), scale=Math.max(2,devicePixelRatio); renderer.setSize(Math.min(1080, Math.round(b.width * scale)), Math.min(1920, Math.round(b.height * scale)), false); }
new ResizeObserver(resize).observe($('stage'));
function framing(value) {
  if(preview){designCamera();return;}
  const preset = { seated: { y: .90, half: .80 }, portrait: { y: 1.01, half: .73 }, battle: { y: 1.01, half: .75 } }[value] || { y: .92, half: 1.02 };
  camera.left = -preset.half * 9 / 16; camera.right = preset.half * 9 / 16; camera.top = preset.half; camera.bottom = -preset.half;
  camera.position.set(0, preset.y, 4); camera.lookAt(0, preset.y, 0); camera.updateProjectionMatrix();
}
function designCamera(){
  const half=designView==='face'?.73:.80,y=designView==='face'?1.01:.90;
  const angle=designView==='left'?-.52:designView==='right'?.52:0;
  camera.left=-half*9/16;camera.right=half*9/16;camera.top=half;camera.bottom=-half;
  camera.position.set(Math.sin(angle)*4,y,Math.cos(angle)*4);camera.lookAt(0,y,0);camera.updateProjectionMatrix();
}
for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>{designView=button.dataset.view;designCamera()};
if($('gesture'))$('gesture').onchange=e=>{gestureMode=e.target.value};
function layer(id, asset) {
  const box = $(id); box.replaceChildren(); box.className = '';
  if (id === 'back' && ['royal', 'studio'].includes(asset)) { box.className = asset; return; }
  if (!asset || asset === 'transparent') return;
  const el = document.createElement(/\.(mp4|webm)$/.test(asset) ? 'video' : 'img');
  el.src = asset; if (el instanceof HTMLVideoElement) { el.muted = true; el.loop = true; el.autoplay = true; el.playsInline = true; }
  box.appendChild(el);
}
function setScene(s) {
  if (s.background !== sceneState.background) layer('back', s.background);
  if (s.foreground !== sceneState.foreground) layer('front', s.foreground);
  if (s.framing !== sceneState.framing) framing(s.framing);
  const tint = { warm: 0xffdfb4, neutral: 0xffffff, cool: 0xc4dbff }[s.lighting] || 0xffdfb4;
  key.color.setHex(tint); sceneState = s;
}
async function report() {
  if (!stageId) return;
  await api('stage/status', { stageId, ready, audio: ac.state === 'running', fps, error }).catch(() => {});
}
async function ack(state, item = ticket) {
  if (item && stageId) await api('stage/ack', { stageId, id: item.id, epoch: item.epoch, state }).catch(() => {});
}
function cancel() {
  const old = ticket; ticket = null; audio.pause(); audio.removeAttribute('src'); audio.load();
  $('caption').textContent = ''; emotion = 'neutral'; focus = 'camera'; ack('cancelled', old);
}
async function utterance(u) {
  if (preview || u.stageId !== stageId || u.epoch < epoch || Date.now() > u.expiresAt || ac.state !== 'running') return;
  cancel(); epoch = u.epoch; ticket = u; focus = u.gaze; emotion = u.emotion;
  audio.src = u.audioUrl;
  audio.onended = () => { if (ticket?.id === u.id) { ack('ended', u); ticket = null; $('caption').textContent = ''; emotion = 'neutral'; } };
  audio.onerror = () => { if (ticket?.id === u.id) { ack('error', u); ticket = null; error = 'audio_playback_failed'; } };
  try {
    await audio.play();
    if (ticket?.id !== u.id || Date.now() > u.expiresAt || epoch !== u.epoch) { if (ticket?.id === u.id) cancel(); return; }
    $('caption').textContent = u.text; ack('started', u);
  } catch { error = 'audio_not_allowed'; ack('error', u); ticket = null; $('start').style.display = ''; }
}
$('start').onclick = async () => {
  try {
    await ac.resume();
    if (!preview && !stageId) stageId = (await api('stage/claim', {})).stageId;
    if (q.get('out') && ac.setSinkId) await ac.setSinkId(q.get('out'));
    $('start').style.display = 'none'; error = ''; await report();
  } catch (e) { error = e.message; $('load').textContent = error; }
};
if (preview) { $('start').style.display = 'none'; gain.gain.value = 0; }
const events = new EventSource('/api/events');
events.onmessage = e => {
  const d = JSON.parse(e.data);
  if (d.type === 'hello') { epoch = d.epoch; setScene(d.scene); }
  if (d.type === 'scene') setScene(d);
  if (d.type === 'cancel') { epoch = d.epoch; cancel(); }
  if (d.type === 'utterance') utterance(d);
  if (d.type === 'pose') { testPose = d.pose; poseUntil = performance.now() + 5000; }
  if(d.type==='music-motion')music={...d,receivedAt:performance.now()};
  if (d.type === 'record-start' && d.stageId === stageId && !preview) record(d.seconds);
};
async function record(seconds) {
  if(recorder?.state==='recording')return;
  try {
    // Composite the same back/3D/front layers into a fixed portrait recording.
    const canvas=document.createElement('canvas');canvas.width=720;canvas.height=1280;
    const ctx=canvas.getContext('2d');const stream=canvas.captureStream(30);
    for(const track of recordingAudio.stream.getAudioTracks())stream.addTrack(track.clone());
    const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus'].find(t=>MediaRecorder.isTypeSupported(t));
    const r=recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:4500000});const chunks=[];
    let drawing=true,lastCapturedFrame=-1;
    const drawLayer=id=>{const el=$(id).firstElementChild;if(el && (el.tagName==='VIDEO'?el.readyState>=2:el.complete))ctx.drawImage(el,0,0,720,1280)};
    function draw(){if(!drawing)return;if(lastCapturedFrame===renderedAt){requestAnimationFrame(draw);return}lastCapturedFrame=renderedAt;ctx.fillStyle=sceneState.background==='studio'?'#0c1c2e':'#0c0b09';ctx.fillRect(0,0,720,1280);
      if(sceneState.background==='royal')for(let x=0;x<720;x+=2){const shade=Math.round(9+12*(.5+.5*Math.sin(x/4.6)));ctx.fillStyle=`rgb(${shade},${shade-1},${Math.max(8,shade-5)})`;ctx.fillRect(x,0,2,1280)}
      drawLayer('back');ctx.drawImage(renderer.domElement,0,0,720,1280);drawLayer('front');requestAnimationFrame(draw)}draw();
    r.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
    r.onstop=async()=>{drawing=false;stream.getTracks().forEach(t=>t.stop());
      try{const response=await fetch('/api/recording/upload',{method:'POST',headers:{'X-Stage-Id':stageId},body:new Blob(chunks,{type:'video/webm'})});if(!response.ok)throw Error('recording_upload_failed')}
      catch(e){await api('recording/error',{stageId,error:e.message}).catch(()=>{})}};
    r.start(1000);setTimeout(()=>{if(r.state==='recording')r.stop()},seconds*1000);
  } catch(e){await api('recording/error',{stageId,error:e.message}).catch(()=>{})}
}
events.onerror = () => { cancel(); error = 'server_disconnected'; };
const loader = new GLTFLoader();
try {
  const assets = await (await fetch('/api/assets')).json();
  const lion = await loader.loadAsync(assets.lion, e => { if (e.total) $('load').textContent = 'טוען אריה ' + Math.round(e.loaded / e.total * 100) + '%'; });
  root = lion.scene; world.add(root);
  // Blender's Fresnel/transparent mix is not a glTF material. Recreate the
  // thin corneal reflection instead of displaying the exported white shell.
  root.traverse(o => {
    if(o.name.includes('LionV8_Crown'))o.visible=false;
    if (!o.isMesh) return;
    if (o.material?.name === 'LionDenim_IndigoJeans') {
      // Blender's exported white sheen overwhelms the indigo at grazing angles.
      o.material.sheen = 0; o.material.metalness = 0; o.material.roughness = .9;
      o.material.vertexColors = false; o.material.envMapIntensity = .25;
      o.material.needsUpdate = true;
    }
    o.receiveShadow=true;o.castShadow=o.name.includes('Head_GPU')||o.name.includes('Body_GPU');
    if(o.name.includes('ArmHandFur')) { o.castShadow=true; o.material.envMapIntensity=.35; }
    if (o.name.includes('PortraitCorneas')) {
      o.material = new THREE.MeshPhysicalMaterial({ color: 0xffffff,
        transparent: true, opacity: .085, depthWrite: false, roughness: .08,
        metalness: 0, ior: 1.376, clearcoat: 1, clearcoatRoughness: .07,
        envMapIntensity: .3 });
      o.renderOrder = 2;
    }
    if (o.name.includes('PortraitIrises')) {
      o.material.roughness = .46; o.material.envMapIntensity = .2;
    }
  });
  head = root.getObjectByName('LionLive_Head'); jaw = root.getObjectByName('LionLive_Jaw');
  headRest.copy(head.quaternion);
  const boneNames=['spine.002','spine.003','shoulder.L','shoulder.R','upper_arm.L','upper_arm.R'];
  bodyBones=[];root.traverse(o=>{const name=o.userData.name||o.name;if(o.isBone && boneNames.includes(name))bodyBones.push({bone:o,name,rest:o.quaternion.clone()})});
  root.traverse(o => { if (o.morphTargetInfluences) morphs.push(o); });
  if (!head || !jaw || !morphs.length) throw new Error('rig_controls_missing');
  gestureRig=createGestureRig(root);
  if (assets.set) { const set = await loader.loadAsync(assets.set);set.scene.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true}}); world.add(set.scene); }
  ready = true; $('load').textContent = ''; resize(); await report();
} catch (e) { error = e.message; $('load').textContent = 'שגיאת טעינת דמות: ' + error; }
let jawValue = 0, frameRms = 0, renderedAt=0;
function animate(now) {
  requestAnimationFrame(animate);
  if(now-renderedAt<1000/30-.5)return;renderedAt=now;
  const dt = Math.min(.1, (now - lastT) / 1000), t = now / 1000; lastT = now;
  totalFrames++; dtHistory.push(dt * 1000); if (dtHistory.length > 300) dtHistory.shift();
  if (now - sampleStart > 2000) { fps = Math.round(totalFrames * 1000 / (now - sampleStart) * 10) / 10; sampleStart = now; totalFrames = 0; }
  if (!ready) return;
  const speaking = ticket && !audio.paused && !audio.ended;
  let open = 0, round = 0;
  if (speaking) {
    analyser.getFloatTimeDomainData(samples); analyser.getByteFrequencyData(spectrum);
    frameRms = Math.sqrt(samples.reduce((n, x) => n + x * x, 0) / samples.length);
    open = Math.min(.7, Math.max(0, (frameRms - .012) * 7));
    const low = spectrum.slice(5, 22).reduce((a, b) => a + b, 0) / 17;
    const high = spectrum.slice(42, 110).reduce((a, b) => a + b, 0) / 68;
    round = open * Math.max(0, Math.min(.45, (low - high - 20) / 180));
  } else frameRms = 0;
  const shapes = speaking && ticket.mouthCues ? cuePose(ticket.mouthCues,audio.currentTime) : { jawOpen: open, mouthFunnel: round, mouthPucker: round * .25 };
  if (t > nextBlink) { blinkStart = t; nextBlink = t + 2.8 + Math.random() * 3; }
  const blink = Math.max(0, 1 - Math.abs((t - blinkStart - .075) / .075));
  shapes.eyeBlinkLeft = shapes.eyeBlinkRight = blink;
  const happy = ['warm', 'amused', 'excited'].includes(emotion) ? .15 : .015;
  shapes.mouthSmileLeft = shapes.mouthSmileRight = happy * (1 - open);
  shapes.browInnerUp = emotion === 'curious' ? .2 : 0;
  const targetYaw = focus === 'opponent' ? .10 : focus === 'chat' ? -.045 : 0;
  const musicOn=now-(music.receivedAt||0)<700,energy=musicOn?music.energy||0:0,pulse=musicOn?music.beat||0:0;
  const amount=speaking?.18:1;
  motionEuler.set(Math.sin(t*1.3)*.009+(speaking?Math.sin(t*3)*.008:0)+pulse*.055*amount,targetYaw+Math.sin(t*.28)*.013,Math.sin(t*.43)*.007+Math.sin(t*2.1)*energy*.06*amount);
  motionQ.setFromEuler(motionEuler);head.quaternion.slerp(headRest.clone().multiply(motionQ),Math.min(1,dt*12));
  for(const {bone,name,rest}of bodyBones){const spine=name.startsWith('spine'),sign=name.endsWith('R')?-1:1;
    motionEuler.set(spine?Math.sin(t*1.4)*.004+pulse*.018*amount:0,spine?Math.sin(t*2)*energy*.022*amount:0,spine?Math.sin(t*2.1)*energy*.025*amount:sign*(Math.sin(t*1.4)*.003+pulse*.025*amount));
    bone.quaternion.slerp(rest.clone().multiply(motionQ.setFromEuler(motionEuler)),Math.min(1,dt*10));}
  gestureRig?.update(t,dt,preview?gestureMode:'idle',!!speaking);
  if (testPose && now < poseUntil && !speaking) {
    if (testPose === 'open') shapes.jawOpen = .65;
    if (testPose === 'seal') { shapes.jawOpen = .35; shapes.mouthClose = .35; }
    if (testPose === 'round') { shapes.jawOpen = .3; shapes.mouthFunnel = .65; shapes.mouthPucker = .3; }
    if (testPose === 'smile') shapes.mouthSmileLeft = shapes.mouthSmileRight = .6;
    if (testPose === 'blink') shapes.eyeBlinkLeft = shapes.eyeBlinkRight = 1;
  } else testPose = null;
  for (const m of morphs) for (const [name, i] of Object.entries(m.morphTargetDictionary)) {
    const target = shapes[name] || 0; m.morphTargetInfluences[i] += (target - m.morphTargetInfluences[i]) * Math.min(1, dt * 24);
  }
  jawValue += ((shapes.jawOpen || 0) - jawValue) * Math.min(1, dt * 24);
  jaw.rotation.x = .36000355 * jawValue;
  renderer.render(world, camera);
}
requestAnimationFrame(animate); setInterval(report, 2500);
window.addEventListener('pagehide', () => { cancel(); ready = false; report(); });
// Read-only diagnostic surface for measured local verification.
window.lionDiagnostics = () => ({ ready, error, fps, morphMeshes: morphs.length, jawOpen: jawValue, rms: frameRms,
  bodyBones:bodyBones.length,music,gesture:gestureRig?.diagnostics(),gestureMode,
  audioState: ac.state, audioTime: audio.currentTime, speaking: !!ticket, scene: sceneState, triangles: renderer.info.render.triangles,
  frameP95ms: [...dtHistory].sort((a,b)=>a-b)[Math.floor(dtHistory.length * .95)] || 0 });
