"""Extend the existing rig with amber eyes, dense groom and fitted gold wardrobe.
Writes a new checkpoint; the source and facial topology are preserved.
"""
import bpy,os,json,math,numpy as np
from mathutils import Vector,Matrix,Quaternion
from mathutils.bvhtree import BVHTree
out=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','data','performer','appearance-v8'));os.makedirs(out,exist_ok=True)
target=os.path.join(out,'Lion_C_Live_Rig_v8.blend')
if os.path.exists(target):raise RuntimeError('Preserve existing v8 checkpoint')
s=bpy.data.scenes['Lion_Chosen_C_Animated'];bpy.context.window.scene=s
ns={'__name__':'lion_chosen_live'};exec(compile(bpy.data.texts['LionChosen_Live.py'].as_string(),'LionChosen_Live.py','exec'),ns)
ns['apply_frame'](ns['create_state'](),0.,None,None,1/30)
body=bpy.data.objects['LionChosen_C_Body'];rig=bpy.data.objects['LionChosen_C_Rig']

def material(name,color,rough=.5,metal=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal;return m

# Retain 52 facial expressions and all skin weights; clear accidental faceting.
for p in body.data.polygons:p.use_smooth=True
for e in body.data.edges:e.use_edge_sharp=False
if body.data.has_custom_normals:body.data.normals_split_custom_set([(0,0,0)]*len(body.data.loops))
body.data.update()
leather=bpy.data.materials['LionV7_BlackLeather'];p=leather.node_tree.nodes.get('Principled BSDF')
p.inputs['Base Color'].default_value=(.009,.013,.017,1);p.inputs['Roughness'].default_value=.58
p.inputs['Coat Weight'].default_value=.12;p.inputs['Coat Roughness'].default_value=.4

# The authoring cornea must use a glTF-compatible material, not an unsupported
# Blender mix shader which became an opaque white cover in the web renderer.
cornea=bpy.data.objects['LionChosen_C_PortraitCorneas'];m=material('LionV8_ThinCornea',(1,1,1),.08)
p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Alpha'].default_value=.085;p.inputs['IOR'].default_value=1.376
p.inputs['Coat Weight'].default_value=1;p.inputs['Coat Roughness'].default_value=.07
m.surface_render_method='BLENDED';cornea.data.materials.clear();cornea.data.materials.append(m)
iris=bpy.data.objects['LionChosen_C_PortraitIrises'];m=iris.data.materials[0]
ramp=m.node_tree.nodes.get('Pupil collarette and limbal ring').color_ramp
while len(ramp.elements)>2:ramp.elements.remove(ramp.elements[-1])
stops=[(0,(.0015,.0008,.0004,1)),(.31,(.002,.001,.0005,1)),(.36,(.09,.032,.006,1)),(.48,(.29,.12,.026,1)),(.70,(.42,.205,.052,1)),(.88,(.24,.09,.014,1)),(.96,(.025,.009,.002,1)),(1,(.009,.004,.001,1))]
for i,(pos,col)in enumerate(stops):
 el=ramp.elements[i] if i<2 else ramp.elements.new(pos);el.position=pos;el.color=col
ramp.interpolation='EASE'
m.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.46

# Full density mane, attached to the head in the runtime; short facial fur keeps
# its expression deformation. Outer mane needs no 52-fold vertex duplication.
for name in ['LionChosen_C_DenseManeGroom','LionChosen_C_DenseManeGroom_LiveLOD']:
 o=bpy.data.objects[name];o.hide_render=name.endswith('LiveLOD');o.hide_viewport=name.endswith('LiveLOD')
full=bpy.data.objects['LionChosen_C_DenseManeGroom']
for mod in full.modifiers:
 if mod.type=='NODES':
  mod.node_group=mod.node_group.copy();sw=mod.node_group.nodes.get('Full density in renders')
  if sw:
   for link in list(sw.inputs['Switch'].links):mod.node_group.links.remove(link)
   sw.inputs['Switch'].default_value=False
s.lion_chosen_settings.fur_detail=1.

# Replace only the previous experimental accessories in this NEW checkpoint.
for o in list(bpy.data.objects):
 if o.name.startswith('LionV7_'):bpy.data.objects.remove(o,do_unlink=True)
gold=material('LionV8_18KGold',(.62,.32,.075),.25,.92)
black=material('LionV8_LapelLeather',(.007,.010,.014),.49)
ruby=material('LionV8_Ruby',(.24,.004,.012),.16,.25)

def attach(o,bone):
 bpy.context.view_layer.update();world=o.matrix_world.copy();o.parent=rig;o.parent_type='BONE';o.parent_bone=bone;o.matrix_world=world;o['LionLive_AttachBone']=bone;return o
def tube(name,pts,r,mat,bone,closed=False):
 cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.bevel_depth=r;cu.bevel_resolution=2;cu.resolution_u=8
 sp=cu.splines.new('POLY');sp.points.add(len(pts)-1);sp.use_cyclic_u=closed
 for p,co in zip(sp.points,pts):p.co=(*co,1)
 o=bpy.data.objects.new(name,cu);s.collection.objects.link(o);o.data.materials.append(mat);return attach(o,bone)
dg=bpy.context.evaluated_depsgraph_get();ev=body.evaluated_get(dg);me=ev.to_mesh()
tree=BVHTree.FromPolygons([ev.matrix_world@v.co for v in me.vertices],[list(p.vertices)for p in me.polygons]);ev.to_mesh_clear()
def front(x,z,offset=.008):
 hit,_,_,_=tree.ray_cast(Vector((x,-1,z)),Vector((0,1,0)))
 return hit.y-offset if hit else -.145-offset

# Linked, draped chains with true alternating oval links.
for row,(width,top,drop,count)in enumerate([(.108,1.14,.17,63),(.125,1.11,.23,79)]):
 points=[]
 for a in np.linspace(-1,1,1000):
  x=float(a*width);z=top-drop*(1-a*a);points.append(Vector((x,front(x,z,.013+row*.003),z)))
 length=[0.]
 for a,b in zip(points,points[1:]):length.append(length[-1]+(b-a).length)
 for i,distance in enumerate(np.linspace(0,length[-1],count)):
  j=min(len(points)-2,max(1,int(np.searchsorted(length,distance))))
  center=points[j];tangent=(points[j+1]-points[j-1]).normalized();normal=Vector((0,-1,0));across=tangent.cross(normal).normalized();normal=across.cross(tangent).normalized()
  orient=Matrix((across,tangent,normal)).transposed().to_quaternion() @ Quaternion((0,1,0),math.radians(65 if i%2 else -12))
  bpy.ops.mesh.primitive_torus_add(major_segments=16,minor_segments=6,major_radius=.0045,minor_radius=.0013,location=center)
  o=bpy.context.object;o.name=f'LionV8_Chain_{row}_{i:03}';o.rotation_mode='QUATERNION';o.rotation_quaternion=orient;o.scale=(.85,1.35,1);o.data.materials.append(gold)
  for p in o.data.polygons:p.use_smooth=True
  attach(o,'spine.003')

# Fitted raised lapels, following the seated torso surface.
for side in [-1,1]:
 verts=[];rows=30
 for z in np.linspace(.85,1.2,rows):
  u=(z-.85)/.35;cx=side*(.090+.047*u);width=.018+.01*math.sin(u*math.pi)
  for dx in [-width/2,width/2]:
   x=cx+dx;verts.append((x,front(x,float(z),.005),float(z)))
 faces=[(i*2,i*2+1,i*2+3,i*2+2)for i in range(rows-1)]
 me=bpy.data.meshes.new('Fitted lapel');me.from_pydata(verts,[],faces);me.materials.append(black)
 o=bpy.data.objects.new('LionV8_Lapel_'+str(side),me);s.collection.objects.link(o)
 for p in me.polygons:p.use_smooth=True
 mod=o.modifiers.new('Leather thickness','SOLIDIFY');mod.thickness=.002
 attach(o,'spine.003')
 tube('LionV8_LapelSeam_'+str(side),[verts[i*2+(1 if side<0 else 0)]for i in range(rows)],.0009,gold,'spine.003')

# A slim sculpted crown leaves the full face and ear silhouette readable.
centerY=.012;baseZ=1.515;radius=.093
for z in [baseZ,baseZ+.018]:
 tube('LionV8_CrownRim',[(radius*math.sin(a),centerY-radius*math.cos(a),z)for a in np.linspace(0,2*math.pi,96,endpoint=False)],.0024,gold,'spine.005',True)
for i in range(10):
 a=i*2*math.pi/10;half=math.pi/10*.85;pts=[]
 for t in np.linspace(-1,1,20):
  theta=a+half*t;z=baseZ+.018+.038*(1-abs(t))**.7
  pts.append((radius*math.sin(theta),centerY-radius*math.cos(theta),z))
 tube('LionV8_CrownFleur_'+str(i),pts,.0023,gold,'spine.005')
 for z,rr in [(baseZ+.009,.0032),(baseZ+.056,.0038)]:
  bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,radius=rr,location=(radius*math.sin(a),centerY-radius*math.cos(a),z))
  o=bpy.context.object;o.name='LionV8_CrownBead';o.data.materials.append(gold);attach(o,'spine.005')
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=.009,location=(0,centerY-radius-.003,baseZ+.026))
o=bpy.context.object;o.name='LionV8_CrownRuby';o.scale=(.78,.4,1);o.data.materials.append(ruby);attach(o,'spine.005')

body['LionLive_StyleRevision']=8;s.render.film_transparent=True
bpy.context.view_layer.update();bpy.ops.wm.save_as_mainfile(filepath=target)
with open(os.path.join(out,'style-report.json'),'w')as f:json.dump({'version':8,'file':target,'dense_mane_source_vertices':len(full.data.vertices),'face_targets':len(bpy.data.objects['LionChosen_C_Head'].data.shape_keys.key_blocks)-1,'body_vertices':len(body.data.vertices),'original_preserved':True,'changes':['amber iris pigmentation','thin transparent cornea','full density mane','smooth leather','fitted lapels','two linked gold chains','crown'],'runtime_outer_mane':'Rigid to head; short face fur retains all expressions'},f,indent=2)
print('STYLE_V8_SAVED',flush=True)
