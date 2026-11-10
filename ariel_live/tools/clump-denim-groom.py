"""Style the existing long groom into locks without changing its skinning."""
import bpy, numpy as np, json
from mathutils.kdtree import KDTree
from pathlib import Path
out=Path(__file__).resolve().parent.parent/'data'/'performer'/'seated-denim'
o=bpy.data.objects['LionV9_ArmHandFur']; me=o.data
if o.get('LionDenim_Clumped'):raise RuntimeError('Groom is already clumped')
xyz=np.empty((len(me.vertices),3),np.float32);me.vertices.foreach_get('co',xyz.ravel())
a=xyz.reshape(-1,4,3,3);centers=a.mean(2);radial=a-centers[:,:,None,:]
roots=centers[:,0];rng=np.random.default_rng(91014)
guide_ids=rng.choice(len(roots),1800,replace=False)
tree=KDTree(len(guide_ids))
for i,g in enumerate(guide_ids):tree.insert(roots[g],i)
tree.balance()
nearest=np.array([guide_ids[tree.find(tuple(p))[1]] for p in roots],np.int32)
guide=centers[nearest]
for k,t in enumerate((0.,.33,.66,1.)):
 w=.70*t*t
 # Preserve root attachment and individual strand length while creating
 # coherent flow toward the adjacent guide strand.
 centers[:,k]=centers[:,k]*(1-w)+guide[:,k]*w
 a[:,k]=centers[:,k,None,:]+radial[:,k]*2.0
me.vertices.foreach_set('co',xyz.ravel());me.update()
o['LionDenim_Clumped']=True
bpy.ops.wm.save_as_mainfile(filepath=str(out/'Lion_Original_Rig_Denim.blend'))
report=json.loads((out/'style-report.json').read_text())
report.update({'groom_guides':1800,'groom_clumping':.70,'strand_radius_multiplier':2.0})
(out/'style-report.json').write_text(json.dumps(report,indent=2))
print('LONG_GROOM_CLUMPED',flush=True)
