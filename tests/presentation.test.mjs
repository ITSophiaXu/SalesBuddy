import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {renderMarkdown} from '../markdown.js';
import {readReplyPrefix} from '../server/reply-prefix.js';
import {CopilotGenerator} from '../server/copilot.js';
import {normalizeChatRequest} from '../server/chat.js';
import {AppError} from '../server/protocol.js';
import {createApplication,configFromEnv} from '../server/http.js';
import {sendChatMessage,generateAIArtifact} from '../ai-client.js';

const answer={mode:'reply',reply:'**买了 Model Y 以后，能否方便、稳定地给车充电。**',artifactRequest:null,engine:'copilot'};
const frame=event=>JSON.stringify(event)+'\n';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('真实报错示例渲染为粗体，兼容段落、列表、引用、表格与代码',()=>{
  assert.match(renderMarkdown(answer.reply),/<strong>买了 Model Y 以后，能否方便、稳定地给车充电。<\/strong>/);
  const html=renderMarkdown('# 标题\n\n*强调*\n\n1. 第一项\n2. 第二项\n\n> 引用\n\n| A | B |\n| --- | --- |\n| 甲 | 乙 |\n\n```js\nconst a = "<tag>";\n```\n\nمرحبا');
  for(const tag of ['h1','em','ol','li','blockquote','table','pre','code'])assert.match(html,new RegExp('<'+tag+'(?:>|\\s)'));
  assert.match(html,/&lt;tag&gt;/);assert.match(html,/مرحبا/);
});

test('Markdown 不执行 HTML、危险链接或自动加载模型图片',()=>{
  const html=renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[危险](javascript:alert%281%29) [实体](jav&#x61;script:alert%281%29) [数据](data:text/html,attack) ![图片](https://example.com/tracker)\n\n[正常](https://example.com?q=1&x=2)');
  assert.doesNotMatch(html,/<script|<img|onerror=alert\(1\)>|href="(?:javascript|data):/);
  assert.match(html,/&lt;script&gt;/);assert.match(html,/href="https:\/\/example.com\?q=1&amp;x=2"/);
  assert.match(html,/rel="noopener noreferrer"/);
});

test('JSON 增量提取只取顶层 reply，处理每个分块处的转义和 Unicode',()=>{
  const reply='**买😀了**\n"Model Y" \\ 中文\tمرحبا';
  const raw='```json\n'+JSON.stringify({artifactRequest:{reply:'DO_NOT_SHOW',prompt:'"reply":"DO_NOT_SHOW"'},other:[{reply:'DO_NOT_SHOW'}],reply}).replace('😀','\\ud83d\\ude00')+'\n```';
  let previous='';
  for(let n=1;n<=raw.length;n++){
    const prefix=readReplyPrefix(raw.slice(0,n));
    assert.ok(reply.startsWith(prefix),JSON.stringify(prefix));assert.ok(prefix.startsWith(previous));
    assert.doesNotMatch(prefix,/DO_NOT_SHOW|[\uD800-\uDBFF]$/);previous=prefix;
  }
  assert.equal(previous,reply);
  assert.equal(readReplyPrefix('{"reply":{"reply":"DO_NOT_SHOW"}}'),'');
  assert.equal(readReplyPrefix('{"other":"the \\"reply\\": \\"DO_NOT_SHOW\\""}'),'');
  assert.equal(readReplyPrefix('{"reply":"bad\\uZZZZ"}'),'');
  assert.equal(readReplyPrefix('{"reply":"'+ 'x'.repeat(6100)), 'x'.repeat(6000));
});

function fakeSDK(send){
  const handlers=new Map(),config={},stats={destroyed:0,unsubscribed:0,aborted:0};
  const emit=(type,data={})=>handlers.get(type)?.({type,data});
  const generator=new CopilotGenerator({model:'test-model',clientFactory:async()=>({
    start:async()=>{},stop:async()=>{},
    createSession:async options=>{
      Object.assign(config,options);
      return {
        on(type,handler){handlers.set(type,handler);return ()=>{handlers.delete(type);stats.unsubscribed++;};},
        sendAndWait:()=>send(emit),abort:async()=>{stats.aborted++;},disconnect:async()=>{stats.destroyed++;}
      };
    }
  })});
  return {generator,config,stats,handlers};
}

test('SDK 在最终结果前逐步公开回复，既不订阅也不转发私有推理',async()=>{
  const gate=deferred(),started=deferred(),events=[];
  const sdk=fakeSDK(async emit=>{
    emit('assistant.turn_start');
    emit('assistant.reasoning_delta',{deltaContent:'PRIVATE_THOUGHT'});
    emit('tool.execution_start',{toolName:'PRIVATE_TOOL'});
    const raw=JSON.stringify({...answer,artifactRequest:{prompt:'PRIVATE_PROMPT'}});
    for(let i=0;i<raw.length;i+=3)emit('assistant.message_delta',{messageId:'m1',deltaContent:raw.slice(i,i+3)});
    started.resolve();await gate.promise;
    emit('assistant.message',{content:raw});return {data:{content:raw}};
  });
  const result=sdk.generator.chat(normalizeChatRequest({message:'讨论充电'}),{onEvent:e=>events.push(e)});
  await started.promise;
  assert.equal(sdk.config.streaming,true);assert.deepEqual(sdk.config.availableTools,[]);
  assert.deepEqual([...sdk.handlers.keys()],['assistant.turn_start','assistant.message_delta','assistant.message']);
  assert.equal(events.filter(e=>e.type==='reply').map(e=>e.text).join(''),answer.reply);
  assert.ok(!events.some(e=>e.stage==='complete'));
  assert.doesNotMatch(JSON.stringify(events),/PRIVATE_|artifactRequest|reasoning|deltaContent/);
  gate.resolve();assert.equal((await result).reply,answer.reply);
  assert.ok(events.some(e=>e.stage==='validating'));assert.equal(events.at(-1).stage,'complete');
  assert.equal(sdk.stats.unsubscribed,3);assert.equal(sdk.stats.destroyed,1);assert.equal(sdk.generator.active,0);
  await sdk.generator.stop();
});

test('流式 SDK 取消或输出校验失败时释放订阅和会话，不报告完成',async()=>{
  const started=deferred(),events=[],controller=new AbortController();
  const sdk=fakeSDK(async()=>{started.resolve();return new Promise(()=>{});});
  const result=sdk.generator.chat(normalizeChatRequest({message:'hi'}),{signal:controller.signal,onEvent:e=>events.push(e)});
  await started.promise;controller.abort();await assert.rejects(result,{code:'CANCELLED'});
  assert.equal(sdk.stats.unsubscribed,3);assert.equal(sdk.stats.aborted,1);assert.equal(sdk.stats.destroyed,1);
  assert.equal(sdk.generator.active,0);assert.ok(!events.some(e=>e.stage==='complete'));await sdk.generator.stop();
  const invalid=fakeSDK(async emit=>{emit('assistant.message_delta',{deltaContent:'{"reply":"draft'});return {data:{content:'invalid'}};});
  await assert.rejects(invalid.generator.chat(normalizeChatRequest({message:'hi'}),{onEvent:()=>{}}),{code:'INVALID_MODEL_OUTPUT'});
  assert.equal(invalid.stats.unsubscribed,3);assert.equal(invalid.stats.destroyed,1);await invalid.generator.stop();
});

function responseStream(events,split=10000){
  const bytes=new TextEncoder().encode(events.map(frame).join(''));
  return new Response(new ReadableStream({start(controller){
    for(let i=0;i<bytes.length;i+=split)controller.enqueue(bytes.slice(i,i+split));
    controller.close();
  }}),{headers:{'Content-Type':'application/x-ndjson; charset=utf-8'}});
}
test('部署版 SDK 超时先中止执行，再断开会话，清理失败明确报错',async()=>{
  const sdk=fakeSDK(async()=>{throw new Error('Timed out waiting for session idle');});
  await assert.rejects(sdk.generator.chat(normalizeChatRequest({message:'hi'}),{onEvent:()=>{}}),{code:'MODEL_TIMEOUT'});
  assert.equal(sdk.stats.aborted,1);assert.equal(sdk.stats.destroyed,1);assert.equal(sdk.stats.unsubscribed,3);assert.equal(sdk.generator.active,0);
  await sdk.generator.stop();
  const generator=new CopilotGenerator({clientFactory:async()=>({start:async()=>{},stop:async()=>{},createSession:async()=>({
    sendAndWait:async()=>({data:{content:JSON.stringify(answer)}}),disconnect:async()=>{throw new Error('PRIVATE_CLEANUP_ERROR');}
  })})});
  await assert.rejects(generator.chat(normalizeChatRequest({message:'hi'})),{code:'SESSION_CLEANUP_FAILED'});
  assert.equal(generator.active,0);await generator.stop();
});
test('浏览器逐字节读取 UTF-8 流并在结果前派发进度、回复；保留旧 JSON 客户端',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  const events=[];
  globalThis.fetch=async(_url,options)=>{
    assert.equal(options.headers.Accept,'application/x-ndjson');
    return responseStream([{type:'progress',stage:'responding',elapsedMs:10,private:'NO'},{type:'reply',text:'**中文😀**'},{type:'heartbeat'},{type:'result',data:answer}],1);
  };
  assert.equal((await sendChatMessage({message:'hi'},{onEvent:e=>events.push(e)})).reply,answer.reply);
  assert.equal(events[1].text,'**中文😀**');assert.equal(events[0].private,undefined);
  globalThis.fetch=async()=>Response.json(answer);
  assert.equal((await sendChatMessage({message:'hi'})).reply,answer.reply);
  globalThis.fetch=async()=>responseStream([{type:'progress',stage:'validating',elapsedMs:20},{type:'result',data:{artifact:{id:'a',sections:[]}}}]);
  assert.equal((await generateAIArtifact({},{onEvent:()=>{}})).id,'a');
});

test('浏览器不将中断、未知事件、超长草稿或服务错误视为成功',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  const cases=[
    [[{type:'reply',text:'unfinished'}],'INCOMPLETE_STREAM'],
    [[{type:'assistant.reasoning_delta',text:'private'}],'INVALID_STREAM'],
    [[{type:'progress',stage:'unknown',elapsedMs:1}],'INVALID_STREAM'],
    [[{type:'reply',text:'x'.repeat(6001)}],'INVALID_STREAM'],
    [[{type:'error',error:{code:'MODEL_TIMEOUT',message:'timed out'}}],'MODEL_TIMEOUT'],
    [[{type:'result',data:{reply:'missing mode'}}],'INVALID_RESPONSE']
  ];
  for(const [events,code] of cases){
    globalThis.fetch=async()=>responseStream(events);
    await assert.rejects(sendChatMessage({message:'hi'},{onEvent:()=>{}}),{code});
  }
  globalThis.fetch=async()=>new Response('not-json\n',{headers:{'Content-Type':'application/x-ndjson'}});
  await assert.rejects(sendChatMessage({message:'hi'},{onEvent:()=>{}}),{code:'INVALID_STREAM'});
});

async function startServer(t,generator){
  const server=createApplication({config:configFromEnv({}),generator});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  return `http://127.0.0.1:${server.address().port}`;
}
test('HTTP 在模型完成前发送公开事件，过滤内部字段并隔离新增静态模块',async t=>{
  const gate=deferred();t.after(()=>gate.resolve());
  const base=await startServer(t,{chat:async(_request,{onEvent})=>{
    onEvent({type:'progress',stage:'connecting',elapsedMs:1,private:'PRIVATE_TRACE'});
    onEvent({type:'assistant.reasoning_delta',text:'PRIVATE_TRACE'});
    onEvent({type:'reply',text:'公开草稿'});await gate.promise;return answer;
  }});
  const response=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({message:'hi'})});
  assert.equal(response.headers.get('X-Accel-Buffering'),'no');assert.match(response.headers.get('Cache-Control'),/no-transform/);
  const reader=response.body.getReader(),decoder=new TextDecoder();let received='';
  while(!received.includes('公开草稿'))received+=decoder.decode((await reader.read()).value);
  assert.doesNotMatch(received,/PRIVATE_TRACE|"type":"result"/);
  gate.resolve();
  while(true){const {value,done}=await reader.read();if(done)break;received+=decoder.decode(value);}
  const frames=received.trim().split('\n').map(JSON.parse);
  assert.equal(frames.at(-1).type,'result');assert.equal(frames.at(-1).data.reply,answer.reply);
  for(const path of ['/markdown.js','/execution.js','/node_modules/marked/lib/marked.esm.js']){
    const asset=await fetch(base+path);assert.equal(asset.status,200);assert.match(asset.headers.get('Content-Type'),/javascript/);
  }
  assert.equal((await fetch(base+'/node_modules/marked/package.json')).status,404);
});

test('HTTP 流内错误不泄露提供方信息，断开连接取消模型请求',async t=>{
  const base=await startServer(t,{chat:async()=>{throw new Error('PRIVATE_PROVIDER_ERROR');}});
  const response=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({message:'hi'})});
  const text=await response.text();assert.match(text,/"type":"error"/);assert.doesNotMatch(text,/PRIVATE_PROVIDER_ERROR|"type":"result"/);
  const cancelled=deferred(),started=deferred();
  const cancellationBase=await startServer(t,{chat:async(_request,{signal,onEvent})=>{
    onEvent({type:'progress',stage:'submitted',elapsedMs:0});started.resolve();
    return new Promise((_,reject)=>signal.addEventListener('abort',()=>{cancelled.resolve();reject(new AppError('CANCELLED','Cancelled',499));},{once:true}));
  }});
  const controller=new AbortController();
  const live=await fetch(cancellationBase+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({message:'hi'}),signal:controller.signal});
  await started.promise;controller.abort();
  await assert.rejects(live.text(),{name:'AbortError'});await cancelled.promise;
});
