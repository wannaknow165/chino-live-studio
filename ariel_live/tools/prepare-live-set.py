"""Export the EXISTING seated chair and inspect the posed rig, in a separate Blender.
Never saves or edits the source .blend. Outputs belong to the performer project.
"""
import bpy, json, os
from mathutils import Vector

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'data', 'performer'))
os.makedirs(OUT, exist_ok=True)
scene = bpy.data.scenes['Lion_Chosen_C_Animated']
bpy.context.window.scene = scene
ns = {'__name__': 'lion_chosen_live', '__file__': bpy.data.filepath + '::LionChosen_Live.py'}
exec(compile(bpy.data.texts['LionChosen_Live.py'].as_string(), ns['__file__'], 'exec'), ns)
ns['apply_frame'](ns['create_state'](), 0., None, None, 1/30)
bpy.context.view_layer.update()

def bounds(o):
    ev = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
    points = [ev.matrix_world @ Vector(c) for c in ev.bound_box]
    return {'min': [min(p[i] for p in points) for i in range(3)],
            'max': [max(p[i] for p in points) for i in range(3)]}

chairs = [o for o in scene.objects if o.name.startswith('LionChosen_C_Chair_')]
report = {'source': bpy.data.filepath, 'chair': {o.name: bounds(o) for o in chairs},
          'body': bounds(bpy.data.objects['LionChosen_C_Body']),
          'head': bounds(bpy.data.objects['LionChosen_C_Head']),
          'cameras': {o.name: {'location': list(o.location), 'rotation': list(o.rotation_euler),
                       'type': o.data.type, 'scale': o.data.ortho_scale}
                      for o in scene.objects if o.type == 'CAMERA'}}
bpy.ops.object.select_all(action='DESELECT')
for o in chairs: o.select_set(True)
bpy.context.view_layer.objects.active = chairs[0]
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'chair.glb'), export_format='GLB',
                         use_selection=True, export_apply=True, export_animations=False)
with open(os.path.join(OUT, 'set-source-audit.json'), 'w', encoding='utf-8') as f:
    json.dump(report, f, indent=2)
print('EXISTING_CHAIR_EXPORTED', len(chairs))
