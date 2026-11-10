import bpy,os
from mathutils import Vector
s=bpy.data.scenes['Lion_Chosen_C_Animated'];bpy.context.window.scene=s
cam=bpy.data.objects['LionChosen_C_FaceCamera'];cam.location=(0,-3,1.28);cam.rotation_euler=(Vector((0,0,1.28))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=.86;s.camera=cam
s.render.engine='BLENDER_EEVEE_NEXT';s.eevee.taa_render_samples=32;s.render.resolution_x=720;s.render.resolution_y=1280;s.render.resolution_percentage=100
s.render.filepath=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','data','performer','appearance-v8','preview.png'))
bpy.ops.render.render(write_still=True)
