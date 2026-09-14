import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {seedState} from '../data.js';
import {normalizeRequest,parseArtifact,AppError} from '../server/protocol.js';
import {CopilotGenerator} from '../server/copilot.js';
import {createAuth} from '../server/auth.js';
import {createApplication,configFromEnv} from '../server/http.js';

const input=()=>{const s=seedState();return {kind:'followup',prompt:'把跟进改为简短英文，并回应充电顾虑。',customer:s.customers[0],vehicles:s.vehicles,knowledge:s.knowledge,workspaceName:'Atlas Motors'};};
const output=()=>({title:'Sarah · 个性化跟进',sections:[{label:'客户洞察',text:'依据 M1，确认儿童座椅需求。',audience:'internal',dir:'ltr'},{label:'WhatsApp · English',text:'Hi Sarah, shall we try both child seats together and review your apartment charging questions?',audience:'customer',dir:'ltr'},{label:'待确认事项',text:'充电条件需要物业确认，尚未发送消息。',audience:'internal',dir:'ltr'}]});

test('请求仅保留必要业务上下文，不把电话、邮箱或无关令牌发给模型',()=>{
  const raw=input();raw.customer.email='secret@example.com';raw.customer.contact='private-phone';raw.githubToken='do-not-forward';
  const normalized=normalizeRequest(raw),serialized=JSON.stringify(normalized);
  assert.doesNotMatch(serialized,/secret@example|private-phone|do-not-forward/);
  assert.equal(normalized.vehicles.length,3);assert.ok(normalized.vehicles.every(v=>v.market==='US'&&v.currency==='USD'));
});
test('服务端重新校验市场、预算、时区和输入长度',()=>{
  assert.throws(()=>normalizeRequest({...input(),preferredVehicleId:'v4'}),e=>e.code==='MARKET_MISMATCH');
  assert.throws(()=>normalizeRequest({...input(),prompt:'a'.repeat(8001)}));
  const raw=input();raw.customer.timezone='not-a-timezone';assert.throws(()=>normalizeRequest(raw));
});
test('模型不能指定审核状态、来源或客户 ID；阿拉伯语对客内容强制 RTL',()=>{
  const req=normalizeRequest(input());req.customer.language='ar';const raw={...output(),status:'approved',sources:['fabricated'],customerId:'other'};
  const a=parseArtifact(JSON.stringify(raw),req,'configured-model');
  assert.equal(a.status,'review');assert.equal(a.customerId,req.customer.id);assert.equal(a.sections[1].dir,'rtl');assert.ok(!a.sources.includes('fabricated'));
});
test('无效模型结果明确失败，不生成模板替代结果',()=>{
  for(const raw of ['not json','{}',JSON.stringify({...output(),sections:output().sections.map(s=>({...s,audience:'internal'}))})])assert.throws(()=>parseArtifact(raw,normalizeRequest(input())),e=>e.code==='INVALID_MODEL_OUTPUT');
});
test('营销活动必须产出可渲染的海报文案',()=>{
  const req=normalizeRequest({...input(),kind:'campaign'});assert.throws(()=>parseArtifact(JSON.stringify(output()),req));
  const posterBrief={kicker:'TEST DRIVE',headline:'Make room for more.',subheadline:'Discover your next drive.',details:'By appointment. Details to be confirmed.',cta:'Ask about a test drive',disclaimer:'Availability subject to local confirmation.'};
  assert.deepEqual(parseArtifact(JSON.stringify({...output(),posterBrief}),req).posterBrief,posterBrief);
});
test('SDK 每个任务创建独立会话、拒绝工具权限并在结束时清理',async()=>{
  const configs=[],prompts=[];let destroyed=0,started=0;
  const generator=new CopilotGenerator({model:'test-model',clientFactory:async()=>({start:async()=>{started++;},stop:async()=>{},getAuthStatus:async()=>({isAuthenticated:true}),createSession:async config=>{configs.push(config);return {sendAndWait:async arg=>{prompts.push(arg.prompt);return {data:{content:JSON.stringify(output())}};},disconnect:async()=>{destroyed++;}};}})});
  const req=normalizeRequest(input());req.previousArtifact={title:'旧标题',sections:[{label:'旧版',text:'上一版内容'}]};
  const first=await generator.generate(req);await generator.generate(req);
  assert.equal(first.engine,'copilot');assert.equal(started,1);assert.equal(configs.length,2);assert.equal(destroyed,2);assert.deepEqual(configs[0].availableTools,[]);
  assert.notEqual((await configs[0].onPermissionRequest({kind:'shell'})).kind,'approved');assert.match(prompts[0],/上一版内容/);assert.match(prompts[0],/两个孩子/);
  await generator.stop();
});
test('SDK 成果只流式发送公开生命周期，不泄露成果 JSON 或其他模型字段',async()=>{
  const handlers=new Map(),events=[];let disconnected=false;
  const raw=JSON.stringify({...output(),reply:'PRIVATE_ARTIFACT_REPLY'});
  const generator=new CopilotGenerator({clientFactory:async()=>({start:async()=>{},stop:async()=>{},createSession:async config=>{
    assert.equal(config.streaming,true);
    return {on:(type,handler)=>{handlers.set(type,handler);return ()=>handlers.delete(type);},sendAndWait:async()=>{
      handlers.get('assistant.turn_start')({data:{}});
      handlers.get('assistant.message_delta')({data:{messageId:'artifact',deltaContent:raw}});
      handlers.get('assistant.message')({data:{content:raw}});
      return {data:{content:raw}};
    },disconnect:async()=>{disconnected=true;}};
  }})});
  const artifact=await generator.generate(normalizeRequest(input()),{onEvent:event=>{if(event.stage==='complete')assert.equal(disconnected,true);events.push(event);}});
  assert.equal(artifact.engine,'copilot');assert.ok(events.every(event=>event.type==='progress'));
  assert.deepEqual(events.map(event=>event.stage),['connecting','session_ready','submitted','model_running','responding','validating','complete']);
  assert.doesNotMatch(JSON.stringify(events),/PRIVATE_|sections|reasoning/);assert.equal(handlers.size,0);await generator.stop();
});
test('并发限制与取消不会占用后续任务名额',async()=>{
  let release;const waiting=new Promise(r=>{release=r;});let destroyed=0,aborted=0;
  const generator=new CopilotGenerator({maxConcurrent:1,clientFactory:async()=>({start:async()=>{},stop:async()=>{},createSession:async()=>({sendAndWait:async()=>{await waiting;return {data:{content:JSON.stringify(output())}};},abort:async()=>{aborted++;},disconnect:async()=>{destroyed++;}})})});
  const controller=new AbortController();const pending=generator.generate(normalizeRequest(input()),{signal:controller.signal});
  await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(generator.generate(normalizeRequest(input())),e=>e.code==='BUSY');
  controller.abort();await assert.rejects(pending,e=>e.code==='CANCELLED');assert.equal(generator.active,0);assert.equal(destroyed,1);assert.equal(aborted,1);release();await generator.stop();
});
test('模型失败和未登录状态不向浏览器泄露原始错误中的凭据',async()=>{
  const generator=new CopilotGenerator({clientFactory:async()=>({start:async()=>{throw new Error('secret-token-123');},stop:async()=>{}})});
  const status=await generator.status({probe:true});assert.equal(status.ready,false);assert.doesNotMatch(JSON.stringify(status),/secret-token/);
  const noAuth=new CopilotGenerator({clientFactory:async()=>({start:async()=>{},stop:async()=>{},getAuthStatus:async()=>({isAuthenticated:false})})});
  assert.equal((await noAuth.status({probe:true})).code,'COPILOT_AUTH_REQUIRED');
});
test('登录使用 HttpOnly 会话，支持过期、退出和失败次数限制',()=>{
  let time=100;const auth=createAuth({password:'test-password-with-entropy',secure:true,now:()=>time});
  const login=auth.login('test-password-with-entropy','client1');assert.match(login.cookie,/HttpOnly.*SameSite=Strict.*Secure/);
  const req={headers:{cookie:login.cookie.split(';')[0]}};assert.equal(auth.verify(req),true);auth.logout(req);assert.equal(auth.verify(req),false);
  const next=auth.login('test-password-with-entropy','client1');time+=13*3600000;assert.equal(auth.verify({headers:{cookie:next.cookie}}),false);
  for(let count=0;count<5;count++)auth.login('wrong','client2');assert.equal(auth.login('test-password-with-entropy','client2').limited,true);
});
test('生产环境拒绝无密码、公网明文和未配置来源',()=>{
  assert.throws(()=>createApplication({config:{...configFromEnv({}),production:true},generator:{}}),/password/);
  assert.throws(()=>createApplication({config:{...configFromEnv({}),password:'long-password-value',publicOrigin:'http://public.example.com'},generator:{}}),/HTTPS/);
});
test('免密码必须显式选择，生产来源与默认密码保护仍然生效',()=>{
  assert.equal(configFromEnv({}).authMode,'password');
  assert.throws(()=>createApplication({config:configFromEnv({MOTIVE_AUTH_MODE:'disabled'}),generator:{}}),/MOTIVE_AUTH_MODE/);
  assert.throws(()=>createApplication({config:configFromEnv({HOST:'0.0.0.0'}),generator:{}}),/password/);
  assert.throws(()=>createApplication({config:configFromEnv({NODE_ENV:'production',MOTIVE_AUTH_MODE:'none'}),generator:{}}),/PUBLIC_ORIGIN/);
  assert.throws(()=>createApplication({config:configFromEnv({NODE_ENV:'production',MOTIVE_AUTH_MODE:'none',PUBLIC_ORIGIN:'http://public.example'}),generator:{}}),/HTTPS/);
});
test('显式免密码生产工作区可直达，但不能绕过主机、来源与跨站检查',async t=>{
  const request=(url,{method='GET',headers,body}={})=>new Promise((resolve,reject)=>{
    const req=httpRequest(url,{method,headers},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);
      res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));
    });
    req.on('error',reject);req.end(body);
  });
  const origin='https://workspace.example',config=configFromEnv({HOST:'0.0.0.0',NODE_ENV:'production',MOTIVE_AUTH_MODE:'none',MOTIVE_PASSWORD:'unused-workspace-password',PUBLIC_ORIGIN:origin,AI_PROVIDER:'demo'});
  const server=createApplication({config,generator:{}});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`,headers={Host:'workspace.example'};
  assert.equal((await request(base+'/',{headers})).status,200);
  assert.equal((await request(base+'/login',{headers})).status,303);
  const status=await (await request(base+'/api/status',{headers})).json();
  assert.equal(status.authentication,false);assert.equal(status.provider,'demo');
  assert.equal((await request(base+'/api/status')).status,403);
  const options={method:'POST',headers:{...headers,'Content-Type':'application/json',Origin:origin},body:JSON.stringify({message:'你好'})};
  assert.equal((await request(base+'/api/chat',options)).status,200);
  assert.equal((await request(base+'/api/chat',{...options,headers:{...options.headers,Origin:'https://elsewhere.example'}})).status,403);
  assert.equal((await request(base+'/api/chat',{...options,headers:{...options.headers,'Sec-Fetch-Site':'cross-site'}})).status,403);
  for(const path of ['/ux.css','/workspace-model.js','/workspace-ui.js','/task-flow.js','/task-ui.js','/customer-profile.js','/profile-ui.js','/markdown.js','/execution.js']){
    assert.equal((await request(base+path,{headers})).status,200,path);
  }
});
test('HTTP JSON 与 NDJSON 协商保留门店、客群、经营快照，不把模型失败替换成演示',async t=>{
  const raw={...input(),scope:'store',customer:{...input().customer,id:'store:US',name:'US store'},needsPoster:false,
    cohort:[{id:'c1',language:'en',timezone:'America/New_York',channel:'whatsapp',need:'Family space'}],
    businessContext:{source:'CRM snapshot',asOf:'2026-09-14',stores:[{store:'US',customers:7,booked:2}],totals:{customers:7,booked:2},missing:['Confirmed budget'],actions:[{store:'US',owner:'Store lead',action:'Confirm budget',dueAt:'2026-09-20',status:'pending'}]}};
  let calls=0;
  const generator={generate:async(request,{onEvent})=>{
    calls++;assert.deepEqual(request,normalizeRequest(raw));
    onEvent?.({type:'progress',stage:'responding',elapsedMs:12,private:'PRIVATE_MODEL_DATA'});
    onEvent?.({type:'assistant.reasoning_delta',text:'PRIVATE_MODEL_DATA'});
    return parseArtifact(JSON.stringify(output()),request,'real-provider-fixture');
  }};
  const server=createApplication({config:configFromEnv({}),generator});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const [accept,streaming] of [['application/json',false],['application/x-ndjson; q=0',false],['application/json;q=1, application/x-ndjson;q=0.5',false],['application/x-ndjson; charset=utf-8',true]]){
    const response=await fetch(base+'/api/generate',{method:'POST',headers:{'Content-Type':'application/json',Accept:accept},body:JSON.stringify(raw)});
    assert.equal(response.status,200);
    const text=await response.text();assert.doesNotMatch(text,/PRIVATE_MODEL_DATA/);
    const result=streaming?JSON.parse(text.trim().split('\n').at(-1)).data:JSON.parse(text);
    assert.match(response.headers.get('Content-Type'),streaming?/application\/x-ndjson/:/application\/json/);
    assert.equal(result.artifact.engine,'copilot');assert.equal(result.artifact.scope,'store');assert.equal(result.artifact.customerId,'store:US');
  }
  assert.equal(calls,4);
  generator.generate=async()=>{throw new Error('PRIVATE_PROVIDER_ERROR');};
  for(const accept of ['application/json','application/x-ndjson']){
    const response=await fetch(base+'/api/generate',{method:'POST',headers:{'Content-Type':'application/json',Accept:accept},body:JSON.stringify(raw)});
    const text=await response.text();assert.doesNotMatch(text,/PRIVATE_PROVIDER_ERROR|"artifact"|"engine":"demo"/);assert.match(text,/INTERNAL_ERROR/);
  }
});
test('真实 HTTP 路由验证登录、来源、请求校验、交付物与静态文件隔离',async t=>{
  let calls=0;const generator={status:async()=>({provider:'copilot',ready:true,model:'test-model'}),generate:async request=>{calls++;return parseArtifact(JSON.stringify(output()),request,'test-model');}};
  const server=createApplication({config:{...configFromEnv({}),password:'test-password-with-entropy'},generator});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/healthz')).status,200);
  assert.equal((await fetch(base+'/api/status')).status,401);
  assert.equal((await fetch(base+'/',{redirect:'manual'})).status,302);
  const login=await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Origin':base},body:'password=test-password-with-entropy',redirect:'manual'});
  assert.equal(login.status,303);const cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base+'/',{headers:{Cookie:cookie}})).status,200);
  for(const path of ['/server.js','/server/copilot.js','/.env','/package.json','/tests/backend.test.mjs'])assert.equal((await fetch(base+path,{headers:{Cookie:cookie}})).status,404);
  const headers={'Content-Type':'application/json',Cookie:cookie,Origin:base};
  const denied=await fetch(base+'/api/generate',{method:'POST',headers:{...headers,Origin:'https://elsewhere.example'},body:JSON.stringify(input())});assert.equal(denied.status,403);assert.equal(calls,0);
  const bad=await fetch(base+'/api/generate',{method:'POST',headers,body:'not-json'});assert.equal(bad.status,400);
  const generated=await fetch(base+'/api/generate',{method:'POST',headers,body:JSON.stringify(input())});assert.equal(generated.status,200);assert.equal((await generated.json()).artifact.engine,'copilot');assert.equal(calls,1);
  await fetch(base+'/api/logout',{method:'POST',headers});assert.equal((await fetch(base+'/api/status',{headers:{Cookie:cookie}})).status,401);
});
