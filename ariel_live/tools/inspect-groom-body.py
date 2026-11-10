import bpy,json,os
out=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','data','performer','appearance'))
r={}
for name in ['LionChosen_C_Body','LionChosen_C_DenseManeGroom','LionChosen_C_DenseManeGroom_LiveLOD','LionChosen_C_ShortFaceFur_LiveLOD']:
 o=bpy.data.objects[name];r[name]={'vertices':len(o.data.vertices),'polys':len(o.data.polygons),'groups':[g.name for g in o.vertex_groups],'attributes':[(a.name,a.data_type,a.domain) for a in o.data.attributes], 'modifiers':[m.type for m in o.modifiers]}
rig=bpy.data.objects['LionChosen_C_Rig'];r['bones']={b.name:{'head':list(b.head),'tail':list(b.tail),'parent':b.parent.name if b.parent else None} for b in rig.pose.bones}
for name in ['LionChosen_SurfaceBoundFur_LiveLOD']:
 g=bpy.data.node_groups[name];r[name]={'nodes':[{'name':n.name,'type':n.type,'label':n.label} for n in g.nodes],'links':[(l.from_node.name,l.from_socket.name,l.to_node.name,l.to_socket.name)for l in g.links]}
with open(os.path.join(out,'groom-body.json'),'w')as f:json.dump(r,f,indent=2)
