import {randomUUID} from 'node:crypto';

export const showMoments=Object.freeze([
  {id:'opening',title:'פתיחת לייב',description:'ברכת צ׳ינו, כותרת זהב ואורות במה',durationMs:7800,clipId:'469f030b38'},
  {id:'double',title:'דאבל ×2',description:'תגובת צ׳ינו ופריצת אנרגיה כפולה',durationMs:4800,clipId:'reuse-288185a729dc'},
  {id:'triple',title:'טריפל ×3',description:'תגובת צ׳ינו וחגיגת טריפל בזהב',durationMs:5400,clipId:'reuse-288185a729dc'},
  {id:'glove',title:'כפפה לשמשה',description:'כפפת אגרוף מהכף, מכה וסדק שנעלם',durationMs:4800,clipId:'reuse-142a64471ef9'},
].map(Object.freeze));

// Local authored show cues only. No generation, billing or effects-dashboard API.
export class ChinoShow {
  constructor({director,emit,now=Date.now,id=randomUUID}){Object.assign(this,{director,emit,now,id});this.active=null;this.lastRendered=null;this.lastFinished=null;}
  catalog(){const library=this.director.library();return showMoments.map(m=>{const c=library.find(c=>c.id===m.clipId&&c.ready);return {...m,ready:!!c,recordedText:c?.text||'',generationRequired:false};});}
  status(){return {outputReady:this.director.stageReady(),moments:this.catalog(),active:this.active,lastRendered:this.lastRendered,lastFinished:this.lastFinished};}
  start(kind){
    const moment=this.catalog().find(m=>m.id===kind);if(!moment)throw new Error('invalid_show_moment');
    if(!moment.ready)throw new Error('show_recording_missing');
    if(!this.director.stageReady())throw new Error('stage_not_available');
    if(this.director.otherSpeaking||this.director.muted||this.director.externalClip)throw new Error('show_input_busy');
    if(this.active&&this.now()<this.active.endsAt)throw new Error('show_already_playing');
    this.stop('replaced');this.director.cancel('operator_show',true,true);
    const clip=this.director.library().find(c=>c.id===moment.clipId&&c.ready),event={id:this.id(),type:'audience',text:moment.title,uid:'',room:this.director.room,t:this.now(),source:'operator_show',language:'he'};
    this.director.play(clip,event);
    const startedAt=this.now(),cue={id:this.id(),kind,startedAt,durationMs:moment.durationMs,endsAt:startedAt+moment.durationMs,seed:Math.floor(startedAt%2147483647),clipId:clip.id,playId:this.director.active?.playId||'',recordedText:clip.text};
    this.active=cue;this.director.showHoldUntil=cue.endsAt;
    this.emit('show-play',cue);return {started:true,cue,generated:false};
  }
  stop(reason='operator_stop'){
    const cue=this.active;if(!cue)return {stopped:false};
    this.active=null;this.director.showHoldUntil=0;
    if(reason!=='finished'&&this.director.active?.event?.source==='operator_show')this.director.cancel(reason,true,true);
    this.lastFinished={id:cue.id,kind:cue.kind,reason,at:this.now()};this.emit('show-stop',{id:cue.id,reason});return {stopped:true};
  }
  tick(){
    if(!this.active)return;
    if(this.now()>=this.active.endsAt)this.stop('finished');
    else if(!this.director.stageReady())this.stop('stage_disconnected');
    else if(this.director.otherSpeaking||this.director.muted||this.director.externalClip||this.director.active&&this.director.active.event?.source!=='operator_show')this.stop('conversation_priority');
  }
  acknowledge(b){
    const cue=this.active||(b.state==='ended'&&this.lastFinished?.reason==='finished'&&this.now()-this.lastFinished.at<2500?this.lastFinished:null);
    if(!cue||b.id!==cue.id||b.preview===true||b.stageId!==this.director.stage.id||!this.director.stageReady())return {accepted:false};
    if(!['started','ended','failed'].includes(b.state))return {accepted:false};
    this.lastRendered={id:b.id,kind:cue.kind,state:b.state,at:this.now()};
    if(b.state==='failed')this.stop('renderer_failed');return {accepted:true};
  }
}
