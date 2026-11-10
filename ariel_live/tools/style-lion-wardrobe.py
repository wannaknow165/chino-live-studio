"""Dress the original seated lion; preserve its face shapes and body weights.

Run against the untouched appearance-v9 authoring checkpoint. The established
denim/groom builder supplies materials and rig attachment helpers; this variant
adds a weighted fabric shell and keeps short fur only beyond the sleeve cuffs.
"""
from pathlib import Path
import bpy, json, math, hashlib, numpy as np
from mathutils import Vector

builder_source=Path(__file__).with_name('style-seated-denim.py').read_text(encoding='utf8')
prefix=builder_source.split('# More, finer tapered hairs.')[0]
prefix=prefix.replace("/'seated-denim'", "/'seated-wardrobe'")
prefix=prefix.replace("'Lion_Original_Rig_Denim.blend'", "'Lion_Original_Rig_Wardrobe.blend'")
exec(compile(prefix, str(Path(__file__).with_name('style-seated-denim.py')), 'exec'))

def packed_image(name, pixels, noncolor=False):
    h,w=pixels.shape[:2]
    image=bpy.data.images.new(name,w,h,alpha=False)
    if noncolor:image.colorspace_settings.name='Non-Color'
    data=np.ones((h,w,4),np.float32);data[:,:,:3]=pixels
    image.pixels.foreach_set(data.ravel());image.pack();return image

# Indigo denim: restrained worn knee openings, uneven edges and individual
# crossing weft threads. A matching tangent-space normal adds recessed depth.
pixels=np.empty(N*N*4,np.float32);im.pixels.foreach_get(pixels)
pixels=pixels.reshape(N,N,4);height=np.full((N,N),.5,np.float32)
for cu,cv,rx,ry in [(.50,.55,.088,.020),(.52,.405,.060,.008)]:
    dx=(uu-cu)/rx;dy=(vv-cv)/ry
    wobble=.055*np.sin(uu*540)+.035*np.sin(vv*690+uu*112)
    dist=np.sqrt(dx*dx+dy*dy)+wobble
    hole=dist<.91;edge=(dist>=.91)&(dist<1.12)
    weft=np.sin((vv-cv)*math.tau*130+np.sin(uu*93)*.12)
    threads=hole & (weft>.78) & (rng.random((N,N))>.035)
    grain=.8+.2*rng.random((N,N))
    for j,c in enumerate((.065,.032,.013)):pixels[:,:,j][hole]=c*grain[hole]
    fray=.67+.22*rng.random((N,N))
    for j,c in enumerate((.17,.22,.27)):
        pixels[:,:,j][edge]=c*fray[edge]
    for j,c in enumerate((.43,.43,.38)):
        pixels[:,:,j][threads]=c*grain[threads]
    height[hole]=.20;height[edge]=.68;height[threads]=.60
im.pixels.foreach_set(pixels.ravel());im.pack()
dy,dx=np.gradient(height)
normal=np.stack([-dx*4,-dy*4,np.ones_like(dx)],axis=-1)
normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
nim=packed_image('Lion_Indigo_Distressed_Normal',normal*.5+.5,True)
nt=denim.node_tree.nodes.new('ShaderNodeTexImage');nt.image=nim
denim.node_tree.links.new(uvnode.outputs[0],nt.inputs['Vector'])
nm=denim.node_tree.nodes.new('ShaderNodeNormalMap');nm.uv_map='DenimUV';nm.inputs['Strength'].default_value=.48
denim.node_tree.links.new(nt.outputs['Color'],nm.inputs['Color']);denim.node_tree.links.new(nm.outputs['Normal'],dp.inputs['Normal'])

# A quiet charcoal sweatshirt with small knitted texture. Avoid shiny leather
# and painted fur. The shell uses the source skin weights vertex for vertex.
shirt,sp=material('LionWardrobe_CharcoalKnit',(.017,.020,.026),.94)
sp.inputs['Specular IOR Level'].default_value=.20
sp.inputs['Sheen Weight'].default_value=0
K=1024;kv,ku=np.mgrid[0:K,0:K].astype(np.float32)/K
knit=.93+.05*np.sin(ku*256*math.pi)*np.sin(kv*256*math.pi)+rng.random((K,K))*.04
texture=np.stack([knit*.145,knit*.157,knit*.175],axis=-1)
kim=packed_image('Lion_Charcoal_Knit',texture)
st=shirt.node_tree.nodes.new('ShaderNodeTexImage');st.image=kim
su=shirt.node_tree.nodes.new('ShaderNodeUVMap');su.uv_map='KnitUV'
shirt.node_tree.links.new(su.outputs[0],st.inputs['Vector']);shirt.node_tree.links.new(st.outputs['Color'],sp.inputs['Base Color'])
me.materials.append(shirt);shirt_index=len(me.materials)-1
hand=np.array([sum(g.weight for g in v.groups if any(t in group_names[g.group] for t in ('hand','thumb','palm'))) for v in me.vertices])
wrist_planes={}
wrist_distance=np.full(len(xyz),-1.,np.float32)
for side in (-1,1):
    wrist=np.array((side*.4748,-.0299,.9131))
    elbow=np.array((side*.35755,.04149,1.05582))
    direction=wrist-elbow;direction/=np.linalg.norm(direction)
    wrist_planes[side]=(wrist,direction)
    mask=(xyz[:,0]*side>.40)&(xyz[:,2]<1.02)
    wrist_distance[mask]=(xyz[mask]-wrist)@direction
is_hand=wrist_distance>-.018
selected=[]
for poly in me.polygons:
    ids=list(poly.vertices);center=xyz[ids].mean(0)
    covered=(poly.material_index==skin_index and np.mean(is_hand[ids])<.5)
    # Overlap the waist slightly, for a continuous lower hem in motion.
    covered|=(poly.material_index==denim_index and center[2]>.804 and arm[ids].mean()<.3)
    if covered:
        selected.append(poly);poly.material_index=shirt_index

original_ids=sorted({i for p in selected for i in p.vertices});index={old:i for i,old in enumerate(original_ids)}
source_normals=np.array([me.vertices[i].normal[:] for i in original_ids])
# Source UV/material islands duplicate geometrically shared vertices. Weld
# their logical garment topology BEFORE relaxing it, to avoid raised cracks.
_,representatives,inverse=np.unique(np.round(xyz[original_ids],4),axis=0,return_index=True,return_inverse=True)
faces=[[int(inverse[index[i]]) for i in p.vertices] for p in selected]
faces=[f for f in faces if len(set(f))>=3]
normals=np.zeros((len(representatives),3),np.float32)
np.add.at(normals,inverse,source_normals)
normals/=np.maximum(np.linalg.norm(normals,axis=1)[:,None],1e-9)
original_ids=[original_ids[i] for i in representatives]
coords=xyz[original_ids].copy()
edges=set()
edge_counts={}
for f in faces:
    for a,b in zip(f,f[1:]+f[:1]):
        e=tuple(sorted((a,b)));edges.add(e);edge_counts[e]=edge_counts.get(e,0)+1
boundary={v for e,n in edge_counts.items() if n==1 for v in e}
adj=[[] for _ in coords]
for a,b in edges:adj[a].append(b);adj[b].append(a)
# Relax old muscular/vest relief into a fabric silhouette. Boundary vertices
# retain their position so the sleeve endings remain fitted to the wrists.
for _ in range(18):
    avg=np.array([coords[a].mean(0) if a else coords[i] for i,a in enumerate(adj)])
    delta=(avg-coords)*.32
    if boundary:delta[list(boundary)]*=.12
    coords+=delta
coords+=normals*.007
torso_mask=np.abs(coords[:,0])<.23
coords[torso_mask,0]*=1.035
coords[torso_mask,1]+=np.sign(coords[torso_mask,1]-.015)*.005
fold_amp=.0016*np.sin(coords[:,2]*90+coords[:,0]*16)*np.exp(-((coords[:,2]-.88)/.20)**2)
coords+=normals*fold_amp[:,None]
for i in boundary:
    x,y,z=coords[i]
    if abs(x)>.40 and z<1.02:
        wrist,direction=wrist_planes[1 if x>0 else -1]
        coords[i]-=direction*(np.dot(coords[i]-wrist,direction)+.018)
# The skin immediately inside the cuff stays tawny; jagged source polygon
# borders are concealed beneath the garment, rather than painted on the paw.
for poly in me.polygons:
    ids=list(poly.vertices)
    if poly.material_index==shirt_index and wrist_distance[ids].mean()>-.055:poly.material_index=skin_index
sm=bpy.data.meshes.new('LionWardrobe_LongSleeveMesh');sm.from_pydata(coords,[],faces);sm.update()
shell=bpy.data.objects.new('LionV9_LongSleeveShirt',sm);scene.collection.objects.link(shell);shell.matrix_world=body.matrix_world.copy()
for g in body.vertex_groups:shell.vertex_groups.new(name=g.name)
for new,old in enumerate(original_ids):
    for g in me.vertices[old].groups:shell.vertex_groups[g.group].add([new],g.weight,'REPLACE')
sm.materials.append(shirt)
for p in sm.polygons:p.use_smooth=True
uvs=sm.uv_layers.new(name='KnitUV')
for loop in sm.loops:
    x,y,z=coords[loop.vertex_index];uvs.data[loop.index].uv=(float(x*3+y),float(z*3))
body_uv=me.uv_layers.get('KnitUV') or me.uv_layers.new(name='KnitUV')
for loop in me.loops:
    x,y,z=xyz[loop.vertex_index];body_uv.data[loop.index].uv=(float(x*3+y),float(z*3))
shell.modifiers.new('Original body garment weights','ARMATURE').object=rig
shell['LionLive_SkinnedFur']=True
shell['LionWardrobe_WeightedGarment']=True

# Sewn rolled edges follow the exact weighted shell boundary, including cuffs,
# neck and hem. Their modest scale keeps fingers free for gestures.
rib,rp=material('LionWardrobe_RibbedEdges',(.012,.014,.019),.91)
rv=[];rf=[];rweights=[]
for (a,b),n in edge_counts.items():
    if n!=1:continue
    va,vb=coords[a],coords[b];tangent=Vector(vb-va)
    midpoint=(va+vb)*.5
    if not ((abs(midpoint[0])>.40 and midpoint[2]<1.02) or .795<midpoint[2]<.825 or (abs(midpoint[0])<.15 and midpoint[2]>1.26)):continue
    if tangent.length<1e-7:continue
    tangent.normalize();normal=Vector(normals[a]);across=tangent.cross(normal).normalized()
    start=len(rv)
    for point,source_i in [(va,a),(vb,b)]:
        for s in range(6):
            angle=s*math.tau/6
            rv.append(Vector(point)+normal*(.0015+.0025*math.cos(angle))+across*(.0025*math.sin(angle)))
            rweights.append(original_ids[source_i])
    for s in range(6):rf.append((start+s,start+(s+1)%6,start+6+(s+1)%6,start+6+s))
rm=bpy.data.meshes.new('LionWardrobe_SeamsMesh');rm.from_pydata(rv,[],rf);rm.update()
ro=bpy.data.objects.new('LionV9_ShirtSeams',rm);scene.collection.objects.link(ro);ro.matrix_world=body.matrix_world.copy();rm.materials.append(rib)
for g in body.vertex_groups:ro.vertex_groups.new(name=g.name)
for vi,old in enumerate(rweights):
    for g in me.vertices[old].groups:ro.vertex_groups[g.group].add([vi],g.weight,'REPLACE')
for p in rm.polygons:p.use_smooth=True
ro.modifiers.new('Original body seam weights','ARMATURE').object=rig;ro['LionLive_SkinnedFur']=True

# The fabric shell supplies the visible torso. Suppress the covered original
# muscular surface so it cannot poke through during gestures.
under=shirt.copy();under.name='LionWardrobe_HiddenUnderShirt'
under.node_tree.nodes.get('Principled BSDF').inputs['Alpha'].default_value=0
under.blend_method='HASHED';under.use_screen_refraction=False
me.materials.append(under);under_index=len(me.materials)-1
for poly in me.polygons:
    if poly.material_index==shirt_index:poly.material_index=under_index

# Reuse the proven fur/chain attachment code with short paw fur only. The
# torso and sleeves have no hair mesh, and chains sit close to the new shirt.
tail=builder_source.split('# More, finer tapered hairs.')[1]
tail='# More, finer tapered hairs.'+tail
tail=tail.replace('count=180000','count=24000')
tail=tail.replace('length=rng.uniform(.038,.072,count);length[torso]=rng.uniform(.12,.23,int(torso.sum()))','length=rng.uniform(.006,.014,count)')
tail=tail.replace('radius=rng.uniform(.00012,.00022,count)','radius=rng.uniform(.00009,.00015,count)')
tail=tail.replace('y-.056-row*.009','y-.017-row*.004')
tail=tail.replace("'upper_fur_strands':count", "'paw_fur_strands':count,'shirt_vertices':len(sm.vertices),'shirt_faces':len(sm.polygons),'shirt_skinned':True,'wardrobe':'charcoal long sleeves and distressed indigo long jeans'")
exec(compile(tail,str(Path(__file__).with_name('style-seated-denim.py')),'exec'))
print('WARDROBE_READY',flush=True)
