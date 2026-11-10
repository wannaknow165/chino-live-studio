exec(compile(open(__file__.replace('test-mouth-depth.py','probe-cavity.py'),encoding='utf-8').read().split("bpy.context.view_layer.update()\ns.render.filepath")[0].replace("__file__.replace('probe-cavity.py','isolate-mouth.py')","__file__.replace('test-mouth-depth.py','isolate-mouth.py')"),__file__,'exec'))
lining=bpy.data.objects['LionChosen_C_MouthLining'];lkeys=lining.data.shape_keys.key_blocks
old={}
for k in lkeys:
 a=np.empty((len(k.data),3),np.float32);k.data.foreach_get('co',a.ravel());old[k.name]=a
for depth in [.01,.02,.03]:
 for k in lkeys:
  a=old[k.name].copy();a[:,1]+=depth;k.data.foreach_set('co',a.ravel())
 bpy.context.view_layer.update();s.render.filepath=os.path.join(out,'recess_'+str(depth)+'.png');bpy.ops.render.render(write_still=True)
