"""A separate, reusable gold and burgundy throne for the existing seated rig."""
import bpy,math,os,json
from mathutils import Vector
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.name='Lion_Royal_Throne'
out=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','data','performer','royal-throne'));os.makedirs(out,exist_ok=True)
if os.path.exists(os.path.join(out,'Royal_Throne.blend')):raise RuntimeError('Preserve throne checkpoint')
def mat(name,color,metal=0,rough=.5):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough;return m
gold=mat('Antique polished gold',(.62,.30,.065),.88,.23);darkgold=mat('Gold carved recess',(.24,.085,.012),.8,.32)
velvet=mat('Burgundy velvet',(.105,.0035,.009),0,.86);velvet.node_tree.nodes.get('Principled BSDF').inputs['Sheen Weight'].default_value=.65
wood=mat('Dark red polished wood',(.025,.005,.004),.1,.3)
def finish(o,name,m):
 o.name=name;o.data.materials.append(m)
 if o.type=='MESH':
  for p in o.data.polygons:p.use_smooth=True
 return o
def tube(name,points,r,material=gold,cyclic=False):
 cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.bevel_depth=r;cu.bevel_resolution=3;cu.resolution_u=16
 sp=cu.splines.new('BEZIER');sp.bezier_points.add(len(points)-1);sp.use_cyclic_u=cyclic
 for p,co in zip(sp.bezier_points,points):p.co=co;p.handle_left_type='AUTO';p.handle_right_type='AUTO'
 o=bpy.data.objects.new(name,cu);scene.collection.objects.link(o);return finish(o,name,material)
def sphere(name,p,scale,material=gold):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=12,radius=1,location=p);o=bpy.context.object;o.scale=scale;return finish(o,name,material)
def box(name,p,scale,material,bevel=.02):
 bpy.ops.mesh.primitive_cube_add(size=1,location=p);o=bpy.context.object;o.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 mod=o.modifiers.new('Rounded carved edges','BEVEL');mod.width=bevel;mod.segments=4
 mod=o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');return finish(o,name,material)
def leaf(name,x,y,z,angle,length=.042,width=.013):
 verts=[];faces=[];axis=Vector((math.sin(angle),0,math.cos(angle)));across=Vector((math.cos(angle),0,-math.sin(angle)))
 for i in range(11):
  t=i/10;half=width*math.sin(math.pi*t)**.65
  for side in [-1,0,1]:
   p=Vector((x,y,z))+axis*length*t+across*half*side;p.y-=.0035*math.sin(math.pi*t)*(1-abs(side));verts.append(p)
  if i:
   for j in range(2):faces.append(((i-1)*3+j,(i-1)*3+j+1,i*3+j+1,i*3+j))
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new(name,me);scene.collection.objects.link(o);finish(o,name,gold)
 mod=o.modifiers.new('Leaf relief thickness','SOLIDIFY');mod.thickness=.001
 return o
# Deep upholstered seat with raised gold carved apron.
box('Seat walnut foundation',(0,-.015,.545),(.71,.57,.115),wood,.032)
box('Seat velvet cushion',(0,-.04,.605),(.64,.51,.10),velvet,.04)
box('Front carved apron',(0,-.292,.535),(.71,.038,.10),darkgold,.015)
for z in [.49,.573]:tube('Seat gold molding',[(-.35,-.315,z),(0,-.327,z),(.35,-.315,z)],.008)
for i in range(25):sphere('Seat nailhead',(-.33+i*.66/24,-.324,.568),(.003,.003,.003))
# Convex, tufted tall back, with a sculpted crown-shaped upper edge.
verts=[];faces=[];nx,nz=40,64
for j in range(nz+1):
 v=j/nz
 for i in range(nx+1):
  u=i/nx*2-1;x=u*(.278+.026*math.sin(v*math.pi));z=.64+.78*v-.09*u*u*v**5
  tuft=(.5+.5*math.cos(u*math.pi*4))*(.5+.5*math.cos(v*math.pi*9))
  y=.205-.052*(1-u*u)*math.sin(v*math.pi)+.008*tuft
  verts.append((x,y,z))
  if i and j:
   a=j*(nx+1)+i;faces.append((a,a-1,a-nx-2,a-nx-1))
me=bpy.data.meshes.new('Tufted back');me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new('Tufted burgundy back',me);scene.collection.objects.link(o);finish(o,o.name,velvet)
mod=o.modifiers.new('Padded back thickness','SOLIDIFY');mod.thickness=.045
outline=[(-.28,.195,.64),(-.315,.195,.82),(-.322,.195,1.08),(-.30,.195,1.33),(-.23,.195,1.40),(-.12,.195,1.45),(0,.195,1.475),(.12,.195,1.45),(.23,.195,1.40),(.30,.195,1.33),(.322,.195,1.08),(.315,.195,.82),(.28,.195,.64)]
tube('Back broad carved frame',outline,.025,darkgold)
tube('Back outer gilt molding',[(x*1.025,y-.018,z)for x,y,z in outline],.009)
tube('Back inner gilt molding',[(x*.95,y-.026,z-.006)for x,y,z in outline],.007)
for side in [-1,1]:
 for k,z in enumerate([.75,.88,1.01,1.14,1.27]):
  x=side*(.315 if z<1.2 else .307)
  for tilt in [-.6,.6]:leaf('Back acanthus leaf',x,.155,z,side*tilt,.052,.012)
 for k in range(6):
  z=.73+k*.108;x=side*.272;sphere('Back nailhead',(x,.169,z),(.003,.003,.003))
 # Large carved scroll on each shoulder of the backrest.
 pts=[]
 for k in range(30):
  t=k/29*math.pi*2.1;r=.048*(1-k/34)
  pts.append((side*(.30+r*math.cos(t)),.16,1.38+r*math.sin(t)))
 tube('Shoulder carved scroll',pts,.007)
 for a in [-.7,0,.7]:leaf('Shoulder fan leaf',side*.30,.145,1.385,side*a,.07,.015)
 # Broad padded armrest under each paw, with curved gold rails.
 box('Burgundy padded arm',(side*.35,-.055,.80),(.10,.49,.085),velvet,.04)
 tube('Armrest outer gold rail',[(side*.405,.16,.80),(side*.41,-.10,.80),(side*.39,-.30,.79)],.012)
 tube('Armrest inner gold rail',[(side*.30,.16,.80),(side*.30,-.1,.80),(side*.31,-.30,.79)],.007)
 sphere('Carved armrest end',(side*.35,-.30,.78),(.052,.035,.043),darkgold)
 # S-shaped front legs and carved side supports.
 leg=[(side*.35,-.27,.79),(side*.38,-.30,.69),(side*.33,-.29,.50),(side*.32,-.25,.25),(side*.39,-.30,.055)]
 tube('S carved front leg',leg,.025,darkgold);tube('Leg gold highlight',[(x-side*.007,y-.020,z)for x,y,z in leg],.009)
 tube('Rear gold leg',[(side*.29,.23,.58),(side*.31,.25,.3),(side*.34,.28,.04)],.021,darkgold)
 for z in [.17,.28,.39,.64,.71]:
  x=side*(.34 if z<.5 else .365)
  for a in [-.55,.55]:leaf('Front leg foliage',x,-.322,z,side*a,.065,.017)
 for z in [.13,.34,.66]:
  pts=[]
  for k in range(22):
   t=k/21*math.pi*1.9;r=.025*(1-k/25)
   pts.append((side*(.35+r*math.cos(t)),-.337,z+r*math.sin(t)))
  tube('Leg carved scroll',pts,.004)
 sphere('Gold claw foot',(side*.39,-.31,.05),(.045,.055,.034),gold)
for i in range(5):
 x=(i-2)*.115
 for a in [-.7,.7]:leaf('Apron leaf',x,-.345,.5,a,.058,.015)
# Central crest is part of the throne, separate from the character's head.
for a in [-.65,-.3,0,.3,.65]:leaf('Throne crest',0,.16,1.45,a,.095,.017)
sphere('Crest red cabochon',(0,.151,1.48),(.013,.006,.017),velvet)
scene.render.engine='BLENDER_EEVEE_NEXT';scene.render.film_transparent=True
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out,'Royal_Throne.blend'))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=os.path.join(out,'royal-throne.glb'),export_format='GLB',use_selection=True,export_animations=False)
with open(os.path.join(out,'report.json'),'w')as f:json.dump({'objects':len(scene.objects),'materials':['antique gold','burgundy velvet','carved walnut'],'seat_height':.605,'arm_height':.8,'independent_scene_asset':True},f,indent=2)
print('ROYAL_THRONE_EXPORTED',flush=True)
