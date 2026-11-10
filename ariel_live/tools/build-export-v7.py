from pathlib import Path
p=Path(__file__).with_name('export-performer-v6.py');s=p.read_text(encoding='utf-8')
s=s.replace("'renderer-v6'","'renderer-v7'").replace("'lion_live_v6.glb'","'lion_live_v7.glb'")
anchor="jaw_group = empty('LionLive_Jaw',jaw_pivot-head_pivot,head_group)"
s=s.replace(anchor,anchor+'''
# Bake the chosen seated pose into the bind skeleton. Existing source weights
# are retained, so the body can breathe and move with music on the GPU.
arm=bpy.data.armatures.new('LionLive_BodyRig');live_rig=bpy.data.objects.new('LionLive_BodyRig',arm);collection.objects.link(live_rig)
bpy.ops.object.select_all(action='DESELECT');live_rig.select_set(True);bpy.context.view_layer.objects.active=live_rig
bpy.ops.object.mode_set(mode='EDIT')
for source_bone in rig.pose.bones:
    b=arm.edit_bones.new(source_bone.name);b.matrix=rig.matrix_world@source_bone.matrix;b.length=max(.005,source_bone.length)
for source_bone in rig.pose.bones:
    if source_bone.parent:arm.edit_bones[source_bone.name].parent=arm.edit_bones[source_bone.parent.name]
bpy.ops.object.mode_set(mode='OBJECT');bpy.context.view_layer.update()
def bone_parent(obj,bone):
    bpy.context.view_layer.update();world=obj.matrix_world.copy();obj.parent=live_rig;obj.parent_type='BONE';obj.parent_bone=bone;obj.matrix_world=world;bpy.context.view_layer.update()
bone_parent(head_group,'spine.005')
''')
s=s.replace("and o.type=='MESH']", "and o.type=='MESH'] + [o.name for o in scene.objects if o.name.startswith('LionV7_') and o.type in {'MESH','CURVE'}]")
anchor='    objects.append(obj)'
s=s.replace(anchor,anchor+'''
    if name=='LionChosen_C_Body':
        if len(data.vertices)!=len(source.data.vertices):raise RuntimeError('Body topology changed before skin export')
        for g in source.vertex_groups:obj.vertex_groups.new(name=g.name)
        for v in source.data.vertices:
            for g in v.groups:obj.vertex_groups[g.group].add([v.index],g.weight,'REPLACE')
        modifier=obj.modifiers.new('Live seated body skin','ARMATURE');modifier.object=live_rig
    elif name.startswith('LionV7_'):
        bone_parent(obj,source.get('LionLive_AttachBone','spine.003'))
''')
s=s.replace('[root,head_group,jaw_group,*objects]','[root,head_group,jaw_group,live_rig,*objects]')
s=s.replace("'Existing chosen C seated pose; body mesh is static in this export'","'Seated bind skeleton with original body weights; 38 bones for live movement'")
Path(__file__).with_name('export-performer-v7.py').write_text(s,encoding='utf-8')
print('Prepared v7 exporter with a seated bind skeleton')
