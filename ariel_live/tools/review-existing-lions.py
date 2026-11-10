"""Read-only renders of existing candidate meshes. Source files are untouched."""
import bpy,os,math,json
from mathutils import Vector
base=r'C:\Users\shk\Downloads\Design_3D_CAD'
sources=['royal lion 3d model.glb','king+lion+3d+model.glb','photo_2026_07_03_02_40_55_Lion_wearing_a_crown_and_gold_chain_Prism_31_a58966a0.glb','royallion3dmodel-parts.glb']
out=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','data','performer','source-review'));os.makedirs(out,exist_ok=True)
report=[]
for index,filename in enumerate(sources):
 bpy.ops.wm.read_factory_settings(use_empty=True);s=bpy.context.scene
 bpy.ops.import_scene.gltf(filepath=os.path.join(base,filename))
 meshes=[o for o in s.objects if o.type=='MESH'];pts=[o.matrix_world@Vector(co)for o in meshes for co in o.bound_box]
 low=Vector(tuple(min(p[i]for p in pts)for i in range(3)));high=Vector(tuple(max(p[i]for p in pts)for i in range(3)));center=(low+high)*.5;size=high-low
 bpy.ops.object.camera_add(location=(center.x,center.y-max(size)*3,center.z));cam=bpy.context.object;cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=max(size.z,size.x*1.5)*1.12;s.camera=cam
 s.world=bpy.data.worlds.new('Review world');s.world.use_nodes=True;s.world.node_tree.nodes['Background'].inputs[0].default_value=(.08,.08,.08,1);s.world.node_tree.nodes['Background'].inputs[1].default_value=.6
 for pos,energy,scale in [((-1,-2,2),600,2),((2,-1,1),350,3),((1,2,2),500,2)]:
  bpy.ops.object.light_add(type='AREA',location=center+Vector(pos)*max(size));l=bpy.context.object;l.rotation_euler=(center-l.location).to_track_quat('-Z','Y').to_euler();l.data.energy=energy*max(size)**2;l.data.shape='DISK';l.data.size=scale*max(size)
 s.render.engine='BLENDER_EEVEE_NEXT';s.eevee.taa_render_samples=16;s.render.resolution_x=480;s.render.resolution_y=720;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.render.film_transparent=False
 s.render.filepath=os.path.join(out,f'candidate-{index+1}.png');bpy.ops.render.render(write_still=True)
 report.append({'file':os.path.join(base,filename),'image':s.render.filepath,'meshes':[(o.name,len(o.data.vertices),len(o.data.polygons))for o in meshes],'armatures':[o.name for o in s.objects if o.type=='ARMATURE'],'bounds':[list(low),list(high)]})
 with open(os.path.join(out,'index.json'),'w')as f:json.dump(report,f,indent=2)
 print('REVIEWED',index+1,filename,flush=True)
