import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadEnvironment,findLocalCopilot,copilotOptions} from '../server/environment.js';
import {CopilotGenerator,connectionError} from '../server/copilot.js';
import {normalizeChatRequest} from '../server/chat.js';
import {runLiveCheck} from '../server/live-check.js';
import {draftStoreArtifact} from '../server/protocol.js';

async function temporary(t){const base=fileURLToPath(new URL('.',import.meta.url)),root=await mkdtemp(resolve(base,'.copilot-setup-'));t.after(async()=>{const target=await realpath(root);assert.ok(target.startsWith(resolve(await realpath(base),'.copilot-setup-')));await rm(target,{recursive:true});});return root;}
const reply=()=>({data:{content:JSON.stringify({mode:'reply',reply:'您好，我可以一起准备销售工作。',artifactRequest:null})}});
test('服务自动读取配置，但不覆盖宿主环境；身份值不会出现在错误中',async t=>{
  const root=await temporary(t),path=resolve(root,'.env');await writeFile(path,'COPILOT_MODEL="example-model"\nGH_TOKEN=fake-test-secret\nHOST=127.0.0.1\n');
  const env={COPILOT_MODEL:'deployment-model'};await loadEnvironment({path,env});assert.equal(env.COPILOT_MODEL,'deployment-model');assert.equal(env.GH_TOKEN,'fake-test-secret');
  const options=await copilotOptions(env,{root});assert.equal(options.githubToken,'fake-test-secret');
  await assert.rejects(copilotOptions({COPILOT_GITHUB_TOKEN_FILE:resolve(root,'missing')},{root}),e=>!e.message.includes(root));
  await loadEnvironment({path:resolve(root,'absent'),env});
});
test('从本项目寻找 CLI，不需要全局安装；显式路径和身份文件优先',async t=>{
  const root=await temporary(t),directory=resolve(root,'node_modules','@github','copilot');await mkdir(directory,{recursive:true});
  await writeFile(resolve(directory,'package.json'),JSON.stringify({bin:{copilot:'index.js'}}));await writeFile(resolve(directory,'index.js'),'// fixture only');
  assert.equal(await findLocalCopilot({root}),resolve(directory,'index.js'));
  const token=resolve(root,'test-identity');await writeFile(token,'fixture-token\n');
  const config=await copilotOptions({COPILOT_CLI_PATH:'explicit-cli',COPILOT_GITHUB_TOKEN_FILE:token,GH_TOKEN:'other'},{root});assert.equal(config.cliPath,'explicit-cli');assert.equal(config.githubToken,'fixture-token');
});
test('身份检查通过不等于真实调用通过；成功生成后才记录 verified',async()=>{
  const generator=new CopilotGenerator({clientFactory:async()=>({start:async()=>{},stop:async()=>{},getAuthStatus:async()=>({isAuthenticated:true}),createSession:async()=>({sendAndWait:async()=>reply(),disconnect:async()=>{}})})});
  assert.equal((await generator.status({probe:true})).verified,false);await generator.chat(normalizeChatRequest({message:'你好'}));
  const status=await generator.status();assert.equal(status.verified,true);assert.ok(status.lastSuccessAt);await generator.stop();
});
test('SDK 启动超时可恢复，不让状态接口一直等待',async()=>{
  let attempts=0;
  const generator=new CopilotGenerator({connectTimeoutMs:15,clientFactory:async()=>({start:async()=>{if(++attempts===1)await new Promise(()=>{});},stop:async()=>{}})});
  assert.equal((await generator.status({probe:true})).code,'COPILOT_START_TIMEOUT');assert.equal((await generator.status({probe:true})).ready,true);await generator.stop();
});
test('创建会话期间取消会释放名额，迟到的会话通过 SDK 1.0.13 断开',async()=>{
  let release,destroyed=0;const created=new Promise(r=>{release=r;});
  const generator=new CopilotGenerator({clientFactory:async()=>({start:async()=>{},stop:async()=>{},createSession:()=>created})});
  const controller=new AbortController(),run=generator.chat(normalizeChatRequest({message:'你好'}),{signal:controller.signal});await new Promise(r=>setImmediate(r));controller.abort();
  await assert.rejects(run,e=>e.code==='CANCELLED');assert.equal(generator.active,0);release({disconnect:async()=>{destroyed++;}});await new Promise(r=>setImmediate(r));assert.equal(destroyed,1);await generator.stop();
});
test('模型没有返回时应用超时保护生效，并停止会话',async()=>{
  let aborted=0,destroyed=0;const generator=new CopilotGenerator({timeoutMs:15,clientFactory:async()=>({start:async()=>{},stop:async()=>{},createSession:async()=>({sendAndWait:()=>new Promise(()=>{}),abort:async()=>{aborted++;},disconnect:async()=>{destroyed++;}})})});
  await assert.rejects(generator.chat(normalizeChatRequest({message:'你好'})),e=>e.code==='MODEL_TIMEOUT');assert.equal(aborted,1);assert.equal(destroyed,1);assert.equal(generator.active,0);await generator.stop();
});
test('同步启动失败可重试，并保留本地 CLI 和令牌选项',async()=>{
  let attempts=0;
  const generator=new CopilotGenerator({cliPath:'local-copilot.js',githubToken:'fixture-token',clientFactory:options=>{
    assert.equal(options.cliPath,'local-copilot.js');assert.equal(options.githubToken,'fixture-token');assert.equal(options.useLoggedInUser,false);
    if(++attempts===1)throw new Error('PRIVATE_START_FAILURE');
    return {start:async()=>{},stop:async()=>{}};
  }});
  const first=await generator.status({probe:true});assert.equal(first.code,'COPILOT_UNAVAILABLE');assert.doesNotMatch(first.message,/PRIVATE/);
  assert.equal((await generator.status({probe:true})).ready,true);assert.equal(attempts,2);await generator.stop();
});
test('启动中取消立即释放请求名额，共享连接完成后仍可进行真实调用',async()=>{
  let release;const starting=new Promise(resolve=>{release=resolve;});
  const generator=new CopilotGenerator({clientFactory:async()=>({start:()=>starting,stop:async()=>{},createSession:async()=>({sendAndWait:async()=>reply(),disconnect:async()=>{}})})});
  const controller=new AbortController(),request=normalizeChatRequest({message:'你好'}),run=generator.chat(request,{signal:controller.signal});
  await new Promise(resolve=>setImmediate(resolve));controller.abort();await assert.rejects(run,{code:'CANCELLED'});assert.equal(generator.active,0);
  release();assert.equal((await generator.chat(request)).engine,'copilot');await generator.stop();
});
test('创建会话超时后仍断开迟到会话，失败只公开安全清理状态',async()=>{
  let release;const created=new Promise(resolve=>{release=resolve;});
  const generator=new CopilotGenerator({connectTimeoutMs:10,cleanupTimeoutMs:10,clientFactory:async()=>({start:async()=>{},stop:async()=>{},createSession:()=>created})});
  await assert.rejects(generator.chat(normalizeChatRequest({message:'你好'})),{code:'MODEL_TIMEOUT'});assert.equal(generator.active,0);
  release({disconnect:async()=>{throw new Error('PRIVATE_LATE_CLEANUP');}});
  await new Promise(resolve=>setImmediate(resolve));
  const status=await generator.status();assert.equal(status.code,'SESSION_CLEANUP_FAILED');assert.equal(status.ready,false);assert.equal(status.verified,false);assert.doesNotMatch(JSON.stringify(status),/PRIVATE/);await generator.stop();
});
test('中止失败或卡住都有界并明确失败，仍会断开会话并释放名额',async()=>{
  for(const abort of [()=>{throw new Error('PRIVATE_ABORT');},async()=>{throw new Error('PRIVATE_ABORT');},()=>new Promise(()=>{})]){
    let disconnected=0;const events=[];
    const generator=new CopilotGenerator({timeoutMs:10,cleanupTimeoutMs:10,clientFactory:async()=>({start:async()=>{},stop:async()=>{},createSession:async()=>({
      on:()=>()=>{},sendAndWait:()=>new Promise(()=>{}),abort,disconnect:async()=>{disconnected++;}
    })})});
    await assert.rejects(generator.chat(normalizeChatRequest({message:'你好'}),{onEvent:e=>events.push(e)}),error=>error.code==='SESSION_ABORT_FAILED'&&!error.message.includes('PRIVATE'));
    assert.equal(disconnected,1);assert.equal(generator.active,0);assert.equal((await generator.status()).verified,false);assert.ok(!events.some(e=>e.stage==='complete'));await generator.stop();
  }
});
test('断开失败或卡住不能报告执行成功，也不会调用 SDK 已移除的 destroy',async()=>{
  for(const disconnect of [()=>{throw new Error('PRIVATE_DISCONNECT');},async()=>{throw new Error('PRIVATE_DISCONNECT');},()=>new Promise(()=>{})]){
    const events=[];
    const generator=new CopilotGenerator({cleanupTimeoutMs:10,clientFactory:async()=>({start:async()=>{},stop:async()=>{},createSession:async()=>({
      on:()=>()=>{},sendAndWait:async()=>reply(),disconnect,destroy:()=>assert.fail('SDK 1.0.13 requires disconnect')
    })})});
    await assert.rejects(generator.chat(normalizeChatRequest({message:'你好'}),{onEvent:e=>events.push(e)}),error=>error.code==='SESSION_CLEANUP_FAILED'&&!error.message.includes('PRIVATE'));
    assert.equal(generator.active,0);assert.equal((await generator.status()).verified,false);assert.ok(!events.some(e=>e.stage==='complete'));await generator.stop();
  }
});
test('一个取消订阅失败不会跳过其他订阅或会话断开',async()=>{
  let unsubscribed=0,disconnected=0;
  const generator=new CopilotGenerator({clientFactory:async()=>({start:async()=>{},stop:async()=>{},createSession:async()=>({
    on:()=>()=>{if(++unsubscribed===1)throw new Error('PRIVATE_UNSUBSCRIBE');},
    sendAndWait:async()=>reply(),disconnect:async()=>{disconnected++;}
  })})});
  await assert.rejects(generator.chat(normalizeChatRequest({message:'你好'}),{onEvent:()=>{}}),{code:'SESSION_CLEANUP_FAILED'});
  assert.equal(unsubscribed,3);assert.equal(disconnected,1);assert.equal(generator.active,0);await generator.stop();
});
test('模型连接分类失败更新状态、关闭失效连接，并允许重新登录后恢复',async()=>{
  let attempts=0,stopped=0;const order=[];
  const generator=new CopilotGenerator({clientFactory:async()=>({start:async()=>{},stop:async()=>{stopped++;order.push('stop');},createSession:async()=>({
    sendAndWait:async()=>{if(++attempts===1)throw Object.assign(new Error('PRIVATE_TOKEN'),{status:401});return reply();},disconnect:async()=>{order.push('disconnect');}
  })})});
  const request=normalizeChatRequest({message:'你好'});
  await assert.rejects(generator.chat(request),{code:'COPILOT_AUTH_REQUIRED'});
  const failed=await generator.status();assert.equal(failed.ready,false);assert.equal(failed.verified,false);assert.equal(failed.code,'COPILOT_AUTH_REQUIRED');assert.doesNotMatch(JSON.stringify(failed),/PRIVATE/);
  assert.equal(stopped,1);assert.deepEqual(order,['disconnect','stop']);assert.equal((await generator.chat(request)).engine,'copilot');
  assert.equal((await generator.status()).verified,true);await generator.stop();
});
test('客户端关闭返回错误列表或卡住时明确报告安全错误',async()=>{
  for(const stop of [async()=>[new Error('PRIVATE_CLIENT_ERROR')],()=>new Promise(()=>{})]){
    const generator=new CopilotGenerator({cleanupTimeoutMs:10,clientFactory:async()=>({start:async()=>{},stop})});
    await generator.status({probe:true});
    await assert.rejects(generator.stop(),error=>error.code==='CLIENT_CLEANUP_FAILED'&&!error.message.includes('PRIVATE'));assert.equal(generator.ready,false);
  }
});
test('登录、额度、网络、CLI 错误分开显示且隐藏原始敏感内容',()=>{
  for(const [error,code] of [[{code:'ENOENT',message:'secret'},'CLI_NOT_FOUND'],[{status:401,message:'token-secret'},'COPILOT_AUTH_REQUIRED'],[{status:403,message:'token-secret'},'COPILOT_ACCESS_REQUIRED'],[{code:'ECONNREFUSED',message:'token-secret'},'COPILOT_NETWORK'],[{message:'model not available token-secret'},'MODEL_UNAVAILABLE']]){const result=connectionError(error);assert.equal(result.code,code);assert.doesNotMatch(result.message,/secret/);}
});
test('真实检查拒绝演示引擎，任何一步不通过就不能报告全流程成功',async()=>{
  const generator={chat:async()=>({engine:'demo',mode:'reply',reply:'模板示例'}),status:async()=>({ready:true})};
  const report=await runLiveCheck(generator);assert.equal(report.ok,false);assert.equal(report.checks.length,1);assert.equal(report.checks[0].ok,false);
});
test('替身检验连接检查的五步协议、画像和海报渲染，不把替身当成真实联网测试',async()=>{
  let calls=0;
  const generator={chat:async request=>{calls++;return calls<3?{engine:'copilot',mode:'reply',reply:'Fixture only',artifactRequest:null}:calls===3?{engine:'copilot',mode:'profile',reply:'Fixture only',artifactRequest:null,profileProposal:{facts:[{field:'need',value:'需要放两个儿童座椅',evidence:'需要放两个儿童座椅',type:'record'},{field:'decisionProcess',value:'太太会一起试驾后决定',evidence:'太太会一起试驾后决定',type:'record'}]}}:{engine:'copilot',mode:'artifact',reply:'Fixture only',artifactRequest:{kind:'campaign',delivery:'task',needsPoster:true,prompt:request.message,language:'en'}};},generate:async request=>({...draftStoreArtifact(request),engine:'copilot'}),status:async()=>({ready:true,verified:true})};
  const report=await runLiveCheck(generator);assert.equal(report.ok,true);assert.equal(calls,4);assert.equal(report.checks.length,5);assert.ok(report.checks.every(c=>c.ok));assert.equal(report.checks.at(-1).poster,true);
});
