from pathlib import Path
s=Path(__file__).with_name('export-performer-v7.py').read_text(encoding='utf-8')
s=s.replace('renderer-v7','renderer-v8').replace('lion_live_v7.glb','lion_live_v8.glb').replace("'LionV7_'","'LionV8_'")
s=s.replace("'LionChosen_C_DenseManeGroom_LiveLOD',",'')
s=s.replace("static_names = ['LionChosen_C_Body']","static_names = ['LionChosen_C_Body','LionChosen_C_DenseManeGroom']")
s=s.replace("for name in dynamic_names:\n    obj=mapping[name]\n    color=", "for name in dynamic_names + ['LionChosen_C_DenseManeGroom']:\n    obj=mapping[name]\n    color=")
# Imported scan surfaces contain coincident split vertices. Average normals at
# coincident positions without changing topology, UVs, weights or expressions.
anchor="    if name=='LionChosen_C_Body':\n        if len(data.vertices)"
replacement="""    if name=='LionChosen_C_Body':
        for poly in data.polygons:poly.use_smooth=True
        for edge in data.edges:edge.use_edge_sharp=False
        xyz=np.empty((len(data.vertices),3),np.float32);data.vertices.foreach_get('co',xyz.ravel())
        _,inverse=np.unique(np.round(xyz,5),axis=0,return_inverse=True)
        sums=np.zeros((inverse.max()+1,3),np.float64)
        for poly in data.polygons:
            normal=np.asarray(poly.normal)*max(poly.area,1e-12)
            for vertex in poly.vertices:sums[inverse[vertex]]+=normal
        sums/=np.maximum(np.linalg.norm(sums,axis=1)[:,None],1e-12)
        data.normals_split_custom_set_from_vertices(sums[inverse].tolist())
        if len(data.vertices)"""
assert anchor in s;s=s.replace(anchor,replacement)
s=s.replace("m,p=basic('LionLive_Iris',(1,1,1),.32)","m,p=basic('LionLive_Iris',(1,1,1),.46)\np.inputs['Specular IOR Level'].default_value=.18")
s=s.replace("'facial_targets':52,","'facial_targets':52,'outer_mane_vertices':len(mapping['LionChosen_C_DenseManeGroom'].data.vertices),")
Path(__file__).with_name('export-performer-v8.py').write_text(s,encoding='utf-8')

p=Path(__file__).with_name('render-style-v7.py').read_text(encoding='utf-8').replace('appearance-v7','appearance-v8')
Path(__file__).with_name('render-style-v8.py').write_text(p,encoding='utf-8')
print('Prepared v8 export and preview')
