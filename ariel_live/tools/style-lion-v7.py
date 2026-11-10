"""Versioned appearance upgrade: longer bound fur, clean geometric arm ink,
black leather and gold accessories. No modification of the approved v4 source."""
import bpy,os,json,math,numpy as np
from mathutils import Vector
out=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','data','performer','appearance-v7'));os.makedirs(out,exist_ok=True)
target=os.path.join(out,'Lion_C_Live_Rig_v7.blend')
if os.path.exists(target):raise RuntimeError('Preserve v7 checkpoint')
s=bpy.data.scenes['Lion_Chosen_C_Animated'];bpy.context.window.scene=s
ns={'__name__':'lion_chosen_live','__file__':bpy.data.filepath+'::LionChosen_Live.py'}
exec(compile(bpy.data.texts['LionChosen_Live.py'].as_string(),ns['__file__'],'exec'),ns)
ns['apply_frame'](ns['create_state'](),0.,None,None,1/30)
body=bpy.data.objects['LionChosen_C_Body'];rig=bpy.data.objects['LionChosen_C_Rig']
for name in ['LionChosen_C_DenseManeGroom','LionChosen_C_DenseManeGroom_LiveLOD','LionChosen_C_ShortFaceFur','LionChosen_C_ShortFaceFur_LiveLOD']:
 o=bpy.data.objects[name];a=o.data.attributes['LionRootOffset'];n=len(a.data)
 v=np.empty((n,3),np.float32);a.data.foreach_get('vector',v.ravel())
 ids=np.array([x.value for x in o.data.attributes['LionRootIndex0'].data])
 factor=(1.55+.35*((ids*37)%101)/100) if 'Mane' in name else np.full(n,1.23)
 v*=factor[:,None];a.data.foreach_set('vector',v.ravel());o.data.update()
 o.hide_render=not name.endswith('LiveLOD');o.hide_viewport=not name.endswith('LiveLOD')
s.lion_chosen_settings.fur_detail=.85

def material(name,color,rough=.5,metal=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal;return m
skin=material('LionV7_CleanSkin_GeometricInk',(1,1,1),.63)
colors=body.data.color_attributes.new('LionV7_Ink','FLOAT_COLOR','POINT')
colorNode=skin.node_tree.nodes.new('ShaderNodeVertexColor');colorNode.layer_name=colors.name
skin.node_tree.links.new(colorNode.outputs['Color'],skin.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
leather=material('LionV7_BlackLeather',(.013,.017,.021),.43)
gold=material('LionV7_BrushedGold',(.72,.39,.10),.26,.82)
body.data.materials.append(skin);skinIndex=len(body.data.materials)-1
body.data.materials.append(leather);leatherIndex=len(body.data.materials)-1
names={g.index:g.name for g in body.vertex_groups};armWeight=[];col=[]
for v in body.data.vertices:
 w=sum(g.weight for g in v.groups if any(t in names[g.group] for t in ['upper_arm','forearm','hand','thumb','palm','shoulder']))
 armWeight.append(w);x,y,z=v.co
 side='L' if x>0 else 'R';bone=rig.data.bones['upper_arm.'+side]
 axis=(bone.tail_local-bone.head_local).normalized();p=v.co-bone.head_local;t=p.dot(axis)/max(.01,bone.length)
 radial=p-axis*p.dot(axis);u=axis.cross(Vector((0,1,0))).normalized();vaxis=axis.cross(u)
 angle=math.atan2(radial.dot(vaxis),radial.dot(u))
 # Angular sun-ray / chevron motif; no portrait, lettering, or face texture.
 motif=(.06<t<.92 and (abs(math.sin(angle*5+t*math.pi*3))<.24 or abs(t-.16)<.026 or abs(t-.82)<.026))
 base=np.array([.33,.16,.075])*(.94+.06*math.sin(z*280+x*210))
 col.append((*((.018,.023,.026) if motif else base),1))
colors.data.foreach_set('color',np.asarray(col,np.float32).ravel())
skinFaces=clothFaces=0
for p in body.data.polygons:
 avg=sum(armWeight[i] for i in p.vertices)/len(p.vertices)
 c=sum([body.data.vertices[i].co for i in p.vertices],Vector())/len(p.vertices)
 if avg>.38:p.material_index=skinIndex;skinFaces+=1
 elif .78<c.z<1.28 and abs(c.x)<.205:p.material_index=leatherIndex;clothFaces+=1

def attach(obj,bone):
 world=obj.matrix_world.copy();obj.parent=rig;obj.parent_type='BONE';obj.parent_bone=bone;obj.matrix_world=world
 obj['LionLive_AttachBone']=bone
 return obj
def curve(name,points,radius,mat,bone):
 cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.bevel_depth=radius;cu.bevel_resolution=3;cu.resolution_u=12
 sp=cu.splines.new('POLY');sp.points.add(len(points)-1)
 for p,co in zip(sp.points,points):p.co=(*co,1)
 obj=bpy.data.objects.new(name,cu);s.collection.objects.link(obj);obj.data.materials.append(mat);attach(obj,bone)
 return obj
# Use raycasts against the already seated body to fit gold piping to the vest.
from mathutils.bvhtree import BVHTree
dg=bpy.context.evaluated_depsgraph_get();ev=body.evaluated_get(dg);mesh=ev.to_mesh()
tree=BVHTree.FromPolygons([ev.matrix_world@v.co for v in mesh.vertices],[list(p.vertices)for p in mesh.polygons]);ev.to_mesh_clear()
for sign in [-1,1]:
 pts=[]
 for z in np.linspace(.82,1.19,35):
  x=sign*(.115+.02*math.sin((z-.82)*8));hit,_,_,_=tree.ray_cast(Vector((x,-1,float(z))),Vector((0,1,0)))
  if hit:pts.append((x,hit.y-.003,float(z)))
 if pts:curve('LionV7_VestPiping_'+str(sign),pts,.0018,gold,'spine.003')
# Small medallion and linked chain, fitted on the front of the seated vest.
for i in range(33):
 a=math.pi*2*i/33;x=.104*math.sin(a);z=1.045+.066*math.cos(a)
 hit,_,_,_=tree.ray_cast(Vector((x,-1,z)),Vector((0,1,0)))
 if not hit:continue
 bpy.ops.mesh.primitive_torus_add(major_segments=12,minor_segments=5,location=(x,hit.y-.008,z),rotation=(math.pi/2,.5*(i%2),a),major_radius=.007,minor_radius=.0015)
 o=bpy.context.object;o.name='LionV7_Chain_'+str(i);o.data.materials.append(gold);attach(o,'spine.003')
hit,_,_,_=tree.ray_cast(Vector((0,-1,.984)),Vector((0,1,0)))
if hit:
 bpy.ops.mesh.primitive_cylinder_add(vertices=8,radius=.018,depth=.004,location=(0,hit.y-.009,.984),rotation=(math.pi/2,0,0))
 o=bpy.context.object;o.name='LionV7_SunMedallion';o.data.materials.append(gold);attach(o,'spine.003')
body['LionLive_StyleRevision']=7
bpy.context.view_layer.update();s.render.film_transparent=True;s.render.resolution_x=1080;s.render.resolution_y=1920;s.render.fps=30
bpy.ops.wm.save_as_mainfile(filepath=target)
with open(os.path.join(out,'style-report.json'),'w')as f:json.dump({'file':target,'skin_faces_recolored':skinFaces,'leather_faces':clothFaces,'mane_length_multiplier':[1.55,1.9],'face_fur_multiplier':1.23,'live_density':.85,'original_source_preserved':True},f,indent=2)
print('STYLE_V7_SAVED',flush=True)
