import unittest,tempfile,pathlib,json,runpy,sys,io,contextlib,shutil
from unittest.mock import patch
class VideoContract(unittest.TestCase):
 def test_first_last_frames_and_single_submission(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);(root/'tools').mkdir();(root/'data').mkdir();(root/'data/settings.json').write_text(json.dumps({'openrouterKey':'fixture'}));(root/'master.png').write_bytes(b'fixture');script=root/'tools/or_video.py';shutil.copyfile(pathlib.Path(__file__).with_name('or_video.py'),script);state=root/'state.json';state.write_text('{}');calls=[]
   class Response:
    def __init__(self,b):self.b=b
    def __enter__(self):return self
    def __exit__(self,*_):pass
    def read(self):return self.b
   def fake(req,**kwargs):
    calls.append(req)
    return Response(b'video bytes' if '/content?' in req.full_url else json.dumps({'id':'fixture-job','status':'completed','usage':{'cost':.24}}).encode())
   argv=[str(script),str(root/'master.png'),'result','google/veo-3.1-lite','8','720p','--last-frame='+str(root/'master.png'),'--job-state-file='+str(state)]
   with patch.object(sys,'argv',argv),patch('urllib.request.urlopen',side_effect=fake),contextlib.redirect_stdout(io.StringIO()):runpy.run_path(str(script),run_name='__main__')
   posts=[r for r in calls if r.data];self.assertEqual(len(posts),1);body=json.loads(posts[0].data);self.assertEqual([f['frame_type'] for f in body['frame_images']],['first_frame','last_frame']);self.assertFalse(body['generate_audio']);self.assertEqual(json.loads(state.read_text())['state'],'completed');self.assertEqual((root/'data/ovsrc/result.mp4').read_bytes(),b'video bytes')
if __name__=='__main__':unittest.main()
