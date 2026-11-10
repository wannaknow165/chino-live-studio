"""Remove the redundant legacy cavity and seat the replacement behind teeth."""
import bpy,os,json,numpy as np
out=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','data','performer','mouth-v6'));os.makedirs(out,exist_ok=True)
target=os.path.join(out,'Lion_C_Live_Rig_v6.blend')
if os.path.exists(target):raise RuntimeError('Existing v6 checkpoint must be preserved')
s=bpy.data.scenes['Lion_Chosen_C_Animated'];bpy.context.window.scene=s
h=bpy.data.objects['LionChosen_C_Head'];keys=h.data.shape_keys.key_blocks
parts=np.array([d.value for d in h.data.attributes['LionChosen_Part'].data])
for k in keys:
 a=np.empty((len(k.data),3),np.float32);k.data.foreach_get('co',a.ravel())
 a[parts==1]=(0,.08,1.5);k.data.foreach_set('co',a.ravel());k.value=0
lining=bpy.data.objects['LionChosen_C_MouthLining']
for k in lining.data.shape_keys.key_blocks:
 a=np.empty((len(k.data),3),np.float32);k.data.foreach_get('co',a.ravel());a[:,1]+=.03;k.data.foreach_set('co',a.ravel())
for o in [h,lining]:
 a=np.empty((len(o.data.vertices),3),np.float32);o.data.shape_keys.key_blocks[0].data.foreach_get('co',a.ravel());o.data.vertices.foreach_set('co',a.ravel());o.data.update()
h['LionLive_MouthRevision']=6;lining['LionLive_LiningRevision']=6
s.render.resolution_x=1080;s.render.resolution_y=1920;s.render.fps=30;s.render.film_transparent=True
bpy.context.view_layer.update();bpy.ops.wm.save_as_mainfile(filepath=target)
with open(os.path.join(out,'repair-report.json'),'w')as f:json.dump({'source':'v5 copy; original v4 unchanged','file':target,'head_vertices':len(h.data.vertices),'facial_targets':len(keys)-1,'skin_vertices_unchanged':int((parts==0).sum()),'redundant_cavity_vertices_collapsed':int((parts==1).sum()),'lining_recession_m':.03},f,indent=2)
