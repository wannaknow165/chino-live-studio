"""Upload copy only: retain the full skeleton and face morphs, omit groom.

Long 3D fur stays in the local master. Retexturing the skin doesn't require
uploading millions of individual strands. No service upload or paid calls.
"""
import bpy, json, struct
from pathlib import Path
out=Path(__file__).resolve().parent.parent/'data'/'performer'/'seated-denim'
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(out/'lion_original_denim.glb'))
omitted=[]
for o in list(bpy.data.objects):
 if any(n in o.name for n in ('ArmHandFur','DenseManeGroom','ShortFaceFur_LiveLOD')):
  omitted.append(o.name);bpy.data.objects.remove(o,do_unlink=True)
for o in bpy.context.scene.objects:
 if o.type=='MESH' and o.data.shape_keys:
  for key in o.data.shape_keys.key_blocks:key.value=0.
for m in bpy.data.materials:
 if m.name=='LionDenim_IndigoJeans':
  p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Sheen Weight'].default_value=0
  image=next((n for n in m.node_tree.nodes if n.type=='TEX_IMAGE'),None)
  if image:m.node_tree.links.new(image.outputs['Color'],p.inputs['Base Color'])
bpy.ops.object.select_all(action='SELECT')
target=out/'Lion_For_Tripo_Texture.glb'
bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',use_selection=True,export_animations=False,export_cameras=False,export_morph=True,export_morph_normal=False,export_morph_tangent=False)
with target.open('rb')as f:
 f.read(12);size,_=struct.unpack('<II',f.read(8));data=json.loads(f.read(size))
report={'file':str(target),'bytes':target.stat().st_size,'source_master':'lion_original_denim.glb','purpose':'Retexturing trial only; reuse returned texture maps on local master after checking UV correspondence','skeleton_joint_counts':[len(s['joints'])for s in data.get('skins',[])],'morph_counts':sorted(set(len(p['targets'])for m in data['meshes']for p in m['primitives']if p.get('targets'))),'omitted_groom_objects':omitted,'morph_normals_omitted':True,'rig_preservation_by_provider':'UNVERIFIED','uploaded':False}
assert report['morph_counts']==[52],report
assert 38 in report['skeleton_joint_counts'],report
assert report['bytes']<150_000_000,'Upload copy still exceeds documented API limit'
(out/'tripo-upload-copy.json').write_text(json.dumps(report,indent=2),encoding='utf8')
print('TRIPO_UPLOAD_COPY_READY '+json.dumps(report),flush=True)
