import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {seedState} from '../data.js';
import {initializeCowork} from '../cowork.js';
import {PRIMARY_NAV,CRM_TEMPLATE,initializeWorkspace,storeSubject,parseCSV,previewCRMImport,importCRMRecords,searchCustomerRecords,customerLookup,workspaceItems,conversationStatus} from '../workspace-model.js';
import {normalizeRequest,draftStoreArtifact} from '../server/protocol.js';
import {normalizeChatRequest,demoChatReply,parseChatReply} from '../server/chat.js';
import {createApplication,configFromEnv} from '../server/http.js';

function state(){const s=initializeCowork(seedState());initializeWorkspace(s);return s;}
const customerContext=s=>({kind:'followup',prompt:'测试',customer:s.customers[0],vehicles:s.vehicles,knowledge:s.knowledge,workspaceName:s.settings.name});
const storeContext=(s,market='US')=>({scope:'store',...customerContext(s),customer:storeSubject(s,market)});

test('AI 协作统一 Cowork 对话，客户画像和两类业务工作台均可直接进入',()=>{
  assert.deepEqual(PRIMARY_NAV.map(n=>n.label),['AI 协作','工作台','客户与画像','车源与方案','营销活动','资料与连接']);
  const routes=PRIMARY_NAV.flatMap(n=>n.pages);assert.equal(new Set(routes).size,routes.length);
  assert.ok(PRIMARY_NAV.find(n=>n.id==='desk').pages.includes('automations'));
  assert.ok(PRIMARY_NAV.find(n=>n.id==='inventory').pages.includes('inventory'));
  assert.ok(PRIMARY_NAV.find(n=>n.id==='campaigns').pages.includes('campaigns'));
});
test('简短话术与问答不产生任务，单张海报是素材，经营方案才是任务',()=>{
  const context=customerContext(state());
  for(const message of ['帮 Sarah 写一句英文跟进话术','写一段客户回复','海报怎么设计？','为什么客户会犹豫？']){
    const r=demoChatReply(normalizeChatRequest({message,context}));assert.equal(r.mode,'reply',message);assert.equal(r.artifactRequest,null);
  }
  const generic=demoChatReply(normalizeChatRequest({message:'帮我写一句通用跟进话术'}));assert.equal(generic.mode,'reply');
  assert.equal(demoChatReply(normalizeChatRequest({message:'帮 Sarah 做一张海报',context})).artifactRequest.delivery,'asset');
  for(const message of ['请制定客户转化计划','帮我写一份营销方案','请准备沉睡客户经营计划'])assert.equal(demoChatReply(normalizeChatRequest({message,context})).artifactRequest.delivery,'task');
});
test('门店营销可以选市场，不借用任意客户；跨市场车源保持隔离',()=>{
  const s=state(),context=storeContext(s,'GB');
  const r=normalizeChatRequest({message:'为门店制定营销方案',context});
  assert.equal(r.context.scope,'store');assert.equal(r.context.customer.id,'store:GB');assert.equal(r.context.customer.name,s.settings.name);
  assert.ok(r.context.vehicles.every(v=>v.market==='GB'));assert.equal(r.context.customer.memories.length,0);
  const reply=demoChatReply(r);assert.equal(reply.mode,'artifact');assert.equal(reply.artifactRequest.delivery,'task');
  const a=draftStoreArtifact(normalizeRequest({...context,kind:'campaign',needsPoster:false}));
  assert.equal(a.customerId,'store:GB');assert.doesNotMatch(JSON.stringify(a),/Sarah|Marcus|USD/);assert.ok(!a.posterBrief);
  assert.throws(()=>normalizeRequest({...context,customer:s.customers[0]}),/有效的市场/);
  assert.throws(()=>storeSubject(s,'all'),/具体市场/);
});
test('模型任务分类不能携带发送权限，未知分类被拒绝',()=>{
  const r=normalizeChatRequest({message:'制定营销方案',context:storeContext(state())});
  const a={kind:'campaign',prompt:'制定营销方案',needsPoster:false,revision:false,language:'en',delivery:'task',send:true};
  const response=parseChatReply(JSON.stringify({mode:'artifact',reply:'开始准备',artifactRequest:a}),r);
  assert.equal(response.artifactRequest.delivery,'task');assert.equal(response.artifactRequest.send,undefined);
  assert.throws(()=>parseChatReply(JSON.stringify({mode:'artifact',reply:'开始',artifactRequest:{...a,delivery:'send'}}),r));
});
test('门店海报演示文案使用所选市场语言，阿语素材保持 RTL',()=>{
  const r=normalizeRequest({...storeContext(state(),'AE'),kind:'campaign',needsPoster:true});
  const a=draftStoreArtifact(r);assert.match(a.posterBrief.headline,/[\u0600-\u06ff]/);assert.equal(a.sections.find(s=>s.audience==='customer').dir,'rtl');
});
test('CSV 支持 BOM、引号、逗号和换行，拒绝缺失字段或不完整文件',()=>{
  const text='\uFEFF"name",phone,market,need\r\n"Jamie, Demo",+1 202-555-0199,US,"需要后排空间\n考虑置换"';
  const r=parseCSV(text);assert.equal(r[0].name,'Jamie, Demo');assert.match(r[0].need,/\n考虑置换/);
  assert.throws(()=>parseCSV('name,market\nA,US'),/缺少字段/);
  assert.throws(()=>parseCSV('name,phone,market\n"A,+1,US'),/未闭合/);
  assert.throws(()=>parseCSV('name,phone,market\nA,+1'),/字段数量/);
  assert.throws(()=>parseCSV('name,phone,market\n'+Array(501).fill('A,+1 202-555-0199,US').join('\n')),/500/);
});
test('CRM 导入保留来源，未知预算与意向不推断，联系许可不默认开启',()=>{
  const s=state(),p=previewCRMImport(s,CRM_TEMPLATE),source=importCRMRecords(s,p,{name:'toyota-store-export.csv'});
  assert.equal(source.count,1);const c=s.customers.at(-1);
  assert.equal(c.name,'Jamie Demo');assert.equal(c.dataSource.recordId,'DEMO-001');assert.equal(c.dataSource.name,'toyota-store-export.csv');
  assert.equal(c.budgetUnknown,true);assert.equal(c.intentUnknown,true);assert.deepEqual(c.consent,{Email:false,WhatsApp:false});assert.equal(c.lastContact,null);
  const request=normalizeRequest({...customerContext(s),customer:c});assert.equal(request.customer.dataSource.name,'toyota-store-export.csv');
  assert.equal(request.customer.contact,undefined);assert.equal(request.customer.email,undefined);
});
test('重复客户和非法日期不会悄悄覆盖已有记录或变成新客户',()=>{
  const s=state();const once=previewCRMImport(s,CRM_TEMPLATE);importCRMRecords(s,once);const count=s.customers.length;
  const again=previewCRMImport(s,CRM_TEMPLATE);assert.equal(again.valid.length,0);assert.equal(again.duplicates.length,1);assert.throws(()=>importCRMRecords(s,again));assert.equal(s.customers.length,count);
  for(const row of ['A,+1 202-555-0198,US,not-a-date,false','B,+1 202-555-0198,US,2099-01-01,false','C,+1 202-555-0198,US,,yes']){
    const p=previewCRMImport(s,'name,phone,market,last_contact,consent_email\n'+row);assert.equal(p.errors.length,1);assert.throws(()=>importCRMRecords(s,p));
  }
});
test('内部客户查询支持电话与车型，沉睡线索排除从未联系者',()=>{
  const s=state();assert.equal(searchCustomerRecords(s,'12135550117')[0].name,'Marcus Reed');
  assert.ok(searchCustomerRecords(s,'RAV4').some(c=>c.id==='c3'));
  assert.ok(searchCustomerRecords(s,'RAV4',{market:'AE'}).length===0);
  s.customers[0].lastContact=null;const found=searchCustomerRecords(s,'',{dormant:true});assert.ok(!found.some(c=>c.id==='c1'));assert.ok(found.every(c=>c.lastContact));
  assert.deepEqual(customerLookup('查找客户 RAV4'),{query:'RAV4',dormant:false});assert.equal(customerLookup('帮我写一句话术'),null);
});
test('任务列表合并对话与生成过程，不把普通问答和未启动客户画像显示为任务',()=>{
  const s=state();s.conversations=[{id:'ordinary',messages:[],title:'问答'},{id:'project',tracked:true,messages:[{status:'done',artifactId:'a'}],title:'营销方案'}];
  s.tasks=[{id:'run',conversationId:'project',title:'生成一次',status:'review'}];
  assert.equal(workspaceItems(s).length,1);assert.equal(workspaceItems(s)[0].key,'project');
  s.works[0].activated=true;assert.equal(workspaceItems(s).length,2);
  assert.equal(conversationStatus({messages:[{status:'failed'}]}).id,'blocked');
  assert.equal(conversationStatus({messages:[],completedAt:'2026-09-13'}).id,'done');
});
test('实际服务支持新的静态资源与门店范围的生成协议',async t=>{
  const server=createApplication({config:configFromEnv({AI_PROVIDER:'demo'}),generator:{}});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const path of ['/workspace-model.js','/workspace-ui.js','/task-flow.js','/task-ui.js','/customer-profile.js','/profile-ui.js','/ux.css'])assert.equal((await fetch(base+path)).status,200,path);
  const r=await fetch(base+'/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...storeContext(state()),kind:'campaign',needsPoster:false,prompt:'制定家庭 SUV 营销方案'})});
  assert.equal(r.status,200);const body=await r.json();assert.equal(body.artifact.scope,'store');assert.equal(body.artifact.customerId,'store:US');assert.doesNotMatch(JSON.stringify(body.artifact),/Sarah|Marcus/);
});
