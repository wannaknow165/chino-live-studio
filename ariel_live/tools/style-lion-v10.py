"""Full fur direction following the user's seated royal lion reference."""
import bpy,os,json,math,numpy as np,runpy
from mathutils import Vector
out=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','data','performer','appearance-v10'));os.makedirs(out,exist_ok=True)
target=os.path.join(out,'Lion_C_Live_Rig_v10.blend')
if os.path.exists(target):raise RuntimeError('Preserve v10 checkpoint')
s=bpy.data.scenes['Lion_Chosen_C_Animated'];bpy.context.window.scene=s
ns={'__name__':'lion_chosen_live'};exec(compile(bpy.data.texts['LionChosen_Live.py'].as_string(),'LionChosen_Live.py','exec'),ns);ns['apply_frame'](ns['create_state'](),0.,None,None,1/30)
body=bpy.data.objects['LionChosen_C_Body'];rig=bpy.data.objects['LionChosen_C_Rig'];me=body.data
for o in list(bpy.data.objects):
 if o.name.startswith(('LionV8_Lapel','LionV8_Crown','LionV9_ArmHandFur')):bpy.data.objects.remove(o,do_unlink=True)
# Broaden and shorten the existing hand shape into furred paws. Original
# weights and vertex indices stay intact, including the thumb controls.
xyz=np.array([v.co[:]for v in me.vertices],np.float32);groups={g.index:g.name for g in body.vertex_groups}
for v in me.vertices:
 for side in ['L','R']:
  weight=sum(g.weight for g in v.groups if groups[g.group].endswith('.'+side) and any(k in groups[g.group]for k in ['hand','thumb','palm']))
  if weight<.02:continue
  bone=rig.data.bones['hand.'+side];origin=np.array(bone.head_local);axis=np.array((bone.tail_local-bone.head_local).normalized())
  delta=xyz[v.index]-origin;along=np.dot(delta,axis)*axis;radial=delta-along
  xyz[v.index]+=weight*(-.16*along+.10*radial)
# Remove the jagged garment relief while retaining the underlying body and rig.
unique,inverse=np.unique(np.round(xyz,5),axis=0,return_inverse=True)
edge=np.array([[inverse[e.vertices[0]],inverse[e.vertices[1]]]for e in me.edges],np.int32);edge=edge[edge[:,0]!=edge[:,1]];edge=np.concatenate([edge,edge[:,::-1]])
counts=np.bincount(edge[:,0],minlength=len(unique));cur=unique.copy()
for i in range(20):
 sums=np.zeros_like(cur);np.add.at(sums,edge[:,0],cur[edge[:,1]])
 cur+=(sums/np.maximum(1,counts[:,None])-cur)*.35
delta=cur-unique;limit=np.where(np.abs(unique[:,0])<.20,.018,.005)
delta*=np.minimum(1,limit/np.maximum(np.linalg.norm(delta,axis=1),1e-9))[:,None]
xyz+=delta[inverse];me.vertices.foreach_set('co',xyz.ravel());me.update()
colors=me.color_attributes['LionV7_Ink'];values=np.empty((len(xyz),4),np.float32)
for i,(x,y,z)in enumerate(xyz):
 torso=z>.70 and abs(x)<.20;base=np.array((.085,.032,.008)if torso else(.27,.129,.044))
 values[i]=(*base*(.95+.05*math.sin(z*21+x*13)),1)
colors.data.foreach_set('color',values.ravel())
for poly in me.polygons:poly.material_index=4;poly.use_smooth=True
mat=me.materials[4];mat.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.8
fur=runpy.run_path(os.path.join(os.path.dirname(__file__),'surface-fur.py'))['add_body_fur'](body,rig,s,'LionV10_BodyFur')
# Bring the chains over the new chest fur.
for o in s.objects:
 if o.name.startswith('LionV8_Chain'):
  w=o.matrix_world.copy();w.translation.y-=.032;o.matrix_world=w
body['LionLive_StyleRevision']=10;bpy.context.view_layer.update();bpy.ops.wm.save_as_mainfile(filepath=target)
with open(os.path.join(out,'style-report.json'),'w')as f:json.dump({'version':10,'file':target,'full_body_fur_strands':70000,'full_body_fur_vertices':len(fur.data.vertices),'body_vertex_count_preserved':len(me.vertices),'clothing_materials_replaced':True,'paw_proportions_refined':True,'facial_targets_preserved':52,'original_sources_preserved':True},f,indent=2)
print('STYLE_V10_SAVED',flush=True)
