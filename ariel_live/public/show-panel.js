const labels={stage_not_available:'הפעל את נגן צ׳ינו לפני המופע',show_recording_missing:'התגובה הקולית המוכנה אינה זמינה',show_already_playing:'המופע כבר מתנגן — אפשר לעצור ולבחור אחר',show_input_busy:'צ׳ינו מקשיב או שיש קטע אחר — המתן רגע'};
let card,state,controls,playing=false,pending=false,last=null;
async function api(route,data){const r=await fetch('/api/show'+route,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const s=await r.json();if(!r.ok)throw new Error(s.error||'show_unavailable');return s;}
function status(text){state.textContent=text;}
function render(s){
 last=s;playing=!!s.active;controls.replaceChildren();
 for(const moment of s.moments){const b=document.createElement('button');b.className='ghost';b.textContent=({opening:'👑 ',double:'⚡ ',triple:'🔥 ',glove:'🥊 '})[moment.id]+moment.title;b.dataset.show=moment.id;b.title=moment.description+' · בקול: '+moment.recordedText;b.disabled=pending||playing||!moment.ready||!s.outputReady;b.onclick=()=>start(moment.id);controls.append(b);}
 card.querySelector('#chinoShowStop').disabled=!playing&&!s.musicPreview;
 if(!pending)status(s.active?'עכשיו: '+s.moments.find(m=>m.id===s.active.kind)?.title+(s.lastRendered?.id===s.active.id?' · נגן המצלמה מציג את המופע':' · נשלח לנגן'):s.musicPreview?'צ׳ינו רוקד · הדגמה של 12 שניות':!s.outputReady?'המופעים מוכנים. הפעל את נגן צ׳ינו.':'מוכן בלחיצה · התגובות הקוליות מהספרייה הקיימת');
}
async function start(id){if(pending)return;pending=true;if(last)render(last);status('מפעיל מופע…');try{await api('/start',{id});pending=false;await refresh();}catch(e){pending=false;status(labels[e.message]||'המופע לא התחיל. בדוק את החיבור לנגן.');if(last){const message=state.textContent;render(last);status(message);}}}
async function refresh(){if(!card||pending)return;try{render(await api(''));}catch{status('אין חיבור למנוע המופעים');controls.querySelectorAll('button').forEach(b=>b.disabled=true);}}
function mount(){
 const target=document.getElementById('quickClips');if(!target||card?.isConnected)return;
 card=document.createElement('section');card.id='chinoShowPanel';card.style.cssText='margin-top:15px;padding-top:13px;border-top:1px solid var(--line)';
 card.innerHTML='<div class="quick-heading"><h3>המופע של צ׳ינו</h3><span class="small">קול · אור · תנועה</span></div><div id="chinoShowControls" class="quick-grid"></div><p id="chinoShowState" class="small" role="status"></p><div class="row"><button id="chinoShowDance" class="ghost">♫ הדגם ריקוד</button><button id="chinoShowStop" class="ghost">עצור מופע</button></div>';
 target.after(card);state=card.querySelector('#chinoShowState');controls=card.querySelector('#chinoShowControls');
 card.querySelector('#chinoShowStop').onclick=async()=>{await api('/stop',{}).catch(()=>{});await refresh();};
 card.querySelector('#chinoShowDance').onclick=async()=>{try{const s=await(await fetch('/api/music-motion')).json(),song=s.songs.find(x=>x.id===document.getElementById('quickSong')?.value)||s.songs[0];if(!song)throw new Error();const r=await fetch('/api/music-motion/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:song.id})});if(!r.ok)throw new Error();status('ריקוד ותאורת קצב · '+song.name+' · הדגמה של 12 שניות');}catch{status('לא נמצא קליפ ריקוד זמין להדגמה');}};
 refresh();
}
const observer=new MutationObserver(mount);if(document.body?.nodeType===1)observer.observe(document.body,{childList:true,subtree:true});mount();setInterval(refresh,1000);
