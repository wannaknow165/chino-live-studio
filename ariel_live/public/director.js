const $=id=>document.getElementById(id);
async function api(url,body){const r=await fetch(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(!r.ok||j.error)throw new Error(j.error||'request_failed');return j;}
const tab=document.createElement('button');tab.dataset.t='director';tab.textContent='🧠 תגובות חכמות';$('tabs').prepend(tab);
const panel=document.createElement('section');panel.id='tab-director';panel.className='tab';
panel.innerHTML=`<div class="cols"><div>
<div class="card"><h2>🧠 הבמאי של צ׳ינו</h2><p class="small">בוחר תגובת וידאו מהספרייה לפי ההקשר. כשחסר מענה — אתה מתערב. האפקטים בשליטתך.</p>
<div class="row"><button id="vdRehearse">חזרה בלי ניגון</button><button id="vdAuto">הפעל אוטומטי</button><button id="vdStop" class="ghost">עצור ועבור לידני</button></div>
<p id="vdStatus" role="status">טוען…</p><p id="vdConnection" class="small"></p><p id="vdCounts" class="small"></p>
<p class="small">כדי לפנות לצ׳ינו: קראו לו בשם. בצ׳אט מתחילים ב״צ׳ינו״ או ״צינו״. אחרי הקריאה בשם ואחרי כל תשובה: שתי דקות מלאות להמשך השיחה — בלי לקרוא שוב בשם. משפט שהתחיל בזמן לא נקטע.</p><p id="vdDialogue" role="status"></p><p id="vdQueue" class="small"></p><button id="vdEndConversation" class="ghost">סיים דו־שיח ופנה לתור</button>
<div class="row"><a href="/stage?live=1" target="_blank" style="color:var(--gold)">פתח את נגן צ׳ינו</a><button id="vdRefresh" class="ghost">רענן ספרייה</button></div>
<details id="vdKeyBox"><summary>חיבור OpenAI לתהליך הנוכחי</summary><div class="row"><input id="vdKey" type="password" autocomplete="off" placeholder="מפתח קיים — בזיכרון בלבד"><button id="vdKeySave">חבר</button></div></details></div>
<div class="card" style="margin-top:14px"><h2>נסה שיחה בעברית או באנגלית</h2><div class="row"><select id="vdRole" aria-label="מקור ההודעה"><option value="opponent">היריב מדבר</option><option value="chat">הודעה בצ׳אט</option><option value="gift">מתנה התקבלה</option></select><input type="text" id="vdName" placeholder="שם המשתתף" aria-label="שם המשתתף"><input type="text" id="vdUid" placeholder="מזהה קבוע לזיכרון" aria-label="מזהה המשתתף"></div>
<div class="row"><input type="text" id="vdText" style="flex:1" placeholder="צינו, מה שלומך?" aria-label="הודעת בדיקה"><button id="vdSend">שלח לבדיקה</button></div>
<div class="row"><button id="vdMic" class="ghost">🎙️ התחל שיחה עם צ׳ינו</button><select id="vdLang" aria-label="שפת המיקרופון"><option value="he-IL">עברית</option><option value="en-US">English</option></select><label class="small"><input id="vdSpeaking" type="checkbox">היריב עדיין מדבר — המתן</label></div>
<p id="vdDecision" style="white-space:pre-wrap;line-height:1.7">החלטת המערכת תופיע כאן.</p><p id="vdError" role="alert" style="color:#ffb393"></p></div>
<div class="card" style="margin-top:14px"><h2>חיבור לקהל וליריב</h2><div class="row"><input type="text" id="vdRoom" placeholder="חשבון TikTok של הלייב שלך" style="flex:1"><button id="vdConnect">חבר צ׳אט</button><button id="vdDisconnect" class="ghost">נתק</button></div>
<p class="small">לשמע היריב: בחר מקור בלשונית ״היריב״. תמלול החלון מקומי; זיהוי הדובר אינו אוטומטי. כפתור המיקרופון משתמש בזיהוי הדיבור של הדפדפן, אם זמין.</p><label class="small"><input id="vdIsolated" type="checkbox">וידאתי שמקור השמע מכיל רק את היריב, בלי האריה והמוזיקה</label></div>
<div class="card" style="margin-top:14px"><h2>ספריית הווידאו הקיימת</h2><p class="small">אפשר לאפשר בחירה אוטומטית אחרי צפייה ובחירת סוג האירוע. שם מוקלט אינו משתנה לפי הצופה.</p><div id="vdLibrary" style="max-height:520px;overflow:auto"></div></div></div>
<div><div class="card"><h2>שאלות ותשובות של צ׳ינו <span id="vdPending"></span></h2><p class="small">כל כרטיס מציג שאלה ואת התשובה המוצעת. אפשר לערוך ולשייך וידאו. טקסט ללא וידאו לא מושמע בלייב.</p><a href="/api/director/export" target="_blank" style="color:var(--gold)">פתח טקסטים להפקת וידאו</a><div id="vdInbox" style="max-height:850px;overflow:auto;margin-top:12px"></div></div>
<div class="card" style="margin-top:14px"><h2>ניגון שאושר מהנגן</h2><div id="vdHistory" class="small"></div></div></div></div>`;
document.body.insertBefore(panel,document.querySelector('script'));
function activate(){document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('act',b===tab));document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('act',t===panel));localStorage.setItem('deskTab','director');}
tab.onclick=activate;activate();
const previewCard=elPreview();function elPreview(){const c=document.createElement('div');c.className='card';c.style.marginBottom='14px';c.innerHTML='<h2>צ׳ינו — תצוגה שקטה</h2><div class="preview"><iframe src="/stage?preview=1" title="תצוגת צ׳ינו" allow="autoplay"></iframe></div>';panel.querySelector('.cols').lastElementChild.prepend(c);return c;}
const captureRow=document.createElement('div');captureRow.className='row';captureRow.innerHTML='<button id="vdCapture" class="ghost">🔊 חבר שמע של היריב</button><span id="vdAudioStatus" class="small">לא מאזין</span>';$('vdIsolated').parentElement.after(captureRow);
captureRow.previousElementSibling.previousElementSibling.textContent='בחר חלון או לשונית עם השמע של היריב בלבד. כש-OpenAI מחובר, קטעי הדיבור נשלחים אליו לתמלול. הדובר נקבע לפי מקור השמע שנבחר.';
const sayRow=document.createElement('div');sayRow.className='row';sayRow.innerHTML='<input type="text" id="vdSay" style="flex:1" placeholder="התערבות: כתוב בדיוק מה שיאמר"><button id="vdSayGo" class="ghost">אמור בדיוק</button>';$('vdDecision').after(sayRow);
const practiceCard=document.createElement('div');practiceCard.className='card';practiceCard.style.marginTop='14px';practiceCard.innerHTML='<h2>תרגול התשובות של צ׳ינו</h2><p class="small">32 שאלות ומצבי לייב בעברית. התשובות יופיעו ברשימת העריכה בלי לנגן. השם של הדמות: צ׳ינו.</p><button id="vdPractice">הרץ 32 שאלות בעברית</button><p id="vdPracticeStatus" class="small"></p><details><summary>הסגנון של צ׳ינו</summary><textarea id="vdStyle" aria-label="סגנון הדיבור של צ׳ינו" style="width:100%;min-height:100px;margin-top:12px"></textarea><button id="vdStyleSave" class="ghost">שמור סגנון</button></details>';
panel.querySelector('.cols').firstElementChild.children[0].after(practiceCard);
const reasons={wake_phrase_missing:'חסר הקליפ שאומר ״דבר״ כאשר קוראים לצ׳ינו',production_individual_approval_required:'מאשרים כל תשובה בנפרד',production_quote_changed:'המחיר השתנה — בדוק שוב לפני אישור',production_quote_expired:'הצעת המחיר פגה, יש לבדוק מחדש',production_already_submitted:'הקליפ כבר נשלח; לא שולחים שוב כדי למנוע חיוב כפול',indexed_semantic_answer:'תשובה מתאימה מהאינדקס — ללא המתנה למודל',production_approval_required:'נדרש אישור לייצור',production_already_running:'הייצור כבר פועל',production_nothing_within_limit:'אין חוסרים חדשים במסגרת שנבחרה',generation_engine_busy:'מנוע הווידאו עסוק; נמתין לפני פתיחת סדרה',generation_key_missing:'המפתח של מנוע הווידאו אינו מחובר',generation_provider_failed:'ספק הווידאו החזיר שגיאה; הייצור נעצר',generated_words_review_required:'המילים בווידאו דורשות בדיקה',generated_quality_review_required:'הקליפ לא עבר בדיקת איכות',openai_unavailable_operator_required:'אין חיבור פעיל ל-OpenAI — נדרשת התערבות',operator_busy:'מנהל הלייב מטפל בהודעה הקודמת',invalid_operator_message:'כתוב הודעה קצרה ובחר פעולה',operator_sensitive_message:'מפתחות גישה אינם נשמרים בשיחה הזאת',operator_draft_video_missing:'הטקסט מוכן, חסר וידאו',uncertain_or_invalid_clip:'אין התאמה בטוחה לקליפ',curated_greeting_offline:'ברכה מוכנה מהספרייה',operator_approved_exact_case:'מקרה שכבר תיקנת ואישרת',playback_not_confirmed:'הנגן לא אישר ניגון; האוטומציה נעצרה',stage_not_available:'פתח את נגן צ׳ינו והפעל בו סאונד',duplicate:'הודעה כפולה סוננה',spam:'הודעה סוננה',rate_limited:'יותר מדי הודעות מאותו משתתף',openai_authentication_failed:'המפתח לא אושר על ידי OpenAI',openai_budget_unavailable:'אין מכסת API זמינה'};
reasons.reviewed_draft_video_missing='נוסח שעבר עריכה — מוכן לשינויים שלך; עדיין בלי וידאו';const reason=x=>reasons[x]||x||'';
Object.assign(reasons,{invalid_operator_lines:'עד 20 שורות בכל שליחה, עד 32 מילים ו־350 תווים בשורה',live_not_active:'הפעל מצב לייב לפני שליחת שורות',operator_live_line:'משפט שכתבת בלייב',existing_answer_cooldown:'קיימת תשובה מתאימה — נותן מרווח כדי לא לחזור על אותו משפט',semantic_production_already_pending:'תשובה לאותה כוונה כבר בהכנה — אין ייצור נוסף',generation_bank_changed:'הספרייה השתנתה — GPT בודק שוב לפני הפקה'});
reasons.name_call_acknowledgment='קראו לי בשם — תגובת וידאו מוכנה';
Object.assign(reasons,{decision_wrong_person:'התשובה התייחסה לשם של הדמות במקום לשם המשתתף',report_wait_until_live_ends:'הניתוח המסכם זמין אחרי סיום מצב לייב',no_session_data:'עדיין אין שיחות לניתוח',own_audio_echo:'השמע החוזר של צ׳ינו סונן',evaluation_in_progress:'בדיקת התשובות עדיין פועלת',evaluation_requires_idle:'אפשר לבדוק תשובות כשהלייב והנגן פנויים'});
Object.assign(reasons,{decision_invalid_clip:'GPT בחר הקלטה לא תקינה — נדרש בירור',decision_clip_changed:'ההקלטה השתנתה בזמן הבדיקה',decision_question_not_answer:'GPT הציע שאלה במקום תשובה — נדרש בירור',decision_empty_draft:'GPT לא החזיר תשובה מלאה',gpt_bank_review_required:'ממתין לבדיקה נוספת של GPT מול המאגר',budget_limit:'מסגרת הבדיקות של GPT נוצלה'});
reasons.semantic_existing_answer='המשמעות זוהתה — נמצאה תשובה מוכנה מתאימה';
reasons.indexed_missing_answer='המשמעות כבר מוכרת — התשובה ממתינה לאישור הפקה';
Object.assign(reasons,{chat_name_required:'לפתיחת שיחה בצ׳אט: צינו או צ׳ינו. מי שבפוקוס ממשיך חופשי לשתי דקות',chat_conversation_followup:'המשך השיחה עם אותו משתתף בצ׳אט',waiting_for_name:'מקשיב בלבד: קרא לו ״צ׳ינו״ כדי לפתוח שיחה',chat_name_prefix:'פנייה לצ׳ינו בתחילת הודעת צ׳אט',spoken_name:'קראו לצ׳ינו בשמו',conversation_followup:'המשך הדו־שיח הפעיל',conversation_queue_full:'התור מלא — הפנייה נשמרה להתערבות'});
reasons.stable_participant_id_required_for_learning='כדי לזכור התאמה למשתתף מסוים צריך מזהה קבוע. אפשר לנגן בלי לסמן זכירה.';
const guard=fn=>async()=>{$('vdError').textContent='';try{await fn();}catch(e){$('vdError').textContent=reason(e.message);}};
Object.assign(reasons,{microphone_practice:'שיחה ישירה דרך כפתור המיקרופון',understanding_event_changed:'התקבלה שאלה חדשה — בדוק את הפירוש שלה לפני התיקון',understanding_required:'כתוב למה התכוונת',stale_audio:'המשפט הוחלף בדיבור חדש; ממתין לסיום הדיבור',no_clear_speech:'לא זוהה דיבור ברור',input_held_during_output:'צ׳ינו מדבר; המיקרופון חוזר בסיום',local_rate_limit:'ממתין למכסת הפענוח — נסה שוב בעוד רגע'});
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
const button=(text,fn)=>{const b=el('button',text,'ghost');b.onclick=guard(fn);return b;};
let meaningEventId='';
const meaningRow=el('details');meaningRow.innerHTML='<summary>לא לזה התכוונתי — תקן את הפירוש</summary><p class="small">התיקון נשמר עבור הניסוח והמשתתף הזה. הוא משנה את ההבנה; ייצור וידאו עדיין דורש אישור נפרד.</p><div class="row"><input id="vdMeaning" type="text" aria-label="המשמעות שהתכוונתי אליה" placeholder="למשל: מה שלומך?" style="flex:1"><button id="vdMeaningSave" class="ghost">שמור פירוש ונסה שוב</button></div>';
$('vdDecision').after(meaningRow);
$('vdMeaningSave').onclick=guard(async()=>{const r=await api('/api/director/understanding',{eventId:meaningEventId,canonicalQuestion:$('vdMeaning').value});$('vdError').textContent=r.queued?'הפירוש נשמר — מחפש תשובה שוב':'הפירוש נשמר. הפעל אוטומטי או חזרה כדי לנסות שוב.';});
let library=[],inboxSignature='',status;const draftEdits=new Map();const filter=document.createElement('select');filter.id='vdInboxFilter';filter.setAttribute('aria-label','הצג בקשות');filter.innerHTML='<option value="all">כל החוסרים</option><option value="live">פניות מהלייב</option><option value="practice">תרגול בעברית</option>';$('vdInbox').before(filter);filter.onchange=()=>{inboxSignature='';loadInbox();};
async function loadLibrary(){library=await api('/api/director/library');const out=$('vdLibrary');out.replaceChildren();for(const c of library){const row=el('div',null,'card');row.style.marginTop='8px';row.append(el('div',c.text));const controls=el('div',null,'row'),check=el('input');check.type='checkbox';check.checked=c.auto;check.disabled=!c.ready;const label=el('label',null,'small');label.append(check,document.createTextNode(' בחירה אוטומטית'));const roles=el('select');roles.setAttribute('aria-label','למי מתאים הקליפ');for(const[v,t]of[['audience,chat,opponent','כולם'],['chat,opponent','קהל ויריב'],['chat','קהל'],['opponent','יריב'],['gift','מתנה'],['audience','פנייה לקהל']]){const o=el('option',t);o.value=v;roles.append(o);}roles.value=c.roles.join(',');const save=guard(()=>api('/api/director/clip',{id:c.id,auto:check.checked,roles:roles.value.split(',')}));check.onchange=save;roles.onchange=save;const preview=button('צפה בקליפ',()=>{const v=el('video');v.src=c.file;v.controls=true;v.playsInline=true;v.style.cssText='width:100%;max-height:300px';row.append(v);preview.disabled=true;});controls.append(label,roles,preview);row.append(controls,el('div',c.ready?'וידאו קיים · '+c.language:'קובץ חסר','small'));out.append(row);}}
async function loadInbox(){
 const rows=(await api('/api/director/inbox')).filter(x=>x.state==='pending'&&!x.productionExcluded&&(filter.value==='all'||(filter.value==='practice'?!!x.practice:!x.practice))).sort((a,b)=>(b.updated||b.created)-(a.updated||a.created));
 const sig=JSON.stringify([rows,library.map(c=>[c.id,c.text,c.ready])]);if(sig===inboxSignature||$('vdInbox').contains(document.activeElement))return;
 inboxSignature=sig;$('vdPending').textContent=rows.length?'('+rows.length+')':'';
 const out=$('vdInbox');out.replaceChildren();if(!rows.length)out.append(el('p','אין בקשות שממתינות לך.','small'));
 for(const row of rows){
  const card=el('div',null,'card');card.style.marginBottom='10px';
  card.append(el('strong',(row.event.type==='opponent'?'מול היריב':'מול הקהל')+' · '+(row.event.name?row.event.name+': ':'')+row.event.text),el('p',reason(row.reason),'small'));
  if(row.variants?.length>1)card.append(el('p','ניסוחים נוספים: '+row.variants.join(' · '),'small'));
  if(row.practice&&row.practice.action!=='answer'){card.append(el('p',row.practice.action==='listen'?'מצב הקשבה — אין צורך בקליפ':'מצב סינון — אין צורך בקליפ'));out.append(card);continue;}
  const draft=el('textarea');draft.value=draftEdits.has(row.id)?draftEdits.get(row.id):row.draft;draft.oninput=()=>draftEdits.set(row.id,draft.value);
  draft.placeholder='כתוב תשובה להפקת וידאו';draft.setAttribute('aria-label','ניסוח תגובה חסרה');draft.style.cssText='width:100%;min-height:70px;background:#100d09;color:#f3e7d3;padding:10px';card.append(draft);
  const select=el('select');select.style.maxWidth='100%';select.setAttribute('aria-label','בחר קליפ להתערבות');select.append(el('option','בחר תגובת וידאו…'));select.firstChild.value='';
  for(const c of library.filter(c=>c.ready)){const o=el('option',c.text);o.value=c.id;select.append(o);}card.append(select);
  const learn=el('input');learn.type='checkbox';learn.checked=!!row.event.uid;const label=el('label',null,'small');label.append(learn,document.createTextNode(' זכור התאמה למקרה ולמשתתף הזה'));card.append(el('br'),label);
  const act=async action=>{await api('/api/director/resolve',{id:row.id,action,clipId:select.value,draft:draft.value,learn:learn.checked,reusable:true});draftEdits.delete(row.id);document.activeElement?.blur();inboxSignature='';await refresh();};
  const buttons=el('div',null,'row');buttons.append(button('נגן עכשיו',()=>act('play')),button('שמור התאמה',()=>act('bind')),button('שמור טקסט להפקה',()=>act('draft')),button('דלג',()=>act('dismiss')));
  const price=status?.production?.price;
  if(price)card.append(el('p',`הפקת וידאו: $${price.perSecondUSD} לשנייה, עד $${price.maxVideoUSD} לווידאו ב־720p. ניסיון אחד בלבד; בדיקות מחויבות בנפרד. מסגרת משוערת כולל מרווח לבדיקות: $${price.reservationUSD}.`,'small'));
  const generate=button('אשר את הנוסח והמחיר — צור קליפ אחד',async()=>{
   generate.disabled=true;
   try{
    const q=await api('/api/director/production/quote',{id:row.id,text:draft.value});
    if(!price||q.price.reservationUSD!==price.reservationUSD||q.price.maxAttempts!==1)throw new Error('production_quote_changed');
    await api('/api/director/production/approve',{quoteId:q.id,approved:true});
    draftEdits.delete(row.id);document.activeElement?.blur();inboxSignature='';await refresh();
   }finally{generate.disabled=false;}
  });
  generate.disabled=!!status?.production?.running;buttons.append(generate);card.append(buttons);out.append(card);
 }
}
async function refresh(){
 status=await api('/api/director/status');updateInteractionQueue();if($('vdError').textContent==='אין חיבור לשרת')$('vdError').textContent='';
 if(status.live?.inputMode==='live'&&capture?.microphone)await stopCapture();
 if(capture&&!capture.microphone&&!status.live?.active&&!startingLive)await stopCapture();
 renderLive(status);
 if(status.index&&status.index.documents!==library.length)await loadLibrary();
 $('vdPractice').disabled=!!status.practice?.running;
 $('vdPracticeStatus').textContent=status.practice?.error?reason(status.practice.error):status.practice?.running?'מכין תשובות לתרגול…':status.practice?.completed?'הוכנו '+status.practice.completed+' מצבים לעריכה':'';
 if(!$('vdStyle').value)$('vdStyle').value=status.persona?.style||'';
 $('vdStatus').textContent=({manual:'ידני',rehearsal:'חזרה — מחליט בלי לנגן',auto:'אוטומטי'}[status.mode])+(status.active?' · '+(status.target==='opponent'?'עונה ליריב: ':'מדבר לקהל: ')+status.active.text:status.busy?' · בוחר תשובה…':' · ממתין');
 $('vdConnection').textContent='תמלול: '+(status.transcription?.selectedEngine==='openai'?'OpenAI':'מקומי')+' | OpenAI: '+(status.provider.blocked?reason(status.provider.blocked):status.provider.configured?'מפתח מחובר — GPT בודק כל מענה':'לא מחובר; המענה האוטומטי ממתין')+' | נגן עם סאונד: '+(status.stage.ready?'מחובר':'לא מוכן')+' | צ׳אט: '+(status.context.audienceConnection.on?status.context.audienceConnection.status:'מנותק');
 renderProduction(status.production);
 $('vdIndexStatus').textContent=status.index?`${status.index.documents} קליפים באינדקס · ${status.index.searchable??0} זמינים לחיפוש · ${status.index.interpretations??0} פירושים זכורים · ${status.index.matches} התאמות שמורות. השאלות, הפירושים והתשובות נשמרים בדיסק.`:'';
 $('vdCounts').textContent=`בספרייה ${library.length} קליפים · בתור ${status.queue} · נוגנו ${status.counts.played} · סוננו ${status.counts.filtered} · תיקונים ${status.lessons}`;
 const c=status.conversation||{};
 const stateText={responding:'מכין תשובה',speaking:'עונה ליריב',waiting:'מחכה להמשך השיחה',listening:'מקשיב להמשך',transcribing:'קולט את התשובה',needs_video:'ממתין לווידאו מתאים — עדיין לא דיבר'};
 $('vdDialogue').textContent=c.active?'🟢 '+(stateText[c.state]||'בשיחה')+(c.name?' עם '+c.name:'')+(c.secondsLeft!=null?' · '+c.secondsLeft+' שניות':''):'🔴 כדי לפתוח דו־שיח קראו לי צ׳ינו';
 $('vdQueue').textContent=(status.waiting?.length?'בתור: '+status.waiting.map((e,i)=>(i+1)+'. '+(e.name||(e.type==='opponent'?'היריב':'צופה'))).join(' · '):'התור פנוי')+(status.lastRouting?' | '+reason(status.lastRouting.reason):'');
 $('vdKeyBox').hidden=status.provider.configured&&!status.provider.blocked;
 $('vdSpeaking').checked=status.opponentSpeaking;
 const d=status.lastDecision;
 if(d){
  const understood=d.understanding?.canonicalQuestion;
  $('vdDecision').textContent=`שמעתי: ${d.event.rawText||d.event.text}\nהבנתי: ${understood||'הפירוש אינו זמין'}${d.understanding&&d.understanding.confidence<.92?' — צריך הבהרה':''}\n${d.action==='play'?'מצאתי וידאו מתאים במאגר':d.action==='draft'?'לא נמצא וידאו מתאים — הצעה לאישור':d.action==='error'?'תקלה בפענוח — לא בקשה לייצור וידאו':'ממשיך להקשיב'}${d.rehearsal?' (חזרה בלבד)':''}\n${d.text||''}\n${reason(d.reason)} · ${d.event.searchedClips??0} מועמדים נבדקו · ${d.decisionMs}ms`;
  if(meaningEventId!==d.event.id){meaningEventId=d.event.id;$('vdMeaning').value=understood||'';}
 }
 await loadInbox();
 renderQuick(status);
 const h=await api('/api/director/history');
 $('vdHistory').replaceChildren(...h.filter(x=>x.direction==='out').slice(-8).reverse().map(x=>el('p',new Date(x.t).toLocaleTimeString('he-IL')+' · '+x.text)));
}
for(const[id,mode]of[['vdRehearse','rehearsal'],['vdAuto','auto'],['vdStop','manual']])$(id).onclick=guard(async()=>{await api('/api/director/mode',{mode});await refresh();});
$('vdSend').onclick=guard(async()=>{const text=$('vdText').value.trim();if(!text)return;const r=await api('/api/director/event',{type:$('vdRole').value,text,name:$('vdName').value,uid:$('vdUid').value});$('vdError').textContent=r.accepted?(r.mode==='manual'?'נשמר. הפעל חזרה או אוטומטי לבחירת תשובה.':'ההודעה בתור'):reason(r.reason);await refresh();});
$('vdText').onkeydown=e=>{if(e.key==='Enter')$('vdSend').click();};
$('vdSpeaking').onchange=guard(()=>api('/api/director/activity',{active:$('vdSpeaking').checked}));
$('vdRefresh').onclick=guard(async()=>{await loadLibrary();inboxSignature='';await refresh();});
$('vdKeySave').onclick=guard(async()=>{const key=$('vdKey').value;$('vdKey').value='';await api('/api/director/credential',{key});await refresh();});
$('vdConnect').onclick=guard(async()=>{await api('/api/tiktok/connect',{user:$('vdRoom').value});await refresh();});
$('vdDisconnect').onclick=guard(async()=>{await api('/api/tiktok/disconnect',{});await refresh();});
$('vdSayGo').onclick=guard(async()=>{const r=await api('/api/operator/say',{text:$('vdSay').value});$('vdError').textContent=r.ready?'הקליפ נשלח לנגן':'הטקסט נשמר — חסר לו וידאו';await refresh();});
$('vdPractice').onclick=guard(async()=>{await api('/api/director/practice',{});await refresh();});
$('vdStyleSave').onclick=guard(async()=>{await api('/api/director/persona',{style:$('vdStyle').value});$('vdError').textContent='הסגנון נשמר';});
const micControls=document.createElement('div');micControls.className='row';micControls.innerHTML='<label class="small">מיקרופון <select id="vdMicDevice" aria-label="בחר מיקרופון"><option value="">ברירת המחדל</option></select></label><meter id="vdMicLevel" min="0" max="0.1" value="0" aria-label="עוצמת המיקרופון" style="width:140px"></meter><span id="vdMicSignal" class="small">עדיין לא הופעל</span>';$('vdMic').parentElement.after(micControls);const micBanner=el('p','המיקרופון כבוי. לחץ על ״התחל שיחה עם צ׳ינו״ ודבר — התשובה תישלח אוטומטית בסיום המשפט.');micBanner.id='vdMicBanner';micBanner.setAttribute('role','status');micBanner.style.cssText='font-size:18px;font-weight:700;padding:14px;border-radius:10px;background:#0c1219;color:#dcb97f';micControls.after(micBanner);const voiceCard=el('div',null,'card');voiceCard.style.marginBottom='14px';const voiceRow=el('div',null,'row');$('vdMic').style.cssText='width:100%;min-height:56px;font-size:20px;background:#79e0b8;color:#10241c';voiceRow.append($('vdMic'),$('vdLang'));voiceCard.append(el('h2','דבר עם צ׳ינו'),voiceRow,micControls,micBanner,$('vdAudioStatus'));panel.querySelector('.cols').firstElementChild.prepend(voiceCard);
const savedMic=localStorage.getItem('chinoMicrophone');if(savedMic){const saved=el('option',localStorage.getItem('chinoMicrophoneLabel')||'המיקרופון שנבחר');saved.value=savedMic;$('vdMicDevice').append(saved);$('vdMicDevice').value=savedMic;}
voiceCard.append(el('h3','מה צ׳ינו הבין ומה הוא עונה'),$('vdDecision'),meaningRow);
$('vdDecision').setAttribute('aria-live','polite');
voiceCard.append(el('p','בתרגול עם הכפתור אפשר לדבר ישירות. בלייב: קוראים ״צ׳ינו״ פעם אחת וממשיכים בשיחה במשך שתי דקות.','small'));
$('vdMicDevice').onchange=guard(async()=>{if(capture?.microphone)await stopCapture();await startCapture(true);});

$('vdEndConversation').onclick=guard(async()=>{await api('/api/director/conversation/end',{});await refresh();});
let capture=null,outputActive=false;
const speechEvents=new EventSource('/api/events');speechEvents.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='director')outputActive=!!m.active;};
async function stopCapture(){
 const c=capture;capture=null;
 if(c){c.cancelled=true;clearInterval(c.timer);try{c.rec.stop();}catch{}c.stream.getTracks().forEach(t=>t.stop());await c.activity.catch(()=>{});await c.ctx.close();}
 await api('/api/director/activity',{active:false,source:c?.microphone?'microphone':'isolated_audio'}).catch(()=>{});
 if(c&&!c.microphone)await api('/api/director/live/audio',{connected:false}).catch(()=>{});
 if(c?.microphone){await api('/api/director/conversation/end',{});await api('/api/director/mode',{mode:'manual'});}
 $('vdCapture').textContent='🔊 חבר שמע של היריב';$('vdMic').textContent='🎙️ התחל שיחה עם צ׳ינו';$('vdMic').disabled=false;$('vdAudioStatus').textContent='לא מאזין';
 $('vdMicBanner').textContent='המיקרופון כבוי. לחץ על ״התחל שיחה עם צ׳ינו״ ודבר — בסיום המשפט אענה אוטומטית.';$('vdMicLevel').value=0;$('vdMicSignal').textContent='כבוי';
}
async function startCapture(microphone,providedStream){
 if(capture){const wasMic=capture.microphone;await stopCapture();if(wasMic===microphone)return;}
 if(microphone)await api('/api/director/input/practice',{});
 $('vdAudioStatus').textContent='מבקש גישה לשמע…';$('vdMicBanner').textContent='מתחבר למיקרופון — עוד לא לדבר…';
 const deviceId=$('vdMicDevice').value;
 const stream=microphone?await navigator.mediaDevices.getUserMedia({audio:{...(deviceId?{deviceId:{exact:deviceId}}:{}),echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false}):providedStream;
 if(!stream)throw new Error('בחר את מצב הלייב כדי לחבר את LIVE Studio.');
 if(!stream.getAudioTracks().length){stream.getTracks().forEach(t=>t.stop());throw new Error('לא נבחר שמע. בחר לשונית או חלון עם שיתוף סאונד.');}
 const surface=stream.getVideoTracks()[0]?.getSettings().displaySurface;
 if(!microphone&&!['window','browser'].includes(surface)){stream.getTracks().forEach(t=>t.stop());throw new Error('יש לבחור חלון LIVE Studio או לשונית יריב בלבד. שמע כל המחשב לא מתקבל.');}
 if(microphone){
  const selected=stream.getAudioTracks()[0].getSettings().deviceId;
  const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput');
  $('vdMicDevice').replaceChildren(...devices.map(d=>{const o=el('option',d.label||'מיקרופון');o.value=d.deviceId;return o;}));
  if(devices.some(d=>d.deviceId===selected))$('vdMicDevice').value=selected;
  localStorage.setItem('chinoMicrophone',selected||'');localStorage.setItem('chinoMicrophoneLabel',stream.getAudioTracks()[0].label);
 }
 const ctx=new AudioContext();await ctx.resume();const analyser=ctx.createAnalyser();analyser.fftSize=1024;
 const source=ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));source.connect(analyser);
 const mime=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':'audio/webm';
 const rec=new MediaRecorder(new MediaStream(stream.getAudioTracks()),{mimeType:mime}),samples=new Float32Array(1024);
 let chunks=[],hadSpeech=false,lastVoice=0,recordAt=Date.now(),speaking=false,asrBusy=false,hadOwnAudio=false;
 let audioQueue=Promise.resolve(),pendingAudio=0;
 const c=capture={stream,ctx,source,rec,microphone,activity:Promise.resolve(),timer:null,cancelled:false};
 try{
  const who=status?.context?.opponent;
  if(microphone&&who?.handle!==($('vdUid').value||'local-microphone'))await api('/api/opponent',{name:$('vdName').value||'אתה',handle:$('vdUid').value||'local-microphone'});
  if(!microphone){
   await api('/api/opponent',{name:'המתמודד ב־LIVE Studio',handle:'live-opponent'});
   await api('/api/director/live/start',{room:$('vdRoom').value||status?.room,surface,audio:true,label:stream.getAudioTracks()[0].label});
   if(!status?.context?.audienceConnection?.on)await api('/api/tiktok/connect',{user:$('vdRoom').value||status?.room});
  }
  if(microphone)await api('/api/director/mode',{mode:'auto'});
 }catch(e){await stopCapture();throw e;}
 rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
 rec.onstop=async()=>{
  const blob=new Blob(chunks,{type:'audio/webm'}),send=hadSpeech&&!hadOwnAudio;chunks=[];hadSpeech=false;hadOwnAudio=false;recordAt=Date.now();
  if(c.cancelled||capture!==c)return;rec.start();if(!send||blob.size<1200)return;
  if(pendingAudio>=3){$('vdAudioStatus').textContent='הפענוח בפיגור — המתן לתשובה ואז חזור על המשפט האחרון';return;}
  pendingAudio++;
  const sendAudio=async()=>{
  if(c.cancelled||capture!==c){pendingAudio--;return;}
  asrBusy=true;$('vdAudioStatus').textContent='קלטתי — מתמלל את הדיבור…';
  try{
   await c.activity;
   const b64=await new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(String(fr.result).split(',')[1]);fr.onerror=reject;fr.readAsDataURL(blob);});
   if(c.cancelled||capture!==c)return;
   const r=await api('/api/director/audio',{b64,isolatedOpponent:!microphone,source:microphone?'microphone':'isolated_audio',language:$('vdLang').value.split('-')[0]});
   $('vdAudioStatus').textContent=r.text?'נשמע: '+r.text+' · '+(r.accepted?'בתור לתגובה':reason(r.reason)):reason(r.reason);
   if(r.text)$('vdText').value=r.text;
  }catch(e){$('vdAudioStatus').textContent=reason(e.message);}finally{pendingAudio--;asrBusy=pendingAudio>0;}
  };
  audioQueue=audioQueue.then(sendAudio,sendAudio);
 };
 rec.start();stream.getTracks().forEach(track=>track.onended=()=>stopCapture());
 c.timer=setInterval(()=>{
  if(capture!==c)return;if(ctx.state==='suspended')ctx.resume().catch(()=>{});analyser.getFloatTimeDomainData(samples);const rms=Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/samples.length);
  const held=microphone&&outputActive;
  if(microphone){$('vdMicLevel').value=rms;$('vdMicSignal').textContent=(rms>0.008?'קול נכנס':'ממתין לקול')+' · '+Math.round(rms*1000)/10+'%';$('vdMicBanner').textContent=held?'🦁 צ׳ינו מדבר — המיקרופון יחזור להקשיב בסיום התגובה.':asrBusy?'קלטתי אותך — מפענח את המשפט…':'🟢 עכשיו דבר לצ׳ינו. בסיום המשפט הוא יענה אוטומטית. אין צורך ללחוץ על שלח.';}
  if(held){hadOwnAudio=true;lastVoice=0;}else if(rms>0.008){lastVoice=Date.now();hadSpeech=true;}
  const activeNow=!held&&Date.now()-lastVoice<(microphone?1100:650);
  if(!microphone&&Date.now()-(c.lastHeartbeat||0)>1800){c.lastHeartbeat=Date.now();api('/api/director/live/audio',{connected:true,level:rms}).catch(()=>{});}
  if(activeNow!==speaking){speaking=activeNow;const next=activeNow;c.activity=c.activity.catch(()=>{}).then(()=>api('/api/director/activity',{active:next,source:microphone?'microphone':'isolated_audio'}));}
  // Quiet buffers are recycled, but a person speaking isn't cut off by a timer.
  if(rec.state==='recording'&&((hadSpeech&&!activeNow)||(!hadSpeech&&Date.now()-recordAt>8000)||(!held&&hadOwnAudio)))rec.stop();
 },100);
 $('vdCapture').textContent=microphone?'🔊 חבר שמע של היריב':'נתק שמע יריב';
 $('vdMic').textContent=microphone?'⏹ עצור שיחה':'🎙️ התחל שיחה עם צ׳ינו';
 $('vdAudioStatus').textContent=microphone?'המיקרופון פעיל — השיחה נשלחת אוטומטית בסיום כל משפט':'מקשיב למקור שנבחר';
 $('vdMicBanner').textContent=microphone?'🟢 עכשיו דבר לצ׳ינו. הוא יענה אוטומטית כשתסיים את המשפט.':'מאזין לשמע היריב';
}
let startingMicrophone=false;
$('vdCapture').onclick=()=>$('vdLiveStart').click();
$('vdMic').onclick=guard(async()=>{if(startingMicrophone)return;startingMicrophone=true;try{await startCapture(true);}finally{startingMicrophone=false;}});
window.addEventListener('pagehide',()=>{if(capture){capture.stream.getTracks().forEach(t=>t.stop());navigator.sendBeacon('/api/director/activity',new Blob([JSON.stringify({active:false})],{type:'application/json'}));}});
const productionCard=el('div',null,'card');productionCard.style.marginTop='14px';
productionCard.innerHTML='<h2>מאגר תשובות · אישור רק כשחסר</h2><p id="vdIndexStatus" class="small"></p><p id="vdProductionStatus" role="status"></p><p id="vdProductionCost" class="small"></p><button id="vdProduceStop" class="ghost">עצור ייצור</button><p class="small">קליפ מתאים קיים → תשובה אוטומטית. חסר קליפ → הנוסח והמחיר מוצגים ליד השאלה. רק האישור שלך שולח ניסיון הפקה אחד. התשובה נשמרת לפעם הבאה.</p><details><summary>מצב הקליפים שהופקו</summary><div id="vdProductionJobs"></div></details>';
voiceCard.after(productionCard);
let productionSignature='';
function renderProduction(p){if(!p)return;
 $('vdProduceStop').disabled=!p.running&&!p.autoSession?.enabled&&!p.autoQueue;
 const ready=p.jobs.filter(j=>j.state==='ready').length,failed=p.jobs.filter(j=>['failed','uncertain'].includes(j.state)).length;
 $('vdProductionStatus').textContent=(p.running?'מייצר ובודק קליפ…':p.autoSession?.error?'הייצור האוטומטי נעצר: '+reason(p.autoSession.error):p.autoSession?.enabled?'ייצור אוטומטי לחוסרים חדשים בלייב בלבד':p.batch?.state==='completed'?'הקליפ הושלם':'ייצור אוטומטי ממתין להפעלת מצב לייב')+` · ${ready} הושלמו · ${failed} דורשים טיפול`;
 $('vdProductionCost').textContent=`וידאו: $${p.price.perSecondUSD} לשנייה, עד $${p.price.maxVideoUSD} לניסיון יחיד ב־720p. בדיקות בנפרד. אין ייצור גורף ואין ניסיונות חוזרים אוטומטיים.`;
 if(p.autoSession)$('vdProductionCost').textContent=`מסגרת השידור: $${p.autoSession.limitUSD} · נשמרו להפקות $${p.autoSession.reservedUSD.toFixed(2)} · יתרה במסגרת $${(p.autoSession.limitUSD-p.autoSession.reservedUSD).toFixed(2)}. זו מסגרת שמורה, לא חשבונית. כיבוי והפעלה אינם מאפסים אותה.`;
 const sig=JSON.stringify(p);if(sig===productionSignature)return;productionSignature=sig;
 const out=$('vdProductionJobs');out.replaceChildren();for(const item of p.plan.items){const j=p.jobs.findLast(x=>x.text===item.text);out.append(el('p',item.text+' — '+(j?({queued:'בתור',submitting:'נשלח',generating:'בהפקה',verifying:'בודק דיבור',ready:'מוכן ונשמר',failed:'נעצר: '+reason(j.error),uncertain:'נדרש בירור; לא שולחים שוב כדי למנוע חיוב כפול'}[j.state]||j.state):item.clipId?'וידאו קיים':'חסר וידאו'),'small'));}
}
$('vdProduceStop').onclick=guard(async()=>{await api('/api/director/production/stop',{});await refresh();});
const liveCard=el('div',null,'card');liveCard.style.cssText='margin-bottom:14px;border:1px solid #d7a85e';
liveCard.innerHTML='<h2>צ׳ינו בלייב · היריב והצ׳אט</h2><div class="row"><button id="vdLiveStart" style="min-height:60px;flex:1;font-size:20px">🔴 מצב לייב — יריב וצ׳אט</button><button id="vdLiveStop" class="ghost">עצור לייב</button></div><p id="vdLiveStatus" role="status">שמע היריב עוד לא מחובר.</p><p class="small">בחרו את חלון TikTok LIVE Studio וסמנו שיתוף שמע של החלון. המיקרופון האישי כבוי במצב לייב. Spotify באפליקציה נפרדת אינו מקור ההאזנה. מוזיקה מתוך חלון היריב עצמו עשויה להיקלט.</p><p id="vdLiveChat" class="small"></p><button id="vdExplain" class="ghost">📣 הסבר איך לדבר עם צ׳ינו</button><p id="vdExplainStatus" role="status" class="small"></p><details><summary>מה צ׳ינו יגיד?</summary><p id="vdExplainText" class="small"></p></details>';
panel.querySelector('.cols').firstElementChild.prepend(liveCard);
const practiceToggle=el('details');practiceToggle.append(el('summary','תרגול אישי עם מיקרופון'));voiceCard.before(practiceToggle);practiceToggle.append(voiceCard);
productionCard.querySelector('h2').textContent='מאגר תשובות · ייצור אוטומטי בלייב';
productionCard.querySelector('details').previousElementSibling.textContent='קליפ מתאים במאגר מושמע מיד. חוסר חדש בלייב נשמר ומופק אוטומטית במסגרת שאושרה. תקלה עוצרת את הייצור; שאלות ישנות מהתרגול לא מופקות אוטומטית.';
function renderLive(s){
 if(!$('vdLiveStart'))return;
 const l=s.live||{},p=s.production;
 const liveOn=l.active&&l.audioConnected&&s.mode==='auto';
 if(!$('vdRoom').value)$('vdRoom').value=s.room||s.context?.audienceConnection?.room||'';
 $('vdLiveStart').disabled=!!l.audioConnected;$('vdLiveStop').disabled=!l.active;
 $('vdLiveStart').textContent=liveOn?'🟢 מצב לייב פעיל':l.active?'🟠 חבר מחדש את שמע הלייב':'🔴 מצב לייב — יריב וצ׳אט';
 $('vdLiveStart').style.background=liveOn?'#69e0ad':'var(--gold)';$('vdLiveStart').style.opacity='1';
 $('vdLiveStart').setAttribute('aria-pressed',String(liveOn));
 $('vdLiveStatus').textContent=l.active?(l.audioConnected?'🟢 מקור שמע מחובר: '+l.audioSource+' · ממתין לדיבור ולשם צ׳ינו':'🟠 מצב לייב פעיל, אבל שמע היריב מנותק — הצ׳אט ממשיך בנפרד'):'⚪ הלייב האוטומטי כבוי · לחץ על מצב לייב לחיבור LIVE Studio';
 if(startingLive)$('vdLiveStatus').textContent='בחרו בחלון השיתוף את TikTok LIVE Studio, הפעילו Also share app audio ולחצו Share.';
 const chat=s.context?.audienceConnection||{},chatConnected=chat.connected&&chat.on&&/^מחובר ✓/.test(chat.status||'');
 $('vdLiveChat').textContent=(chatConnected?'🟢 צ׳אט מחובר':'🟠 צ׳אט ממתין לחיבור לשידור')+' · @'+(s.room||'לא נבחר')+' · '+(chat.status||'מנותק');
 $('vdExplainText').textContent=l.explanationText||'';
 const job=p?.jobs?.findLast(j=>j.text===l.explanationText);
 $('vdExplainStatus').textContent=l.explanationReady?'ההקלטה מוכנה. לחיצה תשמיע אותה בנגן צ׳ינו.':job?'הקלטת ההסבר: '+({ready:'מוכנה',failed:'נעצרה — '+reason(job.error),uncertain:'נדרש בירור — לא מייצר שוב',generating:'מייצר וידאו…',submitting:'נשלחת להפקה…',verifying:'בודק את המילים והאיכות…',queued:'בתור להפקה'}[job.state]||job.state):'ההקלטה עדיין אינה מוכנה. לחיצה תכין אותה במסגרת $15 שאושרה.';
 $('vdExplain').disabled=!!job&&['queued','submitting','generating','verifying'].includes(job.state);
 const chatExplanation=l.explanations?.find(x=>x.id==='chat'),chatJob=p?.jobs?.findLast(j=>j.text===chatExplanation?.text);
 if($('vdExplainChat')){
  $('vdExplainChat').disabled=!!chatJob&&['queued','submitting','generating','verifying'].includes(chatJob.state);
  $('vdExplainChatStatus').textContent=chatExplanation?.ready?'ההסבר לצ׳אט מוכן לניגון.':chatJob?(['failed','uncertain'].includes(chatJob.state)?'ההסבר לצ׳אט נעצר: '+reason(chatJob.error):'מכין ובודק את ההסבר לצ׳אט…'):'ההסבר לצ׳אט עדיין לא הופק.';
 }
}
let startingLive=false;
liveCard.append($('vdError'));
$('vdExplain').textContent='📣 הסבר לשיחה בקול';
const chatExplain=el('button','💬 הסבר לצ׳אט','ghost');chatExplain.id='vdExplainChat';
const chatExplainStatus=el('p','','small');chatExplainStatus.id='vdExplainChatStatus';chatExplainStatus.setAttribute('role','status');
$('vdExplainStatus').after(chatExplain,chatExplainStatus);
chatExplain.onclick=guard(async()=>{const r=await api('/api/director/explanation',{kind:'chat'});if(r.reason)$('vdError').textContent=reason(r.reason);await refresh();});
$('vdLiveStart').onclick=guard(async()=>{
 if(startingLive)return;startingLive=true;let stream;
 try{
  const pending=navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'window'},audio:{echoCancellation:false,noiseSuppression:false},monitorTypeSurfaces:'exclude',systemAudio:'exclude',windowAudio:'window',selfBrowserSurface:'exclude',surfaceSwitching:'exclude'});
  pending.catch(()=>{});await stopCapture();stream=await pending;
  await startCapture(false,stream);await refresh();
 }catch(e){stream?.getTracks().forEach(t=>t.stop());throw e;}finally{startingLive=false;}
});
$('vdLiveStop').onclick=guard(async()=>{await stopCapture();await api('/api/director/live/stop',{});await refresh();});
$('vdExplain').onclick=guard(async()=>{const r=await api('/api/director/explanation',{});if(r.reason)$('vdError').textContent=reason(r.reason);await refresh();});
Object.assign(reasons,{generation_http_402:'ספק הווידאו דורש תשלום או הסדרת חיוב (402); הקליפים הקיימים זמינים',explanation_recording_missing:'הנוסח נשמר; הקלטת ההסבר עדיין לא הופקה',microphone_disabled_in_live:'המיקרופון האישי כבוי במצב לייב',live_audio_not_connected:'שמע היריב עדיין אינו מחובר',live_budget_approval_required:'לא הוגדרה מסגרת ההפקה לשידור',live_budget_exhausted:'מסגרת $15 לשידור נוצלה; החוסר נשמר',live_production_needs_review:'הייצור נעצר עקב תקלה; התשובות הקיימות נשארו זמינות',generation_auth_failed:'ספק הווידאו לא אישר את הגישה',generation_rate_or_quota:'ספק הווידאו חסם בגלל מכסה או קצב בקשות',production_already_submitted:'הבקשה כבר נשמרה; לא נשלחת הפקה נוספת'});
loadLibrary().then(refresh).catch(e=>{$('vdError').textContent=reason(e.message);});let refreshing=false;setInterval(async()=>{if(refreshing||!panel.classList.contains('act'))return;refreshing=true;try{await refresh();}catch{quickOffline();$('vdError').textContent='אין חיבור לשרת';$('vdLiveStart').textContent='🟠 אין חיבור למנוע';$('vdLiveStart').style.background='var(--gold)';$('vdLiveStart').setAttribute('aria-pressed','false');}finally{refreshing=false;}},1800);


// Compact operator surface reuses the existing controls and event handlers.
let quickSignature='',quickBusy=false,quickMusic=null,quickMusicBusy=false,quickDraftSource='';
function quickOffline(){if(!$('quickState'))return;$('quickState').textContent='אין חיבור למנוע';$('quickState').dataset.on='false';document.querySelectorAll('[data-quick-clip]').forEach(b=>b.disabled=true);}
async function quickPlay(id){
 if(quickBusy)return;quickBusy=true;
 try{const rows=await api('/api/director/library'),clip=rows.find(c=>c.id===id&&c.ready);if(!clip)throw new Error('הקליפ אינו זמין');
  const s=await api('/api/director/status');if(!s.stage?.ready)throw new Error('פתח את נגן צ׳ינו או הפעל את המצלמה');
  await api('/api/operator/say',{text:clip.text});await refresh();
 }finally{quickBusy=false;}
}
function renderQuick(s){
 if(!$('quickState'))return;
 const live=s.live?.active&&s.live?.audioConnected&&s.mode==='auto';
 $('quickState').textContent=live?'● מאזין ללייב':s.live?.active?'● שמע היריב מנותק':'● ההאזנה ללייב כבויה';$('quickState').dataset.on=String(!!live);
 const chat=s.context?.audienceConnection||{},chatReady=chat.connected&&chat.on&&/^מחובר ✓/.test(chat.status||'');
 $('vdLiveChat').textContent=(chatReady?'צ׳אט מחובר':'צ׳אט: ממתין לחיבור לשידור')+(s.room?' · @'+s.room:'');
 $('quickNow').textContent=s.active?'אומר: '+s.active.text:s.busy?'GPT מבין את הפנייה ובודק תשובות במאגר…':s.conversation?.active?'ממתין להמשך השיחה':'מוכן לתגובה בלחיצה';
 $('quickHeard').textContent=s.lastDecision?'שמעתי: '+(s.lastDecision.event.rawText||s.lastDecision.event.text):s.audienceMode==='solo'?'מצב לבד עם הקהל: צ׳ינו בודק הודעות גם בלי שיקראו בשמו.':'לפתיחת שיחה: צ׳ינו או צינו. אחרי תשובה, אותו משתתף יכול להמשיך שתי דקות בלי השם.';
 const d=s.lastDecision,r=d?.bankReview,p=s.provider,budget=p?.budget;
 $('quickAI').textContent=!p?.configured||p.blocked?'GPT לא זמין — המענה האוטומטי ממתין':budget&&budget.reservedUSD+.05>budget.limitUSD?'מסגרת GPT נוצלה — המענה האוטומטי ממתין':d?.action==='error'?'GPT: '+reason(d.reason):r?'GPT בדק '+r.candidateCount+' תשובות · '+(d.action==='play'?'נמצאה תשובה מוכנה':d.action==='draft'?'לא נמצאה התאמה גם בבדיקה נוספת':d.reason==='existing_answer_cooldown'?'תשובה קיימת — נותן מרווח בשיחה':'ממשיך להקשיב')+(d.rehearsal?' · חזרה בלבד':''):'GPT מחובר · כל מענה עובר בדיקה · בדיקה נוספת לפני וידאו חדש';
 const health=s.readiness?.checks||{};
 if($('quickHealth'))$('quickHealth').replaceChildren(...Object.entries({gpt:'GPT',output:'נגן',audio:'שמע היריב',chat:'צ׳אט'}).map(([id,label])=>{const c=health[id]||{},item=el('span',(c.ready?'🟢 ':'🟠 ')+label+(id==='audio'&&c.ready?(c.signalSeen?' · קול נכנס':' · ממתין לקול'):id==='chat'&&c.eventCount?' · '+c.eventCount+' אירועים':''),'pill');item.title=id==='gpt'?(c.verifiedAt?'אומת מול OpenAI ב־'+new Date(c.verifiedAt).toLocaleTimeString('he-IL'):'מפתח מוגדר; טרם אומת בבקשה בפועל'):id==='audio'?'החיבור נבדק בנפרד מעוצמת הקול והתמלול':id==='chat'?'מצב החיבור בפועל ומספר האירועים שהתקבלו':'';return item;}));
 if(live&&!s.readiness?.ready){$('quickState').textContent='● מצב לייב חלקי — בדוק חיבורים';$('quickState').dataset.on='false';}
 renderOperatorState(s);
 $('quickCount').textContent=library.filter(c=>c.ready).length+' תגובות מוכנות';
 const sig=JSON.stringify(library.map(c=>[c.id,c.ready,c.text]));
 if(sig!==quickSignature){quickSignature=sig;renderQuickClips();}
 document.querySelectorAll('[data-quick-clip]').forEach(b=>b.disabled=!s.stage?.ready||quickBusy);
 $('quickStop').disabled=!s.active&&!s.conversation?.active;
 $('quickMissing').textContent='חוסרים שממתינים לך '+($('vdPending').textContent||'');
}
function clipButton(c,label){const b=button(label||c.text,()=>quickPlay(c.id));b.dataset.quickClip=c.id;b.title=c.text;return b;}
function renderQuickClips(){
 const ready=library.filter(c=>c.ready),out=$('quickClips');if(!out)return;
 out.replaceChildren();
 for(const [id,label]of[['7902c31ae1','👋 היי, מה קורה?'],['reuse-288185a729dc','😊 וואלה פצצה'],['reuse-142a64471ef9','⚔️ יאללה משחק'],['d2f6bb618b','🎁 תודה על המתנה'],['chino-c78287d4-7340-4d2c-b325-159bc5b3cafd-edited-performance','💋 נשיקות לקהל'],['chino-1b610728-0693-4d0e-a5cc-53e20a00ee59','📣 הסבר לשיחה'],['chino-ba28ca84-ef7d-4243-9fb4-b8f7f59e9aa3','💬 הסבר לצ׳אט']]){const c=ready.find(c=>c.id===id);if(c)out.append(clipButton(c,label));}
 const q=$('quickSearch').value.trim().toLocaleLowerCase(),rows=ready.filter(c=>c.text.toLocaleLowerCase().includes(q));
 $('quickAll').replaceChildren(...rows.map(c=>clipButton(c)));
 if(!rows.length)$('quickAll').append(el('p','אין תגובה מוכנה שמתאימה לחיפוש.','small'));
}
async function updateQuickMusic(){
 if(!$('quickMusicToggle')||quickMusicBusy)return;
 try{quickMusic=await api('/api/music-motion');renderQuickMusic();}catch{$('quickMusicStatus').textContent='אין חיבור לתנועות השירים';$('quickMusicToggle').disabled=true;}
}
function renderQuickMusic(){
 const m=quickMusic;if(!m)return;$('quickMusicToggle').disabled=false;
 $('quickMusicToggle').textContent=m.enabled?'♫ ריקוד אוטומטי: פעיל':'♫ ריקוד אוטומטי: מושהה';$('quickMusicToggle').setAttribute('aria-pressed',String(m.enabled));
 $('quickMusicStatus').textContent=m.preview?'דוגמת תנועה שקטה · 12 שניות · תשובה מקבלת עדיפות':!m.connected?'ממתין לחיבור לנגן השירים הקודם':m.ready?'זוהה: '+m.song.name+' · '+(m.phase==='chorus'?'תנועות פזמון':'תנועות קצב'):m.enabled?(m.playing?'זוהה: '+m.title+' · עדיין אין תנועה לשיר הזה':'ממתין לשיר ב־Spotify · הריקוד יתחיל אוטומטית'):m.songs.length+' שירים מוכנים · הריקוד הושהה ידנית';
 const select=$('quickSong');if(select.options.length!==m.songs.length){select.replaceChildren(...m.songs.map(s=>{const o=el('option',s.name);o.value=s.id;return o;}));}
 $('quickDancePreview').disabled=!m.songs.length;
}
async function loadReferencePhrases(){
 try{const data=await api('/media/reference-library/previous-phrases.json');
  $('quickReferenceCount').textContent=data.items.length+' נוסחים מהפרויקט הקודם';
  $('quickReferences').replaceChildren(...data.items.map(item=>{const b=button(item.emoji+' '+item.label,async()=>{quickDraftSource=item.id;$('quickDraft').value=item.label;$('quickDraftBox').hidden=false;$('quickDraftState').textContent='נוסח לעריכה; עדיין אין לו וידאו.';$('quickDraft').focus();});b.dir=item.category==='english'?'ltr':'rtl';return b;}));
 }catch{$('quickReferences').textContent='לא ניתן לטעון את הנוסחים.';}
}
let interactionQueueBusy=false,interactionQueueClearing=false;
async function updateInteractionQueue(){
 const b=$('quickClearEffects'),info=$('quickEffectsStatus');if(!b||interactionQueueBusy)return;
 interactionQueueBusy=true;
 try{const s=await api('/api/interactions?summary=1'),n=Math.max(0,s.pending-s.playing);b.disabled=interactionQueueClearing||n===0;b.textContent='נקה תור אפקטים'+(n?' ('+n+')':'');if(!interactionQueueClearing)info.textContent=n?n+' שליחות ממתינות':s.playing?'האפקט הנוכחי מסיים · התור ריק':'תור האפקטים ריק';}
 catch{b.disabled=true;info.textContent='לא ניתן לקרוא את תור האפקטים';}finally{interactionQueueBusy=false;}
}
let operatorSending=false,operatorLogSignature='';
function renderOperatorMessages(messages){const sig=JSON.stringify(messages);if(sig===operatorLogSignature)return;operatorLogSignature=sig;const out=$('operatorMessages');if(!out)return;out.replaceChildren(...messages.map(m=>{const box=el('p',(m.role==='user'?'אתה: ':'מנהל הלייב: ')+m.text);box.style.cssText='white-space:pre-wrap;padding:10px;border-radius:10px;background:'+(m.role==='user'?'#302617':'#1d231d');return box;}));if(!messages.length)out.append(el('p','אני כאן לעזור לך לנהל את צ׳ינו. אפשר לשאול למה הוא ענה כך, לתת משפט חדש או ללמד העדפה. כשצריך אותך תופיע נקודה אדומה.','small'));out.scrollTop=out.scrollHeight;}
function renderOperatorState(s){if(!$('operatorBudget'))return;const b=s.production?.sessionBudget;$('operatorBudget').textContent=b?'מסגרת $'+b.limitUSD+' · נשמרו $'+b.totalReservedUSD.toFixed(2)+' לווידאו ולבדיקות · נותרו $'+b.remainingUSD.toFixed(2):'ממתין למסגרת השידור';const rows=s.operatorHelp||[],select=$('operatorGap'),selected=select.value;select.replaceChildren(...rows.map(r=>{const o=el('option',r.question);o.value=r.id;return o;}));if(rows.some(r=>r.id===selected))select.value=selected;select.hidden=!rows.length;const err=s.production?.autoSession?.error;const job=s.production?.jobs?.findLast(j=>['submitting','generating','verifying'].includes(j.state));const overdue=!!job&&Date.now()-job.created>=300000;const disconnected=!!s.live?.active&&!s.readiness?.ready;const needsHelp=!!err||overdue||rows.length>0||disconnected;const dot=$('operatorHelpDot');if(dot){dot.textContent=needsHelp?'🔴 צריך אותך':s.live?.active?'🟢 צ׳ינו מטפל':'⚪ מוכן להפעלה';dot.style.background=needsHelp?'#7d2020':s.live?.active?'#163c2a':'#333';dot.setAttribute('aria-label',needsHelp?'צ׳ינו צריך עזרה':s.live?.active?'צ׳ינו פועל אוטומטית':'צ׳ינו ממתין להפעלה');}if(overdue){$('operatorHelp').textContent='🔴 עברו חמש דקות מתחילת הייצור — צריך לבדוק. לא נשלח ניסיון נוסף בתשלום.';return;}if(disconnected&&!err&&!rows.length){$('operatorHelp').textContent='🔴 צריך להשלים את חיבור שמע היריב או הצ׳אט';return;}$('operatorHelp').textContent=err?'צריך עזרה: '+reason(err):s.production?.running?'מייצר ובודק תשובה חדשה…':rows.length?'יש '+rows.length+' פניות שבהן אפשר לעזור לצ׳ינו':'אין כרגע בקשה לעזרה';}
async function sendOperator(){if(operatorSending)return;const text=$('operatorInput').value.trim();if(!text)return;operatorSending=true;$('operatorSend').disabled=true;$('operatorStatus').textContent='מנהל הלייב בודק…';try{const r=await api('/api/director/operator',{id:crypto.randomUUID(),text,mode:$('operatorMode').value,rowId:$('operatorGap').value});renderOperatorMessages(r.messages);$('operatorInput').value='';$('operatorStatus').textContent='נשמר';await refresh();}catch(e){$('operatorStatus').textContent=reason(e.message);}finally{operatorSending=false;$('operatorSend').disabled=false;}}
function mountQuickPanel(){
 if($('quickDesk'))return;
 const cameraCard=$('cameraStart')?.closest('.card'),performanceCard=$('chinoKiss')?.closest('.card');
 const quick=el('main');quick.id='quickDesk';
 previewCard.id='quickPreview';previewCard.querySelector('h2').textContent='צ׳ינו · תצוגה שקטה';
 const controls=el('section',null,'card');controls.id='quickControls';controls.setAttribute('aria-label','שליטה מהירה בלייב');
 controls.innerHTML=`<div class="quick-heading"><h2>שליטה בלייב</h2><span id="quickState" class="pill" role="status">בודק חיבור…</span></div><div id="quickLiveActions" class="quick-actions"></div><p id="quickNow" role="status"></p><p id="quickHeard" class="small"></p><p id="quickAI" class="small" role="status"></p><div class="quick-heading"><h3>תגיד עכשיו</h3><span id="quickCount" class="small"></span></div><div id="quickClips" class="quick-grid"></div><div class="quick-heading music-line"><button id="quickMusicToggle" class="ghost" aria-pressed="false">♫ בודק זיהוי שיר…</button><span id="quickMusicStatus" class="small" role="status"></span></div><details id="quickMore"><summary>עוד תגובות ושירים</summary><label class="small" for="quickSearch">חפש תגובה מוכנה</label><input id="quickSearch" placeholder="שלום, תודה, משחק…" type="search"><div id="quickAll" class="quick-library"></div><h3>תנועות מהשירים הקודמים</h3><div class="row"><select id="quickSong" aria-label="שיר לתצוגת תנועה"></select><button id="quickDancePreview" class="ghost">הדגם תנועה · 12 שניות</button><button id="quickDanceStop" class="ghost">עצור ריקוד</button></div><p class="small">התנועות נשמרו מהפרויקט הקודם. ברגע ששיר מוכר מתנגן ב־Spotify, הריקוד מתחיל אוטומטית. ההדגמה היא לבדיקה בלבד. המעבר לפזמון משתמש בתזמונים שנשמרו, ואינו סנכרון שפתיים למילות השיר.</p><details><summary id="quickReferenceCount">נוסחים מהפרויקט הקודם</summary><p class="small">טקסטים לעריכה. שמירת נוסח אינה מפיקה וידאו ואינה מחייבת.</p><div id="quickDraftBox" hidden><textarea id="quickDraft" aria-label="ערוך נוסח מהפרויקט הקודם" maxlength="350"></textarea><button id="quickDraftSave" class="ghost">שמור נוסח לרשימת האישור</button><p id="quickDraftState" class="small" role="status"></p></div><div id="quickReferences" class="quick-library"></div></details></details><div class="quick-footer"><button id="quickMissing" class="ghost">חוסרים שממתינים לך</button><a href="/stage?live=1" target="_blank">פתח נגן</a></div>`;
 const advanced=el('details');advanced.id='quickAdvanced';advanced.append(el('summary','הגדרות, מצלמה, ספרייה ותרגול'));panel.before(quick);quick.append(previewCard,controls,advanced);
 advanced.append(panel);if(cameraCard)advanced.append(cameraCard);if(performanceCard)advanced.append(performanceCard);
 $('quickLiveActions').append($('vdLiveStart'),$('vdLiveStop'));
 const stop=button('⏹ עצור תגובה',async()=>{await api('/api/show/stop',{});await api('/api/director/conversation/end',{});await refresh();});stop.id='quickStop';$('quickLiveActions').append(stop);
 const clearEffects=button('נקה תור אפקטים',async()=>{if(interactionQueueClearing)return;interactionQueueClearing=true;clearEffects.disabled=true;try{const r=await api('/api/interactions/clear',{});$('quickEffectsStatus').textContent='בוטלו '+r.cleared+' שליחות ממתינות · הסרטונים נשמרו';}catch{$('quickEffectsStatus').textContent='ניקוי התור נכשל — נסה שוב';}finally{interactionQueueClearing=false;await updateInteractionQueue();}});clearEffects.id='quickClearEffects';clearEffects.classList.add('ghost');clearEffects.disabled=true;$('quickLiveActions').append(clearEffects);
 const effectStatus=el('p','בודק תור אפקטים…','small');effectStatus.id='quickEffectsStatus';effectStatus.setAttribute('role','status');$('quickLiveActions').after(effectStatus);updateInteractionQueue();
 $('quickLiveActions').after($('vdLiveStatus'),$('vdLiveChat'));
 const linesBox=el('div');linesBox.innerHTML='<h3>משפטים שלך לייצור בלייב</h3><p class="small">משפט בכל שורה. Enter שולח את השורה לייצור אוטומטי במסגרת תקציב הלייב. אפשר להדביק כמה שורות יחד. עד 32 מילים למשפט. הקליפים נשמרים בספרייה.</p><textarea id="quickLiveLines" aria-label="משפטים לייצור אוטומטי בלייב" placeholder="כתוב משפט ולחץ Enter…" style="width:100%;min-height:90px"></textarea><button id="quickLiveLinesSend" class="ghost">שלח את השורות לייצור</button><p id="quickLiveLinesStatus" class="small" role="status"></p>';
 $('quickClips').before(linesBox);
 const operator=el('section');operator.id='operatorDesk';operator.innerHTML='<h2>הצ׳אט שלך עם מנהל הלייב</h2><p class="small">השיחה כאן פרטית. צ׳ינו ממשיך לנהל את הלייב בזמן שאתה שואל, מתקן ומוסיף משפטים.</p><p id="operatorBudget" class="small"></p><p id="operatorHelp" role="status"></p><div id="operatorMessages" role="log" aria-live="polite" style="max-height:280px;overflow:auto"></div><label class="small" for="operatorMode">מה לעשות עם ההודעה?</label><select id="operatorMode" aria-label="פעולת מנהל הלייב"><option value="chat">לדבר עם מנהל הלייב</option><option value="say">להוסיף משפט לצ׳ינו</option><option value="teach">ללמד העדפת סגנון</option><option value="answer">לעזור בתשובה שחסרה</option></select><select id="operatorGap" aria-label="פנייה שדורשת עזרה" hidden></select><textarea id="operatorInput" aria-label="הודעה למנהל הלייב" maxlength="1800" placeholder="כתוב לי כאן…" style="width:100%;min-height:85px;margin-top:8px"></textarea><button id="operatorSend">שלח</button><span id="operatorStatus" class="small" role="status"></span><p class="small">Enter לשליחה · Shift+Enter לשורה חדשה. משפטים לצ׳ינו נשמרים בספרייה אחרי יצירה ובדיקה.</p>';
 $('quickAI').after(operator);const helpDot=el('button','🟢 צ׳ינו מטפל','ghost');helpDot.id='operatorHelpDot';helpDot.style.cssText='border-radius:20px;background:#163c2a';$('quickState').after(helpDot);helpDot.onclick=()=>{$('operatorMode').value=$('operatorGap').options.length?'answer':'chat';$('operatorInput').focus();};$('operatorSend').onclick=sendOperator;$('operatorInput').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();sendOperator();}};api('/api/director/operator').then(r=>renderOperatorMessages(r.messages)).catch(()=>$('operatorStatus').textContent='לא ניתן לטעון את השיחה');

 let sendingLines=false;
 const sendLines=async(all=false)=>{
   if(sendingLines)return;
   const input=$('quickLiveLines'),value=input.value,cut=all?value.length:value.lastIndexOf('\n')+1;
   if(!cut||!value.slice(0,cut).trim())return;
   if(!status?.live?.active){$('quickLiveLinesStatus').textContent='הפעל מצב לייב כדי לשלוח שורות לייצור';return;}
   const lines=value.slice(0,cut).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
   sendingLines=true;$('quickLiveLinesSend').disabled=true;
   try{
     const r=await api('/api/director/live/lines',{lines});
     if(input.value.startsWith(value.slice(0,cut)))input.value=input.value.slice(cut);
     $('quickLiveLinesStatus').textContent=r.results.map(x=>x.text+' — '+(x.cached?'כבר קיים בספרייה':x.queued?'נכנס לתור הייצור':reason(x.reason)||'נשמר לבדיקה')).join('\n');
     $('quickLiveLinesStatus').style.whiteSpace='pre-line';
   }catch(e){$('quickLiveLinesStatus').textContent=reason(e.message);}
   finally{sendingLines=false;$('quickLiveLinesSend').disabled=false;}
   // Text entered during the request is processed in the same order.
   if(input.value.includes('\n')&&input.value!==value)sendLines();
 };
 $('quickLiveLines').addEventListener('input',()=>sendLines());
 $('quickLiveLinesSend').onclick=()=>sendLines(true);

 const health=el('div',null,'row');health.id='quickHealth';health.setAttribute('aria-label','מצב חיבורי הלייב');$('vdLiveChat').after(health);
 const intelligence=el('details');intelligence.id='quickIntelligence';
 intelligence.innerHTML='<summary>זיכרון ושיפור מהשיחות</summary><p id="quickLearningStatus" class="small" role="status"></p><div class="row"><button id="quickAnalyze" class="ghost">נתח והצע שיפורים</button><button id="quickMemoryReload" class="ghost">רענן זיכרון</button></div><div id="quickReport" class="small"></div><h3>זיכרון משתתפים</h3><select id="quickPerson" aria-label="משתתף לזיכרון"></select><p id="quickPersonSummary" class="small"></p><label for="quickMemoryNote" class="small">הערה או תיקון שלך למשתתף הזה</label><textarea id="quickMemoryNote" maxlength="1000" style="width:100%;min-height:70px"></textarea><button id="quickMemorySave" class="ghost">שמור תיקון בזיכרון</button><p class="small">הסיכום הוא פרשנות של GPT. עובדות נשמרות עם ציטוט מהדובר; הניקוד והמצב בקרב אינם עובדות קבועות.</p>';
 $('quickMore').after(intelligence);
 const audition=el('details');audition.id='quickVoiceExperiment';
 audition.innerHTML='<summary>ניסוי קול חדש — האזנה בלבד</summary><p class="small">דגימות מקומיות על בסיס קול האריה המאושר. הניסוי אינו מופעל בלייב. העברית נוצרה בכ־15.4 שניות והאנגלית בכ־9.9 שניות; עדיין לא תגובה מיידית. סנכרון שפתיים חזותי ואיכות הקול דורשים בדיקה.</p><p>עברית</p><audio controls preload="none" src="/media/speech/lion-clone-audition-he.wav"></audio><p>English</p><audio controls preload="none" src="/media/speech/lion-clone-audition-en.wav"></audio>';
 intelligence.after(audition);
 intelligence.ontoggle=()=>{if(intelligence.open)loadIntelligence().catch(e=>$('quickLearningStatus').textContent=reason(e.message));};
 $('quickAnalyze').onclick=guard(async()=>{const b=$('quickAnalyze');b.disabled=true;$('quickLearningStatus').textContent='GPT מנתח את החוסרים ומכין הצעות…';try{await api('/api/director/report',{});await loadIntelligence();}finally{b.disabled=false;}});
 $('quickMemoryReload').onclick=guard(loadIntelligence);
 $('quickPerson').onchange=renderPerson;
 $('quickMemorySave').onclick=guard(async()=>{await api('/api/director/memory',{key:$('quickPerson').value,note:$('quickMemoryNote').value});$('quickLearningStatus').textContent='התיקון נשמר וישמש בשיחות הבאות עם המשתתף.';await loadIntelligence();});
 $('quickHeard').after($('vdError'));
 if($('cameraStatus'))$('quickPreview').append($('cameraStatus'));
 $('quickSearch').oninput=()=>{renderQuickClips();if(status)renderQuick(status);};
 $('quickMissing').onclick=()=>{advanced.open=true;$('vdInbox').scrollIntoView({behavior:'smooth',block:'start'});};
 $('quickMusicToggle').onclick=guard(async()=>{if(quickMusicBusy)return;quickMusicBusy=true;try{quickMusic=await api('/api/music-motion',{on:!quickMusic?.enabled});renderQuickMusic();}finally{quickMusicBusy=false;}});
 $('quickDancePreview').onclick=guard(async()=>{quickMusic=await api('/api/music-motion/preview',{id:$('quickSong').value});renderQuickMusic();});
 $('quickDanceStop').onclick=guard(async()=>{quickMusic=await api('/api/music-motion',{on:false});renderQuickMusic();});
 $('quickDraftSave').onclick=guard(async()=>{const b=$('quickDraftSave');b.disabled=true;try{await api('/api/reference-phrases/draft',{sourceId:quickDraftSource,text:$('quickDraft').value});$('quickDraftState').textContent='נשמר ברשימת החוסרים. ייצור דורש אישור נפרד של הנוסח והמחיר.';inboxSignature='';await refresh();}finally{b.disabled=false;}});
 const extras=el('details');extras.id='quickExtras';extras.append(el('summary','תגובות ידניות, שירים ואפשרויות נוספות'));$('quickClips').before(extras);extras.append($('quickClips'),linesBox,$('quickMusicToggle').closest('.music-line'),$('quickMore'),intelligence,audition,$('quickClearEffects'),$('quickEffectsStatus'));$('quickCount').closest('.quick-heading').style.display='none';
 loadReferencePhrases();updateQuickMusic();setInterval(updateQuickMusic,2000);if(status)renderQuick(status);
}
let memoryPeople=[];
function renderPerson(){const p=memoryPeople.find(p=>p.key===$('quickPerson').value);$('quickPersonSummary').textContent=p?(p.summary||'המשתתף זוהה; טרם נשמר סיכום שיחה.'):'אין עדיין משתתפים שמורים בחדר הזה.';$('quickMemoryNote').value=p?.operatorNote||'';$('quickMemorySave').disabled=!p;}
async function loadIntelligence(){
 const [people,report]=await Promise.all([api('/api/director/memory'),api('/api/director/report')]);memoryPeople=people;
 const selected=$('quickPerson').value;$('quickPerson').replaceChildren(...people.map(p=>{const o=el('option',(p.name||p.uid)+' · '+(p.role==='opponent'?'יריב':'צופה'));o.value=p.key;return o;}));if(people.some(p=>p.key===selected))$('quickPerson').value=selected;renderPerson();
 $('quickLearningStatus').textContent=report.events+' החלטות · '+report.readyAnswers+' בחירות בהקלטה קיימת · '+report.errors+' תקלות · '+report.gaps.length+' חוסרים מקובצים'+(report.latency.p50?' · חציון החלטה '+(report.latency.p50/1000).toFixed(1)+' שנ׳':'');
 $('quickReport').replaceChildren();if(report.review){$('quickReport').append(el('p',report.review.summary));report.review.recommendations.forEach((r,i)=>{const box=el('div',null,'card');box.append(el('strong',r.question),el('p',r.suggestedAnswer),el('p',r.reason),button('שמור כהצעה לבדיקה',async()=>{await api('/api/director/report/adopt',{index:i});$('quickLearningStatus').textContent='נשמר בחוסרים לבדיקה. לא נוצר וידאו.';inboxSignature='';await refresh();}));$('quickReport').append(box);});}
 else $('quickReport').append(el('p','הניתוח מציע שיפורים בלבד. שמירת הצעה אינה מפיקה וידאו.'));
 for(const gap of report.gaps.slice(0,6))$('quickReport').append(el('p',gap.count+' פניות: '+gap.question));
}
if(document.readyState!=='complete')document.addEventListener('DOMContentLoaded',mountQuickPanel,{once:true});else mountQuickPanel();
