"""Finite close-up inspection in an isolated Blender. Does not save the source."""
import bpy, json, os
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'data', 'performer', 'mouth-v5'))
os.makedirs(OUT, exist_ok=True)
scene = bpy.data.scenes['Lion_Chosen_C_Animated']; bpy.context.window.scene = scene
ns = {'__name__': 'lion_chosen_live', '__file__': bpy.data.filepath + '::LionChosen_Live.py'}
exec(compile(bpy.data.texts['LionChosen_Live.py'].as_string(), ns['__file__'], 'exec'), ns)
state = ns['create_state'](); ns['apply_frame'](state, 0., None, None, 1.)
head = bpy.data.objects['LionChosen_C_Head']; keys = head.data.shape_keys.key_blocks
parts = np.array([d.value for d in head.data.attributes['LionChosen_Part'].data])
lip = np.array([d.value for d in head.data.attributes['LionChosen_LipSide'].data])
idx = np.where((parts == 0) & (lip != 0))[0]
dg = bpy.context.evaluated_depsgraph_get(); ev = head.evaluated_get(dg); me = ev.to_mesh()
points = [ev.matrix_world @ me.vertices[int(i)].co for i in idx]; ev.to_mesh_clear()
centre = sum(points, Vector()) / len(points)
cam = bpy.data.objects['LionChosen_C_FaceCamera']
cam.location = (centre.x, centre.y - 1., centre.z)
cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam.data.type = 'ORTHO'; cam.data.ortho_scale = .15; cam.data.clip_start = .005
scene.camera = cam; scene.render.resolution_x = 1000; scene.render.resolution_y = 750; scene.render.resolution_percentage = 100
scene.render.engine = 'BLENDER_EEVEE_NEXT'; scene.eevee.taa_render_samples = 32
scene.render.image_settings.file_format = 'PNG'
for name in ('LionChosen_C_DenseManeGroom', 'LionChosen_C_ShortFaceFur'):
    bpy.data.objects[name].hide_render = True
scene.lion_chosen_settings.fur_detail = .35
report = {'posed_lip_centre': list(centre), 'poses': {}, 'drivers': {}}
for name in ['LionChosen_C_MouthLining', 'LionChosen_C_V4_OralFloor', 'LionChosen_C_V4_Palate']:
    obj = bpy.data.objects[name]
    if obj.data.shape_keys and obj.data.shape_keys.animation_data:
        report['drivers'][name] = [d.data_path for d in obj.data.shape_keys.animation_data.drivers]
poses = {'neutral': {}, 'open': {'jawOpen': .65}, 'wide': {'jawOpen': 1.},
         'round': {'jawOpen': .3, 'mouthFunnel': .65, 'mouthPucker': .3},
         'seal': {'jawOpen': .35, 'mouthClose': .35}}
for pose, values in poses.items():
    for k in keys: k.value = 0.
    for k,v in values.items(): keys[k].value = v
    bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get()
    crossings = []
    for o in scene.objects:
        if o.type != 'MESH' or o.hide_render or o.name.startswith('LionChosen_C_Chair'): continue
        if not any(n in o.name for n in ('Head', 'Mouth', 'Dental', 'Palate', 'Oral', 'Gum')): continue
        ev = o.evaluated_get(dg); mesh = ev.to_mesh()
        world = [ev.matrix_world @ v.co for v in mesh.vertices]
        tree = BVHTree.FromPolygons(world, [list(p.vertices) for p in mesh.polygons])
        for dz in [-.018,-.01,0.,.01]:
            origin = Vector((centre.x, centre.y-.5, centre.z+dz))
            hit, normal, poly, distance = tree.ray_cast(origin, Vector((0,1,0)))
            if hit: crossings.append({'object':o.name, 'row':dz, 'point':list(hit), 'distance':distance,
                                      'material': mesh.polygons[poly].material_index})
        ev.to_mesh_clear()
    report['poses'][pose] = crossings
    scene.render.filepath = os.path.join(OUT, 'before_' + pose + '.png')
    bpy.ops.render.render(write_still=True)
    print('MOUTH_RENDERED', pose, flush=True)
with open(os.path.join(OUT, 'inspection.json'), 'w') as f: json.dump(report, f, indent=2)
print('MOUTH_INSPECTION_DONE', flush=True)
