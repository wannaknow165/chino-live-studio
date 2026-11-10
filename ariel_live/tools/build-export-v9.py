from pathlib import Path
s=Path(__file__).with_name('export-performer-v8.py').read_text(encoding='utf-8').replace('renderer-v8','renderer-v9').replace('lion_live_v8.glb','lion_live_v9.glb')
s=s.replace("o.name.startswith('LionV8_')","o.name.startswith(('LionV8_','LionV9_'))")
s=s.replace("    elif name.startswith('LionV8_'):","""    elif source.get('LionLive_SkinnedFur'):
        if len(data.vertices)!=len(source.data.vertices):raise RuntimeError('Skinned fur topology changed')
        for g in source.vertex_groups:obj.vertex_groups.new(name=g.name)
        for v in source.data.vertices:
            for g in v.groups:obj.vertex_groups[g.group].add([v.index],g.weight,'REPLACE')
        world=obj.matrix_world.copy();obj.parent=root;obj.matrix_world=world
        modifier=obj.modifiers.new('Live arm and hand fur skin','ARMATURE');modifier.object=live_rig
    elif name.startswith(('LionV8_','LionV9_')):""")
s=s.replace("for name in dynamic_names + ['LionChosen_C_DenseManeGroom']:","for name in dynamic_names + ['LionChosen_C_DenseManeGroom','LionV9_ArmHandFur']:")
Path(__file__).with_name('export-performer-v9.py').write_text(s,encoding='utf-8')
print('Prepared v9 export with skinned hand and arm fur')
