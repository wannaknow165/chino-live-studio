import bpy, os, json
from mathutils import Vector
out = os.path.abspath(os.path.join(os.path.dirname(__file__), '..','data','performer','mouth-v5'))
s=bpy.data.scenes['Lion_Chosen_C_Animated']; bpy.context.window.scene=s
h=bpy.data.objects['LionChosen_C_Head']; keys=h.data.shape_keys.key_blocks
for k in keys: k.value=0
for n,v in {'jawOpen':.3,'mouthFunnel':.65,'mouthPucker':.3}.items(): keys[n].value=v
bpy.context.view_layer.update()
ev=h.evaluated_get(bpy.context.evaluated_depsgraph_get()); me=ev.to_mesh()
idx=[i for i,d in enumerate(h.data.attributes['LionChosen_LipSide'].data) if d.value!=0 and h.data.attributes['LionChosen_Part'].data[i].value==0]
c=sum([ev.matrix_world@me.vertices[i].co for i in idx],Vector())/len(idx); ev.to_mesh_clear()
cam=bpy.data.objects['LionChosen_C_FaceCamera']; cam.location=(c.x,c.y-1,c.z)
cam.rotation_euler=(c-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=.15;s.camera=cam
s.render.resolution_x=800;s.render.resolution_y=600;s.render.resolution_percentage=100;s.eevee.taa_render_samples=16
names=['LionChosen_C_MouthLining','LionChosen_C_V4_OralFloor','LionChosen_C_V4_Palate']
report={}
for n in names:
 o=bpy.data.objects[n]; report[n]={'matrix':[list(r) for r in o.matrix_world],'keys':{k.name:k.value for k in o.data.shape_keys.key_blocks if k.value} if o.data.shape_keys else {},'modifiers':[m.type for m in o.modifiers]}
for n in names:
 o=bpy.data.objects[n];o.hide_render=True;s.render.filepath=os.path.join(out,'without_'+n+'.png');bpy.ops.render.render(write_still=True);o.hide_render=False
with open(os.path.join(out,'isolation.json'),'w') as f:json.dump(report,f,indent=2)
