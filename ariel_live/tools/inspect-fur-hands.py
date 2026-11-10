import bpy,json,numpy as np,os
s=bpy.data.scenes['Lion_Chosen_C_Animated'];bpy.context.window.scene=s
ns={'__name__':'lion_chosen_live'};exec(compile(bpy.data.texts['LionChosen_Live.py'].as_string(),'LionChosen_Live.py','exec'),ns);ns['apply_frame'](ns['create_state'](),0.,None,None,1/30)
dg=bpy.context.evaluated_depsgraph_get();r={}
o=bpy.data.objects['LionChosen_C_DenseManeGroom'];ev=o.evaluated_get(dg);me=ev.to_mesh()
p=np.array([ev.matrix_world@v.co for v in me.vertices]);offset=np.array([d.vector[:]for d in o.data.attributes['LionRootOffset'].data])
r['groom']={'first_points':p[:21].tolist(),'first_polys':[list(p.vertices)for p in me.polygons[:18]],'offset_first':offset[:7].tolist(),'offset_length_quantiles':np.quantile(np.linalg.norm(offset,axis=1),[0,.1,.5,.9,1]).tolist(),'color_first':[(d.color[:])for d in me.color_attributes['LionFiberColor'].data[:7]]};ev.to_mesh_clear()
o=bpy.data.objects['LionChosen_C_Body'];ev=o.evaluated_get(dg);me=ev.to_mesh();points=np.array([ev.matrix_world@v.co for v in me.vertices])
for g in o.vertex_groups:
 if any(t in g.name for t in ['arm','hand','thumb','palm','shoulder']):
  idx=[v.index for v in o.data.vertices if any(x.group==g.index and x.weight>.3 for x in v.groups)]
  if idx:r[g.name]={'bounds':[points[idx].min(axis=0).tolist(),points[idx].max(axis=0).tolist()],'mean':points[idx].mean(axis=0).tolist(),'verts':len(idx)}
r['modifiers']=[(m.name,m.type)for m in o.modifiers]
out=os.path.join(os.path.dirname(__file__),'..','data','performer','appearance','fur-hands.json')
with open(out,'w')as f:json.dump(r,f,indent=2)
print('INSPECTED_FUR_HANDS')
