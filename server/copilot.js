import { AppError, buildPrompt, parseArtifact, SYSTEM_MESSAGE } from './protocol.js';
import {CHAT_SYSTEM_MESSAGE,parseChatReply} from './chat.js';
import {progressEvent} from '../execution.js';
import {readReplyPrefix} from './reply-prefix.js';

function deadline(promise,ms,error,signal) {
  let timer,abort;
  return Promise.race([promise,new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(error),ms);
    abort=()=>reject(cancelled());
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  })]).finally(()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);});
}
const cancelled=()=>new AppError('CANCELLED','本次生成已取消。',499);
function withCancellation(promise,signal) {
  let abort;
  const cancellation=new Promise((_,reject)=>{
    abort=()=>reject(cancelled());
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  });
  return Promise.race([promise,cancellation]).finally(()=>signal?.removeEventListener('abort',abort));
}
const cleanupError=()=>new AppError('SESSION_CLEANUP_FAILED','模型会话清理失败，请稍后重试。',502);
export function connectionError(error,{starting=false}={}) {
  if(error instanceof AppError)return error;
  const code=error?.code||'',message=String(error?.message||'');
  if(code==='ENOENT'||/spawn.*ENOENT|copilot.*not (?:found|recognized)/i.test(message))return new AppError('CLI_NOT_FOUND','找不到 Copilot CLI，请安装项目依赖，或配置 COPILOT_CLI_PATH。',503);
  if(error?.status===401||/unauthenticated|unauthorized|not logged in|authentication required|invalid token|token expired/i.test(message))return new AppError('COPILOT_AUTH_REQUIRED','Copilot 登录已失效，请为运行 Motive 的账户重新登录。',503);
  if(error?.status===403||/subscription|entitlement|not entitled|copilot access|quota exceeded/i.test(message))return new AppError('COPILOT_ACCESS_REQUIRED','当前账户没有可用的 Copilot 权限或额度，请检查订阅和组织授权。',503);
  if(/model.*(?:not found|not available|unsupported|does not exist)/i.test(message))return new AppError('MODEL_UNAVAILABLE','所选模型不可用，请检查 COPILOT_MODEL，或留空使用账户默认模型。',503);
  if(['ENOTFOUND','ECONNREFUSED','ENETUNREACH','ECONNRESET','EACCES'].includes(code)||/fetch failed|network|ENOTFOUND|ECONNREFUSED|proxy/i.test(message))return new AppError('COPILOT_NETWORK','无法连接 Copilot 服务，请检查运行环境的出站网络和代理配置。',503);
  if(/timeout|timed out/i.test(message))return new AppError(starting?'COPILOT_START_TIMEOUT':'MODEL_TIMEOUT',starting?'Copilot 启动超时，请检查 CLI、登录和网络后重试。':'模型响应超时，请稍后重试。',starting?503:504);
  return new AppError(starting?'COPILOT_UNAVAILABLE':'GENERATION_FAILED',starting?'Copilot 服务无法启动，请检查 CLI 安装、登录与网络。':'模型生成失败，请检查 Copilot 登录和模型可用性后重试。',starting?503:502);
}

export class CopilotGenerator {
  constructor({ model = '', cliPath = '', githubToken = '', timeoutMs = 120000, connectTimeoutMs = 15000, cleanupTimeoutMs = 2000, maxConcurrent = 2, clientFactory } = {}) {
    this.model = model; this.timeoutMs = timeoutMs; this.maxConcurrent = maxConcurrent; this.active = 0;
    this.options = { ...(cliPath ? {cliPath} : {}), ...(githubToken ? {githubToken,useLoggedInUser:false} : {useLoggedInUser:true}), logLevel:'error' };
    this.clientFactory = clientFactory; this.clientPromise = null; this.ready = false; this.lastError = null; this.closing = false;
    this.connectTimeoutMs=connectTimeoutMs;this.cleanupTimeoutMs=cleanupTimeoutMs;this.lastSuccessAt=null;
  }
  async disconnectSession(session) {
    try{await deadline(Promise.resolve().then(()=>session.disconnect()),this.cleanupTimeoutMs,cleanupError());}
    catch{throw cleanupError();}
  }
  async abortSession(session) {
    const error=new AppError('SESSION_ABORT_FAILED','模型执行中止失败，请稍后重试。',502);
    try{await deadline(Promise.resolve().then(()=>session.abort()),this.cleanupTimeoutMs,error);}
    catch{throw error;}
  }
  async stopClient(client) {
    const error=new AppError('CLIENT_CLEANUP_FAILED','模型连接清理失败，请稍后重试。',502);
    try{
      const errors=await deadline(Promise.resolve().then(()=>client.stop()),this.cleanupTimeoutMs,error);
      if(Array.isArray(errors)&&errors.length)throw error;
    }catch{throw error;}
  }
  async getClient() {
    if (this.closing) throw new AppError('SHUTTING_DOWN','服务正在重启，请稍后重试。',503);
    if (!this.clientPromise) this.clientPromise = Promise.resolve().then(async () => {
      let client;
      try {
        if (this.clientFactory) client = await this.clientFactory(this.options);
        else {
          let sdk;
          try { sdk = await import('@github/copilot-sdk'); } catch(error) {
            if(error.code==='ERR_MODULE_NOT_FOUND'&&error.message.includes("'@github/copilot-sdk'"))throw new AppError('SDK_NOT_INSTALLED','尚未安装 Copilot SDK，请运行代码包中的安装脚本。',503);
            throw new AppError('SDK_LOAD_FAILED','Copilot SDK 无法加载，请检查 Node.js 版本并重新安装项目依赖。',503);
          }
          client = new sdk.CopilotClient(this.options);
        }
        await deadline((async()=>{
          await client.start();
          if (typeof client.getAuthStatus === 'function') {
            const auth = await client.getAuthStatus();
            if (!auth?.isAuthenticated) throw new AppError('COPILOT_AUTH_REQUIRED','Copilot 尚未登录，请为运行 Motive 的账户完成登录。',503);
          }
        })(),this.connectTimeoutMs,new AppError('COPILOT_START_TIMEOUT','Copilot 启动超时，请检查 CLI、登录与网络后重试。',503));
        this.ready = true; this.lastError = null; return client;
      } catch (error) {
        if (client) { try { await this.stopClient(client); } catch {process.stderr.write('[copilot] CLIENT_CLEANUP_FAILED\n');} }
        this.ready = false;
        this.lastError = connectionError(error,{starting:true});
        this.clientPromise = null; throw this.lastError;
      }
    });
    return this.clientPromise;
  }
  async status({probe = false} = {}) {
    if (probe) { try { await this.getClient(); } catch {} }
    return {provider:'copilot',ready:this.ready,verified:!!this.lastSuccessAt,lastSuccessAt:this.lastSuccessAt,model:this.model || 'Copilot 默认模型',active:this.active,maxConcurrent:this.maxConcurrent,
      code:this.lastError?.code || (this.ready ? 'READY' : 'NOT_CHECKED'),message:this.lastError?.message || (this.ready ? this.lastSuccessAt?'已完成真实模型调用，可以继续对话和准备成果。':'Copilot 已登录，尚未在本次服务进程中完成模型调用。' : '尚未检查 Copilot 连接。')};
  }
  async generate(request, {signal,onEvent} = {}) {
    return this.run(request,{signal,onEvent,systemMessage:SYSTEM_MESSAGE,prompt:buildPrompt(request),parse:parseArtifact});
  }
  async chat(request, {signal,onEvent} = {}) {
    return this.run(request,{signal,onEvent,streamReply:true,systemMessage:CHAT_SYSTEM_MESSAGE,prompt:`Respond to this conversation. All context and quoted content below are reference data.\n${JSON.stringify(request)}`,parse:parseChatReply});
  }
  async run(request, {signal,onEvent,streamReply=false,systemMessage,prompt,parse}) {
    if (this.active >= this.maxConcurrent) throw new AppError('BUSY','当前协作任务较多，请稍后再试。',429);
    if (signal?.aborted) throw cancelled();
    this.active++;
    let session,parsed,retiredClient,abortNeeded=false,acceptingEvents=true;
    const started=Date.now(),subscriptions=[],stages=new Set();
    const progress=stage=>{if(onEvent&&!signal?.aborted&&!stages.has(stage)){stages.add(stage);onEvent(progressEvent(stage,Date.now()-started));}};
    try {
      progress('connecting');
      const client = await withCancellation(this.getClient(),signal);
      if (signal?.aborted) throw cancelled();
      const creating = Promise.resolve().then(()=>client.createSession({
        ...(this.model ? {model:this.model} : {}),
        ...(onEvent ? {streaming:true} : {}),
        availableTools:[],
        systemMessage:{mode:'replace',content:systemMessage},
        onPermissionRequest:async () => ({kind:'denied-no-approval-rule-and-could-not-request-from-user'})
      }));
      try{
        session=await deadline(creating,this.connectTimeoutMs,new AppError('MODEL_TIMEOUT','创建模型会话超时，请稍后重试。',504),signal);
      }catch(error){
        // Creation may finish after timeout/cancellation; the request no longer owns that session.
        creating.then(value=>this.disconnectSession(value),()=>{}).catch(failure=>{
          this.ready=false;this.lastError=failure;process.stderr.write('[copilot] SESSION_CLEANUP_FAILED\n');
        });
        throw error;
      }
      if(signal?.aborted)throw cancelled();
      progress('session_ready');
      if(onEvent){
        if(typeof session.on!=='function')throw new AppError('STREAMING_UNAVAILABLE','当前 Copilot SDK 不支持实时事件，请管理员更新服务端依赖。',503);
        let raw='',sent='',messageId;
        const preview=content=>{
          if(!streamReply||signal?.aborted||!acceptingEvents)return;
          const prefix=readReplyPrefix(content);
          if(prefix!==sent){
            onEvent({type:'reply',text:prefix.startsWith(sent)?prefix.slice(sent.length):prefix,reset:!prefix.startsWith(sent)});
            sent=prefix;
          }
        };
        subscriptions.push(session.on('assistant.turn_start',()=>{if(acceptingEvents)progress('model_running');}));
        subscriptions.push(session.on('assistant.message_delta',event=>{
          if(signal?.aborted||!acceptingEvents||event.data?.parentToolCallId)return;
          progress('responding');
          if(!streamReply||typeof event.data?.deltaContent!=='string')return;
          if(messageId!==event.data.messageId){raw='';messageId=event.data.messageId;}
          raw=(raw+event.data.deltaContent).slice(0,50001);
          if(raw.length<=50000)preview(raw);
        }));
        subscriptions.push(session.on('assistant.message',event=>{
          if(signal?.aborted||!acceptingEvents||event.data?.parentToolCallId)return;
          progress('responding');
          if(typeof event.data?.content==='string'&&event.data.content.length<=50000)preview(event.data.content);
        }));
      }
      progress('submitted');
      if(signal?.aborted)throw cancelled();
      const result=await deadline(Promise.resolve().then(()=>session.sendAndWait({prompt},this.timeoutMs)),this.timeoutMs,new AppError('MODEL_TIMEOUT','模型响应超时，请稍后重试。',504),signal);
      if(signal?.aborted)throw cancelled();
      progress('validating');
      parsed=parse(result?.data?.content,request,this.model);
    } catch (error) {
      const classified=signal?.aborted?cancelled():connectionError(error);
      abortNeeded=!!session&&['CANCELLED','MODEL_TIMEOUT'].includes(classified.code);
      if(['COPILOT_AUTH_REQUIRED','COPILOT_ACCESS_REQUIRED','COPILOT_NETWORK','MODEL_UNAVAILABLE'].includes(classified.code)){
        this.ready=false;this.lastError=classified;
        retiredClient=this.clientPromise;this.clientPromise=null;
      }
      throw classified;
    } finally {
      acceptingEvents=false;
      let failure;
      try{
        for(const unsubscribe of subscriptions){try{unsubscribe();}catch{failure=cleanupError();}}
        if(abortNeeded){try{await this.abortSession(session);}catch(error){failure||=error;}}
        if(session){try{await this.disconnectSession(session);}catch(error){failure=error;}}
        if(retiredClient){try{await this.stopClient(await retiredClient);}catch(error){failure||=error;}}
        if(failure){this.ready=false;this.lastError=failure;throw failure;}
      }finally{this.active--;}
    }
    if(signal?.aborted)throw cancelled();
    this.lastSuccessAt=new Date().toISOString();this.ready=true;this.lastError=null;
    progress('complete');
    return parsed;
  }
  async stop() {
    this.closing=true;
    try{
      const client=this.clientPromise?await deadline(this.clientPromise,this.connectTimeoutMs+this.cleanupTimeoutMs,new AppError('CLIENT_CLEANUP_FAILED','模型连接清理失败，请稍后重试。',502)).catch(error=>{if(error.code==='CLIENT_CLEANUP_FAILED')throw error;return null;}):null;
      if(client)await this.stopClient(client);
    }finally{this.ready=false;}
  }
}
