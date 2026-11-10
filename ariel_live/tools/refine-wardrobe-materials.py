"""Refresh the existing derived wardrobe without rebuilding its geometry."""
import bpy, numpy as np, math
from pathlib import Path
root=Path(__file__).resolve().parent.parent
builder=Path(__file__).with_name('style-lion-wardrobe.py').read_text(encoding='utf8')
denim_builder=Path(__file__).with_name('style-seated-denim.py').read_text(encoding='utf8')
old=bpy.data.images['Lion_Indigo_Twill_2K']
exec('N=2048\n'+denim_builder.split('N=2048\n')[1].split('denim,dp=')[0])
old.user_remap(im)
denim=bpy.data.materials['LionDenim_IndigoJeans'];dp=denim.node_tree.nodes.get('Principled BSDF')
uvnode=next(n for n in denim.node_tree.nodes if n.type=='UVMAP' and n.uv_map=='DenimUV')
exec('def packed_image'+builder.split('def packed_image')[1].split('# A quiet charcoal sweatshirt')[0])
body=bpy.data.objects['LionChosen_C_Body'];me=body.data
shirt_index=next(i for i,m in enumerate(me.materials) if m and m.name=='LionWardrobe_CharcoalKnit')
under=me.materials[shirt_index].copy();under.name='LionWardrobe_HiddenUnderShirt'
under.node_tree.nodes.get('Principled BSDF').inputs['Alpha'].default_value=0;under.blend_method='HASHED'
me.materials.append(under);under_index=len(me.materials)-1
for poly in me.polygons:
    if poly.material_index==shirt_index:poly.material_index=under_index
bpy.ops.wm.save_as_mainfile(filepath=str(root/'data/performer/seated-wardrobe/Lion_Original_Rig_Wardrobe.blend'))
print('WARDROBE_MATERIALS_REFINED',flush=True)
