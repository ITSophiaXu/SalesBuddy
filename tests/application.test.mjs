import test from 'node:test';
import assert from 'node:assert/strict';
import {draftArtifact} from '../domain.js';

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
globalThis.fetch=async(url,options={})=>{
  if(url==='/api/status')return Response.json({provider:'demo',ready:true,model:'Test fixture',message:'Test fixture'});
  if(url!=='/api/generate')throw new Error('Unexpected request');
  const r=JSON.parse(options.body);requests.push(r);
  if(holdGeneration)await holdGeneration;
  if(failGeneration)return Response.json({error:{code:'GENERATION_FAILED',message:'测试模型服务不可用'}},{status:502});
  const artifact=draftArtifact(r.kind,r.customer,r.vehicles,r.prompt,r.knowledge,{preferredVehicleId:r.preferredVehicleId,campaign:r.campaign,workspaceName:r.workspaceName,workflow:r.workflow,businessContext:r.businessContext,needsPoster:r.needsPoster});
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
  for (const page of ['home','work','inbox','workspace','customers','inventory','campaigns','automations','deliverables','knowledge','settings']) {
    navigate(page);
    assert.match(main(), /<main class="main">/);
    assert.doesNotMatch(main(), />NaN</);
    assert.ok(main().length > 6000, `${page} renders content`);
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
  assert.match(element('#global-results').innerHTML,/交付物/);
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
  const s=currentState(),task=s.tasks[0],poster=s.artifacts.find(a=>a.id===task.posterId);
  assert.equal(poster.parentArtifactId,task.artifactId);assert.equal(poster.campaignId,campaign.id);
  assert.equal(poster.poster.headline,'Room for what matters.');assert.match(main(),/查看海报/);
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
  await click('cw-activity',{id});assert.ok(currentState().works.find(w=>w.id===id).decisions.activity);
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
  await click('cw-quick-lead');assert.match(modal(),/仅凭联系方式/);
  await submit('cw-lead-form',{name:'',contact:'new-qa@example.com',market:'GB',channel:'Email',need:''});
  const c=currentState().customers.find(c=>c.email==='new-qa@example.com');assert.equal(c.budgetUnknown,true);assert.equal(c.city,'城市待确认');
  assert.equal(currentState().visitSlots.some(s=>s.city==='城市待确认'),false);
  navigate('work');assert.match(main(),/补齐需求/);
});
