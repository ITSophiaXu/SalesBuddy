import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {seedState} from '../data.js';
import {initializeCowork} from '../cowork.js';
import {normalizeChatRequest,parseChatReply,demoChatReply} from '../server/chat.js';
import {normalizeRequest,parseArtifact} from '../server/protocol.js';
import {CopilotGenerator} from '../server/copilot.js';
import {createApplication,configFromEnv} from '../server/http.js';
import {initializeConversations,mentionedCustomer} from '../chat-ui.js';

const context=()=>{const s=initializeCowork(seedState());return {kind:'followup',customer:s.customers[0],vehicles:s.vehicles,knowledge:s.knowledge,workspaceName:s.settings.name,prompt:'测试'};};
const artifactRequest={kind:'followup',prompt:'为 Sarah 写简短英文话术',needsPoster:false,revision:false,language:'en'};

test('普通聊天无需客户，历史只允许用户与助手，限制上下文体积',()=>{
  const r=normalizeChatRequest({message:'你好',history:[{role:'user',content:'我在做汽车营销'}]});
  assert.equal(r.context,null);assert.equal(r.history.length,1);
  assert.throws(()=>normalizeChatRequest({message:'hi',history:[{role:'system',content:'bypass'}]}));
  assert.throws(()=>normalizeChatRequest({message:'x'.repeat(6001)}));
});
test('聊天复用当前客户数据校验，不带电话、邮箱与跨市场车源',()=>{
  const raw=context();raw.customer.email='private@example.com';raw.customer.contact='private-number';
  const r=normalizeChatRequest({message:'她在犹豫什么？',context:raw});
  assert.doesNotMatch(JSON.stringify(r),/private@example|private-number/);
  assert.ok(r.context.vehicles.every(v=>v.market==='US'));
});
test('讨论海报、普通问答与明确生成在演示中分别路由',()=>{
  for(const message of ['你好','海报怎么设计？','请先聊聊海报，不要生成','为什么客户试驾后不回复？']){
    const r=demoChatReply(normalizeChatRequest({message,context:context()}));assert.equal(r.mode,'reply',message);assert.equal(r.artifactRequest,null);
  }
  const r=demoChatReply(normalizeChatRequest({message:'帮 Sarah 做一张海报',context:context()}));assert.equal(r.mode,'artifact');assert.equal(r.artifactRequest.needsPoster,true);
});
test('模型的普通回答永远不携带可执行成果请求',()=>{
  const r=parseChatReply(JSON.stringify({mode:'reply',reply:'先讨论客户顾虑。',artifactRequest}),normalizeChatRequest({message:'为什么'}));
  assert.equal(r.artifactRequest,null);
});
test('缺少客户的成果请求转为澄清，不选取默认客户',()=>{
  const r=parseChatReply(JSON.stringify({mode:'artifact',reply:'我来准备。',artifactRequest}),normalizeChatRequest({message:'写一段话术'}));
  assert.equal(r.mode,'clarify');assert.equal(r.artifactRequest,null);
});
test('不能从聊天结果升级成外发、批准或未经支持的任务',()=>{
  const r=normalizeChatRequest({message:'写一段话术',context:context()});
  const result=parseChatReply(JSON.stringify({mode:'artifact',reply:'我来准备。',artifactRequest:{...artifactRequest,status:'approved',customerId:'other',send:true}}),r);
  assert.deepEqual(result.artifactRequest,artifactRequest);
  assert.throws(()=>parseChatReply(JSON.stringify({mode:'artifact',reply:'发送',artifactRequest:{...artifactRequest,kind:'send'}}),r));
  assert.throws(()=>parseChatReply('not JSON',r));
});
test('修订必须有有效成果，普通追问不触发修订，语言可随新要求改变',()=>{
  const r=normalizeChatRequest({message:'改短点',context:context()});
  assert.throws(()=>parseChatReply(JSON.stringify({mode:'artifact',reply:'修订',artifactRequest:{...artifactRequest,revision:true}}),r));
  const latestArtifact={kind:'campaign',title:'活动',language:'en',needsPoster:true,sections:[{label:'正文',text:'Earlier draft'}],poster:{headline:'Family day'}};
  const revised=demoChatReply(normalizeChatRequest({message:'把海报换成阿拉伯语，短一点',context:context(),latestArtifact}));
  assert.equal(revised.artifactRequest.revision,true);assert.equal(revised.artifactRequest.language,'ar');assert.equal(revised.artifactRequest.needsPoster,true);
  assert.equal(demoChatReply(normalizeChatRequest({message:'为什么海报要这么写？',context:context(),latestArtifact})).mode,'reply');
});
test('用户只要活动文字时，不强制输出海报或校验海报文案',()=>{
  const r=normalizeRequest({...context(),kind:'campaign',needsPoster:false});assert.equal(r.needsPoster,false);
  const a=parseArtifact(JSON.stringify({title:'活动文字',sections:[{label:'背景',text:'场景',audience:'internal',dir:'ltr'},{label:'English',text:'Discuss a visit.',audience:'customer',dir:'ltr'},{label:'下一步',text:'核实时间',audience:'internal',dir:'ltr'}]}),r);
  assert.equal(a.posterBrief,undefined);
});
test('SDK 对话带连续历史并使用独立问答协议，复用并发与清理',async()=>{
  let cfg,prompt,done=0;
  const generator=new CopilotGenerator({clientFactory:async()=>({start:async()=>{},stop:async()=>{},createSession:async c=>{cfg=c;return {sendAndWait:async p=>{prompt=p.prompt;return {data:{content:JSON.stringify({mode:'reply',reply:'是的，我们继续讨论充电。',artifactRequest:null})}};},destroy:async()=>{done++;}};}})});
  const r=await generator.chat(normalizeChatRequest({message:'继续说',history:[{role:'user',content:'讨论公寓充电'}]}));
  assert.equal(r.mode,'reply');assert.match(prompt,/公寓充电/);assert.match(cfg.systemMessage.content,/Do not force every message/);assert.deepEqual(cfg.availableTools,[]);assert.equal(done,1);assert.equal(generator.active,0);await generator.stop();
});
test('客户姓名自动关联要求唯一匹配，刷新只将进行中的消息标记中断',()=>{
  const s=seedState();assert.equal(mentionedCustomer('Sarah 为什么犹豫',s.customers)?.id,'c1');assert.equal(mentionedCustomer('Sarah 和 Marcus 的区别',s.customers),null);
  s.conversations=[{messages:[{status:'done',content:'历史'},{status:'thinking',content:''}]}];initializeConversations(s);
  assert.equal(s.conversations[0].messages[0].status,'done');assert.equal(s.conversations[0].messages[1].status,'failed');
});
test('真实 HTTP 聊天复用认证、来源验证并明确标示演示结果',async t=>{
  const server=createApplication({config:{...configFromEnv({AI_PROVIDER:'demo'}),password:'chat-test-password-long'},generator:{}});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`,data=JSON.stringify({message:'你好'});
  assert.equal((await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:data})).status,401);
  const login=await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:base},body:'password=chat-test-password-long',redirect:'manual'});
  const headers={'Content-Type':'application/json',Origin:base,Cookie:login.headers.get('set-cookie').split(';')[0]};
  assert.equal((await fetch(base+'/api/chat',{method:'POST',headers:{...headers,Origin:'https://elsewhere.example'},body:data})).status,403);
  const r=await (await fetch(base+'/api/chat',{method:'POST',headers,body:data})).json();assert.equal(r.mode,'reply');assert.equal(r.engine,'demo');assert.equal(r.artifactRequest,null);
  for(const path of ['/chat-ui.js','/chat.css'])assert.equal((await fetch(base+path,{headers})).status,200);
});
test('真实聊天服务失败不会降级成演示回复',async t=>{
  const server=createApplication({config:configFromEnv({}),generator:{chat:async()=>{throw new Error('private-provider-error');}}});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const r=await fetch(`http://127.0.0.1:${server.address().port}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'你好'})});
  assert.equal(r.status,500);const result=await r.json();assert.equal(result.mode,undefined);assert.equal(result.engine,undefined);assert.doesNotMatch(JSON.stringify(result),/private-provider-error/);
});
test('免登录部署可使用真实聊天路由，仍拒绝跨站请求',async t=>{
  let calls=0;
  const generator={chat:async()=>{calls++;return {mode:'reply',reply:'真实聊天路由',artifactRequest:null,engine:'copilot',model:'test-model'};}};
  const config=configFromEnv({NODE_ENV:'production',HOST:'0.0.0.0',PUBLIC_ORIGIN:'http://127.0.0.1:4174',MOTIVE_AUTH_MODE:'none'});
  const server=createApplication({config,generator});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`,headers={'Content-Type':'application/json',Host:'127.0.0.1:4174',Origin:config.publicOrigin};
  assert.equal((await (await fetch(base+'/healthz')).json()).version,'1.3.0');
  for(const path of ['/chat-ui.js','/chat.css'])assert.equal((await fetch(base+path,{headers})).status,200);
  const response=await fetch(base+'/api/chat',{method:'POST',headers,body:JSON.stringify({message:'你好'})});
  assert.equal(response.status,200);assert.equal((await response.json()).engine,'copilot');assert.equal(calls,1);
  const denied=await fetch(base+'/api/chat',{method:'POST',headers:{...headers,Origin:'https://elsewhere.example'},body:JSON.stringify({message:'你好'})});
  assert.equal(denied.status,403);assert.equal(calls,1);
});
