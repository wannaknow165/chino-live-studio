/* Transparent, deterministic show graphics. The stage owns video and audio. */
const W=720,H=1280,TAU=Math.PI*2;
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const mix=(a,b,t)=>a+(b-a)*t;
const ease=t=>1-Math.pow(1-clamp(t),3);
const smooth=t=>{t=clamp(t);return t*t*(3-2*t);};
const fade=(p,enter=.1,exit=.8)=>smooth(p/enter)*(1-smooth((p-exit)/(1-exit)));
const finite=(n,f)=>Number.isFinite(Number(n))?Number(n):f;
const clock=()=>typeof performance!=='undefined'?performance.now():Date.now();
function seeded(value){let a=2166136261;for(const c of String(value))a=Math.imul(a^c.charCodeAt(0),16777619);return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function line(c,x1,y1,x2,y2,color,width=1){c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.strokeStyle=color;c.lineWidth=width;c.stroke();}
function round(c,x,y,w,h,r=12){r=Math.min(r,w/2,h/2);c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}
function text(c,value,x,y,size,fill,weight=800){c.font=`${weight} ${size}px Arial, sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillStyle=fill;c.fillText(value,x,y);}
function grad(c,x1,y1,x2,y2,stops){const g=c.createLinearGradient(x1,y1,x2,y2);for(const [at,color]of stops)g.addColorStop(at,color);return g;}
const gold=(c,y1,y2)=>grad(c,0,y1,0,y2,[[0,'#fff2b5'],[.23,'#ffe995'],[.48,'#b98022'],[.66,'#ffe5a0'],[1,'#c88c29']]);

export class ChinoShowOverlay {
  constructor(canvas,{onImpact,onFinish}={}){
    if(!canvas||typeof canvas.getContext!=='function')throw new TypeError('A canvas is required');
    this.canvas=canvas;this.ctx=canvas.getContext('2d');if(!this.ctx)throw new Error('Canvas 2D is unavailable');
    this.onImpact=onImpact;this.onFinish=onFinish;this.active=null;this.music={ready:false};this.frame=0;this.destroyed=false;
    this.media=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):null;
    this.reducedMotion=!!this.media?.matches;this.motionChanged=e=>{this.reducedMotion=e.matches;};
    this.media?.addEventListener?.('change',this.motionChanged);
    this.tick=this.tick.bind(this);this.clear();
  }
  play(cue={}){
    const {id,kind,startedAt,durationMs,seed}=cue;
    if(this.destroyed)return false;
    if(!['opening','double','triple','glove'].includes(kind))throw new TypeError('Unknown show kind');
    const now=clock(),stamp=finite(startedAt,Date.now()),elapsed=stamp>1e11?Date.now()-stamp:now-stamp;
    const duration=clamp(finite(durationMs,{opening:5200,double:3300,triple:3900,glove:4100}[kind]),800,15000);
    const rng=seeded(seed??id??kind),particles=Array.from({length:84},()=>({angle:rng()*TAU,speed:85+rng()*270,delay:rng()*.26,size:1+rng()*3,spin:rng()*TAU,warm:rng()>.3}));
    const cracks=[];
    for(let i=0;i<9;i++){
      const angle=TAU*i/9+(rng()-.5)*.3,length=130+rng()*240,points=[[0,0]];
      for(let j=1;j<=5;j++){const a=angle+(rng()-.5)*.25,r=length*j/5;points.push([Math.cos(a)*r,Math.sin(a)*r]);}
      cracks.push({points,branch:2+Math.floor(rng()*2),bend:(rng()>.5?1:-1)*(.25+rng()*.5)});
    }
    this.canvas.dataset.showKind=kind;this.canvas.dataset.showPhase='starting';
    this.active={id:String(id??kind),kind,start:now-elapsed,duration,particles,cracks,impactFired:false,seed:seed??id??kind,cue:{...cue}};
    this.schedule();return true;
  }
  stop(){this.active=null;this.canvas.dataset.showKind='';this.canvas.dataset.showPhase='idle';this.clear();if(this.music.ready)this.schedule();else this.cancel();}
  destroy(){if(this.destroyed)return;this.destroyed=true;this.active=null;this.music={ready:false};this.cancel();this.media?.removeEventListener?.('change',this.motionChanged);this.clear();this.onImpact=this.onFinish=null;}
  status(){const a=this.active;return {active:!!a,id:a?.id||null,kind:a?.kind||null,progress:a?clamp((clock()-a.start)/a.duration):0,reducedMotion:this.reducedMotion,musicReady:!!this.music.ready,destroyed:this.destroyed};}
  updateMusic({ready=false,bpm=100,phase='vibe',position=0,preview=false}={}){
    if(this.destroyed)return;
    this.music={ready:!!ready,bpm:clamp(finite(bpm,100),45,180),phase:String(phase),position:Math.max(0,finite(position,0)),preview:!!preview,at:clock()};
    if(ready||this.active)this.schedule();else{this.cancel();this.clear();}
  }
  cancel(){if(this.frame){cancelAnimationFrame(this.frame);this.frame=0;}}
  schedule(){if(!this.frame&&!this.destroyed)this.frame=requestAnimationFrame(this.tick);}
  clear(){const c=this.ctx;c.setTransform(1,0,0,1,0,0);c.globalAlpha=1;c.globalCompositeOperation='source-over';c.shadowBlur=0;c.shadowOffsetX=c.shadowOffsetY=0;c.clearRect(0,0,this.canvas.width,this.canvas.height);}
  tick(now){
    this.frame=0;if(this.destroyed)return;this.clear();
    const c=this.ctx;c.save();c.scale(this.canvas.width/W,this.canvas.height/H);
    if(this.music.ready)this.musicAura(c,now);
    const a=this.active;
    if(a){
      const p=(now-a.start)/a.duration;this.canvas.dataset.showPhase=p>=1?'idle':a.kind==='glove'&&p>=.46&&p<.60?'impact':p>=.18&&p<.75?'peak':'playing';
      if(p>=0&&p<1){
        if(a.kind==='opening')this.opening(c,clamp(p),a);
        else if(a.kind==='glove')this.glove(c,clamp(p),a);
        else this.multiplier(c,clamp(p),a);
        if(a.kind==='glove'&&p>=.46&&!a.impactFired){a.impactFired=true;this.notify(this.onImpact,a.kind);}
      }else if(p>=1){
        if(a.kind==='glove'&&!a.impactFired){a.impactFired=true;this.notify(this.onImpact,a.kind);}
        if(this.active===a){this.active=null;this.notify(this.onFinish,a.cue);}
      }
    }
    c.restore();c.setTransform(1,0,0,1,0,0);c.globalAlpha=1;c.globalCompositeOperation='source-over';c.shadowBlur=0;
    if(this.active||this.music.ready)this.schedule();
  }
  notify(callback,value){if(typeof callback==='function'){try{callback(value);}catch{/* Renderer must survive host callback errors. */}}}
  musicAura(c,now){
    const m=this.music,t=m.position+(now-m.at)/1000,beat=this.reducedMotion?.34:.25+.75*Math.pow((1+Math.cos(TAU*t*m.bpm/60))/2,5),strength=(m.phase==='chorus'?.15:.09)*beat;
    c.save();c.globalAlpha=1;
    for(const side of [0,W]){
      const g=c.createLinearGradient(side,0,side===0?45:W-45,0);g.addColorStop(0,`rgba(71,211,255,${strength})`);g.addColorStop(1,'rgba(71,211,255,0)');c.fillStyle=g;c.fillRect(side===0?0:W-45,210,45,H-320);
      line(c,side===0?2:W-2,310,side===0?2:W-2,H-110,`rgba(255,212,119,${strength*1.8})`,2);
    }
    c.restore();
  }
  frameLight(c,p,alpha=1){
    const sweep=this.reducedMotion?.5:p;
    c.save();c.globalAlpha=alpha;
    const halo=c.createLinearGradient(0,0,W,0);halo.addColorStop(0,'rgba(244,182,71,.55)');halo.addColorStop(.12,'rgba(244,182,71,0)');halo.addColorStop(.88,'rgba(39,199,235,0)');halo.addColorStop(1,'rgba(39,199,235,.5)');
    c.fillStyle=halo;c.fillRect(0,0,W,H);c.shadowColor='#ffd783';c.shadowBlur=12;
    round(c,17,26,W-34,H-52,33);c.strokeStyle='rgba(255,218,143,.75)';c.lineWidth=1.6;c.stroke();
    for(const side of [0,1]){const x=side?W-17:17,y=100+((sweep*1.4+side*.4)%1)*(H-200);line(c,x,y-75,x,y+75,side?'#9ef7ff':'#ffe5a0',3);}
    c.restore();
  }
  opening(c,p,a){
    const alpha=fade(p,.14,.74);c.save();c.globalAlpha=alpha;this.frameLight(c,p,.85);
    // Keep the lion's face and hands visible; branding sits above and below them.
    const rise=this.reducedMotion?0:22*(1-ease(p/.25));
    c.save();c.translate(W/2,116+rise);c.shadowColor='#cf931d';c.shadowBlur=18;c.strokeStyle='#ffe6ab';c.fillStyle=gold(c,-30,25);c.lineWidth=2.5;
    c.beginPath();c.moveTo(-39,7);c.lineTo(-48,-24);c.lineTo(-20,-9);c.lineTo(0,-38);c.lineTo(20,-9);c.lineTo(48,-24);c.lineTo(39,7);c.closePath();c.fill();c.stroke();
    round(c,-39,10,78,12,4);c.fill();for(const x of [-23,0,23]){c.beginPath();c.arc(x,16,2.4,0,TAU);c.fillStyle=x?'#8f2319':'#39d7eb';c.fill();}c.restore();
    c.shadowColor='rgba(0,0,0,.95)';c.shadowBlur=18;text(c,'CHINO LIVE',W/2,195+rise,55,gold(c,166,226),900);
    line(c,144,239,285,239,'rgba(255,220,148,.65)',1);line(c,435,239,576,239,'rgba(255,220,148,.65)',1);text(c,'THE KING IS LIVE',W/2,240,15,'#e4faff',700);
    c.fillStyle=grad(c,0,1020,0,1198,[[0,'rgba(3,10,18,0)'],[.45,'rgba(3,10,18,.67)'],[1,'rgba(3,10,18,0)']]);c.fillRect(70,1020,W-140,178);
    c.direction='rtl';text(c,'צ׳ינו עלה ללייב',W/2,1090,39,'#fff0c3',800);c.direction='ltr';text(c,'LET THE SHOW BEGIN',W/2,1144,17,'#8deaff',700);
    for(const particle of a.particles.slice(0,48)){
      const t=Math.max(0,p-particle.delay),edge=particle.angle>Math.PI?1:-1,x=edge>0?W-42:42,y=H-t*780-particle.speed*.7;
      c.globalAlpha=alpha*.7*(1-t);c.fillStyle=particle.warm?'#ffe3a1':'#75e6f7';c.beginPath();c.ellipse(x+Math.sin(t*4+particle.angle)*18,y,particle.size*.55,particle.size*2.6,particle.spin,0,TAU);c.fill();
    }
    c.restore();
  }
  multiplier(c,p,a){
    const alpha=fade(p,.09,.74),n=a.kind==='triple'?3:2,x=W/2,y=1000,entry=ease(p/.24),scale=this.reducedMotion?1:mix(.65,1,entry);
    c.save();this.frameLight(c,p,alpha*.72);c.translate(x,y);c.scale(scale,scale);c.globalAlpha=alpha;
    const halo=c.createRadialGradient(0,0,18,0,0,200);halo.addColorStop(0,n===3?'rgba(236,160,28,.35)':'rgba(22,207,235,.26)');halo.addColorStop(1,'rgba(4,10,16,0)');c.fillStyle=halo;c.fillRect(-210,-210,420,420);
    c.shadowColor=n===3?'#e7ab3a':'#41d5ed';c.shadowBlur=15;
    for(let i=0;i<n;i++){
      const r=107+i*18+(this.reducedMotion?0:Math.sin(p*5-i*.6)*4);c.beginPath();c.arc(0,0,r,-2.7+p*.2+i*.6,2.2+p*.2+i*.6);c.strokeStyle=i%2?'rgba(255,218,135,.65)':'rgba(108,237,255,.8)';c.lineWidth=i?2:4;c.stroke();
    }
    c.shadowBlur=22;c.shadowColor='#001923';text(c,'×'+n,0,-5,n===3?112:121,gold(c,-70,65),900);text(c,n===3?'TRIPLE POWER':'DOUBLE POWER',0,93,19,'#e5fcff',800);c.restore();
    const t=clamp((p-.08)/.84),distance=this.reducedMotion?85:ease(t)*365;
    for(const particle of a.particles){
      const life=clamp((p-.06-particle.delay*.5)/.64);if(!life||life>=1)continue;
      c.save();c.globalAlpha=alpha*(1-life)*.9;const dx=Math.cos(particle.angle),dy=Math.sin(particle.angle),r=distance*(particle.speed/240);
      const px=x+dx*r,py=y+dy*r*.78;c.translate(px,py);c.rotate(particle.angle+particle.spin);c.fillStyle=particle.warm?'#ffdf91':'#72efff';c.fillRect(-particle.size,-particle.size*.4,particle.size*2.7,particle.size*.8);c.restore();
    }
  }
  glove(c,p,a){
    const impact=.46,hit=clamp((p-impact)/.5),visible=smooth(p/.13)*(1-smooth((p-.76)/.18));
    const from={x:W*.89,y:H*.70},target={x:W*.53,y:H*.51};
    const drive=this.reducedMotion?1:p<impact?Math.pow(clamp((p-.18)/(impact-.18)),3):1-ease((p-.60)/.23);
    const x=mix(from.x+44,target.x,drive),y=mix(from.y+45,target.y,drive),scale=this.reducedMotion?1:mix(.70,1.48,drive);
    // Short non-flashing impact light, a shock ring, and deterministic glass lines.
    if(p>=impact&&p<.96){
      c.save();c.translate(target.x,target.y);const crackAlpha=(1-smooth((hit-.23)/.77))*.76;
      if(!this.reducedMotion){const radius=12+ease(hit)*205;c.globalAlpha=(1-hit)*.55;c.beginPath();c.arc(0,0,radius,0,TAU);c.strokeStyle='#e7fbff';c.lineWidth=3*(1-hit)+.7;c.stroke();}
      c.globalAlpha=crackAlpha;c.lineCap='round';c.lineJoin='round';
      for(const crack of a.cracks){
        c.beginPath();c.moveTo(0,0);for(const point of crack.points.slice(1))c.lineTo(point[0],point[1]);c.strokeStyle='rgba(235,253,255,.9)';c.lineWidth=1.35;c.stroke();
        const [bx,by]=crack.points[crack.branch],angle=Math.atan2(by,bx)+crack.bend;
        line(c,bx,by,bx+Math.cos(angle)*61,by+Math.sin(angle)*61,'rgba(168,218,239,.8)',.8);
        const q=crack.points[2];line(c,q[0]+3,q[1],q[0]+Math.cos(angle+.7)*42,q[1]+Math.sin(angle+.7)*42,'rgba(255,224,160,.48)',.6);
      }
      c.restore();
      if(!this.reducedMotion)for(const particle of a.particles.slice(0,36)){
        const r=ease(hit)*particle.speed*.65,px=target.x+Math.cos(particle.angle)*r,py=target.y+Math.sin(particle.angle)*r+hit*hit*80;
        c.save();c.translate(px,py);c.rotate(particle.spin+hit*3);c.globalAlpha=(1-hit)*.6;c.fillStyle='rgba(205,245,255,.65)';c.beginPath();c.moveTo(-particle.size*1.7,-particle.size);c.lineTo(particle.size*2.4,0);c.lineTo(0,particle.size*3);c.closePath();c.fill();c.restore();
      }
    }
    c.save();c.globalAlpha=visible;c.translate(x,y);c.rotate(mix(-.15,-.81,drive));c.scale(scale,scale);this.drawGlove(c);c.restore();
  }
  drawGlove(c){
    // Broad padded knuckles, an inset thumb, dark leather seams and a gold cuff.
    c.save();c.shadowColor='rgba(0,0,0,.65)';c.shadowBlur=22;c.shadowOffsetX=7;c.shadowOffsetY=13;
    c.fillStyle=grad(c,-65,-105,64,65,[[0,'#ff654f'],[.25,'#dc1d2d'],[.58,'#a00820'],[1,'#450c16']]);
    c.beginPath();c.moveTo(-54,24);c.bezierCurveTo(-77,9,-81,-22,-70,-47);c.bezierCurveTo(-82,-67,-64,-105,-39,-108);c.bezierCurveTo(-20,-125,14,-121,32,-112);c.bezierCurveTo(57,-119,79,-94,81,-68);c.bezierCurveTo(91,-36,78,7,57,33);c.bezierCurveTo(34,57,-23,54,-54,24);c.closePath();c.fill();
    c.shadowBlur=0;c.shadowOffsetX=c.shadowOffsetY=0;c.strokeStyle='rgba(51,0,9,.7)';c.lineWidth=2;c.stroke();
    const sheen=c.createRadialGradient(-25,-85,2,-15,-62,82);sheen.addColorStop(0,'rgba(255,227,177,.53)');sheen.addColorStop(.34,'rgba(255,175,150,.17)');sheen.addColorStop(1,'rgba(255,150,130,0)');c.fillStyle=sheen;c.beginPath();c.ellipse(0,-49,66,63,-.2,0,TAU);c.fill();
    c.strokeStyle='rgba(255,162,133,.44)';c.lineWidth=1.3;
    for(const [kx,ky]of[[-42,-89],[-13,-101],[18,-100],[47,-87]]){c.beginPath();c.ellipse(kx,ky,15,10,-.2,.13,Math.PI*.95);c.stroke();}
    // Curved thumb sits on the left side and wraps into the fist.
    c.fillStyle=grad(c,-68,-30,-17,53,[[0,'#f64b40'],[.4,'#c01628'],[1,'#620b1c']]);
    c.beginPath();c.moveTo(-58,-36);c.bezierCurveTo(-89,-38,-102,-14,-87,9);c.bezierCurveTo(-76,30,-58,43,-38,40);c.bezierCurveTo(-24,35,-28,19,-39,10);c.bezierCurveTo(-50,0,-40,-19,-58,-36);c.closePath();c.fill();c.strokeStyle='rgba(47,0,10,.75)';c.lineWidth=2;c.stroke();
    c.beginPath();c.moveTo(-64,-23);c.bezierCurveTo(-79,-22,-84,-9,-73,7);c.strokeStyle='rgba(255,151,123,.55)';c.lineWidth=3;c.stroke();
    c.fillStyle=grad(c,-45,43,42,119,[[0,'#390b15'],[.25,'#761426'],[1,'#1a1115']]);round(c,-43,35,88,86,14);c.fill();
    c.fillStyle=gold(c,44,98);round(c,-45,46,92,13,4);c.fill();round(c,-43,99,88,10,4);c.fill();
    c.strokeStyle='rgba(255,211,143,.62)';c.setLineDash([2,4]);round(c,-36,63,75,31,4);c.lineWidth=1;c.stroke();c.setLineDash([]);
    c.fillStyle='#ddb353';c.beginPath();c.moveTo(1,64);c.lineTo(17,78);c.lineTo(1,92);c.lineTo(-15,78);c.closePath();c.fill();text(c,'C',1,79,15,'#3c1720',900);
    c.beginPath();c.moveTo(-18,7);c.bezierCurveTo(4,22,36,15,52,-4);c.strokeStyle='rgba(70,0,12,.55)';c.lineWidth=2;c.stroke();
    c.beginPath();c.moveTo(-12,3);c.bezierCurveTo(7,16,30,11,44,0);c.strokeStyle='rgba(255,165,137,.2)';c.lineWidth=1;c.stroke();c.restore();
  }
}
