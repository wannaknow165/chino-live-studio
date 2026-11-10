import * as THREE from 'three';

// Two-bone arm solver. Targets are in stage metres. The existing shoulder,
// elbow and wrist joints keep their segment lengths and original skin weights.
export function createGestureRig(root) {
  const bones=new Map();root.traverse(o=>{if(o.isBone)bones.set(o.userData.name||o.name,o)});
  root.updateMatrixWorld(true);
  const arms=['L','R'].map(side=>{
    const upper=bones.get('upper_arm.'+side),fore=bones.get('forearm.'+side),hand=bones.get('hand.'+side);
    if(!upper||!fore||!hand)return null;
    const a=upper.getWorldPosition(new THREE.Vector3()),b=fore.getWorldPosition(new THREE.Vector3()),c=hand.getWorldPosition(new THREE.Vector3());
    return {side,upper,fore,hand,upperRest:upper.quaternion.clone(),foreRest:fore.quaternion.clone(),handRest:hand.quaternion.clone(),
      wrist:c,pole:b.clone().add(new THREE.Vector3(0,0,.025)),handWorld:hand.getWorldQuaternion(new THREE.Quaternion()),l1:a.distanceTo(b),l2:b.distanceTo(c),error:0};
  }).filter(Boolean);
  let mix=0;
  function pointBone(bone,child,target){
    const origin=bone.getWorldPosition(new THREE.Vector3());
    const from=child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize(),to=target.clone().sub(origin).normalize();
    const delta=new THREE.Quaternion().setFromUnitVectors(from,to);
    const world=delta.multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
    bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
    root.updateMatrixWorld(true);
  }
  function solve(arm,target,pole){
    const start=arm.upper.getWorldPosition(new THREE.Vector3());
    const direction=target.clone().sub(start);const d=THREE.MathUtils.clamp(direction.length(),Math.abs(arm.l1-arm.l2)+.001,arm.l1+arm.l2-.001);direction.normalize();
    const bend=pole.clone().sub(start);bend.addScaledVector(direction,-bend.dot(direction)).normalize();
    const along=(arm.l1*arm.l1-arm.l2*arm.l2+d*d)/(2*d),height=Math.sqrt(Math.max(0,arm.l1*arm.l1-along*along));
    const elbow=start.clone().addScaledVector(direction,along).addScaledVector(bend,height);
    const reached=start.clone().addScaledVector(direction,d);
    pointBone(arm.upper,arm.fore,elbow);pointBone(arm.fore,arm.hand,reached);
    arm.hand.quaternion.copy(arm.hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(arm.handWorld));
    root.updateMatrixWorld(true);arm.error=arm.hand.getWorldPosition(new THREE.Vector3()).distanceTo(reached);
  }
  return {
    update(t,dt,mode='idle',speaking=false){
      const active=mode!=='idle'||speaking;
      mix+=(Number(active)-mix)*(1-Math.exp(-dt/ .55));
      for(const arm of arms){
        arm.upper.quaternion.copy(arm.upperRest);arm.fore.quaternion.copy(arm.foreRest);arm.hand.quaternion.copy(arm.handRest);
      }
      root.updateMatrixWorld(true);
      if(mix<.001)return;
      for(const arm of arms){
        const sign=arm.side==='L'?1:-1,target=arm.wrist.clone();
        if(mode==='mouth'&&arm.side==='R')target.set(-.075,1.275,.245);
        else if(mode==='react')target.add(new THREE.Vector3(-sign*.05,.19+Math.sin(t*1.7)*.02,.075));
        else if(mode==='talk'||speaking)target.add(new THREE.Vector3(-sign*(.035+.015*Math.sin(t*1.8)),.08+.065*(.5+.5*Math.sin(t*2.2+sign)),.06));
        target.lerpVectors(arm.wrist,target,mix);
        const pole=arm.pole.clone();
        solve(arm,target,pole);
      }
    },
    diagnostics(){return {arms:arms.length,mix,maxReachError:Math.max(0,...arms.map(a=>a.error))}}
  };
}
