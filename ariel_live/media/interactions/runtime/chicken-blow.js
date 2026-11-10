import {SideDance} from './side-dance.js';
export function validateChickenBlow(p){
 if(p?.version!==1||p.kind!=='chicken_blow'||p.reviewed!==true||p.duration!==6||p.blowAt!==2.8||p.exitAt!==3.8||p.enterFrom!==.4||p.standAt!==2||p.groundY!==.65||p.standX!==.22||p.width!==.28)throw new Error('invalid_chicken_blow_profile');return p;
}
export function chickenBlowRect(p,t,w,h,sw,sh){
 validateChickenBlow(p);if(![t,w,h,sw,sh].every(Number.isFinite)||w<=0||h<=0||sw<=0||sh<=0)throw new Error('invalid_chicken_blow_geometry');
 let x=-.2,y=p.groundY,scale=p.width,rotation=0,state='entering';
 if(t>=p.enterFrom&&t<p.standAt){const k=(t-p.enterFrom)/(p.standAt-p.enterFrom);x=-.2+(.22+.2)*k;}
 else if(t>=p.standAt&&t<p.blowAt){x=p.standX;y+=.01*Math.sin((t-p.standAt)*Math.PI*5);state='calling';}
 else if(t>=p.blowAt){const k=Math.min(1,(t-p.blowAt)/(p.exitAt-p.blowAt));x=p.standX+(-.3-p.standX)*k;y=p.groundY+(.4-p.groundY)*k;scale=p.width+(.22-p.width)*k;rotation=-40*Math.PI/180*k;state=t>=p.exitAt?'gone':'flying';}
 const width=w*scale,height=width*sh/sw;return {x:x*w-width/2,y:y*h-height,pivotX:x*w,pivotY:y*h,width,height,rotation,alpha:1,visible:t>=p.enterFrom&&t<p.exitAt,stopSource:t>=p.exitAt,state};
}
export class ChickenBlow extends SideDance{
 validateProfile(p){return validateChickenBlow(p);}
 rectangle(...args){return chickenBlowRect(...args);}
}
