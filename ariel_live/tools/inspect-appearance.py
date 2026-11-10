import bpy,json,os
from mathutils import Vector
out=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','data','performer','appearance'));os.makedirs(out,exist_ok=True)
s=bpy.data.scenes['Lion_Chosen_C_Animated'];bpy.context.window.scene=s
body=bpy.data.objects['LionChosen_C_Body']
report={'body':{'vertices':len(body.data.vertices),'materials':[],'attributes':[a.name for a in body.data.attributes]},'groom':{},'nodes':{}}
for i,m in enumerate(body.data.materials):
 polys=[p for p in body.data.polygons if p.material_index==i]
 verts=set(v for p in polys for v in p.vertices)
 pts=[body.data.vertices[v].co for v in verts]
 entry={'index':i,'name':m.name,'faces':len(polys),'min':[min(p[j] for p in pts) for j in range(3)] if pts else [],'max':[max(p[j] for p in pts) for j in range(3)] if pts else [],'images':[]}
 for n in m.node_tree.nodes:
  if n.type=='TEX_IMAGE' and n.image:entry['images'].append({'name':n.image.name,'size':list(n.image.size),'file':n.image.filepath})
 report['body']['materials'].append(entry)
for o in s.objects:
 if any(x in o.name for x in ['Fur','ManeGroom']):report['groom'][o.name]={'type':o.type,'hide_render':o.hide_render,'modifiers':[{'type':m.type,'name':m.name} for m in o.modifiers]}
for g in bpy.data.node_groups:
 if 'Fur' in g.name or 'Groom' in g.name:
  report['nodes'][g.name]=[{'name':n.name,'type':n.type,'inputs':{i.name:float(i.default_value) for i in n.inputs if i.type=='VALUE' and not i.is_linked}} for n in g.nodes if n.type in ['MATH','VALUE','CURVE_PRIMITIVE_LINE','CURVE_PRIMITIVE_QUADRILATERAL','RESAMPLE_CURVE'] or 'Length' in n.name or 'Density' in n.name]
with open(os.path.join(out,'source.json'),'w')as f:json.dump(report,f,indent=2)
print(json.dumps(report),flush=True)
