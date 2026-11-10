"""Bake the verified seated lion into GPU morph targets in an isolated Blender.

Does not save or modify the authoring .blend. The dental arches retain a rigid
mandibular pivot. Surface-bound fur, eyes, lining and whiskers retain facial
deformation as morph targets rather than runtime CPU geometry nodes.
"""
import bpy
import json
import os
import time
import numpy as np
from mathutils import Matrix

ROOT = os.path.dirname(__file__)
OUT = os.path.abspath(os.path.join(ROOT, '..', 'data', 'performer', 'renderer-v7'))
os.makedirs(OUT, exist_ok=True)
scene = bpy.data.scenes['Lion_Chosen_C_Animated']
bpy.context.window.scene = scene
scope = {'__name__':'lion_chosen_live','__file__':os.path.join(ROOT,'lion_chosen_live_v4.py')}
exec(compile(bpy.data.texts['LionChosen_Live.py'].as_string(),scope['__file__'],'exec'),scope)
scope['apply_frame'](scope['create_state'](), 0., None, None, 1/30)
head = bpy.data.objects['LionChosen_C_Head']
keys = head.data.shape_keys.key_blocks
for key in keys:
    key.value = 0.
bpy.context.view_layer.update()
rig = bpy.data.objects['LionChosen_C_Rig']
head_pivot = rig.matrix_world @ rig.pose.bones['spine.005'].matrix.translation
jaw_pivot = rig.matrix_world @ rig.pose.bones['LionChosen_DentalJaw'].matrix.translation

collection = bpy.data.collections.new('Lion_Realtime_Export')
scene.collection.children.link(collection)
def empty(name, location, parent=None):
    obj = bpy.data.objects.new(name, None)
    collection.objects.link(obj)
    obj.location = location
    if parent:
        obj.parent = parent
    return obj
root = empty('LionLive_Root',(0,0,0))
head_group = empty('LionLive_Head',head_pivot,root)
jaw_group = empty('LionLive_Jaw',jaw_pivot-head_pivot,head_group)
# Bake the chosen seated pose into the bind skeleton. Existing source weights
# are retained, so the body can breathe and move with music on the GPU.
arm=bpy.data.armatures.new('LionLive_BodyRig');live_rig=bpy.data.objects.new('LionLive_BodyRig',arm);collection.objects.link(live_rig)
bpy.ops.object.select_all(action='DESELECT');live_rig.select_set(True);bpy.context.view_layer.objects.active=live_rig
bpy.ops.object.mode_set(mode='EDIT')
for source_bone in rig.pose.bones:
    b=arm.edit_bones.new(source_bone.name);b.matrix=rig.matrix_world@source_bone.matrix;b.length=max(.005,source_bone.length)
for source_bone in rig.pose.bones:
    if source_bone.parent:arm.edit_bones[source_bone.name].parent=arm.edit_bones[source_bone.parent.name]
bpy.ops.object.mode_set(mode='OBJECT');bpy.context.view_layer.update()
def bone_parent(obj,bone):
    bpy.context.view_layer.update();world=obj.matrix_world.copy();obj.parent=live_rig;obj.parent_type='BONE';obj.parent_bone=bone;obj.matrix_world=world;bpy.context.view_layer.update()
bone_parent(head_group,'spine.005')


dynamic_names = [
    'LionChosen_C_Head','LionChosen_C_MouthLining','LionChosen_C_FineWhiskers',
    'LionChosen_C_DenseManeGroom_LiveLOD','LionChosen_C_ShortFaceFur_LiveLOD',
    'LionChosen_C_PortraitIrises','LionChosen_C_PortraitCorneas',
    'LionChosen_C_ManeSurfaceRefinement']
static_names = ['LionChosen_C_Body'] + [o.name for o in scene.objects if o.name.startswith('LionChosen_C_V4_') and o.type=='MESH'] + [o.name for o in scene.objects if o.name.startswith('LionV7_') and o.type in {'MESH','CURVE'}]
objects = []
mapping = {}
def snapshot(source):
    dg = bpy.context.evaluated_depsgraph_get()
    data = bpy.data.meshes.new_from_object(source.evaluated_get(dg),preserve_all_data_layers=True,depsgraph=dg)
    data.transform(source.matrix_world)
    return data
for name in dynamic_names + static_names:
    source = bpy.data.objects[name]
    data = snapshot(source)
    obj = bpy.data.objects.new(name+'_GPU', data)
    collection.objects.link(obj)
    parent = (root if name=='LionChosen_C_Body' else jaw_group if any(t in name for t in ('V4_Lower','V4_OralFloor')) else head_group)
    obj.parent = parent
    obj.matrix_parent_inverse = parent.matrix_world.inverted()
    mapping[name] = obj
    objects.append(obj)
    if name=='LionChosen_C_Body':
        if len(data.vertices)!=len(source.data.vertices):raise RuntimeError('Body topology changed before skin export')
        for g in source.vertex_groups:obj.vertex_groups.new(name=g.name)
        for v in source.data.vertices:
            for g in v.groups:obj.vertex_groups[g.group].add([v.index],g.weight,'REPLACE')
        modifier=obj.modifiers.new('Live seated body skin','ARMATURE');modifier.object=live_rig
    elif name.startswith('LionV7_'):
        bone_parent(obj,source.get('LionLive_AttachBone','spine.003'))

    if name in dynamic_names:
        obj.shape_key_add(name='Basis')

start=time.perf_counter()
for index, key_name in enumerate(scope['ARKIT_NAMES']):
    keys[key_name].value=1.
    bpy.context.view_layer.update()
    dg=bpy.context.evaluated_depsgraph_get()
    for name in dynamic_names:
        source=bpy.data.objects[name]
        evaluated=source.evaluated_get(dg)
        mesh=evaluated.to_mesh(preserve_all_data_layers=True,depsgraph=dg)
        obj=mapping[name]
        if len(mesh.vertices)!=len(obj.data.vertices):
            raise RuntimeError('Expression changed topology: '+name+'/'+key_name)
        points=np.empty((len(mesh.vertices),3),np.float32)
        mesh.vertices.foreach_get('co',points.ravel())
        mat=np.asarray(source.matrix_world,dtype=np.float32)
        points=points @ mat[:3,:3].T + mat[:3,3]
        target=obj.shape_key_add(name=key_name)
        target.data.foreach_set('co',points.ravel())
        evaluated.to_mesh_clear()
    keys[key_name].value=0.
    if index%10==0:print('GPU morph bake',index+1,'/52',flush=True)
bpy.context.view_layer.update()

def basic(name,color,roughness=.6):
    m=bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1.)
    p.inputs['Roughness'].default_value=roughness
    return m,p

def use_colors(obj, name, values, roughness):
    attr=obj.data.color_attributes.get(name)
    if attr is None:
        attr=obj.data.color_attributes.new(name,'FLOAT_COLOR','POINT')
        attr.data.foreach_set('color',np.asarray(values,np.float32).ravel())
    m,p=basic(obj.name+'_VertexColor',(1.,1.,1.),roughness)
    c=m.node_tree.nodes.new('ShaderNodeVertexColor');c.layer_name=name
    m.node_tree.links.new(c.outputs['Color'],p.inputs['Base Color'])
    obj.data.materials.clear();obj.data.materials.append(m)
    for poly in obj.data.polygons:poly.material_index=0
    return m,p

for name in dynamic_names:
    obj=mapping[name]
    color=obj.data.color_attributes.get('LionFiberColor')
    if color:
        use_colors(obj,'LionFiberColor',None,.8)

for name in static_names:
    obj=mapping[name]
    if 'DentalArch' in name:
        a=obj.data.attributes.get('DentalCrown')
        ramp=next(n for n in obj.data.materials[0].node_tree.nodes if n.type=='VALTORGB')
        values=[ramp.color_ramp.evaluate(d.value)[:] for d in a.data]
        m,p=use_colors(obj,'RuntimeEnamel',values,.29)
        p.inputs['Coat Weight'].default_value=.12
        p.inputs['IOR'].default_value=1.46

lining=mapping['LionChosen_C_MouthLining']
material=lining.data.materials[0]
attrnode=next((n for n in material.node_tree.nodes if n.type=='ATTRIBUTE'),None)
ramp=next((n for n in material.node_tree.nodes if n.type=='VALTORGB'),None)
if attrnode and ramp and attrnode.attribute_name in lining.data.attributes:
    values=[ramp.color_ramp.evaluate(d.value)[:] for d in lining.data.attributes[attrnode.attribute_name].data]
    use_colors(lining,'RuntimeMouthTissue',values,.48)

# Bake procedural skin/iris color into ordinary UV textures, preserving the
# authoring shader's colors without requiring its Blender-only node graph.
scene.render.engine='CYCLES';scene.cycles.samples=1
scene.cycles.use_denoising=False
try:
    cp=bpy.context.preferences.addons['cycles'].preferences
    cp.compute_device_type='OPTIX';cp.get_devices()
    for device in cp.devices:device.use=device.type=='OPTIX'
    scene.cycles.device='GPU'
except Exception:
    scene.cycles.device='CPU'

def bake_socket(obj,material_index,socket_name,size,name):
    if not obj.data.uv_layers:
        bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(island_margin=.02);bpy.ops.object.mode_set(mode='OBJECT')
    old=list(obj.data.materials)
    image=bpy.data.images.new(name,width=size,height=size,alpha=False)
    if socket_name!='Base Color':image.colorspace_settings.name='Non-Color'
    temporary=[]
    for index,material in enumerate(old):
        m=material.copy();m.use_nodes=True;temporary.append(m);obj.data.materials[index]=m
        tree=m.node_tree
        target=tree.nodes.new('ShaderNodeTexImage');target.image=image
        tree.nodes.active=target
        if index==material_index:
            principled=next(n for n in tree.nodes if n.type=='BSDF_PRINCIPLED')
            source=principled.inputs[socket_name]
            emission=tree.nodes.new('ShaderNodeEmission')
            if source.is_linked:tree.links.new(source.links[0].from_socket,emission.inputs['Color'])
            else:
                value=source.default_value
                emission.inputs['Color'].default_value=(*([float(value)]*3),1.) if isinstance(value,(int,float)) else value
            output=next(n for n in tree.nodes if n.type=='OUTPUT_MATERIAL')
            tree.links.new(emission.outputs[0],output.inputs['Surface'])
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    scene.render.bake.use_clear=True;scene.render.bake.margin=8
    bpy.ops.object.bake(type='EMIT')
    for index,m in enumerate(old):obj.data.materials[index]=m
    for m in temporary:bpy.data.materials.remove(m)
    image.pack()
    return image

gpu_head=mapping['LionChosen_C_Head']
original_head_mat=gpu_head.data.materials[0]
normal=next((n.image for n in original_head_mat.node_tree.nodes if n.type=='TEX_IMAGE' and n.image and '_3' in n.image.name),None)
albedo=bake_socket(gpu_head,0,'Base Color',4096,'LionLive_Skin_Albedo')
rough=bake_socket(gpu_head,0,'Roughness',1024,'LionLive_Skin_Roughness')
m,p=basic('LionLive_Skin',(1,1,1),.65)
tree=m.node_tree;t=tree.nodes.new('ShaderNodeTexImage');t.image=albedo;tree.links.new(t.outputs['Color'],p.inputs['Base Color'])
t=tree.nodes.new('ShaderNodeTexImage');t.image=rough
sep=tree.nodes.new('ShaderNodeSeparateColor');tree.links.new(t.outputs['Color'],sep.inputs['Color']);tree.links.new(sep.outputs['Green'],p.inputs['Roughness'])
if normal:
    t=tree.nodes.new('ShaderNodeTexImage');t.image=normal
    n=tree.nodes.new('ShaderNodeNormalMap');n.inputs['Strength'].default_value=.85
    tree.links.new(t.outputs['Color'],n.inputs['Color']);tree.links.new(n.outputs[0],p.inputs['Normal'])
gpu_head.data.materials[0]=m
gpu_head.data.materials[1]=basic('LionLive_DeepMouth',(.008,.0015,.002),.6)[0]
gpu_head.data.materials[3]=basic('LionLive_Tongue',(.22,.043,.047),.48)[0]
iris=mapping['LionChosen_C_PortraitIrises']
iris_image=bake_socket(iris,0,'Base Color',1024,'LionLive_Iris_Albedo')
m,p=basic('LionLive_Iris',(1,1,1),.32)
t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=iris_image;m.node_tree.links.new(t.outputs['Color'],p.inputs['Base Color'])
iris.data.materials[0]=m

source_camera=bpy.data.objects['LionChosen_C_FaceCamera']
camera=bpy.data.objects.new('LionLive_Camera',source_camera.data.copy());collection.objects.link(camera)
camera.matrix_world=source_camera.matrix_world.copy();objects.append(camera)
bpy.ops.object.select_all(action='DESELECT')
for obj in [root,head_group,jaw_group,live_rig,*objects]:obj.select_set(True)
bpy.context.view_layer.objects.active=gpu_head
target=os.path.join(OUT,'lion_live_v7.glb')
scene.render.resolution_x=1080;scene.render.resolution_y=1920
bpy.ops.export_scene.gltf(filepath=target,export_format='GLB',use_selection=True,
                         export_animations=False,export_cameras=True,export_morph=True,
                         export_morph_normal=True,export_morph_tangent=False,export_yup=True)
report={'file':target,'bytes':os.path.getsize(target),'facial_targets':52,
        'morph_meshes':{n:len(mapping[n].data.vertices) for n in dynamic_names},
        'head_group':head_group.name,'jaw_group':jaw_group.name,'jaw_angle':.36000354758718034,
        'body_pose':'Seated bind skeleton with original body weights; 38 bones for live movement',
        'baked_materials':['skin albedo 4096','skin roughness 1024','iris albedo 1024'],
        'elapsed_seconds':round(time.perf_counter()-start,2)}
with open(os.path.join(OUT,'asset_report.json'),'w') as f:json.dump(report,f,indent=2)
print('LION_REALTIME_EXPORT '+json.dumps(report),flush=True)
