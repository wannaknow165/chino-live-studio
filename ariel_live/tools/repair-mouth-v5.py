"""Repair lining/lip correspondence on a NEW copy; preserve head topology/rig."""
import bpy, json, os
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'data', 'performer', 'mouth-v5'))
os.makedirs(OUT, exist_ok=True)
target = os.path.join(OUT, 'Lion_C_Live_Rig_v5.blend')
if os.path.exists(target): raise RuntimeError('Working copy exists; do not overwrite without reviewing it')
scene = bpy.data.scenes['Lion_Chosen_C_Animated']; bpy.context.window.scene = scene
ns = {'__name__': 'lion_chosen_live', '__file__': bpy.data.filepath + '::LionChosen_Live.py'}
exec(compile(bpy.data.texts['LionChosen_Live.py'].as_string(), ns['__file__'], 'exec'), ns)
ns['apply_frame'](ns['create_state'](), 0., None, None, 1.)
head = bpy.data.objects['LionChosen_C_Head']; lining = bpy.data.objects['LionChosen_C_MouthLining']
keys = head.data.shape_keys.key_blocks; lkeys = lining.data.shape_keys.key_blocks
parts = np.array([d.value for d in head.data.attributes['LionChosen_Part'].data])
lip = np.array([d.value for d in head.data.attributes['LionChosen_LipSide'].data])
seam = np.where((parts == 0) & (lip != 0))[0]
def coords(key):
    a = np.empty((len(key.data), 3), np.float32); key.data.foreach_get('co', a.ravel()); return a
assert len(seam) == 50 and len(lkeys[0].data) == 151
original_head = {k.name: coords(k) for k in keys}
old = {k.name: coords(k) for k in lkeys}
# Match in the OPEN pose: neutral upper and lower seam positions overlap.
tree = KDTree(len(seam))
for i in seam: tree.insert(original_head['jawOpen'][i], int(i))
tree.balance()
mapping = [tree.find(old['jawOpen'][i])[1] for i in range(50)]
if len(set(mapping)) != 50:
    # One-to-one closest assignment avoids assigning both lips to the same side.
    available = set(map(int, seam)); mapping = []
    for p in old['jawOpen'][:50]:
        i = min(available, key=lambda k: float(np.linalg.norm(original_head['jawOpen'][k] - p)))
        mapping.append(i); available.remove(i)
before = {}
for name in ['Basis', 'jawOpen', 'mouthFunnel', 'mouthPucker', 'mouthClose']:
    before[name] = float(np.max(np.linalg.norm(old[name][:50] - original_head[name][mapping], axis=1)))
for key in lkeys:
    edge = original_head[key.name][mapping].astype(np.float64)
    centre = edge.mean(axis=0)
    a = np.empty((151, 3), np.float32)
    # Bury the first ring just inside the lip. Recess the second ring behind
    # teeth instead of letting it cut across the lower dental arch.
    for ring, (scale, depth) in enumerate([(0.997, .0012), (.89, .017), (.56, .058)]):
        pts = centre + (edge - centre) * scale
        pts[:, 1] += depth
        a[ring*50:(ring+1)*50] = pts
    a[150] = centre + np.array([0., .078, 0.])
    key.data.foreach_set('co', a.ravel())
lining.data.vertices.foreach_set('co', coords(lkeys[0]).ravel())
for p in lining.data.polygons: p.use_smooth = True
lining.data.update()
lining['LionLive_LiningRevision'] = 5
lining['LionLive_LiningFix'] = 'One-to-one posed lip correspondence in all 52 targets; recessed inner rings behind dental arches'
assert all(np.array_equal(coords(keys[n]), a) for n,a in original_head.items()), 'Head geometry changed'
for k in keys: k.value = 0.
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get(); ev = head.evaluated_get(dg); me = ev.to_mesh()
centre = sum([ev.matrix_world @ me.vertices[int(i)].co for i in seam], Vector()) / len(seam); ev.to_mesh_clear()
cam = bpy.data.objects['LionChosen_C_FaceCamera']
saved_camera = cam.matrix_world.copy(); saved_scale = cam.data.ortho_scale
cam.location = (centre.x, centre.y-1., centre.z)
cam.rotation_euler = (centre-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.type = 'ORTHO'; cam.data.ortho_scale = .15; cam.data.clip_start = .005
scene.camera = cam; scene.render.resolution_x = 1000; scene.render.resolution_y = 750; scene.render.resolution_percentage = 100
scene.render.engine = 'BLENDER_EEVEE_NEXT'; scene.eevee.taa_render_samples = 32
scene.render.image_settings.file_format = 'PNG'
for name in ('LionChosen_C_DenseManeGroom','LionChosen_C_ShortFaceFur'): bpy.data.objects[name].hide_render = True
scene.lion_chosen_settings.fur_detail = .35
poses = {'neutral': {}, 'open': {'jawOpen':.65}, 'wide': {'jawOpen':1.},
 'round': {'jawOpen':.3,'mouthFunnel':.65,'mouthPucker':.3},
 'seal': {'jawOpen':.35,'mouthClose':.35}, 'smile': {'jawOpen':.3,'mouthSmileLeft':.5,'mouthSmileRight':.5}}
for name, values in poses.items():
    for k in keys: k.value = 0.
    for n,v in values.items(): keys[n].value = v
    bpy.context.view_layer.update()
    scene.render.filepath = os.path.join(OUT, 'after_' + name + '.png')
    bpy.ops.render.render(write_still=True); print('MOUTH_FIXED_RENDER', name, flush=True)
for k in keys: k.value = 0.
cam.matrix_world = saved_camera; cam.data.ortho_scale = saved_scale
scene.camera = bpy.data.objects['LionChosen_C_MediumCamera']
scene.render.resolution_x = 1080; scene.render.resolution_y = 1920; scene.render.fps = 30
scene.render.film_transparent = True
bpy.ops.wm.save_as_mainfile(filepath=target)
report = {'source_preserved': True, 'head_vertices_preserved': len(head.data.vertices),
          'facial_targets_preserved': len(keys)-1, 'lining_vertices_preserved': len(lining.data.vertices),
          'seam_mapping_unique': len(set(mapping)), 'before_seam_max_distance_m': before, 'file': target}
with open(os.path.join(OUT,'repair-report.json'),'w') as f: json.dump(report,f,indent=2)
print('MOUTH_V5_SAVED', target, flush=True)
