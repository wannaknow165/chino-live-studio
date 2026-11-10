"""Reuse the user's detailed lion and existing quadruped skeleton.

This is a separate design checkpoint. It does not replace or claim to inherit
the production facial rig. Skin weights are transferred from the supplied rig.
"""
import bpy,os,json,math,numpy as np,time
from mathutils import Vector,Matrix
from mathutils.kdtree import KDTree
bpy.ops.wm.read_factory_settings(use_empty=True)
root=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','data','performer','royal-hero-v11'));os.makedirs(root,exist_ok=True)
if os.path.exists(os.path.join(root,'Royal_Lion_Hero_v11.blend')):raise RuntimeError('Preserve hero checkpoint')
base=r'C:\Users\shk\Downloads\Design_3D_CAD'
lowpath=os.path.join(base,'royal+lion+3d+model.glb');highpath=os.path.join(base,'king+lion+3d+model.glb')
bpy.ops.import_scene.gltf(filepath=lowpath);bpy.context.view_layer.update()
rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');low=max((o for o in bpy.context.scene.objects if o.type=='MESH' and any(m.type=='ARMATURE'for m in o.modifiers)),key=lambda o:len(o.data.vertices))
oldobjects=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=highpath);bpy.context.view_layer.update()
high=max((o for o in bpy.context.scene.objects if o not in oldobjects and o.type=='MESH'),key=lambda o:len(o.data.vertices));high.name='RoyalLion_HeroSkin'
# Use the existing skeleton in its bind coordinates. World-space points avoid
# accidental double transforms from the imported glTF node hierarchy.
high.data.transform(high.matrix_world);high.matrix_world=Matrix.Identity(4)
points=np.array([low.matrix_world@v.co for v in low.data.vertices]);highpoints=np.array([v.co[:]for v in high.data.vertices])
loA,hiA=points.min(axis=0),points.max(axis=0);loB,hiB=highpoints.min(axis=0),highpoints.max(axis=0)
alignment=(hiA-loA)/(hiB-loB)
kd=KDTree(len(points))
for i,p in enumerate(points):kd.insert(Vector(p),i)
kd.balance();weightsets=[tuple((g.group,round(g.weight,3))for g in v.groups if g.weight>.002)for v in low.data.vertices]
for g in low.vertex_groups:high.vertex_groups.new(name=g.name)
buckets={};distances=[]
for index,p in enumerate(highpoints):
 query=(p-loB)*alignment+loA;_,near,d=kd.find(Vector(query));distances.append(d)
 for group,weight in weightsets[near]:buckets.setdefault((group,weight),[]).append(index)
for (group,weight),indices in buckets.items():high.vertex_groups[group].add(indices,weight,'REPLACE')
mod=high.modifiers.new('Transferred existing quadruped skin','ARMATURE');mod.object=rig
high.parent=rig;high.matrix_parent_inverse=rig.matrix_world.inverted()
rig.name='RoyalLion_BodyRig';rig['design_revision']=11
# Drop only the imported low-detail display mesh and its helper widgets from
# this new working scene. Original source files are never changed.
for obj in list(oldobjects):
 if obj!=rig and obj.type in {'MESH','EMPTY'}:bpy.data.objects.remove(obj,do_unlink=True)
group=bpy.data.objects.new('RoyalLion_Placement',None);bpy.context.scene.collection.objects.link(group)
world=rig.matrix_world.copy();rig.parent=group;rig.matrix_world=world
group.rotation_euler.z=-math.pi/2;group.scale=(1.05,1.05,1.05);group.location.z=.658
bpy.context.view_layer.update()
# Save editable asset before render/export. The chair stays a separate asset.
s=bpy.context.scene;s.name='Royal_Lion_Hero_Design'
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(root,'Royal_Lion_Hero_v11.blend'))
bpy.ops.object.select_all(action='DESELECT')
for o in [high,rig,group]:o.select_set(True)
bpy.context.view_layer.objects.active=high
bpy.ops.export_scene.gltf(filepath=os.path.join(root,'royal-lion-hero-v11.glb'),export_format='GLB',use_selection=True,export_animations=False,export_morph=False,export_yup=True)
report={'source_surface':highpath,'source_rig':lowpath,'vertices':len(high.data.vertices),'polygons':len(high.data.polygons),'bones':len(rig.data.bones),'weight_transfer_median_distance':float(np.median(distances)),'weight_transfer_p95_distance':float(np.quantile(distances,.95)),'facial_rig_ready':False,'original_sources_preserved':True}
with open(os.path.join(root,'report.json'),'w')as f:json.dump(report,f,indent=2)
print('ROYAL_HERO_EXPORTED '+json.dumps(report),flush=True)
