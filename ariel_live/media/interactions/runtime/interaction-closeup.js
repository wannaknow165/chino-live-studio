const clamp=x=>Math.max(0,Math.min(1,x));
export function closeupScale(p,{elapsed,sourceComplete,time}){
 if(!p)return 1;
 if(![p.scale,p.afterSeconds,p.rampSeconds,p.releaseUntil,p.focus?.x,p.focus?.y,elapsed,time].every(Number.isFinite)||p.scale<1||p.scale>4||p.afterSeconds<0||p.rampSeconds<=0||p.releaseUntil<=0||p.focus.x<0||p.focus.x>1||p.focus.y<0||p.focus.y>1)throw new Error('invalid_interaction_closeup');
 const amount=sourceComplete?clamp((p.releaseUntil-time)/p.rampSeconds):clamp((elapsed-p.afterSeconds)/p.rampSeconds);
 return 1+(p.scale-1)*(amount*amount*(3-2*amount));
}
export function applyCloseup(elements,profile,scale){
 for(const element of elements){if(!element?.style)continue;element.style.transform=scale===1?'':`scale(${scale})`;element.style.transformOrigin=scale===1?'':`${profile.focus.x*100}% ${profile.focus.y*100}%`;}
}
