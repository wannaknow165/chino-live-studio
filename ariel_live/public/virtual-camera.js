const card=document.createElement('section');card.className='card';card.style.marginBottom='16px';
card.innerHTML='<h2>🎥 המצלמה הווירטואלית של צ׳ינו</h2><div class="row"><button id="cameraStart">הפעל מצלמה וירטואלית</button><button id="cameraStop" class="ghost">עצור מצלמה</button></div><p id="cameraStatus" role="status" class="small">בודק את המצלמה…</p><p class="small">ב־TikTok LIVE Studio בחרו OBS Virtual Camera. התמונה מגיעה ישירות מנגן צ׳ינו; אין צורך לפתוח OBS. המצלמה מעבירה תמונה בלבד — הסאונד מוגדר בנפרד ב־LIVE Studio.</p><a href="/stage?vcam=1" target="_blank">פתח את נגן המצלמה</a>';
document.querySelector('header').after(card);
const start=card.querySelector('#cameraStart'),stop=card.querySelector('#cameraStop'),status=card.querySelector('#cameraStatus');let busy=false;
const labels={camera_python_missing:'סביבת המצלמה אינה מותקנת',camera_start_failed:'לא הצלחתי להפעיל את המצלמה',camera_stopped_unexpectedly:'המצלמה נעצרה — נסו להפעיל מחדש'};
function render(s){start.disabled=busy||s.on;stop.disabled=busy||!s.on;status.textContent=s.error?(labels[s.error]||'תקלה במצלמה'):s.ready?'🟢 תמונת צ׳ינו נשלחת למצלמה · 1080×1920 · יעד 30 FPS':s.on?'🟠 המצלמה פועלת וממתינה לתמונה מנגן צ׳ינו':'⚪ המצלמה כבויה';}
async function update(on){if(busy)return;busy=true;start.disabled=stop.disabled=true;status.textContent=on?'מפעיל את המצלמה…':'עוצר את המצלמה…';try{const r=await fetch('/api/virtual-camera',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({on})});const s=await r.json();if(!r.ok)throw new Error(s.error);busy=false;render(s);}catch(e){busy=false;render({error:e.message,on:false});}}
start.onclick=()=>update(true);stop.onclick=()=>update(false);
async function refresh(){if(busy)return;try{const r=await fetch('/api/virtual-camera');if(!r.ok)throw new Error();render(await r.json());}catch{status.textContent='🟠 אין חיבור למנוע המצלמה';start.disabled=stop.disabled=true;}}
refresh();setInterval(refresh,2000);
