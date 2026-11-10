"""Refine the current design, with skinned fur on the arms and hands."""
import bpy,os,json,math,numpy as np
from mathutils import Vector
out=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','data','performer','appearance-v9'));os.makedirs(out,exist_ok=True)
target=os.path.join(out,'Lion_C_Live_Rig_v9.blend')
if os.path.exists(target):raise RuntimeError('Preserve v9 checkpoint')
s=bpy.data.scenes['Lion_Chosen_C_Animated'];bpy.context.window.scene=s
ns={'__name__':'lion_chosen_live'};exec(compile(bpy.data.texts['LionChosen_Live.py'].as_string(),'LionChosen_Live.py','exec'),ns);ns['apply_frame'](ns['create_state'](),0.,None,None,1/30)
body=bpy.data.objects['LionChosen_C_Body'];rig=bpy.data.objects['LionChosen_C_Rig']
for o in list(bpy.data.objects):
 if o.name.startswith('LionV8_Crown'):bpy.data.objects.remove(o,do_unlink=True)

# Warm brown iris, a round dark pupil and a subtle outer ring.
ramp=bpy.data.objects['LionChosen_C_PortraitIrises'].data.materials[0].node_tree.nodes['Pupil collarette and limbal ring'].color_ramp
stops=[(0,(.001,.0005,.0002,1)),(.45,(.001,.0005,.0002,1)),(.51,(.025,.008,.001,1)),(.60,(.105,.039,.006,1)),(.74,(.17,.073,.015,1)),(.88,(.10,.032,.004,1)),(.96,(.012,.003,.0005,1)),(1,(.004,.001,.0003,1))]
for e,(pos,col)in zip(ramp.elements,stops):e.position=pos;e.color=col

# The existing groom is 28,000 seven-ring triangular strands. Increase the
# subpixel strand width and the lift above the sculpt, without duplicating hair.
full=bpy.data.objects['LionChosen_C_DenseManeGroom'];attr=full.data.attributes['LionRootOffset']
off=np.empty((len(attr.data),3),np.float32);attr.data.foreach_get('vector',off.ravel())
assert len(off)%21==0
a=off.reshape(-1,7,3,3);centers=a.mean(axis=2,keepdims=True)
u=np.linspace(0,1,7,dtype=np.float32)[None,:,None,None]
a[:]=centers*1.1+(a-centers)*4.2
a[:,:,:,2]+=(.0014*np.sin(u[:,:,:,0]*math.pi)+.0003)
attr.data.foreach_set('vector',off.ravel())
col=full.data.color_attributes['LionFiberColor'];colors=np.empty((len(col.data),4),np.float32);col.data.foreach_get('color',colors.ravel());colors[:,:3]=np.minimum(.7,colors[:,:3]*1.45);col.data.foreach_set('color',colors.ravel());full.data.update()

# Smooth the scan's noisy upper-body geometry, keeping every vertex index,
# skin weight and UV. Coincident seam vertices move together.
me=body.data;xyz=np.array([v.co[:]for v in me.vertices],np.float32)
unique,inverse=np.unique(np.round(xyz,5),axis=0,return_inverse=True)
edge=np.array([[inverse[e.vertices[0]],inverse[e.vertices[1]]]for e in me.edges],np.int32)
edge=edge[edge[:,0]!=edge[:,1]];edge=np.concatenate([edge,edge[:,::-1]])
counts=np.bincount(edge[:,0],minlength=len(unique));cur=unique.copy();movable=unique[:,2]>.70
for i in range(12):
 sums=np.zeros_like(cur);np.add.at(sums,edge[:,0],cur[edge[:,1]])
 delta=(sums/np.maximum(1,counts[:,None])-cur)*.35;cur[movable]+=delta[movable]
delta=cur-unique;limit=np.where(np.abs(unique[:,0])<.18,.009,.004)
delta*=np.minimum(1,limit/np.maximum(np.linalg.norm(delta,axis=1),1e-9))[:,None]
xyz+=delta[inverse];me.vertices.foreach_set('co',xyz.ravel());me.update()
skin=me.color_attributes['LionV7_Ink'];colors=np.empty((len(skin.data),4),np.float32)
for i,(x,y,z)in enumerate(xyz):
 tint=.92+.08*math.sin(x*17+z*31)
 colors[i]=(.26*tint,.125*tint,.047*tint,1)
skin.data.foreach_set('color',colors.ravel())

# Generate tapered 3D fur from the actual arm/hand surface. Each strand gets
# barycentrically interpolated source weights and follows the same skeleton.
me.calc_loop_triangles();tris=np.array([t.vertices[:]for t in me.loop_triangles if me.polygons[t.polygon_index].material_index==4],np.int32)
if len(tris)<100:raise RuntimeError('Expected clean arm material')
v=xyz[tris];areas=np.linalg.norm(np.cross(v[:,1]-v[:,0],v[:,2]-v[:,0]),axis=1)*.5
rng=np.random.default_rng(9021);count=22000;chosen=rng.choice(len(tris),count,p=areas/areas.sum());tri=tris[chosen]
uv=rng.random((count,2));rootU=np.sqrt(uv[:,0]);bary=np.stack([1-rootU,rootU*(1-uv[:,1]),rootU*uv[:,1]],axis=1)
roots=(xyz[tri]*bary[:,:,None]).sum(axis=1)
normal=np.cross(xyz[tri[:,1]]-xyz[tri[:,0]],xyz[tri[:,2]]-xyz[tri[:,0]]);normal/=np.maximum(np.linalg.norm(normal,axis=1)[:,None],1e-9)
flow=np.stack([np.sign(roots[:,0]),np.full(count,-.12),np.full(count,-.3)],axis=1);flow-=normal*(flow*normal).sum(axis=1)[:,None];flow/=np.maximum(np.linalg.norm(flow,axis=1)[:,None],1e-9)
across=np.cross(normal,flow);length=rng.uniform(.004,.010,count);radius=rng.uniform(.00018,.00028,count)
verts=[];faces=[];colorData=[];weights=[]
sourceWeights=[{g.group:g.weight for g in vertex.groups}for vertex in me.vertices]
for i in range(count):
 base=len(verts);w={}
 for vertex,weight in zip(tri[i],bary[i]):
  for group,value in sourceWeights[vertex].items():w[group]=w.get(group,0)+float(weight)*value
 w=dict(sorted(w.items(),key=lambda kv:-kv[1])[:4]);total=sum(w.values());weights.append({g:v/total for g,v in w.items()})
 tint=rng.uniform(.65,1.25);color=(.23*tint,.108*tint,.038*tint,1)
 for step,t in enumerate([0.,.33,.66,1.]):
  center=roots[i]+normal[i]*(.0002+length[i]*.34*math.sin(t*math.pi/2))+flow[i]*length[i]*t
  for side in range(3):
   theta=side*math.pi*2/3;point=center+(normal[i]*math.cos(theta)+across[i]*math.sin(theta))*radius[i]*max(.03,1-t)
   verts.append(point);colorData.append(color)
  if step:
   for side in range(3):faces.append((base+(step-1)*3+side,base+(step-1)*3+(side+1)%3,base+step*3+(side+1)%3,base+step*3+side))
mesh=bpy.data.meshes.new('LionV9_ArmHandFurMesh');mesh.from_pydata(verts,[],faces);mesh.update()
o=bpy.data.objects.new('LionV9_ArmHandFur',mesh);s.collection.objects.link(o);o.matrix_world=body.matrix_world.copy()
for g in body.vertex_groups:o.vertex_groups.new(name=g.name)
for i,w in enumerate(weights):
 indices=list(range(i*12,(i+1)*12))
 for g,v in w.items():o.vertex_groups[g].add(indices,v,'REPLACE')
attr=mesh.color_attributes.new('LionFiberColor','FLOAT_COLOR','POINT');attr.data.foreach_set('color',np.asarray(colorData,np.float32).ravel())
mat=bpy.data.materials.new('LionV9_ArmFur');mat.use_nodes=True;p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=.72
c=mat.node_tree.nodes.new('ShaderNodeVertexColor');c.layer_name='LionFiberColor';mat.node_tree.links.new(c.outputs['Color'],p.inputs['Base Color']);mesh.materials.append(mat)
for p in mesh.polygons:p.use_smooth=True
mod=o.modifiers.new('Original arm and hand skin','ARMATURE');mod.object=rig;o['LionLive_SkinnedFur']=True
body['LionLive_StyleRevision']=9
bpy.context.view_layer.update();bpy.ops.wm.save_as_mainfile(filepath=target)
with open(os.path.join(out,'style-report.json'),'w')as f:json.dump({'version':9,'file':target,'arm_hand_strands':count,'arm_hand_vertices':len(verts),'mane_strands':len(off)//21,'mane_width_multiplier':4.2,'crown_removed':True,'body_vertex_count_preserved':len(me.vertices),'maximum_body_smoothing_m':float(np.linalg.norm(delta,axis=1).max()),'face_targets_preserved':52},f,indent=2)
print('STYLE_V9_SAVED',flush=True)
