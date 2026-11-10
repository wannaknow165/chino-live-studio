const card=document.createElement('section');card.className='card';card.style.marginBottom='18px';
card.innerHTML='<h2>🦁 מחוות של צ׳ינו</h2><p class="small">תגובה שלמה של האריה: קול, תנועת גוף ונשיקות בתזמון אחד. אחרי הכנה ובדיקה היא נשמרת בספריית התגובות של ה־AI.</p><p><strong>״נשיקות לכל הבנות שלנו!״</strong></p><p class="small">צ׳ינו מרים כף אל הפה, שולח נשיקה לקהל וחוזר לשבת. הנשיקות מתפרצות מהכף בזמן התנועה.</p><div class="row"><button id="chinoKiss">טוען…</button><button id="chinoKissApprove" hidden></button></div><p id="chinoKissState" class="small" role="status"></p>';
document.querySelector('header').after(card);
const play=card.querySelector('#chinoKiss'),approve=card.querySelector('#chinoKissApprove'),state=card.querySelector('#chinoKissState');
let current=null,quote=null,busy=false,message='';
async function api(route,body){const r=await fetch('/api/director/'+route,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(!r.ok||j.error&&!j.alreadySubmitted)throw new Error(j.error||'request_failed');return j;}
function errorText(e){return ({performance_text_changed:'הנוסח של המחווה השתנה. יש להכין הצעה חדשה.',production_quote_expired:'ההצעה פגה. לחץ שוב על הכנת המחווה.',production_already_submitted:'הבקשה כבר נשלחה. אין חיוב נוסף.',stage_not_available:'נגן האריה אינו פנוי כרגע.',openai_key_required:'חיבור הבדיקה של המנוע אינו זמין.',generation_auth_failed:'חיבור ספק הווידאו אינו זמין.'})[e.message]||'לא ניתן להשלים כרגע. הבקשה לא תישלח שוב אוטומטית.';}
function render(){
  if(!current)return;
  const working=['queued','submitting','generating','verifying','uncertain'].includes(current.state);
  play.disabled=busy||working;
  play.textContent=current.ready?'💋 צ׳ינו — נשיקות לקהל':working?'מכין את מחוות הנשיקה…':'הכן את מחוות הנשיקה לאישור';
  if(message){state.textContent=message;return;}
  if(!quote){
    state.textContent=current.ready?'מוכן: דיבור, יד ונשיקות משולבים בתגובה אחת.':working?'הבקשה כבר נשלחה. ממתינים לתוצאה, ללא ניסיון נוסף.':current.error==='generated_performance_review_required'?'הווידאו נוצר וממתין לבדיקת תנועת היד ותזמון הנשיקות.':current.state==='failed'?'ההפקה דורשת בדיקה לפני שניתן להמשיך.':'טרם נוצרה תנועת היד. לחיצה מכינה את הנוסח והמחיר לאישור; היא אינה מחייבת.';
  }
}
async function refresh(){try{const list=await api('performances');current=list.find(x=>x.id==='kiss_audience');render();}catch{play.disabled=true;state.textContent='אין חיבור למנוע המחוות של צ׳ינו.';}}
play.onclick=async()=>{
  if(busy)return;message='';busy=true;render();
  try{
    const j=await api('performance',{id:'kiss_audience'});
    if(j.ready){message='צ׳ינו מבצע את המחווה.';state.textContent=message;quote=null;approve.hidden=true;setTimeout(()=>{message='';render();},10000);}
    else if(j.quote){quote=j.quote;state.textContent=`${quote.description} צילום של ${quote.requestedSeconds} שניות: אומדן וידאו $${quote.estimatedVideoUSD.toFixed(2)}. מסגרת כוללת עד $${quote.price.reservationUSD.toFixed(2)}, כולל מרווח לבדיקות. ניסיון יצירה אחד.`;approve.textContent=`אשר יצירה אחת — עד $${quote.price.reservationUSD.toFixed(2)}`;approve.hidden=false;}
    else{quote=null;approve.hidden=true;await refresh();}
  }catch(e){message=errorText(e);state.textContent=message;}finally{busy=false;render();}
};
approve.onclick=async()=>{
  if(!quote||busy)return;message='';busy=true;play.disabled=approve.disabled=true;
  try{
    // Refresh an expired quote without changing the approved line or spending cap.
    const fresh=await api('production/quote',{id:quote.rowId,text:quote.text});
    if(fresh.performanceId!==quote.performanceId||fresh.price.reservationUSD!==quote.price.reservationUSD||fresh.price.maxAttempts!==1)throw new Error('production_quote_changed');
    await api('production/approve',{quoteId:fresh.id,approved:true});quote=null;approve.hidden=true;await refresh();
  }catch(e){message=errorText(e);state.textContent=message;}finally{busy=false;approve.disabled=false;render();}
};
refresh();setInterval(refresh,5000);
