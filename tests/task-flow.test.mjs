import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../data.js';
import {initializeCowork} from '../cowork.js';
import {initializeWorkspace,workspaceItems} from '../workspace-model.js';
import {trackConversation,saveTaskAction,finishTaskAction,toggleTaskComplete,recordTaskFeedback,taskWorkflow,parseWorkspaceRoute,updateTaskDetails} from '../task-flow.js';

function fixture(){const state=initializeCowork(seedState());initializeWorkspace(state);const chat={id:'conversation-test',title:'客户转化方案',customerId:'c3',createdAt:new Date().toISOString(),messages:[]};state.conversations=[chat];trackConversation(state,chat,'解决总价、月供和置换顾虑');return {state,chat,c:state.customers.find(c=>c.id==='c3')};}
test('任务的负责人、动作和结果是同一份持久状态；未回报前不能完成任务',()=>{
  const {state,chat,c}=fixture(),owner=state.team[0].name;
  updateTaskDetails(state,chat,{goal:'确认 Marcus 能接受的购车费用',owner,dueDate:'2026-09-30'});
  assert.throws(()=>saveTaskAction(state,chat,{title:'核实月供',owner,expected:''}));assert.equal(chat.actions.length,0);
  saveTaskAction(state,chat,{title:'核实月供',owner,expected:'实际 APR、首付和总还款额',dueAt:'2026-09-20T10:00'});
  assert.throws(()=>toggleTaskComplete(chat),/未完成/);assert.equal(workspaceItems(state).length,1);
  assert.equal(workspaceItems(state)[0].next,'核实月供');assert.equal(workspaceItems(state)[0].owner,owner);
  assert.match(taskWorkflow(chat,c).requiredHumanAction,/实际 APR/);
  const id=chat.actions[0].id;assert.throws(()=>finishTaskAction(chat,id,''));
  const before=JSON.stringify(c);finishTaskAction(chat,id,'经理已提供试算条件；需要客户确认首付。');assert.equal(JSON.stringify(c),before);
  assert.throws(()=>finishTaskAction(chat,id,'重复回报'));toggleTaskComplete(chat);assert.ok(chat.completedAt);
  saveTaskAction(state,chat,{title:'向客户确认首付',owner,expected:'客户选择的首付范围'});assert.equal(chat.completedAt,undefined);
});
test('需求反馈需要员工明确保存，更新当前事实并保留旧记录，待生成材料失效',()=>{
  const {state,chat,c}=fixture();const old=c.need;
  c.memories.push({id:'old-need',text:old,type:'record',field:'need'});const previous=state.artifacts.find(a=>a.customerId===c.id);
  recordTaskFeedback(state,chat,{type:'need',text:'月供希望控制在 $500 以内，总价不是首要因素。',source:'电话 · 销售核实',occurredAt:'2026-09-01T10:00:00Z',contacted:true},new Date('2026-09-13T10:00:00Z'));
  assert.match(c.need,/500/);assert.ok(c.memories.find(m=>m.id==='old-need').superseded);assert.equal(previous.status,'stale');
  assert.equal(chat.feedback.length,1);assert.match(chat.messages.at(-1).content,/客户档案已更新/);assert.equal(workspaceItems(state).filter(w=>w.type==='work').length,0);
});
test('没有回复不推断重新激活，也不改变已确认的销售阶段或预约',()=>{
  const {state,chat,c}=fixture();c.stage='已约试驾';c.intent=72;c.lastContact='2026-08-01T00:00:00Z';const w=state.works.find(w=>w.customerId===c.id);w.reservation={reference:'real-calendar-receipt'};
  const memories=c.memories.length;
  const input={type:'no_response',text:'发送了充电指南，暂未收到回复。',source:'Email 记录',occurredAt:'2026-09-01T10:00:00Z'};
  assert.throws(()=>recordTaskFeedback(state,chat,input),/实际联系/);
  recordTaskFeedback(state,chat,{...input,contacted:true},new Date('2026-09-13T10:00:00Z'));
  assert.equal(c.memories.length,memories);assert.equal(c.intent,72);assert.equal(c.stage,'已约试驾');assert.equal(w.reservation.reference,'real-calendar-receipt');
  assert.equal(c.lastContact,'2026-09-01T10:00:00.000Z');assert.match(chat.messages.at(-1).content,/没有客户回复/);
});
test('来源、未来时间和门店范围经过校验，拒绝的反馈不修改客户',()=>{
  const {state,chat,c}=fixture();const old=JSON.stringify(c);
  for(const input of [{type:'reply',text:'可以',source:'',occurredAt:'2026-09-01'}, {type:'reply',text:'可以',source:'电话',occurredAt:'2099-01-01'}, {type:'warm',text:'已激活',source:'AI',occurredAt:'2026-09-01'}])assert.throws(()=>recordTaskFeedback(state,chat,input));
  assert.equal(JSON.stringify(c),old);chat.customerId='store:US';assert.throws(()=>recordTaskFeedback(state,chat,{type:'reply'}),/具体客户/);
});
test('客户停止联系会清除联系许可，保存记录不会发送任何消息',()=>{
  const {state,chat,c}=fixture();recordTaskFeedback(state,chat,{type:'withdraw',text:'客户要求不再接收营销内容。',source:'电话记录',occurredAt:'2026-09-01'},new Date('2026-09-13'));
  assert.equal(c.doNotContact,true);assert.deepEqual(c.consent,{WhatsApp:false,Email:false});assert.equal(taskWorkflow(chat,c).marketingPaused,true);
});
test('刷新与历史导航包含任务身份，不依赖任务数组顺序',()=>{
  assert.deepEqual(parseWorkspaceRoute('#chat?conversation=chat-001'),{page:'chat',conversationId:'chat-001'});
  assert.deepEqual(parseWorkspaceRoute('#desk'),{page:'desk',conversationId:undefined});
  assert.equal(parseWorkspaceRoute('').page,'home');
});
