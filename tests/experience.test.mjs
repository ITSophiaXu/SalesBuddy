import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../data.js';
import {initializeCowork,businessContext} from '../cowork.js';
import {initializeConversations} from '../chat-ui.js';
import {initializeWorkspace,storeSubject} from '../workspace-model.js';
import {initializeExperience,PERSONAS,WORKFLOWS,roleItems,dashboardData,prepareBriefing,syncDeliveries,visibleDeliveries,updateDelivery,saveMCPConfiguration} from '../experience-model.js';

function fixture(){const s=seedState();initializeCowork(s);initializeConversations(s);initializeWorkspace(s);initializeExperience(s);return s;}
test('三类角色具有独立的工作流和可验证的交付目标',()=>{
  assert.deepEqual(Object.keys(PERSONAS),['sales','marketing','regional']);
  for(const role of Object.keys(PERSONAS)){const flows=WORKFLOWS.filter(w=>w.role===role);assert.equal(flows.length,role==='sales'?4:3);assert.ok(flows.every(w=>w.output&&w.steps.length===4&&w.prompt));}
  assert.ok(WORKFLOWS.filter(w=>w.role==='sales').every(w=>w.scope==='customer'));
  assert.ok(WORKFLOWS.filter(w=>w.role!=='sales').every(w=>w.scope==='store'));
});
test('增量迁移保留客户画像、原对话、选中角色和生态配置',()=>{
  const s=fixture();s.persona='regional';s.ecosystem.skills.campaign={instruction:'门店要求',enabled:false};
  const customers=JSON.stringify(s.customers),works=JSON.stringify(s.works);initializeExperience(s);
  assert.equal(s.persona,'regional');assert.equal(s.ecosystem.skills.campaign.enabled,false);assert.equal(JSON.stringify(s.customers),customers);assert.equal(JSON.stringify(s.works),works);
});
test('工作台按任务角色过滤，个人首页仅列自己的任务或待办',()=>{
  const s=fixture();s.conversations=[{id:'sales-chat',title:'销售跟进',persona:'sales',tracked:true,owner:s.settings.operator,customerId:'c1',messages:[]},{id:'marketing-chat',title:'活动计划',persona:'marketing',tracked:true,owner:s.settings.operator,customerId:'store:AE',messages:[]},{id:'other-chat',title:'他人任务',persona:'sales',tracked:true,owner:'Other',customerId:'c1',messages:[]}];
  assert.deepEqual(roleItems(s,'marketing').map(r=>r.key),['marketing-chat']);
  assert.ok(dashboardData(s,'sales').priorities.some(t=>t.key==='sales-chat'));
  assert.ok(!dashboardData(s,'sales').priorities.some(t=>t.key==='other-chat'));
  assert.equal(roleItems(s,'marketing','US').length,0);
});
test('区域报告使用所选市场，缺少业绩数据保持缺失',()=>{
  const s=fixture(),data=businessContext(s,'regional',storeSubject(s,'AE'));
  assert.equal(data.totals.customers,s.customers.filter(c=>c.market==='AE').length);
  assert.ok(data.stores.every(x=>x.store.startsWith('AE')));assert.ok(data.missing.length);assert.equal(data.totals.revenue,undefined);
});
test('自动简报按角色、范围和当地日期去重，查看简报不修改客户记录',()=>{
  const s=fixture(),now=new Date('2026-09-14T15:00:00Z'),before=JSON.stringify(s.customers);
  const d=prepareBriefing(s,'sales','US',now);assert.equal(d.role,'sales');assert.ok(d.sections.some(s=>s.label==='来源与范围'));
  assert.equal(prepareBriefing(s,'sales','US',now),false);assert.ok(prepareBriefing(s,'sales','US',now,true));
  assert.ok(prepareBriefing(s,'marketing','US',now));assert.equal(visibleDeliveries(s,'regional').length,0);assert.equal(JSON.stringify(s.customers),before);
});
test('定时任务完成后投递附件，失败单独说明，没有完成的工作不伪装成交付',()=>{
  const s=fixture();s.coworkSettings.morningEnabled=false;s.tasks=[{id:'pending',automationId:'a',status:'running'},{id:'done',automationId:'a',status:'review',artifactId:'doc',posterId:'poster',title:'客户关怀',customerId:'c1',kind:'followup'},{id:'error',automationId:'a',status:'failed',error:'连接中断',title:'活动准备',kind:'campaign'}];s.artifacts.push({id:'doc',engine:'copilot'});
  assert.equal(syncDeliveries(s),true);assert.equal(s.deliveries.length,2);assert.equal(syncDeliveries(s),false);
  const delivery=s.deliveries.find(d=>d.kind==='artifact');assert.equal(delivery.artifactId,'doc');assert.equal(delivery.posterId,'poster');assert.equal(delivery.source,'Copilot · 定时任务');
  assert.equal(s.deliveries.find(d=>d.kind==='failure').preview,'连接中断');assert.equal(visibleDeliveries(s,'marketing').length,1);
});
test('来信的阅读和归档状态持久保存，归档不等于客户已联系',()=>{
  const s=fixture(),d=prepareBriefing(s,'sales');const customers=JSON.stringify(s.customers);
  updateDelivery(s,d.id,'read');assert.equal(d.read,true);updateDelivery(s,d.id,'unread');assert.equal(d.read,false);
  updateDelivery(s,d.id,'archive');assert.equal(d.archived,true);updateDelivery(s,d.id,'restore');assert.equal(d.archived,false);
  assert.equal(updateDelivery(s,d.id,'send'),false);assert.equal(JSON.stringify(s.customers),customers);
});
test('MCP 配置验证地址且保持未连接，不接收 URL 中的凭据',()=>{
  const s=fixture();const input={name:'门店 CRM',endpoint:'https://dealer.example/mcp',scope:'仅读取本人门店客户'};
  const m=saveMCPConfiguration(s,input);assert.equal(m.status,'configured');assert.equal(m.access,'read');assert.equal(m.connected,undefined);
  assert.throws(()=>saveMCPConfiguration(s,input),/已有配置/);
  for(const endpoint of ['http://dealer.example/mcp','https://user:secret@dealer.example/mcp','https://dealer.example/mcp?token=secret','javascript:alert(1)'])assert.throws(()=>saveMCPConfiguration(s,{...input,endpoint}));
  assert.equal(s.ecosystem.mcp.length,1);
});
