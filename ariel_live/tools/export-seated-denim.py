"""Reuse the proven morph/skeleton exporter with the new wardrobe only."""
from pathlib import Path
import json, struct
cache=Path(__file__).resolve().parent.parent/'data'/'performer'/'seated-denim'/'face-texture-cache'
cache.mkdir(exist_ok=True)
# Styling does not touch the face material or UVs. Reuse its verified v9
# textures instead of rebaking the exact same face for every fur adjustment.
with (cache.parent.parent/'renderer-v9'/'lion_live_v9.glb').open('rb') as f:
    f.read(12); size,_=struct.unpack('<II',f.read(8)); original=json.loads(f.read(size))
    size,_=struct.unpack('<II',f.read(8)); binary_start=f.tell()
    for matname,field,name in [('LionLive_Skin','baseColorTexture','skin'),('LionLive_Skin','metallicRoughnessTexture','roughness'),('LionLive_Iris','baseColorTexture','iris')]:
        mat=next(m for m in original['materials'] if m.get('name')==matname)
        im=original['images'][original['textures'][mat['pbrMetallicRoughness'][field]['index']]['source']]
        view=original['bufferViews'][im['bufferView']];f.seek(binary_start+view.get('byteOffset',0))
        assert im['mimeType']=='image/png'
        (cache/(name+'.png')).write_bytes(f.read(view['byteLength']))
def _cached_face_texture(name):
    image=bpy.data.images.load(str(cache/(name+'.png')),check_existing=False)
    if name=='roughness':image.colorspace_settings.name='Non-Color'
    image.pack();return image
source=Path(__file__).with_name('export-performer-v9.py').read_text(encoding='utf8')
source=source.replace("'renderer-v9'","'seated-denim'").replace("'lion_live_v9.glb'","'lion_original_denim.next.glb'")
needle="target=os.path.join(OUT,'lion_original_denim.next.glb')"
assert source.count(needle)==1
source=source.replace(needle,"head_group.scale = (1.22, 1.22, 1.22)\nbpy.context.view_layer.update()\n"+needle)
# Emission bakes only need the selected skin/iris. Exclude the millions of
# unrelated hair vertices and the duplicate authoring scene from Cycles.
source=source.replace("    old=list(obj.data.materials)","    render_visibility=[(o,o.hide_render) for o in scene.objects]\n    for o,_ in render_visibility:o.hide_render=(o != obj)\n    old=list(obj.data.materials)")
source=source.replace("    image.pack()\n    return image","    image.pack()\n    for o,hidden in render_visibility:o.hide_render=hidden\n    return image")
source=source.replace("bake_socket(gpu_head,0,'Base Color',4096,'LionLive_Skin_Albedo')","_cached_face_texture('skin')")
source=source.replace("bake_socket(gpu_head,0,'Roughness',1024,'LionLive_Skin_Roughness')","_cached_face_texture('roughness')")
source=source.replace("bake_socket(iris,0,'Base Color',1024,'LionLive_Iris_Albedo')","_cached_face_texture('iris')")
exec(compile(source,str(Path(__file__).with_name('export-performer-v9.py')),'exec'))
final=Path(OUT)/'lion_original_denim.glb'
Path(target).replace(final)
report['file']=str(final)
(Path(OUT)/'asset_report.json').write_text(json.dumps(report,indent=2),encoding='utf8')
print('DENIM_ASSET_ACTIVATED',flush=True)
