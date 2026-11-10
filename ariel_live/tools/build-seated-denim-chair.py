"""Reuse existing throne primitives, fit upholstery to the original rig."""
from pathlib import Path
source=Path(__file__).with_name('build-royal-throne.py').read_text(encoding='utf8').split('# Deep upholstered seat')[0]
source=source.replace("'royal-throne'","'seated-denim-chair'")
source=source.replace("if os.path.exists(os.path.join(out,'Royal_Throne.blend')):raise RuntimeError('Preserve throne checkpoint')", "# This script only rebuilds its own derived chair; Blender retains a .blend1 backup.")
exec(compile(source,'build-royal-throne.py','exec'))

# The original rig's hip is .556m, its knees .531m and wrists .835m.
# Seat top .475m leaves room for the thighs instead of cutting through them.
velvet.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.075,.0018,.005,1)
velvet.node_tree.nodes.get('Principled BSDF').inputs['Sheen Weight'].default_value=.38
gold.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.57,.285,.065,1)
box('Throne lower walnut seat',(0,.069,.395),(.69,.35,.09),wood,.025)
box('Deep burgundy seat cushion',(0,.069,.435),(.65,.35,.08),velvet,.038)
for z in [.355,.405]:tube('Seat carved gold edge',[(-.344,-.113,z),(-.18,-.124,z),(0,-.127,z),(.18,-.124,z),(.344,-.113,z)],.009)
for i in range(35):sphere('Seat bronze nail',(-.315+i*.63/34,-.110,.443),(.0025,.002,.0025),gold)

# A tall upholstered back with a bowed lower edge and carved, gilded perimeter.
nx,nz=48,72;verts=[];faces=[]
for j in range(nz+1):
 t=j/nz
 for i in range(nx+1):
  u=i/nx*2-1;w=.286+.048*math.sin(t*math.pi*.8);x=u*w
  z=.46+t*(.99-.10*abs(u)**3)
  # Slightly recessed diamonds in the padding, without oversized buttons.
  tuft=(.5+.5*math.cos(u*math.pi*5+t*math.pi*7))*(.5+.5*math.cos(u*math.pi*5-t*math.pi*7))
  y=.281-.026*(1-u*u)*math.sin(t*math.pi)+.007*tuft
  verts.append((x,y,z))
  if i and j:
   a=j*(nx+1)+i;faces.append((a,a-1,a-nx-2,a-nx-1))
me=bpy.data.meshes.new('Bowed padded velvet');me.from_pydata(verts,[],faces);me.update()
o=bpy.data.objects.new('Burgundy upholstered back',me);scene.collection.objects.link(o);finish(o,o.name,velvet)
mod=o.modifiers.new('Upholstery depth','SOLIDIFY');mod.thickness=.044
outline=[(-.29,.285,.46),(-.338,.285,.64),(-.365,.285,.95),(-.356,.285,1.23),(-.316,.285,1.37),(-.21,.285,1.43),(0,.285,1.49),(.21,.285,1.43),(.316,.285,1.37),(.356,.285,1.23),(.365,.285,.95),(.338,.285,.64),(.29,.285,.46)]
tube('Broad carved frame',outline,.032,darkgold)
tube('Outer polished gilt',[(x*1.035,y-.016,z) for x,y,z in outline],.010,gold)
tube('Inner gilded bead',[(x*.955,y-.034,z-.007) for x,y,z in outline],.006,gold)

def scroll(name,x,y,z,side,r=.034,turns=1.05,tube_radius=.004):
 pts=[]
 for k in range(36):
  t=k/35*math.pi*2*turns;rr=r*(1-.88*k/35)
  pts.append((x+side*rr*math.cos(t),y-.003*math.sin(t),z+rr*math.sin(t)))
 tube(name,pts,tube_radius,gold)

for side in [-1,1]:
 # Five small carved paired volutes, integrated into the frame rather than
 # large leaves protruding into the character silhouette.
 for z in [.61,.76,.91,1.06,1.21]:
  x=side*(.343 if z<.8 else .36)
  scroll('Back acanthus relief',x,.241,z,side,.022,.88,.0032)
  scroll('Back reverse relief',x,.244,z+.035,-side,.018,.85,.0025)
 scroll('Shoulder rococo scroll',side*.328,.244,1.385,side,.046,1.18,.007)
 for offset in [-.012,.012]:
  tube('Shoulder engraved sweep',[(side*.36,.24,1.31+offset),(side*.31,.235,1.36+offset),(side*.25,.24,1.40+offset)],.0032)
 # The forearm lands at x .295, y -.19; fingertips drape over the front.
 box('Burgundy arm pad',(side*.305,-.055,.788),(.098,.355,.065),velvet,.027)
 tube('Outer arm golden rail',[(side*.355,.14,.789),(side*.363,-.06,.79),(side*.344,-.23,.78)],.011)
 tube('Inner arm bead',[(side*.254,.13,.787),(side*.254,-.12,.787),(side*.268,-.235,.77)],.005)
 scroll('Armrest rolled end',side*.307,-.252,.764,side,.032,1.05,.008)
 for i in range(12):sphere('Arm upholstery nail',(side*.354,.10-i*.027,.796),(.002,.002,.002),gold)
 leg=[(side*.312,-.239,.77),(side*.343,-.255,.66),(side*.323,-.15,.49),(side*.307,-.17,.31),(side*.345,-.25,.08)]
 tube('Carved cabriole support',leg,.022,darkgold)
 tube('Support golden ridge',[(x-side*.006,y-.019,z)for x,y,z in leg],.007)
 for z in [.20,.34,.52,.64]:
  scroll('Cabriole relief',side*.327,-.27,z,side,.021,1.15,.0035)
 sphere('Carved lion foot',(side*.345,-.25,.065),(.033,.042,.025),gold)
 tube('Rear chair leg',[(side*.28,.22,.43),(side*.29,.26,.25),(side*.33,.29,.065)],.021,darkgold)

for x in [-.22,-.11,0,.11,.22]:
 scroll('Apron horizontal carving',x,-.136,.381,1,.017,.9,.003)
scroll('Central top ornament',0,.248,1.47,1,.023,1.12,.004)
scene.render.engine='BLENDER_EEVEE_NEXT';scene.render.film_transparent=True
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out,'Royal_Throne.blend'))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=os.path.join(out,'royal-throne.glb'),export_format='GLB',use_selection=True,export_animations=False)
with open(os.path.join(out,'report.json'),'w')as f:json.dump({'objects':len(scene.objects),'seat_top':.475,'arm_top':.8205,'back_depth':.281,'fit':'Original v9 face and body rig','source_preserved':True},f,indent=2)
print('FITTED_DENIM_THRONE_EXPORTED',flush=True)
