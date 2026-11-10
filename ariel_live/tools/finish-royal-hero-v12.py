import bpy,os,json,math
from mathutils import Vector
from mathutils.bvhtree import BVHTree
out=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','data','performer','royal-hero-v12'));os.makedirs(out,exist_ok=True)
if os.path.exists(os.path.join(out,'Royal_Lion_Hero_v12.blend')):raise RuntimeError('Preserve v12 checkpoint')
body=bpy.data.objects['RoyalLion_HeroSkin'];rig=bpy.data.objects['RoyalLion_BodyRig'];placement=bpy.data.objects['RoyalLion_Placement']
original=body.data.materials[0]
gold=original.copy();gold.name='RoyalLion_Crown_Gold';p=next(n for n in gold.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
for name,value in [('Metallic',.82),('Roughness',.28)]:
 for link in list(p.inputs[name].links):gold.node_tree.links.remove(link)
 p.inputs[name].default_value=value
source=p.inputs['Base Color'].links[0].from_socket if p.inputs['Base Color'].is_linked else None
if source:
 mix=gold.node_tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[2].default_value=(1,.66,.24,1);gold.node_tree.links.new(source,mix.inputs[1]);gold.node_tree.links.new(mix.outputs[0],p.inputs['Base Color'])
body.data.materials.append(gold);index=len(body.data.materials)-1;crownFaces=0
for face in body.data.polygons:
 if sum(body.data.vertices[i].co.z for i in face.vertices)/len(face.vertices)>.825:face.material_index=index;crownFaces+=1
# Two small curved amber irises, fitted to the existing eye surfaces. The
# surrounding eyelid geometry is retained; the face rig remains a separate task.
tree=BVHTree.FromPolygons([v.co for v in body.data.vertices],[list(p.vertices)for p in body.data.polygons])
irisMaterial=bpy.data.materials.new('RoyalLion_AmberIris');irisMaterial.use_nodes=True;p=irisMaterial.node_tree.nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=.34;p.inputs['Coat Weight'].default_value=.6;p.inputs['Coat Roughness'].default_value=.09
vc=irisMaterial.node_tree.nodes.new('ShaderNodeVertexColor');vc.layer_name='IrisColor';irisMaterial.node_tree.links.new(vc.outputs['Color'],p.inputs['Base Color'])
eyes=[]
for side,y in [('L',.055),('R',-.055)]:
 hit,normal,face,distance=tree.ray_cast(Vector((1,y,.727)),Vector((-1,0,0)))
 if hit is None:raise RuntimeError('Eye fit ray missed')
 vertices=[];colors=[];faces=[];rings=20;segments=64;radius=.0053
 for ring in range(rings+1):
  r=ring/rings
  for j in range(segments):
   a=j*2*math.pi/segments
   vertices.append((hit.x+.00035+.00075*(1-r*r),y+radius*r*math.cos(a),.727+radius*r*math.sin(a)))
   fiber=.88+.12*math.sin(a*43+r*11)+.06*math.sin(a*71-r*17)
   if r<.46:color=(.001,.0006,.0003)
   elif r>.91:color=(.014,.005,.001)
   else:
    warmth=.75+.25*math.sin((r-.46)/.45*math.pi)
    color=(.16*warmth*fiber,.065*warmth*fiber,.013*warmth*fiber)
   colors.append((*color,1))
   if ring:
    a0=(ring-1)*segments+j;b0=(ring-1)*segments+(j+1)%segments;c0=ring*segments+(j+1)%segments;d0=ring*segments+j;faces.append((a0,b0,c0,d0))
 mesh=bpy.data.meshes.new('RoyalLion_Iris_'+side);mesh.from_pydata(vertices,[],faces);mesh.update();attr=mesh.color_attributes.new('IrisColor','FLOAT_COLOR','POINT')
 for d,color in zip(attr.data,colors):d.color=color
 for f in mesh.polygons:f.use_smooth=True
 mesh.materials.append(irisMaterial);o=bpy.data.objects.new('RoyalLion_Iris_'+side,mesh);bpy.context.scene.collection.objects.link(o);o.matrix_world=placement.matrix_world.copy()
 world=o.matrix_world.copy();o.parent=rig;o.parent_type='BONE';o.parent_bone='tripo::Head_2';o.matrix_world=world
 eyes.append({'side':side,'source_center':list(hit),'radius':radius})
bpy.context.view_layer.update();bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out,'Royal_Lion_Hero_v12.blend'))
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.context.scene.objects:
 if o.type in {'ARMATURE','MESH','EMPTY'} and (o==rig or o==body or o==placement or o.name.startswith('RoyalLion_Iris_')):o.select_set(True)
bpy.context.view_layer.objects.active=body
bpy.ops.export_scene.gltf(filepath=os.path.join(out,'royal-lion-hero-v12.glb'),export_format='GLB',use_selection=True,export_animations=False,export_morph=False)
with open(os.path.join(out,'report.json'),'w')as f:json.dump({'version':12,'crown_faces':crownFaces,'eye_fit':eyes,'body_geometry_unchanged':True,'facial_rig_ready':False},f,indent=2)
print('ROYAL_V12_EXPORTED',flush=True)
