import bpy,json,os
from mathutils import Vector
source=r'C:\Users\shk\Downloads\Design_3D_CAD\royal+lion+3d+model.glb'
bpy.ops.import_scene.gltf(filepath=source);bpy.context.view_layer.update()
report={}
for o in bpy.context.scene.objects:
 if o.type=='ARMATURE':report[o.name]={'matrix':[list(row)for row in o.matrix_world],'bones':{b.name:{'head':list(o.matrix_world@b.head),'tail':list(o.matrix_world@b.tail),'parent':b.parent.name if b.parent else None}for b in o.pose.bones}}
 if o.type=='MESH':
  ev=o.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh();pts=[ev.matrix_world@v.co for v in me.vertices]
  report[o.name]={'verts':len(me.vertices),'bounds':[[min(p[i]for p in pts)for i in range(3)],[max(p[i]for p in pts)for i in range(3)]],'materials':[m.name for m in me.materials],'modifiers':[(m.name,m.type)for m in o.modifiers]};ev.to_mesh_clear()
out=os.path.join(os.path.dirname(__file__),'..','data','performer','source-review','royal-source.json')
with open(out,'w')as f:json.dump(report,f,indent=2)
print('ROYAL_SOURCE_INSPECTED',flush=True)
