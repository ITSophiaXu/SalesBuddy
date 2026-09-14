import test from 'node:test';
import assert from 'node:assert/strict';
import {draftArtifact} from '../domain.js';
import {normalizeChatRequest,demoChatReply} from '../server/chat.js';
import {normalizeRequest,draftStoreArtifact} from '../server/protocol.js';

// Component/controller tests with an in-memory document adapter. This does not
// launch or control a browser and is intentionally not visual acceptance testing.
const elements = new Map();
function element(selector) {
  if (!elements.has(selector)) elements.set(selector, { innerHTML: '', style: {}, value: '', dataset: {}, focus() {}, isConnected: true });
  return elements.get(selector);
}
const listeners = {};
const windowListeners = {};
const storage = new Map();
const timers = [];
globalThis.document = {
  title: '', activeElement: null, body: { style: {} },
  querySelector(selector) {
    if (selector === '.modal' || selector === '.overlay') return element('#overlay-root').innerHTML ? element(selector) : null;
    return element(selector);
  },
  querySelectorAll() { return []; },
  addEventListener(name, fn) { listeners[name] = fn; }
};
globalThis.window = { addEventListener(name, fn) { windowListeners[name] = fn; }, scrollTo() {} };
globalThis.location = { hash: '' };
globalThis.localStorage = { getItem(key) { return storage.get(key) || null; }, setItem(key, value) { storage.set(key, value); } };
globalThis.setTimeout = (fn, delay) => { timers.push({ fn, delay }); return timers.length; };
globalThis.clearTimeout = () => {};
globalThis.setInterval = () => {};
globalThis.requestAnimationFrame = () => {};
globalThis.FormData = class { constructor(form) { this.data = form.values; } *[Symbol.iterator]() { yield* Object.entries(this.data); } };
let failGeneration=false;
let holdGeneration=null;
const requests=[];
const chatRequests=[];
let holdChat=null,failChat=false;
let aiStatus={provider:'demo',ready:true,model:'Test fixture',message:'Test fixture'};
globalThis.fetch=async(url,options={})=>{
  if(url==='/api/status')return Response.json(aiStatus);
  if(url==='/api/chat'){
    const payload=JSON.parse(options.body);chatRequests.push(payload);
    if(holdChat)await holdChat;
    if(failChat)return Response.json({error:{code:'SDK_NOT_INSTALLED',message:'尚未安装 Copilot SDK'}},{status:503});
    return Response.json(demoChatReply(normalizeChatRequest(payload)));
  }
  if(url!=='/api/generate')throw new Error('Unexpected request');
  const r=JSON.parse(options.body);requests.push(r);
  if(holdGeneration)await holdGeneration;
  if(failGeneration)return Response.json({error:{code:'GENERATION_FAILED',message:'测试模型服务不可用'}},{status:502});
  const artifact=r.scope==='store'?draftStoreArtifact(normalizeRequest(r)):draftArtifact(r.kind,r.customer,r.vehicles,r.prompt,r.knowledge,{preferredVehicleId:r.preferredVehicleId,campaign:r.campaign,workspaceName:r.workspaceName,workflow:r.workflow,businessContext:r.businessContext,needsPoster:r.needsPoster});
  if(r.kind==='campaign')artifact.posterBrief={kicker:'FAMILY DRIVE',headline:'Room for what matters.',subheadline:'Find your next drive.',details:'Appointment details to be confirmed.',cta:'Request a test drive',disclaimer:'Concept. Confirm local details.'};
  return Response.json({artifact:{...artifact,engine:'demo'}});
};
await import('../app.js');
const currentState = () => JSON.parse(storage.get('motive-workspace-v3'));
const main = () => element('#app').innerHTML;
const modal = () => element('#overlay-root').innerHTML;
const navigate = page => { location.hash = `#${page}`; windowListeners.hashchange(); };
async function click(act, extra = {}) { const el = { dataset: { act, ...extra } }; await listeners.click({ target: { matches() { return false; }, closest() { return el; } } }); }
function submit(id, values, dataset={}) { return listeners.submit({ preventDefault() {}, target: { id, values, dataset } }); }

test('新工作区自动整理客户工作，可加载原页面及新的工作与人工待办', () => {
  assert.equal(currentState().customers.length, 8);
  assert.equal(currentState().tasks.length, 3);
  assert.equal(currentState().works.length, 8);
  assert.equal(currentState().artifacts.filter(a=>a.kind==='journey').length,8);
  for (const page of ['home','chat','desk','connections','work','inbox','workspace','customers','inventory','campaigns','automations','deliverables','knowledge','settings']) {
    navigate(page);
    assert.match(main(), /<main class="main">/);
    assert.doesNotMatch(main(), />NaN</);
    assert.ok(main().length > 3500, `${page} renders content`);
  }
});
test('客户画像可读取、增加记忆，并持久保存', async () => {
  await click('customer', { id: 'c1' });
  assert.match(modal(), /Sarah Johnson/);
  assert.match(modal(), /两个孩子/);
  submit('memory-form', { memory: '周日下午带孩子到店，请准备儿童座椅。' }, { id: 'c1' });
  assert.ok(currentState().customers[0].memories.some(m => m.text.includes('周日下午')));
  assert.match(modal(), /周日下午/);
});
test('客户新增后不会自动取得联系授权，信息持久保存', async () => {
  await click('new-customer');
  submit('customer-form', {name:'Product QA',market:'GB',city:'London',timezone:'Europe/London',language:'en',stage:'新线索',budgetMin:'35000',budgetMax:'45000',vehicle:'Kia EV6',channel:'Email',contact:'',email:'qa@example.com',need:'英国右舵家庭用车',concern:'本地库存待确认',next:'确认英国车源'});
  const c=currentState().customers.find(c=>c.name==='Product QA');
  assert.equal(c.currency,'GBP'); assert.equal(c.lastContact,null);
  assert.deepEqual(c.consent,{WhatsApp:false,Email:false});
  assert.match(modal(),/英国右舵家庭用车/);
});
test('选定车源的协作生成该车型报价，并把新增客户记忆传入成果', async () => {
  await click('vehicle-customer-run',{id:'c1',vehicle:'v3'});
  navigate('workspace');
  assert.match(main(),/待审核/);
  const s=currentState();const task=s.tasks[0];const a=s.artifacts.find(a=>a.id===task.artifactId);
  assert.equal(task.status,'review');
  assert.match(a.sections.find(x=>x.label==='推荐方案').text,/Kia EV6/);
  assert.match(a.sections[0].text,/周日下午/);
  assert.equal(requests.at(-1).preferredVehicleId,'v3');
});
test('交付物审核更新对应任务状态', async () => {
  const id=currentState().artifacts[0].id;
  await click('approve-artifact',{id});
  assert.equal(currentState().artifacts.find(a=>a.id===id).status,'approved');
  assert.equal(currentState().tasks.find(t=>t.artifactId===id).status,'approved');
  assert.match(modal(),/记录手动联系/);
});
test('手动联系需要独立确认界面，保存真实反馈后更新联系间隔', async () => {
  const id=currentState().artifacts[0].id;
  await click('record-contact',{id});
  assert.match(modal(),/我确认已通过上述渠道实际联系客户/);
  assert.match(modal(),/本操作仅更新沟通记录，不发送消息/);
  submit('contact-form',{note:'测试反馈：客户确认了到店时间。',confirmed:'on'});
  const s=currentState();const c=s.customers.find(c=>c.id==='c1');
  assert.equal(s.artifacts.find(a=>a.id===id).status,'contacted');
  assert.match(c.timeline[0].body,/确认了到店时间/);
  assert.ok(Date.now()-new Date(c.lastContact)<5000);
});
test('未取得授权的客户不能记录营销联系', async () => {
  const before=currentState().customers.find(c=>c.id==='c8').lastContact;
  await click('customer-run',{id:'c8',kind:'followup'});
  const id=currentState().artifacts[0].id;
  await click('approve-artifact',{id});
  await click('record-contact',{id});
  assert.equal(currentState().artifacts[0].status,'approved');
  assert.equal(currentState().customers.find(c=>c.id==='c8').lastContact,before);
  assert.match(element('#toast-root').innerHTML,/补充真实的渠道授权/);
  assert.doesNotMatch(modal(),/id="contact-form"/);
});
test('自动化规则可以保存、暂停，并展示执行检查结果', async () => {
  await click('new-automation');
  submit('automation-form',{name:'测试车主关怀',description:'准备服务问候',segment:'owners',kind:'aftersales',cadence:'30',hour:'11'});
  const id=currentState().automations.at(-1).id;
  assert.equal(currentState().automations.at(-1).enabled,true);
  await click('toggle-automation',{id});assert.equal(currentState().automations.at(-1).enabled,false);
  await click('toggle-automation',{id});
  await click('run-automation',{id});
  assert.match(modal(),/本次自动化检查结果/);
  assert.equal(currentState().automationLog[0].name,'测试车主关怀');
});
test('新增知识与营销活动均可持久保存', async () => {
  await click('new-knowledge');submit('knowledge-form',{title:'测试充电指南',category:'销售手册',body:'物业确认前不承诺可以安装。'});
  assert.equal(currentState().knowledge.at(-1).title,'测试充电指南');
  await click('new-campaign');submit('campaign-form',{title:'家庭空间体验日',market:'AE',channel:'WhatsApp + Instagram',audience:'家庭首购客户',goal:'演示儿童座椅和行李厢空间'});
  assert.equal(currentState().campaigns[0].title,'家庭空间体验日');
});
test('全局搜索可定位客户和交付物', async () => {
  await click('search');
  listeners.input({target:{dataset:{input:'global-search'},value:'Sarah'}});
  assert.match(element('#global-results').innerHTML,/Sarah Johnson/);
  assert.match(element('#global-results').innerHTML,/成果/);
});
test('模型失败保留失败任务，不生成模板；重试可重新完成',async()=>{
  const before=currentState().artifacts.length;failGeneration=true;
  await click('customer-run',{id:'c1',kind:'followup'});
  const failed=currentState().tasks[0];
  assert.equal(failed.status,'failed');assert.equal(currentState().artifacts.length,before);
  assert.match(main(),/测试模型服务不可用/);
  failGeneration=false;await click('retry-task',{id:failed.id});
  assert.equal(currentState().tasks[0].status,'review');assert.equal(currentState().artifacts.length,before+1);
});
test('活动包同时保存关联的文案与海报，海报编辑后重新审核',async()=>{
  const campaign=currentState().campaigns[0];
  await click('campaign-package',{id:campaign.id});
  navigate('chat');const count=currentState().conversations.length;
  assert.equal(currentState().conversations[0].customerId,'store:'+campaign.market);
  await click('campaign-package',{id:campaign.id});assert.equal(currentState().conversations.length,count);
  element('#cowork-chat-input').value=currentState().conversations[0].draft;
  await submit('cowork-chat-form',{});navigate('chat');
  const s=currentState(),task=s.tasks[0],poster=s.artifacts.find(a=>a.id===task.posterId);
  assert.equal(poster.parentArtifactId,task.artifactId);assert.equal(poster.campaignId,campaign.id);
  assert.equal(poster.poster.headline,'Room for what matters.');assert.match(main(),/class="chat-artifact/);
  await click('artifact',{id:poster.id});assert.match(modal(),/LIVE PREVIEW/);assert.match(modal(),/导出 PNG/);
  assert.match(modal(),/<button type="button"[^>]+data-act="poster-ai"/);
  element('#poster-form').values={...poster.poster,size:'story',theme:'midnight',headline:'Ready for your next drive?'};
  await click('poster-approve');assert.equal(currentState().artifacts.find(a=>a.id===poster.id).status,'approved');
  element('#poster-form').values={...currentState().artifacts.find(a=>a.id===poster.id).poster,headline:'A revised headline'};
  listeners.input({target:{dataset:{input:'poster'}}});assert.match(element('#poster-preview').innerHTML,/DRAFT \/ CONCEPT/);
  await click('poster-save');const saved=currentState().artifacts.find(a=>a.id===poster.id);
  assert.equal(saved.status,'review');assert.equal(saved.poster.size,'story');assert.equal(saved.poster.headline,'A revised headline');
  assert.equal(saved.approvedAt,undefined);
  element('#poster-form').values={...saved.poster};let prevented=false;
  await listeners.submit({target:{id:'poster-form'},preventDefault(){prevented=true;}});
  assert.ok(prevented,'Enter saves locally instead of leaking form fields into a navigation URL');
});
test('海报的 AI 优化保留所选语言、尺寸和配色',async()=>{
  const poster=currentState().artifacts.find(a=>a.format==='poster');
  await click('artifact',{id:poster.id});
  element('#poster-form').values={...poster.poster,size:'square',theme:'sand',language:'en'};
  await click('poster-ai');
  const s=currentState(),task=s.tasks[0],created=s.artifacts.find(a=>a.id===task.posterId);
  assert.equal(requests.at(-1).customer.language,'en');assert.match(requests.at(-1).prompt,/A revised headline/);
  assert.equal(created.poster.size,'square');assert.equal(created.poster.theme,'sand');
});

test('客户工作完整走通：调整时段、审核材料、记录发送与客户同意、登记回执',async()=>{
  const id='work_c1';await click('cw-open',{id});navigate('work');
  assert.match(main(),/邀约结果，要有三份依据/);
  const slot=currentState().visitSlots.find(s=>s.city==='Austin, TX');
  element('#cw-slot').value=slot.id;await click('cw-slot-save',{id});
  await click('cw-strategy',{id});
  let s=currentState(),w=s.works.find(w=>w.id===id),poster=s.artifacts.find(a=>a.id===w.posterId);
  await click('artifact',{id:poster.id});element('#poster-form').values={...poster.poster};await click('poster-approve');await click('close-modal');
  await click('cw-activity',{id});assert.ok(currentState().works.find(w=>w.id===id).decisions.activity,element('#toast-root').innerHTML);
  await click('cw-outbound',{id});await submit('cw-outbound-form',{confirmed:'on',note:'已实际发送此时段邀请。'},{id});
  await submit('cw-feedback-form',{type:'reply',message:'我再考虑一下。',outcome:'unsure',slotId:''},{id});
  await click('cw-reservation',{id});await submit('cw-reservation-form',{confirmed:'on',reference:'UI-R1'},{id});
  assert.equal(currentState().works.find(w=>w.id===id).reservation,undefined);assert.match(element('#toast-root').innerHTML,/尚未明确接受/);
  await click('close-modal');await submit('cw-feedback-form',{type:'reply',message:'我确定这个时段到店。',outcome:'accepted',slotId:slot.id},{id});
  await click('cw-reservation',{id});await submit('cw-reservation-form',{confirmed:'on',reference:'UI-R1'},{id});
  s=currentState();w=s.works.find(w=>w.id===id);assert.equal(w.reservation.reference,'UI-R1');assert.equal(s.customers.find(c=>c.id==='c1').stage,'已约试驾');assert.match(main(),/已建立|接待/);
});

test('模型返回较晚时，不让旧客户事实覆盖已经更新的工作包',async()=>{
  let release;holdGeneration=new Promise(resolve=>{release=resolve;});
  const running=click('customer-run',{id:'c1',kind:'followup'});
  await new Promise(resolve=>setImmediate(resolve));
  const pending=currentState().tasks[0];assert.equal(pending.status,'running');
  submit('memory-form',{memory:'最新变化：需要另行确认新时间。'},{id:'c1'});
  release();await running;holdGeneration=null;
  const done=currentState().tasks.find(t=>t.id===pending.id);assert.equal(done.status,'stale');assert.equal(done.artifactId,undefined);
});

test('停止运行中的生成，迟到的结果不会被保存为完成',async()=>{
  let release;holdGeneration=new Promise(resolve=>{release=resolve;});
  const running=click('customer-run',{id:'c3',kind:'quote'});await new Promise(resolve=>setImmediate(resolve));
  const pending=currentState().tasks[0];await click('cancel-task',{id:pending.id});
  release();await running;holdGeneration=null;
  const done=currentState().tasks.find(t=>t.id===pending.id);assert.equal(done.status,'cancelled');assert.equal(done.artifactId,undefined);
});

test('从快速咨询入口进入完整交接工作，城市与预算不被补写为猜测',async()=>{
  await click('cw-quick-lead');assert.match(modal(),/仅凭联系方式/,element('#toast-root').innerHTML);
  await submit('cw-lead-form',{name:'',contact:'new-qa@example.com',market:'GB',channel:'Email',need:''});
  const c=currentState().customers.find(c=>c.email==='new-qa@example.com');assert.equal(c.budgetUnknown,true);assert.equal(c.city,'城市待确认');
  assert.equal(currentState().visitSlots.some(s=>s.city==='城市待确认'),false);
  navigate('work');assert.match(main(),/补齐需求/);
});

const sayChat=async text=>{element('#cowork-chat-input').value=text;await submit('cowork-chat-form',{});navigate('chat');};
test('v1.6 对话保留 Markdown 和真实事件，不因普通流式回复创建任务',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async(url,options)=>{
    if(url!=='/api/chat')return original(url,options);
    assert.equal(options.headers.Accept,'application/x-ndjson');
    const reply='**买了 Model Y 以后，能否方便、稳定地给车充电。**';
    const events=[
      {type:'progress',stage:'session_ready',elapsedMs:1},
      {type:'reply',text:reply},
      {type:'progress',stage:'complete',elapsedMs:2},
      {type:'result',data:{mode:'reply',reply,engine:'copilot',artifactRequest:null,profileProposal:null}}
    ];
    return new Response(events.map(e=>JSON.stringify(e)+'\n').join(''),{headers:{'Content-Type':'application/x-ndjson'}});
  };
  await click('chat-new');const count=currentState().tasks.length;
  await sayChat('讨论充电，不创建任务');
  assert.match(main(),/<strong>买了 Model Y 以后，能否方便、稳定地给车充电。<\/strong>/);
  assert.match(main(),/class="chat-execution"/);
  const reply=currentState().conversations[0].messages.at(-1);
  assert.equal(reply.status,'done');assert.equal(reply.engine,'copilot');
  assert.deepEqual(reply.execution.map(e=>e.stage),['session_ready','complete']);
  assert.equal(currentState().tasks.length,count);
});
const latestChat=()=>currentState().conversations[0];

test('对话整理画像，经销售核对保存，后续车源方案实际使用更新内容',async()=>{
  await click('chat-profile',{customer:'c1'});navigate('chat');
  assert.equal(latestChat().customerId,'c1');assert.match(main(),/把刚才的沟通告诉我/);
  const before=currentState(),cBefore=before.customers.find(c=>c.id==='c1');
  await sayChat('沟通记录：需要更大的后排空间。太太希望一起试驾后决定。计划月底购车。');
  const chat=latestChat(),m=chat.messages.at(-1);assert.equal(m.mode,'profile');assert.equal(m.profileProposal.status,'pending');
  assert.equal(currentState().artifacts.length,before.artifacts.length);assert.equal(currentState().tasks.length,before.tasks.length);
  assert.equal(currentState().customers.find(c=>c.id==='c1').contextVersion,cBefore.contextVersion);assert.match(main(),/核对并记入画像/);
  await click('profile-review',{chat:chat.id,message:m.id});assert.match(modal(),/销售原话/);assert.match(modal(),/替换这一类的旧描述/);
  const values=Object.fromEntries(m.profileProposal.facts.flatMap((f,n)=>[[`include_${n}`,'on'],[`value_${n}`,f.value],[`type_${n}`,f.type],[`action_${n}`,'replace']]));
  await submit('profile-confirm-form',values);
  const after=currentState(),c=after.customers.find(c=>c.id==='c1');
  assert.equal(c.decisionProcess,'太太希望一起试驾后决定');assert.equal(c.purchaseTiming,'计划月底购车');
  assert.equal(c.lastContact,cBefore.lastContact);assert.equal(c.stage,cBefore.stage);assert.deepEqual(c.consent,cBefore.consent);
  assert.equal(after.tasks.length,before.tasks.length);assert.equal(after.artifacts.length,before.artifacts.length);assert.equal(latestChat().tracked,undefined);
  assert.match(main(),/已记入画像/);
  await click('customer',{id:c.id});assert.match(modal(),/持续积累的客户画像/);assert.match(modal(),/太太希望一起试驾后决定/);assert.match(modal(),/回到对话/);
  await click('close-modal');await click('vehicle-customer-run',{id:c.id,vehicle:'v3'});
  assert.equal(requests.at(-1).customer.decisionProcess,'太太希望一起试驾后决定');assert.equal(requests.at(-1).customer.need,'需要更大的后排空间');
  assert.ok(requests.at(-1).customer.memories.some(x=>x.evidence==='计划月底购车'));
});

test('画像草稿暂不记录不会改变客户，未选客户不会默认写入第一位客户',async()=>{
  await click('chat-profile');navigate('chat');await sayChat('沟通记录：客户想买家庭车');
  assert.equal(latestChat().customerId,'');assert.equal(latestChat().messages.at(-1).mode,'clarify');
  await listeners.change({target:{id:'cowork-chat-customer',value:'c2',dataset:{}}});navigate('chat');
  const chat=latestChat(),m=chat.messages.at(-1);assert.equal(m.mode,'profile');assert.equal(m.profileProposal.customerId,'c2');
  const before=JSON.stringify(currentState().customers);
  await click('profile-discard',{chat:chat.id,message:m.id});assert.equal(latestChat().messages.at(-1).profileProposal.status,'discarded');assert.equal(JSON.stringify(currentState().customers),before);
});

test('首页首屏与全局导航都有对话入口，普通问答连续保存而不产生交付物',async()=>{
  navigate('home');assert.match(main(),/id="cowork-home-input"/);assert.doesNotMatch(main(),/class="cw-objectives"/);assert.match(main(),/aria-label="主导航"/);
  await click('chat-new');navigate('chat');
  const before=currentState();await sayChat('你好');await sayChat('为什么客户试驾后不回复？');
  assert.equal(latestChat().messages.length,4);assert.equal(latestChat().customerId,'');
  assert.equal(currentState().artifacts.length,before.artifacts.length);assert.equal(currentState().tasks.length,before.tasks.length);
  assert.equal(chatRequests.at(-1).history.length,2);assert.match(chatRequests.at(-1).history[0].content,/你好/);
  assert.match(main(),/为什么客户试驾后不回复/);
});
test('在自然对话中提到唯一客户可带入上下文，讨论海报不会生成海报',async()=>{
  await click('chat-new');navigate('chat');const count=currentState().artifacts.length;
  await sayChat('Sarah 现在最需要解决什么问题？');
  assert.equal(latestChat().customerId,'c1');assert.equal(chatRequests.at(-1).context.customer.id,'c1');
  await sayChat('海报怎么设计？');assert.equal(currentState().artifacts.length,count);
});
test('明确要求成果时在聊天内生成文案和海报，可继续改语言并保留上一版',async()=>{
  const before=currentState().artifacts.length;await sayChat('帮 Sarah 做一张周末体验邀请海报');
  const first=latestChat().messages.at(-1);assert.ok(first.artifactId);assert.ok(first.posterId);
  assert.equal(currentState().artifacts.length,before+2);assert.match(main(),/class="chat-artifact/);assert.equal(location.hash,'#chat');
  await sayChat('换成阿拉伯语，短一点');
  const next=latestChat().messages.at(-1);assert.notEqual(next.artifactId,first.artifactId);
  assert.equal(requests.at(-1).customer.language,'ar');assert.ok(requests.at(-1).previousArtifact);
  assert.ok(currentState().artifacts.some(a=>a.id===first.artifactId));
  assert.equal(currentState().artifacts.find(a=>a.id===next.posterId).language,'ar');
});
test('生成后继续问原因只回答，之后缩短解释也不会误改成果',async()=>{
  const before=currentState().artifacts.length;await sayChat('为什么海报要这样设计？');await sayChat('短一点');
  assert.equal(currentState().artifacts.length,before);assert.equal(latestChat().messages.at(-1).mode,'reply');
});
test('文本活动请求不强制增加海报，客户联系事实不受聊天影响',async()=>{
  const before=currentState(),contact=before.customers.find(c=>c.id==='c1').lastContact;
  await sayChat('帮我写一份活动方案，只要文字，不要海报');
  const m=latestChat().messages.at(-1);assert.ok(m.artifactId);assert.equal(m.posterId,undefined);
  assert.equal(currentState().artifacts.length,before.artifacts.length+1);assert.equal(currentState().customers.find(c=>c.id==='c1').lastContact,contact);
});
test('缺少对象时先问一句，选择客户后继续原请求且不混入另一客户历史',async()=>{
  await click('chat-new');navigate('chat');const before=currentState().tasks.length;
  const conversationId=latestChat().id;
  await sayChat('请制定一份客户转化方案');assert.equal(latestChat().messages.at(-1).mode,'clarify');assert.equal(currentState().tasks.length,before);
  listeners.change({target:{id:'cowork-chat-customer',value:'c3',dataset:{}}});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(latestChat().customerId,'c3');assert.equal(latestChat().id,conversationId);assert.ok(latestChat().messages.at(-1).artifactId);assert.equal(chatRequests.at(-1).history.length,2);assert.doesNotMatch(JSON.stringify(chatRequests.at(-1).history),/Sarah/);
});
test('发送前显示连接原因，检查恢复保留草稿，聊天失败可重试且不重复用户消息',async()=>{
  await click('chat-new');navigate('chat');
  const previousStatus=aiStatus,requestsBefore=chatRequests.length;
  aiStatus={provider:'copilot',ready:false,code:'SDK_NOT_INSTALLED',message:'尚未安装 Copilot SDK'};
  await click('ai-check');assert.match(main(),/缺少 Copilot SDK/);assert.equal(chatRequests.length,requestsBefore);
  listeners.input({target:{id:'cowork-chat-input',value:'还没发出的客户问题',dataset:{}}});
  await click('ai-status');assert.match(modal(),/SDK_NOT_INSTALLED/);assert.match(modal(),/安装项目依赖/);
  aiStatus={provider:'copilot',ready:false,code:'COPILOT_AUTH_REQUIRED',message:'Copilot 尚未登录'};
  await click('ai-check');assert.match(element('#cowork-chat-connection').innerHTML,/Copilot 尚未登录/);assert.match(modal(),/运行 Motive 的账户/);assert.doesNotMatch(modal(),/SDK_NOT_INSTALLED/);
  aiStatus={provider:'copilot',ready:true,code:'READY',message:'Copilot 已连接'};
  await click('ai-check');assert.equal(element('#cowork-chat-connection').innerHTML,'');
  await click('close-modal');navigate('chat');assert.match(main(),/还没发出的客户问题/);
  aiStatus=previousStatus;await click('ai-check');
  failChat=true;await sayChat('你好');
  const failed=latestChat().messages.at(-1);assert.equal(failed.status,'failed');assert.match(failed.content,/尚未安装/);
  failChat=false;await click('chat-retry',{id:failed.id});assert.equal(latestChat().messages.length,2);assert.equal(latestChat().messages.at(-1).status,'done');
});
test('停止聊天丢弃迟到的回复，输入中的下一条草稿保留',async()=>{
  let release;holdChat=new Promise(resolve=>{release=resolve;});
  const operation=sayChat('你好');await new Promise(resolve=>setImmediate(resolve));
  listeners.input({target:{id:'cowork-chat-input',value:'还想问一个问题',dataset:{}}});
  await click('chat-stop');release();await operation;holdChat=null;
  assert.equal(latestChat().messages.at(-1).status,'cancelled');assert.match(main(),/还想问一个问题/);
});
test('聊天生成成果时也能停止，不保存迟到的成果',async()=>{
  await click('chat-new');navigate('chat');let release;holdGeneration=new Promise(resolve=>{release=resolve;});
  const before=currentState().artifacts.length,operation=sayChat('帮 Sarah 制定客户转化方案');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(latestChat().messages.at(-1).status,'creating');await click('chat-stop');release();await operation;holdGeneration=null;
  assert.equal(latestChat().messages.at(-1).status,'cancelled');assert.equal(currentState().artifacts.length,before);
});
test('聊天等待中客户资料变化，原结果不继续生成旧材料',async()=>{
  await click('chat-new');navigate('chat');let release;holdChat=new Promise(resolve=>{release=resolve;});
  const operation=sayChat('帮 Sarah 写一段跟进话术');await new Promise(resolve=>setImmediate(resolve));
  await submit('memory-form',{memory:'新确认：下周才能联系，请重新安排。'},{id:'c1'});
  const before=currentState().tasks.length;release();await operation;holdChat=null;
  assert.equal(latestChat().messages.at(-1).status,'stale');assert.equal(currentState().tasks.length,before);
});
test('对话提到另一位明确客户时开启独立上下文，不混合原客户历史',async()=>{
  const old=latestChat().id;await sayChat('Marcus 现在有什么顾虑？');
  assert.notEqual(latestChat().id,old);assert.equal(latestChat().customerId,'c3');assert.equal(chatRequests.at(-1).history.length,0);assert.equal(chatRequests.at(-1).context.customer.id,'c3');
});
test('讨论修订时原海报被人工编辑，不覆盖员工刚改好的版本',async()=>{
  await sayChat('帮 Marcus 做一张海报');const first=latestChat().messages.at(-1);
  let release;holdChat=new Promise(resolve=>{release=resolve;});
  const operation=sayChat('把海报标题改短一点');await new Promise(resolve=>setImmediate(resolve));
  await click('artifact',{id:first.posterId});const p=currentState().artifacts.find(a=>a.id===first.posterId);
  element('#poster-form').values={...p.poster,headline:'Employee verified headline'};await click('poster-save');await click('close-modal');
  const before=currentState().artifacts.length;release();await operation;holdChat=null;
  assert.equal(latestChat().messages.at(-1).status,'stale');assert.equal(currentState().artifacts.length,before);
  assert.equal(currentState().artifacts.find(a=>a.id===first.posterId).poster.headline,'Employee verified headline');
});

test('短话术直接回复，保存为素材不新增任务，用户可再加入工作台',async()=>{
  await click('chat-new');navigate('chat');const before=currentState();
  await sayChat('帮 Sarah 写一句英文跟进话术');
  const m=latestChat().messages.at(-1);assert.equal(m.mode,'reply');assert.match(m.content,/Hi Sarah/);
  assert.equal(currentState().tasks.length,before.tasks.length);assert.equal(currentState().artifacts.length,before.artifacts.length);
  await click('chat-save',{id:m.id});assert.equal(currentState().artifacts.length,before.artifacts.length+1);assert.equal(currentState().tasks.length,before.tasks.length);
  await click('chat-save',{id:m.id});assert.equal(currentState().artifacts.length,before.artifacts.length+1);
  await click('chat-track');assert.equal(latestChat().tracked,true);navigate('desk');assert.match(main(),/帮 Sarah 写一句/);
});

test('新建门店任务可选择市场，同一对话保留目标、成果和完成状态',async()=>{
  await click('ux-task-new',{template:'为门店制定家庭 SUV 营销方案'});navigate('chat');
  assert.equal(latestChat().tracked,true);assert.match(main(),/为门店制定家庭 SUV/);
  listeners.change({target:{id:'cowork-chat-customer',value:'store:US',dataset:{}}});
  await sayChat('为门店制定家庭 SUV 营销方案，只要文字不要海报');
  const chat=latestChat(),m=chat.messages.at(-1);assert.ok(m.artifactId);assert.equal(chat.customerId,'store:US');
  assert.equal(requests.at(-1).scope,'store');assert.equal(currentState().artifacts.find(a=>a.id===m.artifactId).customerId,'store:US');
  await click('chat-details');assert.match(main(),/本次成果/);assert.match(main(),/管理资料与连接/);
  await click('chat-complete');assert.ok(latestChat().completedAt);await click('chat-complete');assert.equal(latestChat().completedAt,undefined);
  navigate('desk');assert.match(main(),/家庭 SUV 营销方案/);
});

test('本地查客户返回可接续卡片，不调用模型、不产生任务',async()=>{
  await click('chat-new');navigate('chat');const count=chatRequests.length,before=currentState().tasks.length;
  await sayChat('查找客户 RAV4');const m=latestChat().messages.at(-1);
  assert.equal(chatRequests.length,count);assert.equal(currentState().tasks.length,before);assert.equal(m.engine,'records');assert.ok(m.customerIds.includes('c3'));
  await click('chat-plan-customer',{id:'c3'});navigate('chat');assert.equal(latestChat().customerId,'c3');assert.equal(latestChat().tracked,true);
});

test('连接器保存的是接入需求，不能显示为已连接',async()=>{
  navigate('connections');await click('ux-connector',{id:'toyota'});assert.match(modal(),/尚未连接/);
  await submit('ux-connector-form',{system:'Dealer CRM',scope:'US 门店 001 的客户资料'},{id:'toyota'});navigate('connections');
  assert.equal(currentState().connectionRequests.find(r=>r.id==='toyota').system,'Dealer CRM');
  assert.match(main(),/接入需求已保存/);assert.match(main(),/当前没有已连接的外部业务系统/);
});

test('新线索使用电话和已有信息建档，并进入对应客户的 Cowork 任务',async()=>{
  const before=currentState();navigate('customers');assert.match(main(),/新增销售线索/);
  await click('ux-lead');assert.match(modal(),/电话号码/);assert.doesNotMatch(modal(),/预算下限/);
  await submit('ux-lead-form',{name:'Jamie Dealer',contact:'+1 202 555 0174',market:'US',need:'官网咨询家庭 SUV，总费用待确认。',source:'官网线索'});navigate(location.hash.slice(1));
  const c=currentState().customers.find(c=>c.name==='Jamie Dealer'),chat=latestChat();
  assert.equal(c.budgetUnknown,true);assert.equal(c.intentUnknown,true);assert.equal(c.source,'官网线索');assert.equal(chat.customerId,c.id);assert.equal(chat.tracked,true);
  assert.equal(currentState().tasks.length,before.tasks.length);assert.match(main(),/首次沟通内容/);
  await submit('ux-lead-form',{name:'Duplicate',contact:'12025550174',market:'US',need:'',source:''});assert.equal(currentState().customers.length,before.customers.length+1);
});

test('任务动作可分配、从待办回报结果、记录客户反馈并在原对话继续',async()=>{
  const chatId=latestChat().id,cid=latestChat().customerId;
  await click('flow-action',{id:chatId});assert.match(modal(),/完成后需要带回什么结果/);
  await submit('flow-action-form',{title:'致电确认预算与车型',owner:'Alex Chen',expected:'总预算、购车时间和家庭成员',dueAt:'2026-09-20T10:00'},{id:chatId});
  const action=latestChat().actions[0];navigate('desk');assert.match(main(),/致电确认预算与车型/);
  await click('chat-select',{id:chatId});navigate(location.hash.slice(1));await click('chat-complete');assert.equal(latestChat().completedAt,undefined);
  navigate('inbox');assert.match(main(),/总预算、购车时间和家庭成员/);
  await click('flow-result',{id:chatId,actionId:action.id});await submit('flow-result-form',{result:'已接通，客户希望先比较家庭 SUV。'},{id:chatId,actionId:action.id});
  assert.equal(latestChat().actions[0].status,'done');assert.equal(currentState().customers.find(c=>c.id===cid).lastContact,null);
  await click('chat-select',{id:chatId});navigate(location.hash.slice(1));assert.match(main(),/已接通，客户希望先比较/);
  await click('flow-feedback',{id:chatId});await submit('flow-feedback-form',{type:'need',text:'需要容纳两个儿童座椅，优先后排空间。',source:'电话 · Alex',occurredAt:'2026-09-01T10:00',contacted:'on'},{id:chatId});navigate(location.hash.slice(1));
  assert.equal(latestChat().id,chatId);assert.match(currentState().customers.find(c=>c.id===cid).need,/儿童座椅/);assert.match(main(),/请根据刚记录的客户反馈调整方案/);
  assert.equal(latestChat().messages.at(-1).event,'feedback');
});

test('资料选择真实影响对话和成果请求，任务、搜索和成果都能回到同一对话',async()=>{
  const id=latestChat().id;
  listeners.change({target:{id:'',dataset:{chatSource:'knowledge'},checked:false}});
  listeners.change({target:{id:'',dataset:{chatSource:'vehicles'},checked:false}});
  await sayChat('请制定一份客户转化方案');assert.equal(chatRequests.at(-1).context.knowledge.length,0);assert.equal(chatRequests.at(-1).context.vehicles.length,0);
  assert.equal(requests.at(-1).knowledge.length,0);assert.equal(requests.at(-1).vehicles.length,0);assert.match(requests.at(-1).workflow.goal,/转化/);
  const artifact=latestChat().messages.at(-1).artifactId;await click('artifact',{id:artifact});assert.match(modal(),/回到原对话/);
  await click('chat-new');navigate('chat');navigate('chat?conversation='+id);assert.match(main(),/儿童座椅/);
  await click('search');listeners.input({target:{dataset:{input:'global-search'},value:'转化'}});assert.match(element('#global-results').innerHTML,/data-act="chat-select"/);
});

test('旧成果准备记录进入 Cowork，反复打开不会创建重复任务',async()=>{
  const old=currentState().tasks.find(t=>!t.conversationId&&!t.workId),before=currentState().conversations.length;
  assert.ok(old);await click('select-task',{id:old.id});navigate(location.hash.slice(1));
  assert.equal(currentState().conversations.length,before+1);assert.match(main(),/Cowork/);assert.match(main(),/AI 协作/);
  const linked=currentState().tasks.find(t=>t.id===old.id).conversationId;assert.ok(linked);
  await click('select-task',{id:old.id});assert.equal(currentState().conversations.length,before+1);assert.equal(location.hash,'#chat?conversation='+linked);
});
