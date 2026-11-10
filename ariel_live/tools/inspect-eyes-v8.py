import bpy,json,os,numpy as np
from mathutils import Vector
s=bpy.data.scenes['Lion_Chosen_C_Animated'];bpy.context.window.scene=s
ns={'__name__':'lion_chosen_live'}
exec(compile(bpy.data.texts['LionChosen_Live.py'].as_string(),'LionChosen_Live.py','exec'),ns)
ns['apply_frame'](ns['create_state'](),0.,None,None,1/30)
bpy.context.view_layer.update();r={}
for name in ['LionChosen_C_Head','LionChosen_C_Body','LionChosen_C_PortraitIrises','LionChosen_C_PortraitCorneas','LionChosen_C_DenseManeGroom','LionChosen_C_DenseManeGroom_LiveLOD']:
 o=bpy.data.objects[name];ev=o.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh()
 pts=np.array([ev.matrix_world@v.co for v in me.vertices]);ev.to_mesh_clear()
 r[name]={'bounds':[pts.min(axis=0).tolist(),pts.max(axis=0).tolist()],'verts':len(pts),'smooth':sum(p.use_smooth for p in o.data.polygons),'polys':len(o.data.polygons),'attrs':[(a.name,a.data_type)for a in o.data.attributes],'materials':[]}
 if 'Irises' in name or 'Corneas' in name:
  r[name]['points_sample']=pts[::max(1,len(pts)//15)].tolist()
  for m in o.data.materials:
   r[name]['materials'].append({'name':m.name,'nodes':[{'name':n.name,'type':n.type,'operation':getattr(n,'operation',None),'inputs':{i.name:list(i.default_value) if i.type in ['RGBA','VECTOR'] else i.default_value for i in n.inputs if not i.is_linked and i.type in ['VALUE','INT','BOOLEAN','RGBA','VECTOR']}}for n in m.node_tree.nodes],'links':[(l.from_node.name,l.from_socket.name,l.to_node.name,l.to_socket.name)for l in m.node_tree.links]})
r['settings']={p.identifier:str(getattr(s.lion_chosen_settings,p.identifier)) for p in s.lion_chosen_settings.bl_rna.properties if p.identifier!='rna_type'}
r['pose']={b.name:list(b.rotation_euler)for b in bpy.data.objects['LionChosen_C_Rig'].pose.bones}
out=os.path.join(os.path.dirname(__file__),'..','data','performer','appearance','eyes-v8-inspection.json')
with open(out,'w')as f:json.dump(r,f,indent=2)
with open(os.path.join(os.path.dirname(__file__),'..','data','performer','appearance','source-live-inspect.py'),'w',encoding='utf-8')as f:f.write(bpy.data.texts['LionChosen_Live.py'].as_string())
print('EYES_INSPECTED')
