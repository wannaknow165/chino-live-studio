import bpy,os,json
root=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','data','performer','royal-throne-v2'));os.makedirs(root,exist_ok=True)
if os.path.exists(os.path.join(root,'Royal_Throne_Fitted.blend')):raise RuntimeError('Preserve fitted chair')
for o in bpy.context.scene.objects:
 name=o.name
 if name.startswith(('Tufted burgundy back','Back ','Shoulder ','Throne crest','Crest red')):o.location.y+=.29
 if name.startswith('Seat velvet cushion'):o.location.y=.10;o.scale.y*=1.60
 if name.startswith('Seat walnut foundation'):o.location.y=.08;o.scale.y*=1.52
 if name.startswith('Burgundy padded arm'):o.location.y=.10;o.scale.y*=1.63
 if name.startswith('Rear gold leg'):o.location.y+=.24
 if name.startswith('Armrest ') and o.type=='CURVE':
  for sp in o.data.splines:
   for p in sp.bezier_points:p.co.y=-.30+(p.co.y+.30)*1.72
bpy.context.view_layer.update();bpy.ops.wm.save_as_mainfile(filepath=os.path.join(root,'Royal_Throne_Fitted.blend'))
bpy.ops.object.select_all(action='SELECT');bpy.ops.export_scene.gltf(filepath=os.path.join(root,'royal-throne-fitted.glb'),export_format='GLB',use_selection=True,export_animations=False)
print('FITTED_CHAIR_EXPORTED',flush=True)
