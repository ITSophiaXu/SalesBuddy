import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {seedState} from '../data.js';
import {normalizeRequest,parseArtifact} from '../server/protocol.js';
import {normalizeChatRequest,demoChatReply,parseChatReply} from '../server/chat.js';
import {createApplication,configFromEnv} from '../server/http.js';
import {draftComparisonArtifact,normalizeComparison,inferComparison,renderVehicleComparison,exportComparisonHTML} from '../vehicle-comparison.js';

function context(){const s=seedState();return {kind:'comparison',prompt:'比较车型',customer:s.customers[0],vehicles:s.vehicles,knowledge:s.knowledge,comparison:{vehicleIds:['v1','v2'],focus:['space','budget','charging']}};}

test('车型对比限定同市场的明确车型，缺失车型先澄清，重点按用户顺序保留',()=>{
  const r=normalizeRequest(context());assert.deepEqual(r.comparison.vehicleIds,['v1','v2']);assert.equal(r.vehicles.find(v=>v.id==='v1').energy,'纯电');
  for(const vehicleIds of [['v1'],['v1','v1'],['v1','v4'],['missing','v1']])assert.throws(()=>normalizeRequest({...context(),comparison:{...r.comparison,vehicleIds}}));
  assert.throws(()=>normalizeComparison({vehicleIds:['v1','v2'],focus:['score']},r.vehicles));
  const spec=inferComparison('把用车成本放在最前面，其它重点保留',r.vehicles,r.comparison);assert.deepEqual(spec.focus,['cost','space','budget','charging']);assert.deepEqual(spec.vehicleIds,['v1','v2']);
  assert.deepEqual(inferComparison('加入 Kia EV6',r.vehicles,r.comparison).vehicleIds,['v1','v2','v3']);
  const unclear=demoChatReply(normalizeChatRequest({message:'请生成车型对比方案',context:context()}));assert.equal(unclear.mode,'clarify');assert.equal(unclear.artifactRequest,null);
});

test('自然对话识别图文车型对比任务，SDK 返回的车型必须存在于当前市场',()=>{
  const request=normalizeChatRequest({message:'比较 Tesla Model Y 和 Toyota RAV4 Hybrid，侧重家庭空间和购车预算，生成车型对比方案',context:context()});
  const demo=demoChatReply(request);assert.equal(demo.artifactRequest.kind,'comparison');assert.equal(demo.artifactRequest.delivery,'task');assert.deepEqual(demo.artifactRequest.comparison.vehicleIds,['v1','v2']);assert.deepEqual(demo.artifactRequest.comparison.focus,['space','budget']);
  const parsed=parseChatReply(JSON.stringify({...demo,artifactRequest:{...demo.artifactRequest,needsPoster:true}}),request);assert.equal(parsed.artifactRequest.needsPoster,false);
  const invalid=parseChatReply(JSON.stringify({...demo,artifactRequest:{...demo.artifactRequest,comparison:{vehicleIds:['v1','v4'],focus:['space']}}}),request);assert.equal(invalid.mode,'clarify');
});

test('模型车型对比必须覆盖每个选中车型，数据表取自输入快照而非模型捏造参数',()=>{
  const request=normalizeRequest(context()),draft=draftComparisonArtifact(request);
  const model={title:'家庭选车对比',sections:draft.sections.map(s=>({...s,text:s.label==='summary'?'Start with your charging options.':s.text})),comparison:{vehicles:[{id:'v1',price:1}]}};
  const artifact=parseArtifact(JSON.stringify(model),request,'stub');assert.equal(artifact.format,'comparison');assert.equal(artifact.engine,'copilot');assert.equal(artifact.comparison.vehicles[0].price,49990);
  assert.equal(artifact.sections[0].text,'Start with your charging options.');
  assert.throws(()=>parseArtifact(JSON.stringify({...model,sections:model.sections.filter(s=>s.label!=='vehicle:v2')}),request));
  assert.throws(()=>parseArtifact(JSON.stringify({...model,sections:model.sections.map(s=>s.label==='vehicle:v2'?{...s,audience:'internal'}:s)}),request));
});

test('图文结果与客户导出包含示意、价格和重点，不包含内部审核内容或可执行文本',()=>{
  const a=draftComparisonArtifact(normalizeRequest(context()));
  a.sections.find(s=>s.audience==='internal').text='INTERNAL_ONLY_CONTACT_PRIVATE';
  a.sections.find(s=>s.label==='summary').text='<script>alert("x")</script>';
  a.comparison.vehicles[0].name='<img src=x onerror=alert(1)>';
  const html=exportComparisonHTML(a),render=renderVehicleComparison(a);
  assert.equal((render.match(/<svg /g)||[]).length,2);assert.match(render,/<table>/);assert.match(html,/@media print/);assert.match(html,/49,990/);assert.match(html,/37,950/);
  assert.doesNotMatch(html,/<script>|<img |INTERNAL_ONLY_CONTACT_PRIVATE/);assert.match(html,/&lt;script&gt;/);assert.match(html,/not a vehicle photograph/);assert.match(html,/No live dealer data/);
  assert.ok(html.indexOf('Family space')<html.indexOf('Purchase budget'));
});

test('真实 HTTP 演示接口交付结构化车型对比，新增前端模块可加载',async t=>{
  const server=createApplication({config:configFromEnv({AI_PROVIDER:'demo'}),generator:{}});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const res=await fetch(base+'/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(context())});assert.equal(res.status,200);
  const {artifact}=await res.json();assert.equal(artifact.format,'comparison');assert.equal(artifact.engine,'demo');assert.equal(artifact.comparison.vehicles.length,2);
  for(const path of ['/workbench-ui.js','/artifact-workbench.js','/vehicle-comparison.js'])assert.equal((await fetch(base+path)).status,200);
});
