"""Wardrobe/groom refinement of the existing v9 face AND body rig.

No new character, retopology, weights, face expressions or provider calls.
The original authoring checkpoint remains untouched.
"""
import bpy, os, json, math, hashlib, numpy as np
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree
from pathlib import Path

OUT=Path(__file__).resolve().parent.parent/'data'/'performer'/'seated-denim'
OUT.mkdir(exist_ok=True)
target=OUT/'Lion_Original_Rig_Denim.blend'
# This only rebuilds our own derived styling file. Blender saves .blend1;
# the v9 source and all earlier facial-rig checkpoints remain untouched.
scene=bpy.data.scenes['Lion_Chosen_C_Animated']; bpy.context.window.scene=scene
scope={'__name__':'lion_chosen_live'}
exec(compile(bpy.data.texts['LionChosen_Live.py'].as_string(),'LionChosen_Live.py','exec'),scope)
scope['apply_frame'](scope['create_state'](),0.,None,None,1/30)
body=bpy.data.objects['LionChosen_C_Body']; rig=bpy.data.objects['LionChosen_C_Rig']
head=bpy.data.objects['LionChosen_C_Head']; me=body.data
def face_hash():
 h=hashlib.sha256()
 for k in head.data.shape_keys.key_blocks:
  a=np.empty(len(k.data)*3,np.float32); k.data.foreach_get('co',a)
  h.update(k.name.encode()); h.update(a.tobytes())
 return h.hexdigest()
face_before=face_hash()
for o in list(bpy.data.objects):
 if o.name.startswith(('LionV8_Lapel','LionV8_Crown','LionV8_Chain','LionV9_ArmHandFur')):
  bpy.data.objects.remove(o,do_unlink=True)

def material(name,color,rough=.65,metal=0):
 m=bpy.data.materials.new(name);m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1)
 p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
 return m,p

# Keep the geometry and all weights. Define a clean waist instead of painting
# over the old vest and trousers indiscriminately.
xyz=np.array([v.co[:] for v in me.vertices],np.float32)
group_names={g.index:g.name for g in body.vertex_groups}
arm=np.array([sum(g.weight for g in v.groups if any(t in group_names[g.group] for t in ('upper_arm','forearm','hand','thumb','palm','shoulder'))) for v in me.vertices])
skin,p=material('LionDenim_TawnyUnderfur',(.25,.115,.038),.82)
color=me.color_attributes.get('LionV7_Ink')
vals=np.empty((len(xyz),4),np.float32)
for i,(x,y,z) in enumerate(xyz):
 chest=abs(x)<.22 and z>.82
 base=np.array((.105,.043,.012) if chest else (.29,.145,.055))
 vals[i]=(*base*(.92+.08*math.sin(x*21+z*28)),1)
color.data.foreach_set('color',vals.ravel())
c=skin.node_tree.nodes.new('ShaderNodeVertexColor');c.layer_name=color.name
skin.node_tree.links.new(c.outputs['Color'],p.inputs['Base Color'])
me.materials.append(skin);skin_index=len(me.materials)-1

# A repeatable indigo twill texture with directional weave, fading and sewn
# seams. This is generated material data, not a reference-photo replacement.
N=2048
vv,uu=np.mgrid[0:N,0:N].astype(np.float32)/(N-1)
rng=np.random.default_rng(1401)
weave=.91+.065*np.sin((uu*768-vv*1024)*2*math.pi)+.025*np.sin(uu*2048*math.pi)
noise=rng.random((N,N),dtype=np.float32)*.065-.0325
fade=np.exp(-((uu-.5)/.29)**4)*np.exp(-((vv-.56)/.27)**4)
folds=.025*np.sin(vv*95+uu*11)*np.exp(-((vv-.5)/.15)**2)
rgb=np.empty((N,N,3),np.float32)
for j,base in enumerate((.026,.078,.165)):
 rgb[:,:,j]=base*(weave+noise+folds)+fade*(.022,.044,.061)[j]
seam=(np.abs(uu-.035)<.0011)|(np.abs(uu-.965)<.0011)|(np.abs(vv-.936)<.0012)|(np.abs(vv-.957)<.0012)
stitches=seam & ((np.floor(vv*190)+np.floor(uu*190))%3!=0)
rgb[stitches]=(.36,.23,.105)
rgba=np.ones((N,N,4),np.float32);rgba[:,:,:3]=rgb
im=bpy.data.images.new('Lion_Indigo_Twill_2K',N,N,alpha=False)
im.pixels.foreach_set(rgba.ravel());im.pack()
denim,dp=material('LionDenim_IndigoJeans',(1,1,1),.83)
dp.inputs['Sheen Weight'].default_value=0
t=denim.node_tree.nodes.new('ShaderNodeTexImage');t.image=im
uvnode=denim.node_tree.nodes.new('ShaderNodeUVMap');uvnode.uv_map='DenimUV'
denim.node_tree.links.new(uvnode.outputs[0],t.inputs['Vector'])
denim.node_tree.links.new(t.outputs['Color'],dp.inputs['Base Color'])
me.materials.append(denim);denim_index=len(me.materials)-1
uvlayer=me.uv_layers.get('DenimUV') or me.uv_layers.new(name='DenimUV')
pants_faces=0
for poly in me.polygons:
 ids=list(poly.vertices);center=xyz[ids].mean(0)
 is_pants=center[2]<.835 and center[2]>.15 and arm[ids].mean()<.3
 if is_pants:
  poly.material_index=denim_index;pants_faces+=1
  side=1 if center[0]>0 else -1
  for loop in poly.loop_indices:
   x,y,z=xyz[me.loops[loop].vertex_index]
   cx=side*(.145+.04*(1-np.clip(z/.83,0,1)))
   u=.5+math.atan2(x-cx,-(y-.025))/(2*math.pi)
   uvlayer.data[loop].uv=(u,float(np.clip((z-.15)/.70,0,1)))
 elif center[2]>.76 or arm[ids].mean()>.3:
  poly.material_index=skin_index
 poly.use_smooth=True

# More, finer tapered hairs. Every strand inherits the existing body weights,
# so the wrists, forearms and chest remain compatible with the live rig.
me.calc_loop_triangles()
triangles=np.array([t.vertices[:] for t in me.loop_triangles if me.polygons[t.polygon_index].material_index==skin_index],np.int32)
v=xyz[triangles];areas=np.linalg.norm(np.cross(v[:,1]-v[:,0],v[:,2]-v[:,0]),axis=1)*.5
centers=v.mean(1);density=np.where(np.abs(centers[:,0])<.23,1.1,2.0)
count=180000;prob=areas*density;prob/=prob.sum()
tri=triangles[rng.choice(len(triangles),count,p=prob)]
uv=rng.random((count,2));ru=np.sqrt(uv[:,0]);bary=np.stack([1-ru,ru*(1-uv[:,1]),ru*uv[:,1]],1)
roots=(xyz[tri]*bary[:,:,None]).sum(1)
normal=np.cross(xyz[tri[:,1]]-xyz[tri[:,0]],xyz[tri[:,2]]-xyz[tri[:,0]])
normal/=np.maximum(np.linalg.norm(normal,axis=1)[:,None],1e-9)
torso=np.abs(roots[:,0])<.23
flow=np.zeros((count,3));flow[:,2]=-1
flow[~torso,0]=np.sign(roots[~torso,0])*.58;flow[~torso,2]=-.82
flow-=normal*(flow*normal).sum(1)[:,None];flow/=np.maximum(np.linalg.norm(flow,axis=1)[:,None],1e-9)
across=np.cross(normal,flow)
length=rng.uniform(.038,.072,count);length[torso]=rng.uniform(.12,.23,int(torso.sum()))
radius=rng.uniform(.00012,.00022,count)
source_weights=[{g.group:g.weight for g in v.groups} for v in me.vertices]
verts=np.empty((count*12,3),np.float32);colors=np.empty((count*12,4),np.float32);faces=[];weights=[]
for i in range(count):
 w={}
 for vertex,weight in zip(tri[i],bary[i]):
  for group,value in source_weights[vertex].items():w[group]=w.get(group,0)+float(weight)*value
 w=dict(sorted(w.items(),key=lambda kv:-kv[1])[:4]);total=sum(w.values())
 if total<1e-8:raise RuntimeError('Missing source weights')
 weights.append({g:a/total for g,a in w.items()})
 tint=rng.uniform(.55,1.55);col=np.array((.17,.073,.022) if torso[i] else (.34,.17,.062))*tint
 phase=rng.uniform(0,math.pi*2)
 for step,u in enumerate((0.,.33,.66,1.)):
  pos=roots[i]+normal[i]*(.0003+length[i]*.28*math.sin(u*math.pi/2))+flow[i]*length[i]*u
  pos+=across[i]*math.sin(u*4+phase)*length[i]*.07*u
  for side in range(3):
   theta=side*2*math.pi/3;idx=i*12+step*3+side
   verts[idx]=pos+(normal[i]*math.cos(theta)+across[i]*math.sin(theta))*radius[i]*max(.02,1-u)
   colors[idx]=(*np.minimum(.7,col*(.8+.35*u)),1)
  if step:
   for side in range(3):faces.append((i*12+(step-1)*3+side,i*12+(step-1)*3+(side+1)%3,i*12+step*3+(side+1)%3,i*12+step*3+side))
fm=bpy.data.meshes.new('LionDenim_UpperFurMesh');fm.from_pydata(verts,[],faces);fm.update()
fur=bpy.data.objects.new('LionV9_ArmHandFur',fm);scene.collection.objects.link(fur);fur.matrix_world=body.matrix_world.copy()
for group in body.vertex_groups:fur.vertex_groups.new(name=group.name)
for i,w in enumerate(weights):
 indices=list(range(i*12,(i+1)*12))
 for group,value in w.items():fur.vertex_groups[group].add(indices,value,'REPLACE')
attr=fm.color_attributes.new('LionFiberColor','FLOAT_COLOR','POINT');attr.data.foreach_set('color',colors.ravel())
mat,fp=material('LionDenim_FineGroom',(1,1,1),.76)
c=mat.node_tree.nodes.new('ShaderNodeVertexColor');c.layer_name='LionFiberColor';mat.node_tree.links.new(c.outputs['Color'],fp.inputs['Base Color'])
fm.materials.append(mat)
for poly in fm.polygons:poly.use_smooth=True
mod=fur.modifiers.new('Preserved original body weights','ARMATURE');mod.object=rig;fur['LionLive_SkinnedFur']=True

# Retain the head's existing groom, refining only its strand radius.
groom=bpy.data.objects['LionChosen_C_DenseManeGroom'];attr=groom.data.attributes['LionRootOffset']
offset=np.empty((len(attr.data),3),np.float32);attr.data.foreach_get('vector',offset.ravel())
a=offset.reshape(-1,7,3,3);center=a.mean(2,keepdims=True);a[:]=center+(a-center)*.64
attr.data.foreach_set('vector',offset.ravel());groom.data.update()

# Two substantial interlinked gold chains fitted over the chest groom.
bpy.context.view_layer.update();ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=ev.to_mesh()
tree=BVHTree.FromPolygons([ev.matrix_world@v.co for v in mesh.vertices],[list(p.vertices) for p in mesh.polygons]);ev.to_mesh_clear()
gold,gp=material('LionDenim_18KChains',(.64,.35,.105),.23,.94)
for row,(width,top,drop,n) in enumerate(((.151,1.22,.26,57),(.175,1.18,.34,67))):
 pts=[]
 for t in np.linspace(-1,1,800):
  x=float(t*width);z=float(top-drop*(1-t*t));hit,_,_,_=tree.ray_cast(Vector((x,-1,z)),Vector((0,1,0)))
  y=hit.y if hit else -.13
  pts.append(Vector((x,y-.056-row*.009,z)))
 lengths=[0.]
 for a,b in zip(pts,pts[1:]):lengths.append(lengths[-1]+(b-a).length)
 for i,d in enumerate(np.linspace(0,lengths[-1],n)):
  j=min(len(pts)-2,max(1,int(np.searchsorted(lengths,d))));tangent=(pts[j+1]-pts[j-1]).normalized()
  normal=Vector((0,-1,0));across=tangent.cross(normal).normalized();normal=across.cross(tangent).normalized()
  orient=Matrix((across,tangent,normal)).transposed().to_quaternion()@Quaternion((0,1,0),math.radians(63 if i%2 else -13))
  bpy.ops.mesh.primitive_torus_add(major_segments=18,minor_segments=8,major_radius=.0072,minor_radius=.0020,location=pts[j])
  o=bpy.context.object;o.name=f'LionV8_Chain_Denim_{row}_{i:03}';o.rotation_mode='QUATERNION';o.rotation_quaternion=orient;o.scale=(.85,1.4,1);o.data.materials.append(gold)
  for p in o.data.polygons:p.use_smooth=True
  bpy.context.view_layer.update();world=o.matrix_world.copy();o.parent=rig;o.parent_type='BONE';o.parent_bone='spine.003';o.matrix_world=world;o['LionLive_AttachBone']='spine.003'

assert face_hash()==face_before,'Facial controls must remain byte-identical'
body['LionLive_HeadPresentationScale']=1.22
bpy.ops.wm.save_as_mainfile(filepath=str(target))
report={'source':'appearance-v9/Lion_C_Live_Rig_v9.blend','face_shape_hash_before':face_before,'face_shape_hash_after':face_hash(),'face_targets':len(head.data.shape_keys.key_blocks)-1,'body_vertices':len(me.vertices),'body_weights_preserved':True,'denim_faces':pants_faces,'upper_fur_strands':count,'head_presentation_scale':1.22,'file':str(target)}
(OUT/'style-report.json').write_text(json.dumps(report,indent=2),encoding='utf8')
print('DENIM_STYLE_SAVED '+json.dumps(report),flush=True)
