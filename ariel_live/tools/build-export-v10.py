from pathlib import Path
s=Path(__file__).with_name('export-performer-v9.py').read_text(encoding='utf-8').replace('renderer-v9','renderer-v10').replace('lion_live_v9.glb','lion_live_v10.glb')
s=s.replace("('LionV8_','LionV9_')","('LionV8_','LionV9_','LionV10_')").replace('LionV9_ArmHandFur','LionV10_BodyFur')
Path(__file__).with_name('export-performer-v10.py').write_text(s,encoding='utf-8')
print('Prepared full fur body export')
