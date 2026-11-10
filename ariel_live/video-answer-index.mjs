import fs from 'node:fs';
import path from 'node:path';

export const fold = text => String(text || '').normalize('NFKC').replace(/[\u0591-\u05c7]/g,'').toLowerCase().replace(/['׳’]/g,'').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
const intents = {
  greeting:['שלום','היי','הי','אהלן','שלום לך','היי לך','hello','hi','hey'],
  wellbeing:['מה שלומך','מה נשמע','מה קורה','מה המצב','מה העניינים','איך אתה','איך הולך','איך אתה מרגיש','מה איתך','מה איתך אח שלי','מה איתך אח שלי יקר','איך עובר עליך היום','מה שלומך היום','איך אתה היום','how are you','how are you doing','how is it going','how are things','whats up'],
  identity:['מי אתה','מי אתה בכלל','איך קוראים לך','מה השם שלך','תגיד לי איך קוראים לך','who are you','what is your name','whats your name'],
  thanks:['תודה','תודה רבה','תודה לך','המון תודה','thanks','thank you','thank you very much'],
  wake:['צינו','chino','chiino'],
};
const intentMap = new Map(Object.entries(intents).flatMap(([intent, forms])=>forms.map(x=>[fold(x),intent])));
export function intentOf(text) {
  let q=fold(text); if(intentMap.has(q))return intentMap.get(q);
  q=q.replace(/(?:^|\s)(?:צינו|chi+no)(?=\s|$)/giu,' ').replace(/^\s*(?:תגיד|היי|אהלן)\s+/u,'').replace(/\s+/g,' ').trim();
  return intentMap.get(q)||'';
}
const canonical = {
  he:{greeting:'שלום',wellbeing:'מה שלומך?',identity:'איך קוראים לך?',thanks:'תודה',wake:'צינו'},
  en:{greeting:'hello',wellbeing:'how are you?',identity:'what is your name?',thanks:'thank you',wake:'chino'},
};
export const standardReplies={greeting:'היי, מה קורה?',wellbeing:'וואלה מעולה, מה איתך?',identity:'אני צ׳ינו.',wake:'דבר',thanks:'בכיף!'};
const englishReplies={greeting:'Hi!',wellbeing:'I am good, thanks. How about you?',identity:'I am Chino.',wake:'Yes, I am listening.',thanks:'You are welcome!'};
export function missingReply(event,decision){
  const proposed=String(decision.text||decision.fallbackText||'').trim(),intent=eventIntent(event);
  if(intent&&!reusableReply(intent,proposed))return (event.language==='en'?englishReplies:standardReplies)[intent]||proposed;
  return proposed||(event.language==='en'?'Could you clarify what you mean?':'תחדד לי רגע למה התכוונת?');
}
export const understandingSchema={type:'object',additionalProperties:false,properties:{
  intent:{type:'string',enum:['greeting','wellbeing','identity','thanks','wake','turn_yield','other']},
  canonicalQuestion:{type:'string'},confidence:{type:'number'},standalone:{type:'boolean'},
},required:['intent','canonicalQuestion','confidence','standalone']};
export function validUnderstanding(u){
  return !!u&&understandingSchema.properties.intent.enum.includes(u.intent)&&typeof u.canonicalQuestion==='string'&&u.canonicalQuestion.trim().length>0&&u.canonicalQuestion.length<=500&&Number.isFinite(u.confidence)&&u.confidence>=0&&u.confidence<=1&&typeof u.standalone==='boolean';
}
export function eventIntent(e){
  const u=e.understanding;
  if(validUnderstanding(u))return u.standalone&&u.confidence>=.92&&intentOf(u.canonicalQuestion)===u.intent?u.intent:'';
  return e.wakeOnly?'wake':intentOf(e.text);
}
const meaningKey=(e,persona)=>JSON.stringify([e.room||'',e.type,e.uid||'',e.language,!!e.wakeOnly,fold(e.text),persona]);
// These complete context-free answers may share retrieval and production hints.
// Every automatic playback still requires the director's fresh GPT decision.
export function reusableReply(intent, text) {
  const t=fold(text);
  const patterns={
    greeting:/^(?:היי|הי|שלום|אהלן)(?: לך)?(?: מה קורה| מה נשמע| כיף שבאת)?$|^(?:hello|hi|hey)(?: there)?$/u,
    wellbeing:/^(?:(?:וואלה|אני|הכל|הכול) )?(?:מעולה|מצוין|מצויין|פצצה|בסדר|טוב|סבבה)(?: תודה)?(?: מה איתך| ואיך אצלך| ואצלך| איך אצלך)?$|^(?:im |i am )?(?:doing )?(?:good|great|fine)(?: thanks)?(?: how about you| and you)?$/u,
    identity:/^(?:אני|קוראים לי) צינו(?: האריה הווירטואלי)?$|^(?:im|i am|my name is) chino$/u,
    thanks:/^(?:בכיף|בשמחה|באהבה|על לא דבר)(?: תמיד)?$|^(?:youre welcome|my pleasure|anytime)$/u,
    wake:/^(?:דבר|כן|כן אני מקשיב|אני מקשיב)$/u,
  };
  return !!patterns[intent]?.test(t);
}
export function semanticGapKey(event,text){
  const intent=eventIntent(event);
  if(!intent||!reusableReply(intent,text))return null;
  return JSON.stringify([event.room||'',event.type,event.language,intent]);
}
export class VideoAnswerIndex {
  constructor({file, now=Date.now}={}) {
    this.file=file;this.now=now;this.data={version:1,documents:[],matches:[]};this.hits=0;this.searches=0;
    if(file&&fs.existsSync(file))this.data=JSON.parse(fs.readFileSync(file,'utf8'));
    this.data.interpretations??=[];this.signature='';this.rebuild();
  }
  understand(event,persona=''){
    // Name-only wake metadata must not inherit a cached greeting interpretation.
    if(event.wakeOnly)return {intent:'wake',canonicalQuestion:canonical[event.language==='en'?'en':'he'].wake,confidence:1,standalone:true,source:'curated'};
    const saved=this.data.interpretations.findLast(x=>x.key===meaningKey(event,persona));
    if(saved)return {...saved.understanding,source:saved.source==='operator'?'operator':'learned_phrase'};
    const intent=event.wakeOnly?'wake':intentOf(event.text);
    return intent?{intent,canonicalQuestion:canonical[event.language==='en'?'en':'he'][intent],confidence:1,standalone:true,source:'curated'}:null;
  }
  rememberUnderstanding(event,u,{persona='',source='model'}={}){
    if(!validUnderstanding(u))return false;
    // Contextual interpretations are displayed/journaled, never turned into global aliases.
    if(source!=='operator'&&!eventIntent({...event,understanding:u}))return false;
    const key=meaningKey(event,persona),row={key,question:event.text,room:event.room||'',type:event.type,uid:event.uid||'',language:event.language,persona,understanding:{intent:u.intent,canonicalQuestion:u.canonicalQuestion,confidence:u.confidence,standalone:u.standalone},source,updated:this.now()};
    const prior=this.data.interpretations.find(x=>x.key===key);if(prior)Object.assign(prior,row);else this.data.interpretations.push(row);
    this.persist();return true;
  }
  languageExamples(event,persona=''){
    return this.data.interpretations.filter(x=>x.room===(event.room||'')&&x.type===event.type&&x.uid===(event.uid||'')&&x.language===event.language&&x.persona===persona).slice(-12).map(x=>({heard:x.question,meaning:x.understanding.canonicalQuestion,source:x.source}));
  }
  persist(){if(!this.file)return;fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data,null,2));fs.renameSync(this.file+'.tmp',this.file);}
  rebuild(){
    this.postings=new Map();this.byIntent=new Map();this.byKey=new Map();
    for(const m of this.data.matches){this.byKey.set(m.key,m);const key=JSON.stringify([m.intent,m.language,m.persona]);if(!this.byIntent.has(key))this.byIntent.set(key,[]);this.byIntent.get(key).push(m);}
    for(const d of this.data.documents){
      const text=[d.text,...this.data.matches.filter(m=>m.clipId===d.id&&m.recordedText===d.text).map(m=>m.question)].join(' ');
      for(const token of new Set(fold(text).split(' ').filter(Boolean))){if(!this.postings.has(token))this.postings.set(token,new Set());this.postings.get(token).add(d.id);}
    }
  }
  sync(library){const docs=library.map(({id,text,ready,auto,roles,language})=>({id,text,ready,auto,roles,language}));const sig=JSON.stringify(docs);if(sig===this.signature)return;this.signature=sig;this.data.documents=docs;this.rebuild();this.persist();}
  remember(event,clip,{source='model',reusable=false,persona=''}={}){
    const key=JSON.stringify([event.room||'',event.type,event.uid||'',fold(event.text),clip.id,persona]);
    const prior=this.byKey.get(key),intent=eventIntent(event);
    const row={key,question:event.text,intent,room:event.room||'',uid:event.uid||'',type:event.type,language:event.language,clipId:clip.id,recordedText:clip.text,source,persona,reusable:!!reusable&&!!intent&&reusableReply(intent,clip.text),updated:this.now(),uses:prior?.uses||0};
    if(prior)Object.assign(prior,row);else this.data.matches.push(row);
    this.rebuild();this.persist();return row;
  }
  lookup(event,candidates,persona=''){
    const intent=eventIntent(event);if(!intent)return null;
    const matches=(this.byIntent.get(JSON.stringify([intent,event.language,persona]))||[]).filter(m=>m.reusable&&candidates.some(c=>c.id===m.clipId&&c.text===m.recordedText));
    const usage=new Map();for(const m of this.data.matches){const u=usage.get(m.clipId)||{uses:0,last:0};u.uses+=m.uses||0;u.last=Math.max(u.last,m.lastUsed||0);usage.set(m.clipId,u);}
    matches.sort((a,b)=>(usage.get(a.clipId)?.last||0)-(usage.get(b.clipId)?.last||0)||(usage.get(a.clipId)?.uses||0)-(usage.get(b.clipId)?.uses||0));
    const match=matches[0];if(!match)return null;match.uses++;match.lastUsed=this.now();this.hits++;
    this.remember(event,candidates.find(c=>c.id===match.clipId),{source:match.source,reusable:true,persona});
    return {action:'play',clipId:match.clipId,text:match.recordedText,confidence:1,reason:'indexed_semantic_answer',reusable:true};
  }
  rank(event,candidates){
    this.searches++;const scores=new Map(),intent=eventIntent(event);
    for(const token of new Set(fold(event.text+' '+(event.understanding?.canonicalQuestion||'')).split(' '))){const ids=this.postings.get(token);if(ids)for(const id of ids)scores.set(id,(scores.get(id)||0)+Math.log(1+this.data.documents.length/ids.size));}
    for(const m of this.data.matches)if((intent&&m.intent===intent)||fold(m.question)===fold(event.text))scores.set(m.clipId,(scores.get(m.clipId)||0)+8);
    // Ranking is a shortlist aid, never permission to play a similar question.
    return [...candidates].sort((a,b)=>(scores.get(b.id)||0)-(scores.get(a.id)||0));
  }
  status(){return {documents:this.data.documents.length,ready:this.data.documents.filter(d=>d.ready).length,searchable:this.data.documents.filter(d=>d.ready&&d.auto).length,interpretations:this.data.interpretations.length,matches:this.data.matches.length,fastMatches:this.data.matches.filter(m=>m.reusable).length,hits:this.hits,searches:this.searches,persistent:!!this.file};}
}
