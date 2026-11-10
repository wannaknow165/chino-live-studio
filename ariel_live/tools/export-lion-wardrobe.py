"""Reuse the original morph exporter and verified face textures for clothing."""
from pathlib import Path
import json,struct
source=Path(__file__).with_name('export-seated-denim.py').read_text(encoding='utf8')
# Leave the already verified texture cache where it is; change only outputs.
source=source.replace("replace(\"'renderer-v9'\",\"'seated-denim'\")", "replace(\"'renderer-v9'\",\"'seated-wardrobe'\")")
source=source.replace('lion_original_denim','lion_original_wardrobe')
exec(compile(source,str(Path(__file__).with_name('export-seated-denim.py')),'exec'))

# The body still has its old skin COLOR_0. Fabric primitives use fabric color
# exclusively. No geometry, skeleton, morph buffers or chain transforms change.
with final.open('rb') as f:
    f.read(12);size,_=struct.unpack('<II',f.read(8));doc=json.loads(f.read(size));remaining=f.read()
for mat in doc['materials']:
    if mat.get('name','').startswith(('LionWardrobe_','LionDenim_IndigoJeans')):
        mat.get('extensions',{}).pop('KHR_materials_sheen',None)
for mesh in doc['meshes']:
    mesh['primitives']=[p for p in mesh['primitives'] if doc['materials'][p.get('material',0)].get('name')!='LionWardrobe_HiddenUnderShirt']
    for p in mesh['primitives']:
        name=doc['materials'][p.get('material',0)].get('name','')
        if name.startswith(('LionWardrobe_','LionDenim_IndigoJeans')):p['attributes'].pop('COLOR_0',None)
payload=json.dumps(doc,separators=(',',':')).encode();payload+=b' '*((-len(payload))%4)
temp=final.with_suffix('.finished.glb')
with temp.open('wb') as f:
    f.write(struct.pack('<III',0x46546c67,2,20+len(payload)+len(remaining)));f.write(struct.pack('<II',len(payload),0x4e4f534a));f.write(payload);f.write(remaining)
temp.replace(final)
report['bytes']=final.stat().st_size
(Path(OUT)/'asset_report.json').write_text(json.dumps(report,indent=2),encoding='utf8')
print('WARDROBE_EXPORT_FINISHED',final.stat().st_size,flush=True)
