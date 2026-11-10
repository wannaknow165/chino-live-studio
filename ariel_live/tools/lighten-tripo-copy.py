"""Reduce only an upload copy's skin texture; preserve all rig/geometry data."""
import json, struct
from pathlib import Path
from PIL import Image
from io import BytesIO
folder=Path(__file__).resolve().parent.parent/'data'/'performer'/'seated-denim'
p=folder/'Lion_For_Tripo_Texture.glb'
with p.open('rb')as f:
 f.read(12);length,_=struct.unpack('<II',f.read(8));d=json.loads(f.read(length));length,_=struct.unpack('<II',f.read(8));binary=f.read(length)
mat=next(m for m in d['materials']if m.get('name')=='LionLive_Skin')
im=d['images'][d['textures'][mat['pbrMetallicRoughness']['baseColorTexture']['index']]['source']]
view_index=im['bufferView'];view=d['bufferViews'][view_index]
image=Image.open(BytesIO(binary[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']]))
image.thumbnail((2048,2048),Image.Resampling.LANCZOS);stream=BytesIO();image.save(stream,format='PNG')
parts=[];offset=0
for i,v in enumerate(d['bufferViews']):
 blob=stream.getvalue() if i==view_index else binary[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]
 v['byteOffset']=offset;v['byteLength']=len(blob);padding=b'\0'*((-len(blob))%4)
 parts.extend([blob,padding]);offset+=len(blob)+len(padding)
binary=b''.join(parts);d['buffers'][0]['byteLength']=len(binary)
payload=json.dumps(d,separators=(',',':')).encode();payload+=b' '*((-len(payload))%4)
temp=p.with_suffix('.tmp.glb')
with temp.open('wb')as f:
 f.write(struct.pack('<III',0x46546c67,2,28+len(payload)+len(binary)))
 f.write(struct.pack('<II',len(payload),0x4e4f534a));f.write(payload)
 f.write(struct.pack('<II',len(binary),0x004e4942));f.write(binary)
assert temp.stat().st_size<150_000_000
temp.replace(p)
report={'file':str(p),'bytes':p.stat().st_size,'master_unchanged':True,'skeleton_joint_counts':[len(s['joints'])for s in d['skins']],'morph_counts':sorted(set(len(p['targets'])for m in d['meshes']for p in m['primitives']if p.get('targets'))),'omitted':['DenseManeGroom','ShortFaceFur_LiveLOD','ArmHandFur','morph normals'],'skin_texture_size':list(image.size),'uploaded':False,'purpose':'Retexture trial; existing long groom and high resolution face stay in the master. Provider rig and UV preservation still require verification.'}
assert report['morph_counts']==[52] and report['skeleton_joint_counts']==[38]
(folder/'tripo-upload-copy.json').write_text(json.dumps(report,indent=2),encoding='utf8')
print(json.dumps(report))
