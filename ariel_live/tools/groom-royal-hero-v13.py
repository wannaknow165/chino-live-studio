"""Fine surface-coloured mane strands and fitted gold chains on the royal lion.
Keeps the detailed source surface, UV textures, anatomy and skeleton intact.
"""
import bpy,os,json,math,numpy as np
from mathutils import Vector,Matrix,Quaternion
from mathutils.bvhtree import BVHTree
out=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','data','performer','royal-hero-v13'));os.makedirs(out,exist_ok=True)
if os.path.exists(os.path.join(out,'Royal_Lion_Hero_v13.blend')):raise RuntimeError('Preserve v13 checkpoint')
body=bpy.data.objects['RoyalLion_HeroSkin'];rig=bpy.data.objects['RoyalLion_BodyRig'];placement=bpy.data.objects['RoyalLion_Placement'];me=body.data;s=bpy.context.scene
xyz=np.empty((len(me.vertices),3),np.float32);me.vertices.foreach_get('co',xyz.ravel())
eligible=[p for p in me.polygons if .37<p.center.z<.825 and p.center.x<.255 and p.material_index==0]
tris=np.array([p.vertices[:]for p in eligible],np.int32)
verts=xyz[tris];area=np.linalg.norm(np.cross(verts[:,1]-verts[:,0],verts[:,2]-verts[:,0]),axis=1)*.5
rng=np.random.default_rng(13131);count=9500;chosen=rng.choice(len(tris),count,p=area/area.sum());tri=tris[chosen]
u=rng.random((count,2));ru=np.sqrt(u[:,0]);weights=np.stack([1-ru,ru*(1-u[:,1]),ru*u[:,1]],axis=1)
roots=(xyz[tri]*weights[:,:,None]).sum(axis=1)
normals=np.cross(xyz[tri[:,1]]-xyz[tri[:,0]],xyz[tri[:,2]]-xyz[tri[:,0]]);normals/=np.maximum(np.linalg.norm(normals,axis=1)[:,None],1e-9)
flow=np.tile(np.array([-.20,0,-1.]),(count,1));flow[:,1]=np.sign(roots[:,1])*.12
flow[roots[:,2]>.77]=np.array([-1.,0.,-.12]);flow-=normals*(normals*flow).sum(axis=1)[:,None];flow/=np.maximum(np.linalg.norm(flow,axis=1)[:,None],1e-9)
across=np.cross(normals,flow);length=rng.uniform(.014,.035,count);radius=rng.uniform(.00008,.00015,count)
material=me.materials[0];principled=next(n for n in material.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
texture=principled.inputs['Base Color'].links[0].from_node
if texture.type!='TEX_IMAGE':raise RuntimeError('Expected original source colour texture')
image=texture.image;w,h=image.size;pixels=np.empty(w*h*4,np.float32);image.pixels.foreach_get(pixels);uv=me.uv_layers.active.data
print('SOURCE_COLOUR_BUFFER_READY',w,h,flush=True)
sourceWeights=[{g.group:g.weight for g in v.groups}for v in me.vertices]
hairVerts=np.empty((count*21,3),np.float32);hairColors=np.empty((count*21,4),np.float32);faces=[];skin=[]
def linear(c):return c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4
for i in range(count):
 if i%2000==0:print('GROOM_STRANDS',i,'/',count,flush=True)
 p=eligible[int(chosen[i])];texUV=sum((Vector(uv[li].uv)*float(b)for li,b in zip(p.loop_indices,weights[i])),Vector((0,0)))
 ix=min(w-1,max(0,int(texUV.x*w)));iy=min(h-1,max(0,int(texUV.y*h)));pixel=(iy*w+ix)*4
 color=np.array([linear(float(pixels[pixel+k]))for k in range(3)])*rng.uniform(.90,1.10)
 boneWeights={}
 for vi,weight in zip(tri[i],weights[i]):
  for group,value in sourceWeights[vi].items():boneWeights[group]=boneWeights.get(group,0)+float(weight)*value
 boneWeights=dict(sorted(boneWeights.items(),key=lambda kv:-kv[1])[:4]);total=sum(boneWeights.values());skin.append({g:v/total for g,v in boneWeights.items()})
 phase=rng.uniform(0,math.pi*2);base=i*21
 for step in range(7):
  t=step/6;center=roots[i]+flow[i]*length[i]*t+normals[i]*(.00025+length[i]*.24*math.sin(t*math.pi/2))
  center+=across[i]*math.sin(t*math.pi*1.7+phase)*length[i]*.045*t
  for side in range(3):
   theta=side*math.pi*2/3;hairVerts[base+step*3+side]=center+(normals[i]*math.cos(theta)+across[i]*math.sin(theta))*radius[i]*max(.02,1-t)
   hairColors[base+step*3+side]=(*np.minimum(.8,color*(.9+.2*t)),1)
  if step:
   for side in range(3):faces.append((base+(step-1)*3+side,base+(step-1)*3+(side+1)%3,base+step*3+(side+1)%3,base+step*3+side))
mesh=bpy.data.meshes.new('RoyalLion_FineManeMesh');mesh.from_pydata(hairVerts,[],faces);mesh.update();o=bpy.data.objects.new('RoyalLion_FineMane',mesh);s.collection.objects.link(o);o.parent=rig
for g in body.vertex_groups:o.vertex_groups.new(name=g.name)
for i,bw in enumerate(skin):
 indices=list(range(i*21,(i+1)*21))
 for group,weight in bw.items():o.vertex_groups[group].add(indices,weight,'REPLACE')
attr=mesh.color_attributes.new('RoyalStrandColor','FLOAT_COLOR','POINT');attr.data.foreach_set('color',hairColors.ravel())
mat=bpy.data.materials.new('RoyalLion_FineMane');mat.use_nodes=True;p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=.68
node=mat.node_tree.nodes.new('ShaderNodeVertexColor');node.layer_name=attr.name;mat.node_tree.links.new(node.outputs['Color'],p.inputs['Base Color']);mesh.materials.append(mat)
for face in mesh.polygons:face.use_smooth=True
mod=o.modifiers.new('Existing quadruped skin','ARMATURE');mod.object=rig
# Fit jewellery to the actual front surface, avoiding floating chains.
tree=BVHTree.FromPolygons([body.matrix_world@Vector(v)for v in xyz],[list(p.vertices)for p in me.polygons])
gold=bpy.data.materials.new('RoyalLion_ChainGold');gold.use_nodes=True;p=gold.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.66,.34,.07,1);p.inputs['Metallic'].default_value=.94;p.inputs['Roughness'].default_value=.22
made=0
for row,(width,top,drop,links)in enumerate([(.115,1.29,.19,46),(.13,1.265,.275,62)]):
 points=[]
 for a in np.linspace(-1,1,1000):
  x=float(a*width);z=top-drop*(1-a*a);hit,_,_,_=tree.ray_cast(Vector((x,-2,z)),Vector((0,1,0)))
  if hit:points.append(Vector((x,hit.y-.012-row*.003,z)))
 distance=[0.]
 for a,b in zip(points,points[1:]):distance.append(distance[-1]+(b-a).length)
 for i,d in enumerate(np.linspace(0,distance[-1],links)):
  j=min(len(points)-2,max(1,int(np.searchsorted(distance,d))));center=points[j];tangent=(points[j+1]-points[j-1]).normalized();normal=Vector((0,-1,0));across=tangent.cross(normal).normalized();normal=across.cross(tangent).normalized()
  orientation=Matrix((across,tangent,normal)).transposed().to_quaternion()@Quaternion((0,1,0),math.radians(63 if i%2 else -12))
  bpy.ops.mesh.primitive_torus_add(major_segments=18,minor_segments=7,major_radius=.0065,minor_radius=.0019,location=center);o=bpy.context.object;o.name=f'RoyalLion_Chain_{row}_{i:02}';o.rotation_mode='QUATERNION';o.rotation_quaternion=orientation;o.scale=(.83,1.35,1);o.data.materials.append(gold)
  for face in o.data.polygons:face.use_smooth=True
  bpy.context.view_layer.update();world=o.matrix_world.copy();o.parent=rig;o.parent_type='BONE';o.parent_bone='tripo::Head_1';o.matrix_world=world;made+=1
bpy.context.view_layer.update();bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out,'Royal_Lion_Hero_v13.blend'))
bpy.ops.object.select_all(action='DESELECT')
for o in s.objects:
 if o.name.startswith('RoyalLion_'):o.select_set(True)
bpy.context.view_layer.objects.active=body
bpy.ops.export_scene.gltf(filepath=os.path.join(out,'royal-lion-hero-v13.glb'),export_format='GLB',use_selection=True,export_animations=False,export_morph=False)
with open(os.path.join(out,'report.json'),'w')as f:json.dump({'version':13,'added_mane_strands':count,'source_colour_texture':image.name,'jewellery_links':made,'source_anatomy_preserved':True,'facial_rig_ready':False},f,indent=2)
print('ROYAL_V13_EXPORTED',flush=True)
