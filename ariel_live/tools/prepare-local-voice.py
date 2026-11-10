"""Finite audition, using only the user's approved synthetic lion reference."""
import os,json,time,sys
from pathlib import Path
os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
os.environ['DO_NOT_TRACK']='1'
import torch,soundfile as sf
from huggingface_hub import HfApi,snapshot_download
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
root=Path(__file__).resolve().parents[1];out=root/'media'/'speech';out.mkdir(exist_ok=True)
repo='ResembleAI/chatterbox';revision=HfApi().model_info(repo).sha
ckpt=snapshot_download(repo,revision=revision,allow_patterns=['ve.pt','t3_mtl23ls_v2.safetensors','s3gen.pt','grapheme_mtl_merged_expanded_v1.json','conds.pt','Cangjie5_TC.json'])
print('MODELS_READY',revision,flush=True)
device='cuda' if torch.cuda.is_available() else 'cpu';torch.set_num_threads(4)
t=time.monotonic();model=ChatterboxMultilingualTTS.from_local(ckpt,device=device)
model.prepare_conditionals(str(out/'gemini-original-voice-reference.wav'),exaggeration=.35)
print('VOICE_READY',device,round(time.monotonic()-t,2),flush=True)
rows=[]
for lang,text in [('he','מה קורה חברים? אני כאן, תשאלו אותי מה שבא לכם.'),('en','Welcome back, my friends. I am ready for your questions.')]:
 torch.manual_seed(42);t=time.monotonic()
 wav=model.generate(text,language_id=lang,exaggeration=.35,cfg_weight=.5,temperature=.65)
 file=out/('lion-clone-audition-'+lang+'.wav');sf.write(str(file),wav.squeeze(0).detach().cpu().numpy(),model.sr)
 row={'language':lang,'text':text,'secondsToGenerate':round(time.monotonic()-t,3),'audioSeconds':round(wav.shape[-1]/model.sr,3),'file':str(file)};rows.append(row);print('AUDITION',json.dumps(row,ensure_ascii=True),flush=True)
cfg={'modelDir':ckpt,'revision':revision,'device':device,'reference':str(out/'gemini-original-voice-reference.wav'),'approved':False,'auditions':rows}
(root/'data'/'local-voice-config.json').write_text(json.dumps(cfg,indent=2),encoding='utf-8')
