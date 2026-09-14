import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../data.js';
import {initializeCowork} from '../cowork.js';
import {proposeCustomerProfile,confirmCustomerProfile,correctProfileMemory,profileValues,profileIntent} from '../customer-profile.js';
import {normalizeChatRequest,parseChatReply,demoChatReply} from '../server/chat.js';
import {normalizeRequest} from '../server/protocol.js';
import {initializeWorkspace,previewCRMImport,importCRMRecords,storeSubject,searchCustomerRecords} from '../workspace-model.js';

const fact=(field,value,type='record')=>({field,value,evidence:value,type});
function fixture(facts=[fact('need','需要放两个儿童座椅'),fact('decisionProcess','需要太太一起试驾后决定'),fact('purchaseTiming','计划月底购车'),fact('concern','我觉得可能在比较其他品牌','inference')]){
  const state=initializeCowork(seedState()),c=state.customers[0];
  const chat={id:'profile-chat',customerId:c.id,title:'销售沟通',messages:[{id:'sales-note',role:'user',status:'done',content:'沟通记录：'+facts.map(f=>f.evidence).join('。')}]};
  const message={id:'profile-reply',role:'assistant',status:'done',content:'请核对'};chat.messages.push(message);state.conversations=[chat];
  message.profileProposal=proposeCustomerProfile(chat,message,c,{facts});
  const edits=message.profileProposal.facts.map(f=>({...f,action:'add'}));
  return {state,c,chat,message,edits};
}
const context=(s,c=s.customers[0])=>({kind:'followup',prompt:'检查画像',customer:c,vehicles:s.vehicles,knowledge:s.knowledge,workspaceName:s.settings.name});

test('销售对话先形成待核对画像，确认后保留证据、时间、来源及会话',()=>{
  const {state,c,chat,message,edits}=fixture(),before=structuredClone(c),count=state.artifacts.length;
  assert.equal(c.profileHistory,undefined);assert.equal(message.profileProposal.status,'pending');
  confirmCustomerProfile(state,chat,message,edits);
  assert.equal(message.profileProposal.status,'saved');assert.equal(c.profileHistory.length,4);
  assert.equal(c.decisionProcess,'需要太太一起试驾后决定');assert.equal(c.purchaseTiming,'计划月底购车');
  const memory=c.memories.find(m=>m.field==='decisionProcess');assert.equal(memory.evidence,memory.text);assert.equal(memory.conversationId,chat.id);assert.ok(memory.at);assert.match(memory.source,/Cowork 沟通记录/);
  assert.equal(c.stage,before.stage);assert.equal(c.lastContact,before.lastContact);assert.deepEqual(c.consent,before.consent);
  assert.equal(state.artifacts.length,count);assert.equal(chat.tracked,undefined);
  assert.equal(state.tasks.length,0);assert.ok(state.artifacts.filter(a=>a.customerId===c.id).every(a=>a.status==='stale'));
  assert.ok(!profileValues(c,'concern').includes(edits[3].value));
  assert.throws(()=>confirmCustomerProfile(state,chat,message,edits),/已处理/);
});

test('CRM 导入基础资料后，用销售原话建立和更新画像，保留两类来源',()=>{
  const state=initializeCowork(seedState());initializeWorkspace(state);
  importCRMRecords(state,previewCRMImport(state,'name,phone,market,need\nNew Lead,+1 202 555 0129,US,需要家庭车'),{name:'门店线索.csv'});
  const c=state.customers.at(-1),source=structuredClone(c.dataSource),old=c.memories[0];
  const chat={id:'imported-chat',customerId:c.id,messages:[{role:'user',content:'孩子开始上学，需要放两个儿童座椅。太太也会参与试驾。'}]},message={id:'new-profile'};
  state.conversations=[chat];message.profileProposal=proposeCustomerProfile(chat,message,c,{facts:[fact('need','需要放两个儿童座椅'),fact('decisionProcess','太太也会参与试驾')]});
  confirmCustomerProfile(state,chat,message,message.profileProposal.facts.map(f=>({...f,action:'replace'})));
  assert.equal(old.superseded,true);assert.equal(c.need,'需要放两个儿童座椅');assert.deepEqual(c.dataSource,source);
  assert.deepEqual(profileValues(c,'need'),['需要放两个儿童座椅']);assert.equal(c.stage,'新线索');assert.equal(c.lastContact,null);
  const restored=JSON.parse(JSON.stringify(state)).customers.at(-1);assert.equal(restored.profileHistory.length,2);assert.equal(restored.dataSource.name,'门店线索.csv');
  assert.ok(searchCustomerRecords(state,'太太').some(x=>x.id===c.id));
});

test('销售判断不能通过替换操作覆盖已确认需求',()=>{
  const x=fixture([fact('need','我猜客户想买七座车','inference')]),before=x.c.need;
  confirmCustomerProfile(x.state,x.chat,x.message,[{...x.edits[0],action:'replace'}]);
  assert.equal(x.c.need,before);assert.ok(!profileValues(x.c,'need').includes('我猜客户想买七座车'));
  assert.equal(x.c.memories.at(-1).type,'inference');
});

test('失效草稿和无效编辑不能部分写入画像，旧会话不能写到另一客户',()=>{
  const x=fixture(),before=JSON.stringify(x.state);
  assert.throws(()=>confirmCustomerProfile(x.state,x.chat,x.message,[x.edits[0],{...x.edits[1],value:''}]));assert.equal(JSON.stringify(x.state),before);
  x.c.contextVersion++;const changed=JSON.stringify(x.state);assert.throws(()=>confirmCustomerProfile(x.state,x.chat,x.message,x.edits),/已有新变化/);assert.equal(JSON.stringify(x.state),changed);
  const y=fixture();y.chat.customerId='c2';assert.throws(()=>confirmCustomerProfile(y.state,y.chat,y.message,y.edits),/客户已变化/);
});

test('预算描述与可计算金额分别核对，月供不能被当作购车预算',()=>{
  const x=fixture([fact('budgetNote','预算上限四万美元'),fact('budgetNote','月供不超过六百美元')]);
  confirmCustomerProfile(x.state,x.chat,x.message,[{...x.edits[0],budgetMin:'30000',budgetMax:'40000'},x.edits[1]]);
  assert.deepEqual(x.c.budget,[30000,40000]);assert.equal(x.c.budgetUnknown,false);
  const y=fixture([fact('budgetNote','月供不超过六百美元')]);confirmCustomerProfile(y.state,y.chat,y.message,y.edits);assert.equal(y.c.budgetUnknown,true);
});

test('后续模型请求带画像和销售证据，已替换旧信息不再引用',()=>{
  const x=fixture(),old=x.c.need;x.edits[0].action='replace';confirmCustomerProfile(x.state,x.chat,x.message,x.edits);
  const r=normalizeRequest(context(x.state));
  assert.equal(r.customer.need,'需要放两个儿童座椅');assert.equal(r.customer.profile.decisionProcess,'需要太太一起试驾后决定');
  assert.ok(r.customer.memories.some(m=>m.field==='decisionProcess'&&m.evidence==='需要太太一起试驾后决定'));
  assert.ok(!r.customer.memories.some(m=>m.text===old));assert.ok(r.customer.memories.some(m=>m.type==='inference'));
  assert.equal(r.customer.contact,undefined);assert.ok(r.vehicles.every(v=>v.market===x.c.market));
});

test('Copilot 画像协议验证销售原话并去除模型自带的执行请求',()=>{
  const s=initializeCowork(seedState()),request=normalizeChatRequest({context:context(s),message:'沟通记录：需要家庭车',history:[{role:'assistant',content:'建议客户明天付款'}]});
  const output={mode:'profile',reply:'请核对',profileProposal:{facts:[fact('need','需要家庭车')],customerId:'c2',saved:true},artifactRequest:{send:true}};
  const result=parseChatReply(JSON.stringify(output),request);
  assert.equal(result.mode,'profile');assert.equal(result.artifactRequest,null);assert.equal(result.profileProposal.customerId,undefined);assert.equal(result.profileProposal.saved,undefined);
  assert.throws(()=>parseChatReply(JSON.stringify({...output,profileProposal:{facts:[fact('next','建议客户明天付款')]}}),request),e=>e.code==='INVALID_MODEL_OUTPUT');
  assert.throws(()=>parseChatReply(JSON.stringify({...output,profileProposal:{facts:[fact('consent','需要家庭车')]}}),request),e=>e.code==='INVALID_MODEL_OUTPUT');
  assert.equal(parseChatReply(JSON.stringify(output),normalizeChatRequest({message:request.message})).mode,'clarify');
  assert.equal(parseChatReply(JSON.stringify(output),normalizeChatRequest({message:request.message,context:{...context(s),scope:'store',customer:storeSubject(s,'US')}})).mode,'clarify');
});

test('演示模式明确区分真实沟通记录、普通问题和画像草稿',()=>{
  const s=initializeCowork(seedState());
  for(const message of ['客户画像怎么整理？','先不要记录客户画像','什么是客户画像？','帮客户写一句跟进话术','客户说价格太贵，我怎么回复？','假设客户说他有两个孩子，请模拟一段对话'])assert.equal(profileIntent(message),false);
  const r=demoChatReply(normalizeChatRequest({context:context(s),message:'沟通记录：需要两个儿童座椅。太太会一起决定。计划月底购车。'}));
  assert.equal(r.mode,'profile');assert.equal(r.profileProposal.facts.length,3);assert.match(r.reply,/关键词/);assert.equal(r.artifactRequest,null);
});

test('更正和停用画像记录保留维度与证据，推测不会继续出现在确定事实中',()=>{
  const x=fixture([fact('decisionProcess','太太希望一起试驾后决定')]);confirmCustomerProfile(x.state,x.chat,x.message,x.edits);
  const original=x.c.memories.at(-1);correctProfileMemory(x.state,x.c.id,original.id,{text:'我觉得太太会一起决定',type:'inference'});
  assert.equal(original.superseded,true);assert.equal(x.c.memories.at(-1).field,'decisionProcess');assert.equal(x.c.memories.at(-1).evidence,original.evidence);
  assert.doesNotMatch(profileValues(x.c,'decisionProcess').join(' '),/太太/);
  const record=x.c.memories.at(-1);correctProfileMemory(x.state,x.c.id,record.id,{remove:true});assert.equal(record.superseded,true);
  assert.throws(()=>correctProfileMemory(x.state,x.c.id,record.id,{text:'恢复',type:'record'}),/历史版本/);
});

test('销售可以纠正整理分类和内容，保存结果保留原始提议与原话',()=>{
  const x=fixture([fact('need','太太也要参与决定')]);
  confirmCustomerProfile(x.state,x.chat,x.message,[{...x.edits[0],field:'decisionProcess',value:'与太太共同决定'}]);
  assert.equal(x.c.decisionProcess,'与太太共同决定');assert.equal(x.c.memories.at(-1).evidence,'太太也要参与决定');
  assert.equal(x.message.profileProposal.facts[0].field,'need');assert.equal(x.message.profileProposal.savedFacts[0].field,'decisionProcess');
});
