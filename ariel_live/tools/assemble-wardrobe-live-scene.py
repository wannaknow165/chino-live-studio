"""Package the live wardrobe and existing throne as an additional Blender file."""
from pathlib import Path
source=Path(__file__).with_name('assemble-denim-live-scene.py').read_text(encoding='utf8')
source=source.replace("/'seated-denim'", "/'seated-wardrobe'")
source=source.replace('lion_original_denim.glb','lion_original_wardrobe.glb')
source=source.replace('Lion_Original_Rig_Denim.blend','Lion_Original_Rig_Wardrobe.blend')
source=source.replace('Lion_Denim_Live_Scene.blend','Lion_Wardrobe_Live_Scene.blend')
source=source.replace('Original Lion - Denim Live Set','Original Lion - Charcoal and Indigo')
source=source.replace('denim, longer fur, chains and fitted chair','charcoal long sleeves, distressed jeans, short paw fur, chains and fitted chair')
exec(compile(source,str(Path(__file__).with_name('assemble-denim-live-scene.py')),'exec'))
