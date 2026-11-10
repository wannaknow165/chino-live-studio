"""Deterministic GLB presentation fixes; binary geometry/morphs untouched."""
import json, struct, math, numpy as np
from pathlib import Path
root=Path(__file__).resolve().parent.parent/'data'/'performer'
def matrix(n):
 if 'matrix' in n:return np.array(n['matrix']).reshape(4,4).T
 x,y,z,w=n.get('rotation',[0,0,0,1]);m=np.eye(4)
 m[:3,:3]=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])@np.diag(n.get('scale',[1,1,1]))
 m[:3,3]=n.get('translation',[0,0,0]);return m
for path in [root/'seated-denim'/'lion_original_denim.glb',root/'seated-denim-chair'/'royal-throne.glb',root/'seated-denim'/'Lion_For_Tripo_Texture.glb']:
 if not path.exists():continue
 with path.open('rb')as f:
  f.read(12);length,kind=struct.unpack('<II',f.read(8));d=json.loads(f.read(length));remaining=f.read()
 nodes=d.get('nodes',[]);parents={child:i for i,n in enumerate(nodes)for child in n.get('children',[])};world={}
 def wm(i):
  if i not in world:world[i]=(wm(parents[i]) if i in parents else np.eye(4))@matrix(nodes[i])
  return world[i]
 for i,n in enumerate(nodes):
  if 'LionV8_Chain_Denim' in n.get('name','') and not n.get('extras',{}).get('fur_clearance_added'):
   parent=wm(parents[i]) if i in parents else np.eye(4)
   delta=np.linalg.inv(parent[:3,:3])@np.array([0,0,.048])
   if 'matrix' in n:
    for axis in range(3):n['matrix'][12+axis]+=float(delta[axis])
   else:n['translation']=(np.array(n.get('translation',[0,0,0]))+delta).tolist()
   n.setdefault('extras',{})['fur_clearance_added']=True
 for m in d.get('materials',[]):
  if 'velvet' in m.get('name','').lower() or m.get('name')=='LionDenim_IndigoJeans':
   m.get('extensions',{}).pop('KHR_materials_sheen',None)
   m.setdefault('pbrMetallicRoughness',{})['roughnessFactor']=.88
 for mesh in d.get('meshes',[]):
  for p in mesh['primitives']:
   if d['materials'][p.get('material',0)].get('name')=='LionDenim_IndigoJeans':p['attributes'].pop('COLOR_0',None)
 payload=json.dumps(d,separators=(',',':')).encode();payload+=b' '*((-len(payload))%4)
 temp=path.with_suffix('.finishing.glb')
 with temp.open('wb')as f:
  f.write(struct.pack('<III',0x46546c67,2,20+len(payload)+len(remaining)));f.write(struct.pack('<II',len(payload),0x4e4f534a));f.write(payload);f.write(remaining)
 temp.replace(path);print('FINISHED',path.name,path.stat().st_size)
