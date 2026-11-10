"""Deterministic, skinned triangular hair tubes on an existing weighted mesh."""
import bpy,numpy as np,math

def add_body_fur(body,rig,scene,name,count=70000,seed=1209):
 me=body.data;me.calc_loop_triangles();xyz=np.array([v.co[:]for v in me.vertices],np.float32)
 tris=np.array([t.vertices[:]for t in me.loop_triangles],np.int32);v=xyz[tris]
 area=np.linalg.norm(np.cross(v[:,1]-v[:,0],v[:,2]-v[:,0]),axis=1)*.5
 # More density on the torso and paws than on the soles outside the live frame.
 center=v.mean(axis=1);density=np.where((center[:,2]>.72)&(np.abs(center[:,0])<.20),2.,1.)
 probability=area*density;probability/=probability.sum()
 rng=np.random.default_rng(seed);tri=tris[rng.choice(len(tris),count,p=probability)]
 uv=rng.random((count,2));ru=np.sqrt(uv[:,0]);bary=np.stack([1-ru,ru*(1-uv[:,1]),ru*uv[:,1]],axis=1)
 roots=(xyz[tri]*bary[:,:,None]).sum(axis=1)
 normal=np.cross(xyz[tri[:,1]]-xyz[tri[:,0]],xyz[tri[:,2]]-xyz[tri[:,0]]);normal/=np.maximum(np.linalg.norm(normal,axis=1)[:,None],1e-9)
 torso=(roots[:,2]>.70)&(np.abs(roots[:,0])<.20)
 arms=(np.abs(roots[:,0])>.20)&(roots[:,2]>.75)
 flow=np.zeros((count,3));flow[:,2]=-1;flow[arms,0]=np.sign(roots[arms,0]);flow[arms,2]=-.28
 flow-=normal*(flow*normal).sum(axis=1)[:,None];flow/=np.maximum(np.linalg.norm(flow,axis=1)[:,None],1e-9)
 across=np.cross(normal,flow)
 lengths=rng.uniform(.005,.014,count);lengths[torso]=rng.uniform(.036,.085,int(torso.sum()))
 radii=rng.uniform(.00022,.00039,count);radii[torso]*=1.2
 sourceWeights=[{g.group:g.weight for g in vertex.groups}for vertex in me.vertices]
 verts=np.empty((count*12,3),np.float32);colors=np.empty((count*12,4),np.float32);faces=[];weights=[]
 for i in range(count):
  base=i*12;w={}
  for vertex,weight in zip(tri[i],bary[i]):
   for group,value in sourceWeights[vertex].items():w[group]=w.get(group,0)+float(weight)*value
  w=dict(sorted(w.items(),key=lambda kv:-kv[1])[:4]);total=sum(w.values())
  if total<1e-7:raise RuntimeError('Fur root has no skin weights')
  weights.append({g:v/total for g,v in w.items()})
  tint=rng.uniform(.65,1.35);color=np.array((.105,.042,.010) if torso[i] else (.30,.148,.052))*tint
  phase=rng.uniform(0,math.pi*2)
  for step,t in enumerate([0.,.33,.66,1.]):
   point=roots[i]+normal[i]*(.0004+lengths[i]*.38*math.sin(t*math.pi/2))+flow[i]*lengths[i]*t
   point+=across[i]*math.sin(t*math.pi*1.7+phase)*lengths[i]*.06*t
   for side in range(3):
    theta=side*math.pi*2/3;verts[base+step*3+side]=point+(normal[i]*math.cos(theta)+across[i]*math.sin(theta))*radii[i]*max(.025,1-t)
    colors[base+step*3+side]=(*np.minimum(.65,color*(.8+.3*t)),1)
   if step:
    for side in range(3):faces.append((base+(step-1)*3+side,base+(step-1)*3+(side+1)%3,base+step*3+(side+1)%3,base+step*3+side))
 mesh=bpy.data.meshes.new(name+'Mesh');mesh.from_pydata(verts,[],faces);mesh.update()
 o=bpy.data.objects.new(name,mesh);scene.collection.objects.link(o);o.matrix_world=body.matrix_world.copy()
 for g in body.vertex_groups:o.vertex_groups.new(name=g.name)
 for i,w in enumerate(weights):
  indices=list(range(i*12,(i+1)*12))
  for g,v in w.items():o.vertex_groups[g].add(indices,v,'REPLACE')
 attr=mesh.color_attributes.new('LionFiberColor','FLOAT_COLOR','POINT');attr.data.foreach_set('color',colors.ravel())
 mat=bpy.data.materials.new(name+'Material');mat.use_nodes=True;p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=.72
 c=mat.node_tree.nodes.new('ShaderNodeVertexColor');c.layer_name=attr.name;mat.node_tree.links.new(c.outputs['Color'],p.inputs['Base Color']);mesh.materials.append(mat)
 for p in mesh.polygons:p.use_smooth=True
 mod=o.modifiers.new('Existing body skin','ARMATURE');mod.object=rig;o['LionLive_SkinnedFur']=True
 return o
