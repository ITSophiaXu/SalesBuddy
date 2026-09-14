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
import {sendChatMessage,generateAIArtifact} from '../ai-client.js';

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
  assert.deepEqual(result.artifactRequest,{...artifactRequest,delivery:'asset'});
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
  const generator=new CopilotGenerator({clientFactory:async()=>({start:async()=>{},stop:async()=>{},createSession:async c=>{cfg=c;return {sendAndWait:async p=>{prompt=p.prompt;return {data:{content:JSON.stringify({mode:'reply',reply:'是的，我们继续讨论充电。',artifactRequest:null})}};},disconnect:async()=>{done++;}};}})});
  const r=await generator.chat(normalizeChatRequest({message:'继续说',history:[{role:'user',content:'讨论公寓充电'}]}));
  assert.equal(r.mode,'reply');assert.match(prompt,/公寓充电/);assert.match(cfg.systemMessage.content,/Do not force every message/);assert.deepEqual(cfg.availableTools,[]);assert.equal(done,1);assert.equal(generator.active,0);await generator.stop();
});
test('SDK 画像模式仍逐步流式返回顶层公开回复，私有字段与子代理消息不转发',async t=>{
  let release,started;const gate=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{started=resolve;});
  t.after(()=>release());
  const handlers=new Map(),events=[],profile={mode:'profile',reply:'**画像草稿**：需要两个儿童座椅。',artifactRequest:null,profileProposal:{facts:[{field:'need',value:'需要两个儿童座椅',evidence:'需要两个儿童座椅',type:'record'}]}};
  const raw=JSON.stringify({privateTrace:{reply:'PRIVATE_TRACE'},...profile});
  const generator=new CopilotGenerator({clientFactory:async()=>({start:async()=>{},stop:async()=>{},createSession:async()=>({
    on:(type,handler)=>{handlers.set(type,handler);return ()=>handlers.delete(type);},
    sendAndWait:async()=>{
      handlers.get('assistant.message_delta')({data:{messageId:'subagent',parentToolCallId:'tool',deltaContent:'{"reply":"PRIVATE_SUBAGENT"}'}});
      for(const deltaContent of raw)handlers.get('assistant.message_delta')({data:{messageId:'public',deltaContent}});
      started();await gate;return {data:{content:raw}};
    },disconnect:async()=>{}
  })})});
  const pending=generator.chat(normalizeChatRequest({message:'请记住，客户需要两个儿童座椅',context:context()}),{onEvent:event=>events.push(event)});
  await ready;
  assert.deepEqual([...handlers.keys()],['assistant.turn_start','assistant.message_delta','assistant.message']);
  assert.equal(events.filter(event=>event.type==='reply').map(event=>event.text).join(''),profile.reply);
  assert.doesNotMatch(JSON.stringify(events),/PRIVATE_|profileProposal|reasoning/);assert.ok(!events.some(event=>event.stage==='complete'));
  release();const result=await pending;assert.equal(result.mode,'profile');assert.deepEqual(result.profileProposal,profile.profileProposal);
  assert.equal(events.at(-1).stage,'complete');assert.equal(handlers.size,0);assert.equal((await generator.status()).verified,true);await generator.stop();
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
test('浏览器流式与旧 JSON 调用保留画像、任务交付与完整 v1.6 请求数据',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  const payload={message:'请记住，客户需要两个儿童座椅',context:context(),history:[{role:'user',content:'客户说需要两个儿童座椅'}]};
  payload.context.businessContext={source:'Snapshot',totals:{customers:2},actions:[{owner:'Sales',action:'Confirm visit'}]};
  payload.context.cohort=[{id:'c1',language:'en',timezone:'America/New_York',need:'Family space'}];
  const profile={mode:'profile',reply:'画像草稿等待确认。',artifactRequest:null,profileProposal:{facts:[{field:'need',value:'两个儿童座椅',evidence:'需要两个儿童座椅',type:'record'}]}},events=[];
  globalThis.fetch=async(url,options)=>{
    assert.equal(url,'/api/chat');assert.deepEqual(JSON.parse(options.body),payload);assert.equal(options.headers.Accept,'application/x-ndjson');
    return new Response([{type:'reply',text:'画像草稿'},{type:'result',data:profile}].map(e=>JSON.stringify(e)+'\n').join(''),{headers:{'Content-Type':'application/x-ndjson'}});
  };
  assert.deepEqual(await sendChatMessage(payload,{onEvent:e=>events.push(e)}),profile);assert.equal(events[0].text,'画像草稿');
  const task={mode:'artifact',reply:'准备门店计划。',artifactRequest:{...artifactRequest,delivery:'task'}};
  globalThis.fetch=async(_url,options)=>{assert.equal(options.headers.Accept,undefined);assert.deepEqual(JSON.parse(options.body),payload);return Response.json(task);};
  assert.deepEqual(await sendChatMessage(payload),task);
  const store={...payload.context,scope:'store',customer:{...payload.context.customer,id:'store:US',name:'US store'}},artifact={id:'store-artifact',scope:'store',sections:[]};
  globalThis.fetch=async(url,options)=>{assert.equal(url,'/api/generate');assert.deepEqual(JSON.parse(options.body),store);return Response.json({artifact});};
  assert.deepEqual(await generateAIArtifact(store,{onEvent:()=>assert.fail('JSON fallback has no stream events')}),artifact);
});
test('浏览器无效 UTF-8 流使用安全错误，调用方取消仍然保留 AbortError',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async()=>new Response(new Uint8Array([255,10]),{headers:{'Content-Type':'application/x-ndjson'}});
  await assert.rejects(sendChatMessage({message:'hi'},{onEvent:()=>{}}),{code:'INVALID_STREAM'});
  const controller=new AbortController();controller.abort();
  globalThis.fetch=async(_url,options)=>{options.signal.throwIfAborted();};
  await assert.rejects(sendChatMessage({message:'hi'},{signal:controller.signal}),{name:'AbortError'});
});

test('选中成果协议保留确切版本，并限制修订只生成所选格式',()=>{
  const latestArtifact={kind:'campaign',title:'活动文档',language:'en',needsPoster:true,sections:[{label:'正文',text:'Baseline'}],selection:{id:'chosen-doc',version:2,format:'document'}};
  const request=normalizeChatRequest({message:'修改当前文档',context:context(),latestArtifact});
  assert.deepEqual(request.latestArtifact.selection,latestArtifact.selection);assert.equal(request.latestArtifact.needsPoster,false);
  const result=parseChatReply(JSON.stringify({mode:'artifact',reply:'正在修改',artifactRequest:{...artifactRequest,kind:'followup',revision:true,needsPoster:true}}),request);
  assert.equal(result.artifactRequest.needsPoster,false);assert.equal(result.artifactRequest.kind,'campaign');
  for(const selection of [{id:'x',version:0,format:'document'},{id:'x',version:1,format:'executable'},{id:'x',version:1,format:'poster'}])assert.throws(()=>normalizeChatRequest({message:'修改当前文档',context:context(),latestArtifact:{...latestArtifact,selection}}));
  assert.equal(demoChatReply(request).artifactRequest.revision,true);
  assert.equal(demoChatReply({...request,message:'修改海报标题'}).mode,'reply');
  const sections=[{label:'正文',text:'x'.repeat(20000)}];
  assert.equal(normalizeRequest({...context(),previousArtifact:{title:'长文档',sections}}).previousArtifact.sections[0].text.length,20000);
});
