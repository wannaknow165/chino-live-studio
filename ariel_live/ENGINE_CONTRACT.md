# ARIEL DESK ⇄ Lion Performer — חוזה חיבור (טיוטה לתיאום עם Codex)

הדשבורד (ARIEL DESK, פורט 7777) **לא נוגע** בריג, בפה, בדיבור או במנגנון התגובה. הוא רק קורא למנוע של Codex (ברירת מחדל `http://127.0.0.1:7778`) ומודיע לו על אירועים של הסט. כל הנתיבים ניתנים לשינוי בקובץ `data/settings.json` → `engineMap`.

## מה הדשבורד קורא (ברירות המחדל תואמות ל-`performer-server.mjs` כפי שהוא היום)

| מטרה | נתיב (ברירת מחדל) | גוף הבקשה | מה אני מצפה בחזרה |
|---|---|---|---|
| בריאות / מצב (כל 5 שנ׳) | `GET /api/status` | — | JSON. אני קורא: `performer.state` או `performer.mode` או `speaking`; אופציונלי `render: {type:'iframe'|'video'|'image', url}` — כתובת רינדור שקוף להטמעה בשכבה האמצעית |
| אמור משפט (התערבות / המוח) | `POST /api/say` | `{text, language:'he'|'en', lang, priority:bool, emotion:'', source:'operator'|'brain'|'dashboard'}` | `{ok:true}` או `{error}` |
| עצור הכל → ידני | `POST /api/stop` | `{clear:true}` — **לבטל גם תגובות ממתינות** | `{ok:true}` |
| אוטומטי / ידני | `POST /api/mode` | `{mode:'auto'|'manual', auto:bool}` | סטטוס |
| השתקה | `POST /api/mute` | `{on:bool}` (אם אין נתיב כזה — אני שולח גם `/api/stop`) | `{ok:true}` |
| **סרטון עם קול התחיל/נגמר** | `POST /api/clip` | `{playing:true, secs, name}` / `{playing:false, reason:'ended'|'stopped'}` | `{ok:true}` — בזמן `playing:true` המנוע לא מדבר; אחרי `false` לא לחזור עם משפט ישן |
| מצב צילום | `POST /api/scene` | `{shot:'full'|'close', framing:'seated'|'portrait'}` | סטטוס |
| אירוע כללי | `POST /api/event` | `{type:'gift'|'chat'|'battle'|..., t, ...}` | אופציונלי |

## מה אני צריך מ-Codex כדי להציג את האריה בשכבה האמצעית (מצב 3D)
1. **כתובת רינדור שקוף** — דף (iframe) או סטרים שמציג את האריה+הכיסא עם רקע שקוף. אם ב-`/api/status` יחזור `render:{type:'iframe',url:'http://127.0.0.1:7778/stage?transparent=1'}` — הדשבורד מטמיע אותו לבד. אפשר גם להדביק ידנית בלוח (הסט → "המנוע של Codex").
2. האריה והכיסא **לא** כוללים רקע — הרקע הוא השכבה האחורית של הדשבורד.
3. אירועי SSE (רשות): `{type:'speaking', on:bool}`, `{type:'heard', text}`, `{type:'reply', text}` — כדי להראות בלוח מה המנוע עושה.

## כללים
- במצב 3D שום משפט לא נשלח למנוע יצירת הווידאו (Gemini Omni) — רק ל-`/api/say`.
- סרטון בלחיצה עם קול: הדשבורד שולח `clip playing:true` לפני הניגון ו-`playing:false` בסיום/עצירה; המוזיקה מונמכת אוטומטית.
- "עצור הכל" בדשבורד = `stop {clear:true}` + `mode manual` + ביטול כל מה שחיכה אצלנו.
