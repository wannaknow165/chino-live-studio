exec(compile(open(__file__.replace('probe-cavity.py','isolate-mouth.py'),encoding='utf-8').read().split('for n in names:\n o=bpy.data.objects[n];o.hide_render')[0],__file__,'exec'))
import numpy as np
parts=np.array([d.value for d in h.data.attributes['LionChosen_Part'].data])
print('PARTS',[(int(i),int((parts==i).sum())) for i in np.unique(parts)],flush=True)
for k in keys:
 a=np.empty((len(k.data),3),np.float32);k.data.foreach_get('co',a.ravel());a[parts==1]=(0,.08,1.5);k.data.foreach_set('co',a.ravel())
bpy.context.view_layer.update()
s.render.filepath=os.path.join(out,'without_legacy_cavity.png');bpy.ops.render.render(write_still=True)
bpy.data.objects['LionChosen_C_MouthLining'].hide_render=True
s.render.filepath=os.path.join(out,'without_both_cavities.png');bpy.ops.render.render(write_still=True)
