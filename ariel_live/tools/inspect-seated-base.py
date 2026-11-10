"""Read the existing author's seated pose; never save the source."""
import bpy, json, numpy as np
s=bpy.data.scenes['Lion_Chosen_C_Animated']; bpy.context.window.scene=s
scope={'__name__':'lion_chosen_live'}
exec(compile(bpy.data.texts['LionChosen_Live.py'].as_string(),'LionChosen_Live.py','exec'),scope)
scope['apply_frame'](scope['create_state'](),0.,None,None,1/30)
rig=bpy.data.objects['LionChosen_C_Rig']; body=bpy.data.objects['LionChosen_C_Body']
dg=bpy.context.evaluated_depsgraph_get(); ev=body.evaluated_get(dg); mesh=ev.to_mesh()
report={'body_materials':[],'bones':{},'objects':[]}
for i,m in enumerate(body.data.materials):
 ids=sorted(set(v for p in body.data.polygons if p.material_index==i for v in p.vertices))
 a=np.array([body.data.vertices[v].co[:] for v in ids]); b=np.array([(ev.matrix_world@mesh.vertices[v].co)[:] for v in ids])
 report['body_materials'].append({'index':i,'name':m.name,'vertices':len(ids),'rest_bounds':[a.min(0).tolist(),a.max(0).tolist()] if len(ids) else [],'posed_bounds':[b.min(0).tolist(),b.max(0).tolist()] if len(ids) else []})
for bone in rig.pose.bones:
 report['bones'][bone.name]={'rest_head':list(bone.bone.head_local),'posed_head':list(rig.matrix_world@bone.head),'posed_tail':list(rig.matrix_world@bone.tail)}
ev.to_mesh_clear()
for o in s.objects:
 if 'Chair' in o.name: report['objects'].append({'name':o.name,'hidden':o.hide_render})
print('SEATED_BASE '+json.dumps(report),flush=True)
