export const materialSchema={type:'object',additionalProperties:false,properties:{summary:{type:'string'},skills:{type:'array',items:{type:'object',additionalProperties:false,properties:{trigger:{type:'string'},policy:{type:'string'},reply_he:{type:'string'},reply_en:{type:'string'},evidenceQuote:{type:'string'},uncertainty:{type:'string'},testInput:{type:'string'},expectedBehavior:{type:'string'}},required:['trigger','policy','reply_he','reply_en','evidenceQuote','uncertainty','testInput','expectedBehavior']}},irrelevant:{type:'boolean'}},required:['summary','skills','irrelevant']};
export function materialInput(input){
 if(typeof input.text!=='string'||input.text.length>64000||!Array.isArray(input.images)||input.images.length>4||(!input.text.trim()&&!input.images.length))throw new Error('invalid_learning_material');
 if(input.images.some(s=>typeof s!=='string'||s.length>700000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(s)))throw new Error('invalid_learning_image');
 return {text:input.text,images:input.images};
}
export function materialResult(result,input){
 if(typeof result.summary!=='string'||!Array.isArray(result.skills)||result.skills.length>8)throw new Error('invalid_learning_result');
 const skills=result.skills.filter(s=>typeof s.policy==='string'&&s.policy.trim()&&typeof s.evidenceQuote==='string'&&s.evidenceQuote.trim()&&(input.images.length||input.text.includes(s.evidenceQuote)));
 return {styles:[result.summary],lines:skills.filter(s=>s.reply_he?.trim()).map(s=>({text:s.reply_he,when:s.trigger,kind:'other'})),skills,irrelevant:!!result.irrelevant,analysisProvider:'openai',analysisVersion:'full_source_v2',checks:{sourceRead:true,quotesMatchedToText:!input.images.length,visualSource:!!input.images.length,behaviorTested:false}};
}
