"""Package the same live GLB and fitted chair as a reviewable Blender scene."""
import bpy, math, json
from pathlib import Path
from mathutils import Vector
out=Path(__file__).resolve().parent.parent/'data'/'performer'/'seated-denim'
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(out/'lion_original_denim.glb'))
bpy.ops.import_scene.gltf(filepath=str(out.parent/'seated-denim-chair'/'royal-throne.glb'))
scene=bpy.context.scene;scene.name='Original Lion - Denim Live Set'
for mat in bpy.data.materials:
 if mat.name=='LionDenim_IndigoJeans':
  p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Sheen Weight'].default_value=0
  p.inputs['Roughness'].default_value=.9
  # The runtime intentionally excludes the old skin vertex tint from jeans.
  socket=p.inputs['Base Color']
  image=next((n for n in mat.node_tree.nodes if n.type=='TEX_IMAGE'),None)
  if image:mat.node_tree.links.new(image.outputs['Color'],socket)
 if 'Cornea' in mat.name and mat.use_nodes:
  p=mat.node_tree.nodes.get('Principled BSDF')
  if p:p.inputs['Alpha'].default_value=.085;p.inputs['Roughness'].default_value=.08

bpy.ops.object.camera_add(location=(0,-4,.90))
cam=bpy.context.object;cam.name='Live portrait 9x16';cam.data.type='ORTHO';cam.data.ortho_scale=1.6
cam.rotation_euler=(Vector((0,0,.90))-cam.location).to_track_quat('-Z','Y').to_euler();scene.camera=cam
for name,pos,power,size,col in [('Warm key',(-2,-3,3),380,2,(1,.86,.68)),('Soft fill',(2,-2,2),170,2,(.78,.86,1)),('Mane rim',(.5,1.5,2.5),420,1.8,(1,.68,.35))]:
 bpy.ops.object.light_add(type='AREA',location=pos);o=bpy.context.object;o.name=name;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.data.color=col
 o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
scene.world.color=(.055,.055,.055)
scene.render.engine='BLENDER_EEVEE_NEXT';scene.render.resolution_x=1080;scene.render.resolution_y=1920;scene.render.resolution_percentage=100;scene.render.fps=30
scene.render.film_transparent=True
scene['source_authoring']='Lion_Original_Rig_Denim.blend'
scene['scope']='Same original 52-expression face and seated body, with denim, longer fur, chains and fitted chair.'
for screen in bpy.data.screens:
 for area in screen.areas:
  if area.type=='VIEW_3D':area.spaces.active.region_3d.view_perspective='CAMERA'
bpy.ops.wm.save_as_mainfile(filepath=str(out/'Lion_Denim_Live_Scene.blend'))
heads=[o for o in scene.objects if o.type=='MESH' and o.data.shape_keys]
print('LIVE_SCENE_SAVED '+json.dumps({'objects':len(scene.objects),'facial_meshes':len(heads),'target_counts':sorted(set(len(o.data.shape_keys.key_blocks)-1 for o in heads))}),flush=True)
