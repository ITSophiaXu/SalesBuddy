import {uid} from './domain.js';
import {updateCustomerContext,invalidateCustomerMaterials} from './cowork.js';

const clean=(value,max,label)=>{const text=String(value||'').trim();if(!text||text.length>max)throw new Error(`请填写${label}（最多 ${max} 字）。`);return text;};
export const FEEDBACK_TYPES={reply:'客户有回复',need:'购车需求变化',concern:'顾虑有变化',no_response:'已联系，暂未回复',withdraw:'客户要求停止联系',complaint:'出现服务问题'};
export const openActions=chat=>(chat.actions||[]).filter(a=>a.status!=='done');
export function trackConversation(state,chat,goal) {
  chat.tracked=true;chat.owner??=state.settings.operator;chat.actions??=[];
  chat.goal ||= goal?.slice(0,100)||chat.messages.find(m=>m.role==='user')?.content.slice(0,100)||'';
  chat.updatedAt=new Date().toISOString();
  return chat;
}
export function updateTaskDetails(state,chat,input) {
  const goal=clean(input.goal,160,'任务目标'),owner=clean(input.owner,100,'负责人');
  if(input.dueDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)||!Number.isFinite(Date.parse(input.dueDate))||new Date(input.dueDate).toISOString().slice(0,10)!==input.dueDate))throw new Error('请选择有效的目标日期。');
  trackConversation(state,chat,goal);Object.assign(chat,{goal,owner,dueDate:input.dueDate||'',updatedAt:new Date().toISOString()});
}
export function saveTaskAction(state,chat,input,id) {
  const title=clean(input.title,160,'下一步动作'),owner=clean(input.owner,100,'负责人'),expected=clean(input.expected,1000,'需要带回的结果');
  const dueAt=input.dueAt?new Date(input.dueAt).toISOString():null;
  const old=id?(chat.actions||[]).find(a=>a.id===id):null;
  if(id&&!old)throw new Error('这项待办已不存在。');
  if(old?.status==='done')throw new Error('这项待办已经完成，请添加新的下一步。');
  trackConversation(state,chat);delete chat.completedAt;
  if(old)Object.assign(old,{title,owner,expected,dueAt});
  else chat.actions.push({id:uid('action'),title,owner,expected,dueAt,status:'open',createdAt:new Date().toISOString()});
}
export function finishTaskAction(chat,id,result) {
  const action=(chat.actions||[]).find(a=>a.id===id);
  if(!action)throw new Error('这项待办已不存在。');
  if(action.status==='done')throw new Error('这项待办已经回报结果。');
  action.result=clean(result,2000,'已完成的工作结果');
  action.status='done';action.completedAt=new Date().toISOString();chat.updatedAt=action.completedAt;
  chat.messages.push({id:uid('msg'),role:'assistant',engine:'record',event:'action',status:'done',at:action.completedAt,content:`${action.owner} 回报：${action.title}\n${action.result}`});
}
export function toggleTaskComplete(chat) {
  if(chat.completedAt){delete chat.completedAt;return;}
  if(openActions(chat).length)throw new Error('还有未完成的待办，请先回报结果，或调整下一步安排。');
  chat.completedAt=new Date().toISOString();
}
export function recordTaskFeedback(state,chat,input,now=new Date()) {
  const c=state.customers.find(c=>c.id===chat.customerId);
  if(!c)throw new Error('请先关联一位具体客户。');
  if(!Object.hasOwn(FEEDBACK_TYPES,input.type))throw new Error('请选择发生了什么。');
  if(input.type==='no_response'&&!input.contacted)throw new Error('请勾选确认这次已经实际联系客户。');
  const text=clean(input.text,2000,'客户原话或已核实的记录'),source=clean(input.source,200,'反馈来源');
  const occurredAt=new Date(input.occurredAt);
  if(!Number.isFinite(occurredAt.getTime())||occurredAt>now)throw new Error('请填写已发生的时间，不能记录未来反馈。');
  const at=occurredAt.toISOString(),label=FEEDBACK_TYPES[input.type];
  const record={id:uid('feedback'),type:input.type,text,source,at};
  if(input.type!=='no_response'){
    const field=['need','concern'].includes(input.type)?input.type:null;
    if(field){for(const m of c.memories)if(m.field===field||m.text===c[field])m.superseded=true;c[field]=text;}
    c.memories.push({id:record.id,text,source,type:'record',field,at});
  }
  if(input.type==='withdraw'){c.doNotContact=true;c.consent={WhatsApp:false,Email:false};}
  if(input.type==='complaint')c.serviceIssue={status:'open',summary:text,at};
  if(input.contacted&&(!c.lastContact||Date.parse(c.lastContact)<occurredAt.getTime()))c.lastContact=at;
  c.timeline.unshift({title:label,body:text,source,at});
  (chat.feedback??=[]).push(record);delete chat.completedAt;
  if(['reply','no_response'].includes(input.type))invalidateCustomerMaterials(state,c.id,`${label}：${text}`);
  else updateCustomerContext(state,c.id,`${label}：${text}`,now);
  chat.updatedAt=now.toISOString();
  chat.messages.push({id:uid('msg'),role:'assistant',engine:'record',event:'feedback',status:'done',at:now.toISOString(),content:`已记录${label} · ${source}\n${text}\n${input.type==='no_response'?'没有客户回复，购车意向与销售阶段未改变。':'客户档案已更新，旧版材料保留为历史参考。'}`});
  return record;
}
export function taskWorkflow(chat,c) {
  if(!chat?.tracked)return null;
  return {goal:chat.goal||chat.title,path:'cowork',reason:'当前任务目标、人工安排与真实反馈',steps:openActions(chat).slice(0,10).map(a=>`${a.owner}：${a.title}`),requiredHumanAction:openActions(chat).slice(0,3).map(a=>`${a.title}；负责人 ${a.owner}；需要带回 ${a.expected}${a.dueAt?'；时间 '+a.dueAt:''}`).join('\n').slice(0,2000),latestFeedback:(chat.feedback||[]).slice(-10).map(f=>({...f,source:f.source.slice(0,300)})),marketingPaused:!!c?.doNotContact||c?.serviceIssue?.status==='open'};
}
export function conversationForArtifact(state,id){return (state.conversations||[]).find(c=>(c.artifactIds?.includes(id)||c.messages.some(m=>[m.artifactId,m.posterId,m.savedArtifactId].includes(id))));}
export function parseWorkspaceRoute(hash) {
  const [page,query='']=String(hash||'').replace(/^#/,'').split('?');
  return {page:page||'home',conversationId:new URLSearchParams(query).get('conversation')||undefined};
}
