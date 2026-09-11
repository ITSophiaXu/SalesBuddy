import {uid} from './domain.js';
import {sendChatMessage,describeAIConnection} from './ai-client.js';
import {isArtifactCurrent} from './cowork.js';
import {buildPosterSVG} from './poster.js';
import {renderMarkdown} from './markdown.js';
import {executionStages} from './execution.js';

export function initializeConversations(state) {
  state.conversations ??= [];
  for (const chat of state.conversations) {
    for (const m of chat.messages) if (['thinking','creating'].includes(m.status)) {
      m.status='failed';m.content='页面关闭时对话中断，请重试。';
    }
  }
}

export function mentionedCustomer(text, customers) {
  const hits=customers.filter(c=>{
    const names=[c.name,...c.name.split(' ').filter(n=>n.length>=3)];
    return names.some(name=>new RegExp(`(^|[^a-zA-Z])${name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}($|[^a-zA-Z])`,'i').test(text));
  });
  return hits.length===1?hits[0]:null;
}

export function createChatUI(api) {
  const {esc,i,btn}=api;
  const state=()=>api.state(), ui=()=>api.ui();
  const pending=new Map();
  let homeDraft='',homeCustomer='',scrollNext=false;
  const drafts=new Map();
  const current=()=>state().conversations.find(c=>c.id===ui().conversationId)||state().conversations[0]||null;
  const context=c=>state().customers.find(x=>x.id===c?.customerId);
  const busy=c=>!!c&&pending.has(c.id);
  const options=selected=>`<option value="">不关联客户 · 自由讨论</option>${state().customers.map(c=>`<option value="${esc(c.id)}" ${c.id===selected?'selected':''}>${esc(c.name)}</option>`).join('')}`;
  const source=engine=>engine==='demo'?'本地对话演示':engine==='copilot'?'Copilot':'Motive';

  function makeConversation(customerId='') {
    const chat={id:uid('chat'),customerId:state().customers.some(c=>c.id===customerId)?customerId:'',title:'新对话',messages:[],createdAt:new Date().toISOString()};
    state().conversations.unshift(chat);ui().conversationId=chat.id;api.save();return chat;
  }
  function open(customerId){
    if(customerId){const chat=state().conversations.find(c=>c.customerId===customerId)||makeConversation(customerId);ui().conversationId=chat.id;}
    else if(current())ui().conversationId=current().id;
    api.navigate('chat');
  }
  function renderHomeComposer(){
    return `<section class="chat-hero" aria-labelledby="cowork-home-title"><div class="chat-hero-intro"><span class="chat-mark">${i('spark')}</span><div><span class="eyebrow">YOUR AUTOMOTIVE COWORKER</span><h2 id="cowork-home-title">和 Cowork 聊聊，把下一步做出来。</h2><p>问一个问题，讨论一位客户，或一起完成话术、方案和海报。</p></div>${btn('继续对话','chat-open','message','chat-continue')}</div><div class="chat-composer home-chat-composer"><label class="sr-only" for="cowork-home-input">和 Cowork 对话</label><textarea id="cowork-home-input" maxlength="6000" rows="2" placeholder="Sarah 为什么还在犹豫？我们先聊聊怎么跟进…">${esc(homeDraft)}</textarea><div class="chat-composer-bottom"><label class="chat-context-label">${i('users')}<span class="sr-only">关联客户，可选</span><select id="cowork-home-customer" aria-label="关联客户，可选">${options(homeCustomer)}</select></label>${btn('发送','chat-send-home','arrow','primary')}</div></div><div class="chat-starters"><button data-act="chat-example" data-example="为什么客户试驾后不回复？">${i('message')}一起想想跟进思路</button><button data-act="chat-example" data-example="帮 Sarah 写一段简短的英文跟进话术">${i('doc')}准备客户话术</button><button data-act="chat-example" data-example="为 Sarah 做一张周末家庭体验邀请海报">${i('megaphone')}做一张活动海报</button><span>直接聊，需要时再交付成果</span></div></section>`;
  }
  function artifactCard(id){
    const a=state().artifacts.find(a=>a.id===id);if(!a)return '';
    const stale=!isArtifactCurrent(state(),a);
    return `<button class="chat-artifact ${a.format==='poster'?'has-poster':''}" data-act="artifact" data-id="${esc(a.id)}">${a.format==='poster'?`<div class="chat-artifact-thumb">${buildPosterSVG(a.poster,{approved:a.status==='approved'&&!stale})}</div>`:`<span class="chat-artifact-icon">${i('doc')}</span>`}<div><span class="eyebrow">${a.format==='poster'?'POSTER':'DELIVERABLE'}</span><strong>${esc(a.title)}</strong><span>${stale?'资料已更新 · 历史版本':a.status==='approved'?'已审核':'可编辑 · 待审核'} · ${a.format==='poster'?'PNG / SVG':'文档'}</span></div>${i('arrow')}</button>`;
  }
  function renderMessage(m){
    return `<article id="chat-message-${esc(m.id)}" class="chat-message ${m.role==='user'?'from-user':'from-motive'}">${renderMessageBody(m)}</article>`;
  }
  function renderExecution(m,working){
    if(!m.execution?.length)return '';
    const elapsed=working?Date.now()-m.startedAt:m.elapsedMs||0;
    return `<details class="chat-execution" ${working?'open':''}><summary>执行过程 <span data-execution-elapsed>${(Math.max(0,elapsed)/1000).toFixed(1)} 秒</span></summary><ol>${m.execution.map(event=>{
      const step=executionStages[event.stage];if(!step)return '';
      return `<li><div><strong>${event.phase==='artifact'?'成果准备 · ':''}${esc(step.title)}</strong><time>${(event.elapsedMs/1000).toFixed(1)}s</time></div><p>${esc(step.detail)}</p></li>`;
    }).join('')}</ol><p class="chat-execution-note">展示实际执行状态与公开回复，不展示模型内部推理原文。</p></details>`;
  }
  function renderMessageBody(m){
    const working=['thinking','creating'].includes(m.status),error=['failed','stale','cancelled'].includes(m.status);
    const markdown=m.role==='assistant'&&!error;
    return `<div class="chat-message-label">${m.role==='user'?esc(state().settings.operator):`${i('spark')}Motive <small>${source(m.engine)}</small>`}</div>${renderExecution(m,working)}${m.content?`<div class="chat-message-text ${markdown?'markdown-content':''} ${error?'chat-error':''}" dir="auto" aria-busy="${working}">${markdown?renderMarkdown(m.content):esc(m.content)}</div>`:''}${working?`<div class="chat-thinking" role="status"><span></span>${m.status==='creating'?'正在准备可编辑成果…':m.content?'回复正在生成，完成前为草稿…':'等待 Copilot 响应…'}</div>`:''}${m.artifactId?`<div class="chat-artifacts">${artifactCard(m.artifactId)}${m.posterId?artifactCard(m.posterId):''}</div>`:''}${m.status==='failed'||m.status==='stale'?btn('重试这一条','chat-retry','refresh','sm',`data-id="${esc(m.id)}"`):''}`;
  }
  function refreshMessage(chat,m,elapsedOnly=false){
    if(ui().page!=='chat'||current()?.id!==chat.id||api.modalOpen())return;
    const article=document.getElementById?.(`chat-message-${m.id}`);if(!article)return;
    if(elapsedOnly){const clock=article.querySelector('[data-execution-elapsed]');if(clock)clock.textContent=((Date.now()-m.startedAt)/1000).toFixed(1)+' 秒';return;}
    const messages=document.querySelector('.chat-messages');
    const follow=messages&&messages.scrollHeight-messages.scrollTop-messages.clientHeight<80;
    const expanded=article.querySelector('details')?.open;
    article.innerHTML=renderMessageBody(m);
    const details=article.querySelector('details');if(details&&expanded!==undefined)details.open=expanded;
    if(follow)messages.scrollTop=messages.scrollHeight;
  }
  function onProgress(chat,m,event,phase='chat'){
    if(!['thinking','creating'].includes(m.status))return;
    if(event.type==='progress'&&Object.hasOwn(executionStages,event.stage)){
      if(!m.execution.some(x=>x.stage===event.stage&&x.phase===phase))m.execution.push({stage:event.stage,elapsedMs:Date.now()-m.startedAt,phase});
      if(event.stage==='session_ready')m.engine='copilot';
      if(event.stage==='demo')m.engine='demo';
    }else if(event.type==='reply'&&phase==='chat'){
      m.content=event.reset?event.text:m.content+event.text;
    }else return;
    refreshMessage(chat,m);
  }
  function onTaskProgress(task,event){
    const chat=state().conversations.find(c=>c.id===task.conversationId),run=pending.get(chat?.id);
    if(run&&run.message.id===task.chatMessageId)onProgress(chat,run.message,event,'artifact');
  }
  function renderConnection(){
    const a=ui().ai;
    if(a.ready)return a.provider==='demo'?'<div class="chat-connection chat-connection-demo">当前为本地对话演示；开放式问答与语义判断需要连接 Copilot。</div>':'';
    const connection=describeAIConnection(a);
    return `<div class="chat-connection" role="status">${i('info')}<div class="chat-connection-copy"><strong>${esc(connection.title)}</strong><p>${esc(connection.message)}</p></div>${a.code==='CHECKING'?'':btn('连接详情','ai-status',null,'sm')}</div>`;
  }
  function refreshConnection(){
    const region=document.querySelector('#cowork-chat-connection');
    if(region)region.innerHTML=renderConnection();
  }
  function render(){
    const chat=current(),c=context(chat),running=busy(chat),selected=chat?.customerId||'';
    const items=chat?.messages||[];
    return `<div class="chat-page"><div class="chat-page-heading"><div><span class="eyebrow">MOTIVE COWORK</span><h1>有想法，就从这里聊起。</h1><p>一起讨论，也一起把需要的成果做出来。</p></div>${btn('新对话','chat-new','plus','soft')}</div><div class="chat-layout"><section class="chat-session" aria-label="Cowork 对话"><div class="chat-session-top"><label class="chat-context-label">${i('users')}<select id="cowork-chat-customer" aria-label="本次对话关联客户" ${running?'disabled':''}>${options(selected)}</select></label><span>${c?esc(c.market)+' · '+esc(c.language.toUpperCase()):'可以问普通问题，无需选择客户'}</span></div><div id="cowork-chat-connection">${renderConnection()}</div><div class="chat-messages" role="log" aria-label="对话记录" aria-live="polite">${items.length?items.map(renderMessage).join(''):`<div class="chat-welcome"><span class="chat-mark">${i('spark')}</span><h2>你好，我是你的汽车营销 Cowork。</h2><p>可以先讨论思路，也可以直接说你需要什么。<br>我会把可编辑的话术、方案和海报放在对话里。</p><div class="chat-welcome-prompts"><button data-act="chat-example" data-example="为什么客户试驾后不回复？">问一个问题 ${i('arrow')}</button><button data-act="chat-example" data-example="Sarah 现在最需要解决什么问题？">一起看一位客户 ${i('arrow')}</button><button data-act="chat-example" data-example="帮 Sarah 写一段简短的英文跟进话术">准备可直接使用的内容 ${i('arrow')}</button></div></div>`}<div id="chat-end"></div></div><form id="cowork-chat-form" class="chat-composer chat-bottom-composer"><label class="sr-only" for="cowork-chat-input">给 Cowork 发消息</label><textarea id="cowork-chat-input" maxlength="6000" rows="2" placeholder="继续聊聊，或说“把刚才的建议写成话术”…">${esc(drafts.get(chat?.id||'new')||'')}</textarea><div class="chat-composer-bottom"><span>Enter 发送 · Shift + Enter 换行</span>${running?btn('停止','chat-stop','pause','soft'):'<button class="btn primary" type="submit">'+i('arrow')+'发送</button>'}</div></form></section><aside class="chat-sidebar"><div class="chat-side-heading"><h2>最近对话</h2>${btn('新建','chat-new','plus','sm')}</div><div class="chat-history-list">${state().conversations.slice(0,15).map(x=>`<button class="${x.id===chat?.id?'selected':''}" data-act="chat-select" data-id="${esc(x.id)}">${i('message')}<span><strong>${esc(x.title)}</strong><small>${esc(context(x)?.name||'自由讨论')}${busy(x)?' · 正在回复':''}</small></span></button>`).join('')||'<p class="muted">第一段对话会保存在这里。</p>'}</div>${c?`<div class="chat-customer-card"><span class="eyebrow">本次客户上下文</span><h3>${esc(c.name)}</h3><p>${esc(c.need)}</p><p class="muted">${esc(c.concern)}</p>${btn('查看客户画像','customer','users','sm',`data-id="${esc(c.id)}"`)}${btn('接续客户工作','chat-work','arrow','sm',`data-id="${esc(c.id)}"`)}</div>`:'<div class="chat-customer-card"><h3>先聊清楚，再做成果</h3><p>普通问题直接回答。需要针对客户准备内容时，选择客户或在消息中提到姓名。</p></div>'}<div class="chat-customer-card"><h3>成果留在工作里</h3><p>对话中的成果可打开、编辑、审核与导出，也会出现在交付物中。</p><a class="link" href="#deliverables">查看全部交付物 ${i('arrow')}</a></div></aside></div></div>`;
  }
  const redraw=()=>{
    api.save();if(!['chat','home'].includes(ui().page)||api.modalOpen())return;
    const input=document.activeElement?.id==='cowork-chat-input'?document.activeElement:null;
    const selection=input?{start:input.selectionStart,end:input.selectionEnd}:null;
    const messages=ui().page==='chat'?document.querySelector('.chat-messages'):null;
    const top=messages?.scrollTop,follow=scrollNext||(messages&&messages.scrollHeight-top-messages.clientHeight<80);
    api.render();
    if(input){const next=document.querySelector('#cowork-chat-input');next?.focus({preventScroll:true});next?.setSelectionRange?.(selection.start,selection.end);}
    const updated=ui().page==='chat'?document.querySelector('.chat-messages'):null;
    if(updated&&Number.isFinite(top))updated.scrollTop=follow?updated.scrollHeight:top;
  };
  const stale=(c,revision)=>c.customerId&&context(c)?.contextVersion!==revision;

  async function send(message,{customerId,fromHome=false,retryId}={}){
    const text=String(message||'').trim();if(!text)return;
    if(text.length>6000){api.toast('请将单条消息控制在 6000 字以内。');return;}
    let chat=current();
    if(fromHome||!chat)chat=makeConversation(customerId||mentionedCustomer(text,state().customers)?.id||'');
    if(busy(chat)){api.toast('这段对话正在回复，可以停止后再发送。');return;}
    const mentioned=mentionedCustomer(text,state().customers);
    if(!retryId&&chat.customerId&&mentioned&&mentioned.id!==chat.customerId){
      chat=makeConversation(mentioned.id);api.toast(`已为 ${mentioned.name} 开始独立对话。`);
    }
    if(!chat.customerId){const found=mentionedCustomer(text,state().customers);if(found)chat.customerId=found.id;}
    let reply;
    if(retryId){
      reply=chat.messages.find(m=>m.id===retryId);
      if(!reply||chat.messages.at(-1)!==reply||!['failed','stale'].includes(reply.status)){api.toast('请在输入框重新发送你的问题。');return;}
    }
    const history=(reply?chat.messages.slice(0,-2):chat.messages).filter(m=>m.status==='done').slice(-20).map(m=>({role:m.role,content:(m.content+(m.artifactId?'\n[该回复附有可编辑交付物]':'')).slice(0,6000)}));
    const last=chat.messages.slice().reverse().find(m=>m.artifactId&&m.status==='done');
    const artifact=state().artifacts.find(a=>a.id===last?.artifactId);
    const previous=artifact&&isArtifactCurrent(state(),artifact)?structuredClone(artifact):null;
    const currentPoster=state().artifacts.find(a=>a.id===last?.posterId);
    const previousPoster=currentPoster&&isArtifactCurrent(state(),currentPoster)?structuredClone(currentPoster):null;
    const c=context(chat),revision=c?.contextVersion;
    const work=state().works.find(w=>w.customerId===c?.id);
    if(!reply){
      chat.messages.push({id:uid('msg'),role:'user',content:text,status:'done',at:new Date().toISOString()});
      reply={id:uid('msg'),role:'assistant',content:'',status:'thinking',request:text,at:new Date().toISOString()};chat.messages.push(reply);
    }else Object.assign(reply,{status:'thinking',content:'',taskId:null});
    if(chat.title==='新对话')chat.title=text.slice(0,32);
    delete chat.awaitingCustomerPrompt;drafts.set(chat.id,'');homeDraft='';scrollNext=true;
    ui().conversationId=chat.id;api.navigate('chat');
    Object.assign(reply,{execution:[],startedAt:Date.now(),elapsedMs:0});
    const controller=new AbortController();pending.set(chat.id,{controller,message:reply});redraw();
    const ticker=setInterval(()=>refreshMessage(chat,reply,true),1000);
    try{
      const payload={message:text,history,context:c?api.generationPayload({kind:'followup',customerId:c.id,workId:work?.id,prompt:text}):null,
        latestArtifact:previous?{kind:previous.kind,title:previous.title,sections:previous.sections,needsPoster:!!previousPoster,language:previous.language,poster:previousPoster?.poster}:null};
      const result=await sendChatMessage(payload,{signal:controller.signal,onEvent:event=>onProgress(chat,reply,event)});
      if(reply.status==='cancelled')return;
      if(stale(chat,revision)){reply.status='stale';reply.content='客户资料已变化，本次结果未采用。重试后会参考最新记录。';return;}
      Object.assign(reply,{content:result.reply,mode:result.mode,engine:result.engine,status:'done'});
      if(result.mode==='clarify'&&!c)chat.awaitingCustomerPrompt=text;
      if(result.mode==='artifact'){
        if(!c)throw new Error('请先选择客户，再准备对应成果。');
        const action=result.artifactRequest;
        if(action.revision&&!previous)throw new Error('上一版成果已失效，请依据最新客户资料重新生成。');
        if(action.revision&&(JSON.stringify(previous)!==JSON.stringify(state().artifacts.find(a=>a.id===previous.id))||(previousPoster&&JSON.stringify(previousPoster)!==JSON.stringify(state().artifacts.find(a=>a.id===previousPoster.id))))){
          reply.status='stale';reply.content='你刚刚修改了这份成果。请重试，我会基于最新版本继续调整。';return;
        }
        reply.status='creating';onProgress(chat,reply,{type:'progress',stage:'artifact_requested'});refreshMessage(chat,reply);
        const operation=api.startRun(action.kind,c.id,action.prompt,{background:true,conversationId:chat.id,chatMessageId:reply.id,workId:work?.id,
          needsPoster:action.needsPoster,languageOverride:action.language,previousArtifact:action.revision?{...previous,sections:[...previous.sections,...(previousPoster?[{label:'当前海报文案',text:JSON.stringify(previousPoster.poster)}]:[])]}:null,
          ...(action.revision&&previousPoster?{posterStyle:{size:previousPoster.poster.size,theme:previousPoster.poster.theme}}:{})});
        reply.taskId=state().tasks.find(t=>t.chatMessageId===reply.id)?.id;
        const task=await operation;
        if(reply.status==='cancelled')return;
        if(task.status!=='review'){reply.status=task.status==='stale'?'stale':'failed';reply.content=task.error||'本次成果未完成，请重试。';return;}
        onProgress(chat,reply,{type:'progress',stage:'saved'},'artifact');
        reply.status='done';reply.artifactId=task.artifactId;reply.posterId=task.posterId;
        reply.content=action.revision?'已根据这次要求准备新版本，原版仍保留在交付物中。可以打开检查，或继续告诉我哪里需要调整。':`已准备好${task.posterId?'文案和海报':'可编辑成果'}。可以打开检查，也可以继续告诉我想怎么调整。`;
      }
    }catch(error){
      if(reply.status!=='cancelled'){reply.status='failed';reply.content=error.name==='TimeoutError'?'回复超时，请重试。':error.code?error.message:'本次对话未完成，请检查连接后重试。';}
    }finally{
      clearInterval(ticker);reply.elapsedMs=Date.now()-reply.startedAt;
      const terminal={failed:'failed',stale:'stale',cancelled:'stopped'}[reply.status];
      if(terminal)reply.execution.push({stage:terminal,elapsedMs:reply.elapsedMs,phase:'chat'});
      pending.delete(chat.id);redraw();
    }
  }
  async function handleAction(act,data={}){
    if(!act.startsWith('chat-'))return false;
    if(act==='chat-open')open(data.customer);
    if(act==='chat-new'){makeConversation();api.navigate('chat');}
    if(act==='chat-select'){if(state().conversations.some(c=>c.id===data.id)){ui().conversationId=data.id;scrollNext=true;api.navigate('chat');}}
    if(act==='chat-send-home')await send(document.querySelector('#cowork-home-input').value,{customerId:document.querySelector('#cowork-home-customer').value,fromHome:true});
    if(act==='chat-example'){
      if(ui().page==='home'){homeDraft=data.example;document.querySelector('#cowork-home-input').value=data.example;document.querySelector('#cowork-home-input').focus();}
      else{drafts.set(current()?.id||'new',data.example);document.querySelector('#cowork-chat-input').value=data.example;document.querySelector('#cowork-chat-input').focus();}
    }
    if(act==='chat-stop'){
      const run=pending.get(current()?.id);if(run){run.message.status='cancelled';run.message.content='已停止这次回复。';run.controller.abort();if(run.message.taskId)api.cancelTask(run.message.taskId);redraw();}
    }
    if(act==='chat-retry'){const m=current()?.messages.find(m=>m.id===data.id);if(m)await send(m.request,{retryId:m.id});}
    if(act==='chat-work'){const w=state().works.find(w=>w.customerId===data.id);if(w){ui().workId=w.id;api.navigate('work');}}
    return true;
  }
  function onInput(target){
    if(target.id==='cowork-home-input')homeDraft=target.value;
    if(target.id==='cowork-chat-input')drafts.set(current()?.id||'new',target.value);
  }
  async function onChange(target){
    if(target.id==='cowork-home-customer'){homeCustomer=target.value;return;}
    if(target.id==='cowork-chat-customer'){
      const old=current();if(busy(old))return;
      if((old?.customerId||'')===target.value)return;
      const follow=old?.awaitingCustomerPrompt;
      makeConversation(target.value);api.render();
      if(follow&&target.value)await send(follow);
    }
  }
  function afterRender(){
    if(ui().page==='chat'&&scrollNext){scrollNext=false;requestAnimationFrame(()=>document.querySelector('#chat-end')?.scrollIntoView?.({block:'nearest'}));}
  }
  return {render,renderHomeComposer,refreshConnection,onTaskProgress,open,send,handleAction,onInput,onChange,afterRender};
}
