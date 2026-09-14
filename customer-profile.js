import {uid} from './domain.js';
import {invalidateCustomerMaterials,workPlan,logWork} from './cowork.js';

export const PROFILE_FIELDS = {
  need:'用车需求',budgetNote:'预算与付款',vehicle:'意向车型',concern:'顾虑与阻碍',
  purchaseTiming:'购车时间',decisionProcess:'决策人与条件',tradeIn:'现有车辆与置换',preference:'沟通与体验偏好',next:'下一步'
};
const limits={vehicle:200,next:2000};
const clean=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max?value.trim():null;
const unknown=value=>!value||/^(?:需求|用车需求|车型|购车顾虑|预算|客户需求)?(?:待确认|待了解|待核实)$/.test(value);

// Evidence is a verbatim excerpt from a salesperson's message, never an AI answer.
export function validateProfileFacts(facts,sourceTexts) {
  if(!Array.isArray(facts)||!facts.length||facts.length>12)throw new Error('请提供 1–12 条可核对的画像记录。');
  return facts.map(f=>{
    if(!f||!Object.hasOwn(PROFILE_FIELDS,f.field)||!clean(f.value,limits[f.field]||1000)||!clean(f.evidence,2000)||!['record','inference'].includes(f.type))throw new Error('画像记录的字段或内容不完整。');
    if(!sourceTexts.some(text=>typeof text==='string'&&text.includes(f.evidence.trim())))throw new Error('画像记录缺少对应的销售原话。');
    return {field:f.field,value:f.value.trim(),evidence:f.evidence.trim(),type:f.type};
  });
}
export function profileIntent(text) {
  if(/不要(?:记录|记住|保存)|不用(?:记录|保存)|怎么.*画像|如何.*画像|什么是.*画像/.test(text))return false;
  if(!/沟通记录[：:]|(?:记录|记住|更新|整理).{0,12}(?:画像|沟通|客户反馈)/.test(text)&&/怎么|如何|为什么|假设|例如|举例|如果.*客户|角色扮演|模拟|(?:帮|请).*(?:写|回复)|role.?play|example|what if/i.test(text))return false;
  return /沟通记录[：:]|(?:记录|记住|更新|整理).{0,12}(?:画像|沟通|客户反馈)|(?:刚|今天|昨天).{0,12}(?:聊|沟通|打电话|联系|接待)|客户(?:说|表示|提到|告诉我)|customer (?:said|mentioned|told)/i.test(text);
}
export function demoProfileFacts(text) {
  const parts=text.replace(/^(?:请.*?画像[：:]|沟通记录[：:])\s*/,'').split(/[。；;\n]+/).map(p=>p.trim()).filter(Boolean);
  return parts.slice(0,12).map(value=>{
    const field=/预算|月供|首付|付款|budget|payment/i.test(value)?'budgetNote':/担心|顾虑|纠结|贵|concern|worr/i.test(value)?'concern':/置换|旧车|现有车|trade.?in/i.test(value)?'tradeIn':/太太|先生|家人|决定|决策|spouse|decid/i.test(value)?'decisionProcess':/买车时间|购车时间|月底|下个月|本月|购车|before|next month/i.test(value)?'purchaseTiming':/偏好|联系时间|周末|下午|prefer/i.test(value)?'preference':/下一步|下次|跟进安排|next step/i.test(value)?'next':/车型|RAV4|Corolla|Camry|Model Y|EV6/i.test(value)?'vehicle':'need';
    return {field,value:value.slice(0,limits[field]||1000),evidence:value,type:/我猜|我觉得|可能|推测|猜测|maybe|I think/i.test(value)?'inference':'record'};
  });
}
export function proposeCustomerProfile(chat,message,customer,result) {
  const sourceTexts=chat.messages.filter(m=>m.role==='user').map(m=>m.content);
  const facts=validateProfileFacts(result.facts,sourceTexts);
  return {id:uid('profile'),customerId:customer.id,revision:customer.contextVersion||0,status:'pending',createdAt:new Date().toISOString(),facts:facts.map(f=>({...f,id:uid('fact'),sourceMessageId:chat.messages.findLast(m=>m.role==='user'&&m.content.includes(f.evidence))?.id})),replyMessageId:message.id};
}
export function profileValues(customer,field) {
  const current=customer[field];
  const records=(customer.memories||[]).filter(m=>!m.superseded&&m.field===field&&m.type!=='inference').map(m=>m.text);
  const budget=field==='budgetNote'&&!customer.budgetUnknown&&customer.budget?.[1]>0?`${customer.budget[0]} – ${customer.budget[1]} ${customer.currency}`:null;
  return [...new Set([current,...records,budget].filter(value=>!unknown(value)))];
}
export function confirmCustomerProfile(state,chat,message,edits,now=new Date()) {
  const proposal=message.profileProposal,c=state.customers.find(c=>c.id===proposal?.customerId);
  if(!c||chat.customerId!==c.id||proposal.status!=='pending')throw new Error('这份画像更新已处理或客户已变化。');
  if((c.contextVersion||0)!==proposal.revision)throw new Error('客户画像已有新变化，请根据原沟通记录重新整理后再确认。');
  if(!Array.isArray(edits)||!edits.length)throw new Error('至少选择一条要记住的内容。');
  const ids=new Set(),replaced=new Set();
  const accepted=edits.map(edit=>{
    const fact=proposal.facts.find(f=>f.id===edit.id),field=edit.field||fact?.field,value=clean(edit.value,limits[field]||1000);
    if(!fact||!Object.hasOwn(PROFILE_FIELDS,field)||ids.has(edit.id)||!value||!['record','inference'].includes(edit.type)||!['add','replace'].includes(edit.action))throw new Error('请检查每条画像记录的内容和类型。');
    ids.add(edit.id);
    if(edit.action==='replace'&&edit.type==='record'){
      if(replaced.has(field))throw new Error('同一类画像只能选择一条作为新的完整描述。');
      replaced.add(field);
    }
    let amounts=null;
    if(field==='budgetNote'&&edit.type==='record'&&(edit.budgetMin!==''&&edit.budgetMin!=null||edit.budgetMax!==''&&edit.budgetMax!=null)){
      if(edit.budgetMin==null||edit.budgetMin===''||edit.budgetMax==null||edit.budgetMax==='')throw new Error('预算金额请填写完整范围，或同时留空。');
      amounts=[Number(edit.budgetMin),Number(edit.budgetMax)];
      if(amounts.some(n=>!Number.isFinite(n)||n<0||n>1e8)||amounts[0]>amounts[1])throw new Error('预算范围无效。');
    }
    return {...fact,field,value,type:edit.type,action:edit.action,amounts};
  });
  const budgets=accepted.filter(f=>f.field==='budgetNote'&&f.type==='record');
  const ranges=budgets.filter(f=>f.amounts);
  if(ranges.length>1)throw new Error('请只在一条预算记录中填写最终确认的金额范围。');
  // Validate all edits before mutating, and retain the original evidence on every fact.
  const at=now.toISOString(),source=`${state.settings.operator} · Cowork 沟通记录`;
  c.profileHistory??=[];
  for(const f of accepted){
    const before=c[f.field]||'';
    if(f.type==='record'&&f.action==='replace'){
      for(const old of c.memories)if(!old.superseded&&(old.field===f.field||old.text===before))old.superseded=true;
      c[f.field]=f.value;
    }else if(f.type==='record'&&unknown(before))c[f.field]=f.value;
    const record={id:uid('memory'),field:f.field,text:f.value,type:f.type,source,at,evidence:f.evidence,conversationId:chat.id,sourceMessageId:f.sourceMessageId,proposalId:proposal.id};
    c.memories.push(record);
    c.profileHistory.unshift({...record,action:f.action,before});
  }
  if(budgets.length){if(ranges.length){c.budget=ranges[0].amounts;c.budgetUnknown=false;}else c.budgetUnknown=true;}
  proposal.status='saved';proposal.savedAt=at;proposal.savedCount=accepted.length;proposal.savedFacts=accepted;
  c.timeline.unshift({title:'从销售对话更新画像',body:accepted.map(f=>`${PROFILE_FIELDS[f.field]}：${f.value}${f.type==='inference'?'（待核实）':''}`).join('\n'),source,at,conversationId:chat.id});
  invalidateCustomerMaterials(state,c.id,'销售确认了新的客户画像');
  const work=state.works.find(w=>w.customerId===c.id);
  if(work){work.plan=workPlan(c);work.goal=work.plan.goal;work.revision=c.contextVersion;logWork(work,'客户画像已更新','销售已确认新的记录；后续方案将参考最新画像。已有预约与联系回执保留。',now);}
  // A profile observation does not imply a contact, appointment, permission, or sale.
  chat.updatedAt=at;
  return c;
}

export function correctProfileMemory(state,customerId,memoryId,input,now=new Date()) {
  const c=state.customers.find(c=>c.id===customerId),old=c?.memories.find(m=>m.id===memoryId);
  if(!old||old.superseded)throw new Error('请修改当前有效的记录，历史版本不再参与生成。');
  const value=clean(input.text,limits[old.field]||2000);
  if(!input.remove&&(!value||!['record','inference'].includes(input.type)))throw new Error('请填写有效的记录和性质。');
  const at=now.toISOString();old.superseded=true;
  const replacement=input.remove?null:{id:uid('memory'),text:value,field:old.field,type:input.type,source:state.settings.operator+' · 更正记录',at,evidence:old.evidence,conversationId:old.conversationId,supersedes:old.id};
  if(replacement)c.memories.push(replacement);
  for(const key of Object.keys(PROFILE_FIELDS)){
    if(typeof c[key]==='string'&&c[key].includes(old.text))c[key]=c[key].replace(old.text,replacement?.type==='record'?value:'待重新核实');
  }
  if(old.field==='budgetNote')c.budgetUnknown=true;
  (c.profileHistory??=[]).unshift({id:uid('history'),field:old.field,before:old.text,text:replacement?.text||'',action:input.remove?'remove':'correct',source:state.settings.operator,at});
  c.timeline.unshift({title:input.remove?'停用客户记忆':'更正客户记忆',body:replacement?.text||old.text,source:state.settings.operator,at});
  invalidateCustomerMaterials(state,c.id,'销售更正了客户记忆');
  const work=state.works.find(w=>w.customerId===c.id);if(work){work.plan=workPlan(c);work.goal=work.plan.goal;work.revision=c.contextVersion;}
  return c;
}
