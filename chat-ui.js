import {uid} from './domain.js';
import {sendChatMessage,describeAIConnection} from './ai-client.js';
import {isArtifactCurrent} from './cowork.js';
import {buildPosterSVG} from './poster.js';
import {createArtifactWorkbench} from './workbench-ui.js';
import {conversationArtifacts, selectedArtifact} from './artifact-workbench.js';
import {storeSubject,sourceLabel,conversationStatus,customerLookup,searchCustomerRecords} from './workspace-model.js';
import {trackConversation,toggleTaskComplete,taskWorkflow} from './task-flow.js';
import {markets} from './data.js';
import {proposeCustomerProfile} from './customer-profile.js';
import {renderMarkdown} from './markdown.js';
import {executionStages} from './execution.js';

export function initializeConversations(state) {
  state.conversations ??= [];
  for (const chat of state.conversations) {
    if(chat.tracked)trackConversation(state,chat);
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
  const viewPositions=new Map();
  let homeDraft='',homeCustomer='',scrollNext=false;
  const drafts=new Map((state().conversations||[]).filter(c=>c.draft).map(c=>[c.id,c.draft]));
  const current=()=>state().conversations.find(c=>c.id===ui().conversationId)||(ui().page==='home'?null:state().conversations[0])||null;
  const isWorkbench=id=>{const c=state().conversations.find(c=>c.id===id);return !!c&&(c.tracked||c.messages.some(m=>m.artifactId||m.posterId||m.mode==='artifact'));};
  function prepareHome(){
    const available=c=>c&&!isWorkbench(c.id);
    const selected=state().conversations.find(c=>c.id===ui().conversationId);
    const saved=state().conversations.find(c=>c.id===state().homeConversationId);
    const chat=available(selected)?selected:available(saved)?saved:state().conversations.find(available);
    ui().conversationId=chat?.id;
    if(chat&&state().homeConversationId!==chat.id){state().homeConversationId=chat.id;api.save();}
    return chat||null;
  }
  const context=c=>c?.customerId?.startsWith('store:')?storeSubject(state(),c.customerId.slice(6)):state().customers.find(x=>x.id===c?.customerId);
  const busy=c=>!!c&&(pending.has(c.id)||state().tasks.some(t=>t.conversationId===c.id&&t.status==='running'));

  const workbench=createArtifactWorkbench({...api,current,busy});

  const options=selected=>`<option value="">不限定资料 · 自由对话</option><optgroup label="客户资料">${state().customers.map(c=>`<option value="${esc(c.id)}" ${c.id===selected?'selected':''}>${esc(c.name)}</option>`).join('')}</optgroup><optgroup label="门店与市场">${Object.entries(markets).filter(([id])=>id!=='all').map(([id,label])=>`<option value="store:${id}" ${selected==='store:'+id?'selected':''}>${label} · 门店资料</option>`).join('')}</optgroup>`;
  const source=engine=>engine==='record'?'人工工作记录':engine==='records'?'工作区查询':engine==='demo'?'本地对话演示':engine==='copilot'?'Copilot':'Motive';

  function makeConversation(customerId='',{home=true}={}) {
    const chat={id:uid('chat'),persona:ui().role,customerId:(state().customers.some(c=>c.id===customerId)||/^store:(US|AE|GB|DE)$/.test(customerId))?customerId:'',title:'新对话',messages:[],createdAt:new Date().toISOString()};
    state().conversations.unshift(chat);if(home)state().homeConversationId=chat.id;ui().conversationId=chat.id;ui().chatDetails=false;ui().taskActions=false;api.save();return chat;
  }
  function open(customerId){
    if(customerId){const chat=state().conversations.find(c=>c.customerId===customerId)||makeConversation(customerId);ui().conversationId=chat.id;}
    else if(current())ui().conversationId=current().id;
    api.navigate('chat');
  }

  function newTask(template='',customerId='') {
    const chat=makeConversation(customerId,{home:false});trackConversation(state(),chat);chat.title='新任务';
    drafts.set(chat.id,template);chat.draft=template;api.save();api.navigate('chat');return chat;
  }
  function renderHomeComposer(){
    return `<div class="chat-composer home-chat-composer"><label class="sr-only" for="cowork-home-input">和 Cowork 对话</label><textarea id="cowork-home-input" maxlength="6000" rows="3" placeholder="例如：刚和 Sarah 聊过，她准备月底买车，想先解决充电顾虑…">${esc(homeDraft)}</textarea><div class="chat-composer-bottom"><label class="chat-context-label">${i('book')}<select id="cowork-home-customer" aria-label="关联客户，可选">${options(homeCustomer)}</select></label>${btn('发送','chat-send-home','arrow','primary')}</div></div>`;
  }

  function artifactCard(id){
    const a=state().artifacts.find(a=>a.id===id);if(!a)return '';
    const stale=!isArtifactCurrent(state(),a);
    return `<button class="chat-artifact ${a.format==='poster'?'has-poster':''}" data-act="chat-artifact" data-id="${esc(a.id)}">${a.format==='poster'?`<div class="chat-artifact-thumb">${buildPosterSVG(a.poster,{approved:a.status==='approved'&&!stale})}</div>`:`<span class="chat-artifact-icon">${i('doc')}</span>`}<div><span class="eyebrow">${a.format==='poster'?'POSTER':'DELIVERABLE'}</span><strong>${esc(a.title)}</strong><span>${stale?'资料已更新 · 历史版本':a.status==='approved'?'已审核':'可编辑 · 待审核'} · ${a.format==='poster'?'PNG / SVG':'文档'}</span></div>${i('arrow')}</button>`;
  }

  const messageAction=(label,action,icon,id)=>`<button type="button" class="chat-message-action" data-act="${action}" data-id="${esc(id)}">${i(icon)}<span>${label}</span></button>`;

  function renderMessage(m,chat){
    const working=['thinking','creating'].includes(m.status),error=['failed','stale','cancelled'].includes(m.status);
    const markdown=m.role==='assistant'&&!error;
    const records=(m.customerIds||[]).map(id=>state().customers.find(c=>c.id===id)).filter(Boolean);
    return `<article id="chat-message-${esc(m.id)}" class="chat-message ${m.role==='user'?'from-user':'from-motive'}"><div class="chat-message-label">${m.role==='user'?esc(state().settings.operator):`${i('spark')}Motive <small>${source(m.engine)}</small>`}</div>${renderExecution(m,working)}${m.content?`<div class="chat-message-text ${markdown?'markdown-content':''} ${error?'chat-error':''}" dir="auto" aria-busy="${working}">${markdown?renderMarkdown(m.content):esc(m.content)}</div>`:''}${working?`<div class="chat-thinking" role="status"><span></span>${m.status==='creating'?'正在准备可编辑成果…':m.content?'回复正在生成，完成前为草稿…':'正在处理你的消息…'}</div>`:''}${records.map(c=>`<div class="ux-lookup-card"><div><strong>${esc(c.name)}</strong><small>${esc(c.vehicle)} · ${esc(c.city)}</small><small>${esc(c.contact||c.email||'联系方式待补充')}</small><small>${esc(sourceLabel(c))}</small></div><div>${btn('查看资料','customer',null,'sm',`data-id="${esc(c.id)}"`)} ${btn('制定转化计划','chat-plan-customer',null,'sm',`data-id="${esc(c.id)}"`)}</div></div>`).join('')}${m.profileProposal?api.profileCard(chat,m):''}${m.artifactId?`<div class="chat-artifacts">${artifactCard(m.artifactId)}${m.posterId?artifactCard(m.posterId):''}</div>`:''}${m.role==='assistant'&&m.status==='done'&&!m.artifactId&&!m.event&&!m.customerIds&&!m.profileProposal?`<div class="chat-message-actions" role="group" aria-label="回复操作">${messageAction('复制','chat-copy','copy',m.id)}${m.savedArtifactId?messageAction('查看已存素材','artifact','doc',m.savedArtifactId):messageAction('保存为素材','chat-save','doc',m.id)}</div>`:''}${m.status==='failed'||m.status==='stale'?btn('重试这一条','chat-retry','refresh','sm',`data-id="${esc(m.id)}"`):''}</article>`;
  }

  function renderExecution(m,working){
    if(!m.execution?.length)return '';
    const elapsed=working?Date.now()-m.startedAt:m.elapsedMs||0;
    return `<details class="chat-execution" ${working?'open':''}><summary>执行过程 <span data-execution-elapsed>${(Math.max(0,elapsed)/1000).toFixed(1)} 秒</span></summary><ol>${m.execution.map(event=>{
      const step=executionStages[event.stage];if(!step)return '';
      return `<li><div><strong>${event.phase==='artifact'?'成果准备 · ':''}${esc(step.title)}</strong><time>${(event.elapsedMs/1000).toFixed(1)}s</time></div><p>${esc(step.detail)}</p></li>`;
    }).join('')}</ol><p class="chat-execution-note">展示实际执行状态与公开回复，不展示模型内部推理原文。</p></details>`;
  }
  function refreshMessage(chat,m,elapsedOnly=false){
    if(!['home','chat','workspace'].includes(ui().page)||current()?.id!==chat.id||api.modalOpen())return;
    const article=document.getElementById?.(`chat-message-${m.id}`);if(!article)return;
    if(elapsedOnly){const clock=article.querySelector('[data-execution-elapsed]');if(clock)clock.textContent=((Date.now()-m.startedAt)/1000).toFixed(1)+' 秒';return;}
    const messages=document.querySelector('.chat-messages');
    const follow=messages&&messages.scrollHeight-messages.scrollTop-messages.clientHeight<80;
    const expanded=article.querySelector('details')?.open;
    article.outerHTML=renderMessage(m,chat);
    const details=document.getElementById(`chat-message-${m.id}`)?.querySelector('details');
    if(details&&expanded!==undefined)details.open=expanded;
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

  function renderSources(chat,c,running){
    return `<details class="xp-canvas-sources" ${ui().chatDetails?'open':''}><summary>${i('book')}参考资料${c?' · '+esc(c.name):''}</summary><div>${c?`<p>${esc(c.need)}</p><small>${esc(sourceLabel(c))}</small>${c.scope==='store'?'':btn('查看客户画像','customer','users','sm',`data-id="${c.id}"`)}`:'<p>普通问答可以不关联客户。需要具体方案时，先在右侧选择客户或市场。</p>'}<div class="ux-source-options"><label><input type="checkbox" data-chat-source="knowledge" ${chat?.sourceSelection?.knowledge!==false?'checked':''} ${running?'disabled':''}>参考品牌与知识</label><label><input type="checkbox" data-chat-source="vehicles" ${chat?.sourceSelection?.vehicles!==false?'checked':''} ${running?'disabled':''}>参考同市场车型资料</label></div><a class="link" href="#ecosystem">配置数据来源 ${i('arrow')}</a></div></details>`;
  }
  function renderCanvas(){return workbench.render();}
  function renderConversation(chat,home=false){
    const c=context(chat),running=busy(chat),items=chat?.messages||[];
    return `<section id="cowork-conversation" data-conversation-id="${esc(chat?.id||'new')}" class="chat-session ${home?'xp-home-conversation':'xp-cowork-panel'} ${items.length?'has-messages':''}" aria-label="Cowork 对话"><div class="xp-cowork-heading"><span class="xp-symbol">${i('spark')}</span><div class="chat-heading-copy"><strong>${home?'和 Cowork 一起工作':'Cowork'}</strong><small>${home?(chat?.profileCapture?'记录客户沟通，持续完善画像。':'问问题、写话术、记录反馈，也可以直接交代工作。'):'围绕当前成果，一起修改和完善'}</small></div><div class="chat-header-actions" role="group" aria-label="对话操作">${home?btn('新对话','chat-new','plus','sm'):''}${btn('参考资料','chat-details','book','sm',`aria-expanded="${!!ui().chatDetails}"`)}</div></div><div class="chat-session-top"><label class="chat-context-label">${i('book')}<select id="cowork-chat-customer" aria-label="本次对话关联客户" ${running?'disabled':''}>${options(chat?.customerId||'')}</select></label>${home&&items.length?btn('转为任务','chat-track','target','sm',running?'disabled':''):''}</div><div id="cowork-chat-connection">${renderConnection()}</div>${ui().chatDetails?renderSources(chat,c,running):''}<div class="chat-messages" role="log" aria-label="对话记录" aria-live="polite">${items.length?items.map(m=>renderMessage(m,chat)).join(''):home?`<div class="xp-home-prompts"><button data-act="chat-example" data-example="为什么客户试驾后不回复？">讨论一个问题</button><button data-act="chat-example" data-example="查找客户 RAV4">查找客户资料</button><button data-act="chat-example" data-example="帮 Sarah 写一句简短的英文跟进话术">写一句话术</button>${btn('记录客户沟通','chat-profile','users','sm')}</div>`:`<div class="chat-welcome"><h2>这次想一起完成什么？</h2><p>补充工作要求或新的反馈，我会据此准备和调整成果。</p></div>`}<div id="chat-end"></div></div>${!home?workbench.renderTarget():''}<form id="cowork-chat-form" class="chat-composer chat-bottom-composer"><label class="sr-only" for="cowork-chat-input">给 Cowork 发消息</label><textarea id="cowork-chat-input" maxlength="6000" rows="2" placeholder="${home?'例如：帮我写一句跟进话术，或根据这个线索制定转化方案…':(workbench.selected()?(workbench.selected().format==='poster'?'例如：精简当前海报的标题，保留活动信息…':'例如：把当前文档的跟进步骤写得更具体…'):'描述你要完成的工作和希望得到的成果…')}">${esc(drafts.get(chat?.id||'new')||'')}</textarea><div class="chat-composer-bottom"><span>Enter 发送 · Shift + Enter 换行</span>${running?btn('停止','chat-stop','pause','soft'):'<button class="btn primary" type="submit">'+i('arrow')+'发送</button>'}</div></form></section>`;
  }
  function renderHome(){return renderConversation(prepareHome(),true);}
  function render(){
    const chat=current(),c=context(chat),running=busy(chat),items=chat?.messages||[];
    const artifacts=conversationArtifacts(state(),chat).map(a=>a.id);
    const status=conversationStatus(chat||{},state());
    return `<div class="xp-reactive"><div class="xp-reactive-heading"><div><a href="#desk" class="link">← 任务列表</a><h1>${esc(chat?.goal||chat?.title||'准备成果')}</h1></div><div class="row">${chat?.tracked?`<details class="wb-task-details"><summary class="btn sm">任务信息 · ${status.label}</summary><div>${api.taskSummary(chat)}${btn(chat.completedAt?'继续此任务':'标记工作完成','chat-complete','checkCircle','sm',running?'disabled':'')}</div></details>`:''}${btn('记录沟通','chat-profile','users','sm',c?.scope!=='store'&&c?.id?`data-customer="${c.id}"`:'')}${btn('回首页对话','chat-home','message','sm')}</div></div><div class="xp-reactive-layout">${renderCanvas(chat,c,artifacts,running)}${renderConversation(chat)}</div></div>`;
  }
  function submit(form,data){return workbench.submit(form,data);}
  const redraw=()=>{
    api.save();if(!['chat','home','workspace'].includes(ui().page)||api.modalOpen())return;
    const input=document.activeElement?.id==='cowork-chat-input'?document.activeElement:null;
    const selection=input?{start:input.selectionStart,end:input.selectionEnd}:null;
    const messages=document.querySelector('.chat-messages');
    const top=messages?.scrollTop,follow=scrollNext||(messages&&messages.scrollHeight-top-messages.clientHeight<80);
    api.render();
    if(input){const next=document.querySelector('#cowork-chat-input');next?.focus({preventScroll:true});next?.setSelectionRange?.(selection.start,selection.end);}
    const updated=document.querySelector('.chat-messages');
    if(updated&&Number.isFinite(top))updated.scrollTop=follow?updated.scrollHeight:top;
  };
  const stale=(c,revision)=>c.customerId&&!c.customerId.startsWith('store:')&&context(c)?.contextVersion!==revision;

  async function send(message,{customerId,fromHome=false,retryId}={}){
    const text=String(message||'').trim();if(!text)return;
    if(text.length>6000){api.toast('请将单条消息控制在 6000 字以内。');return;}
    let chat=current();
    if(fromHome||!chat)chat=makeConversation(customerId||mentionedCustomer(text,state().customers)?.id||'');
    if(busy(chat)){api.toast('这段对话正在回复，可以停止后再发送。');return;}
    if(workbench.hasDirtyDraft()){api.toast('中间有未保存的修改，请先保存新版本或取消编辑，再交给 Cowork。');return;}
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
    const artifact=selectedArtifact(state(),chat);
    const previous=artifact&&isArtifactCurrent(state(),artifact)?structuredClone(artifact):null;
    const previousPoster=previous?.format==='poster'?previous:null;
    const c=context(chat),revision=c?.contextVersion;
    const work=c?.scope==='store'?null:state().works.find(w=>w.customerId===c?.id);
    if(!reply){
      chat.messages.push({id:uid('msg'),role:'user',content:text,status:'done',at:new Date().toISOString()});
      reply={id:uid('msg'),role:'assistant',content:'',status:'thinking',request:text,at:new Date().toISOString()};chat.messages.push(reply);
    }else Object.assign(reply,{status:'thinking',content:'',taskId:null});
    if(chat.title==='新对话'||chat.title==='新任务')chat.title=text.slice(0,32);
    chat.updatedAt=new Date().toISOString();if(chat.tracked){trackConversation(state(),chat,text);delete chat.completedAt;}
    delete chat.awaitingCustomerPrompt;drafts.set(chat.id,'');delete chat.draft;homeDraft='';scrollNext=true;
    ui().conversationId=chat.id;api.navigate('chat');
    Object.assign(reply,{execution:[],startedAt:Date.now(),elapsedMs:0});
    const controller=new AbortController();pending.set(chat.id,{controller,message:reply});redraw();
    const ticker=setInterval(()=>refreshMessage(chat,reply,true),1000);
    try{
      const lookup=customerLookup(text);
      if(lookup){
        const all=searchCustomerRecords(state(),lookup.query,{dormant:lookup.dormant,market:c?.market||'all',limit:501});
        const found=all.slice(0,12);
        Object.assign(reply,{status:'done',engine:'records',mode:'reply',customerIds:found.map(c=>c.id),content:found.length?`根据当前工作区记录找到 ${all.length} 位客户${all.length>12?'，先显示前 12 位':''}。可以查看资料，或选择一位开始制定转化计划。${lookup.dormant?'筛选条件为最近联系已满 14 天；尚未联系过的记录没有混入。':''}
这次查询未访问外部 CRM，也没有发送消息。`:'当前工作区没有找到符合条件的客户。可换一个姓名、电话或车型关键词，或先导入门店资料。'});return;
      }
      const payload={message:text,history,context:c?api.generationPayload({kind:'followup',customerId:c.id,workId:work?.id,prompt:text,conversationId:chat.id,workflow:taskWorkflow(chat,c),sourceSelection:chat.sourceSelection}):null,
        latestArtifact:previous?{kind:previous.format==='poster'?'campaign':previous.kind,title:previous.title,sections:previous.sections,needsPoster:!!previousPoster,language:previous.language,poster:previousPoster?.poster,comparison:previous.comparison,selection:{id:previous.id,format:previousPoster?'poster':previous.format==='comparison'?'comparison':'document',version:previous.artifactVersion||1}}:null};
      const result=await sendChatMessage(payload,{signal:controller.signal,onEvent:event=>onProgress(chat,reply,event)});
      if(reply.status==='cancelled')return;
      if(stale(chat,revision)){reply.status='stale';reply.content='客户资料已变化，本次结果未采用。重试后会参考最新记录。';return;}
      Object.assign(reply,{content:result.reply,mode:result.mode,engine:result.engine,status:'done'});
      if(result.mode==='clarify'&&(!c||c.scope==='store'))chat.awaitingCustomerPrompt=text;
      if(result.mode==='profile'){
        if(!c||c.scope==='store')throw new Error('请先选择一位具体客户。');
        reply.profileProposal=proposeCustomerProfile(chat,reply,c,result.profileProposal);
      }
      if(result.mode==='artifact'){
        if(!c)throw new Error('请先选择客户，再准备对应成果。');
        const action=result.artifactRequest;
        if(action.delivery==='task'){trackConversation(state(),chat,text);chat.market=c.market;}
        delete chat.completedAt;
        if(action.revision&&!previous)throw new Error('上一版成果已失效，请依据最新客户资料重新生成。');
        if(action.revision&&(JSON.stringify(previous)!==JSON.stringify(state().artifacts.find(a=>a.id===previous.id))||(previousPoster&&JSON.stringify(previousPoster)!==JSON.stringify(state().artifacts.find(a=>a.id===previousPoster.id))))){
          reply.status='stale';reply.content='你刚刚修改了这份成果。请重试，我会基于最新版本继续调整。';return;
        }
        reply.status='creating';onProgress(chat,reply,{type:'progress',stage:'artifact_requested'});
        if(ui().conversationId===chat.id&&['home','chat'].includes(ui().page))api.navigate('chat');
        redraw();
        const operation=api.startRun(action.kind,c.id,action.prompt,{background:true,conversationId:chat.id,chatMessageId:reply.id,
          campaignId:chat.campaignId,workflow:taskWorkflow(chat,c),sourceSelection:chat.sourceSelection,needsPoster:action.revision?!!previousPoster:action.needsPoster,languageOverride:action.language,revisionSource:action.revision?previous:null,comparison:action.comparison||(action.revision?previous?.comparison:null),previousArtifact:action.revision?{...previous,sections:[...previous.sections,...(previousPoster?[{label:'当前海报文案',text:JSON.stringify(previousPoster.poster)}]:[])]}:null,
          ...(action.revision&&previousPoster?{posterStyle:{size:previousPoster.poster.size,theme:previousPoster.poster.theme}}:{})});
        reply.taskId=state().tasks.find(t=>t.chatMessageId===reply.id)?.id;
        const task=await operation;
        if(reply.status==='cancelled')return;
        if(task.status!=='review'){reply.status=task.status==='stale'?'stale':'failed';reply.content=task.error||'本次成果未完成，请重试。';return;}
        onProgress(chat,reply,{type:'progress',stage:'saved'},'artifact');
        reply.status='done';reply.artifactId=task.artifactId;reply.posterId=task.posterId;
        if(!action.revision||chat.selectedArtifactId===previous.id||!chat.selectedArtifactId)chat.selectedArtifactId=task.artifactId;
        reply.content=action.revision?`已根据当前选中的${previousPoster?'海报':'文档'}准备新版本。点击下方成果查看，可在版本菜单切换原版。`:`已准备好${task.posterId?'文案和海报':'可编辑成果'}，显示在中间。可以直接编辑，也可以在这里提出修改要求。`;
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
    if(await workbench.handleAction(act,data))return true;
    if(act==='chat-revision-tip'){const a=workbench.selected();if(a){const prompt=`请修改当前选中的${a.format==='poster'?'海报':'文档'}（${a.title}）：`;drafts.set(current().id,prompt);current().draft=prompt;api.save();const input=document.querySelector('#cowork-chat-input');input.value=prompt;input.focus();}return true;}
    if(act==='chat-open'){api.closeModal?.();open(data.customer);}
    if(act==='chat-new'){makeConversation();api.navigate('chat');}
    if(act==='chat-home'){ui().conversationId=state().homeConversationId;prepareHome();api.navigate('home');}
    if(act==='chat-profile'){api.closeModal?.();const chat=makeConversation(data.customer||'');chat.title='记录客户沟通';chat.profileCapture=true;chat.draft='沟通记录：';drafts.set(chat.id,chat.draft);api.save();api.navigate('chat');api.toast('选择客户后，直接描述刚才的沟通，核对后即可记入画像。');}
    if(act==='chat-details'){ui().chatDetails=!ui().chatDetails;api.render();if(ui().chatDetails)document.querySelector('.xp-canvas-sources')?.scrollIntoView?.({block:'nearest'});}
    if(act==='chat-track'){const chat=current()||makeConversation();if(busy(chat))return true;trackConversation(state(),chat);api.save();api.navigate('chat');api.render();api.toast('已加入工作台，继续在这段对话推进。');}
    if(act==='chat-complete'){const chat=current();if(!chat||busy(chat))return true;try{toggleTaskComplete(chat);api.save();api.render();}catch(error){api.toast(error.message);}}
    if(act==='chat-plan-customer')newTask('请根据已有线索资料制定客户转化计划：已知需求、关键顾虑、缺失信息、沟通内容、下一步动作与负责人。',data.id);
    if(act==='chat-copy'){const m=current()?.messages.find(m=>m.id===data.id);if(m)await api.copyText(m.content);}
    if(act==='chat-save'){
      const chat=current(),m=chat?.messages.find(m=>m.id===data.id);if(!m||m.status!=='done'||m.savedArtifactId)return true;
      const c=context(chat),a={id:uid('doc'),customerId:c?.id||'workspace',scope:c?.scope||(!c?'workspace':undefined),customerRevision:c?.contextVersion,kind:'followup',format:'snippet',title:chat.title.slice(0,70)+' · 对话素材',sections:[{label:'对话内容',text:m.content,audience:'internal',dir:'ltr'}],status:'review',createdAt:new Date().toISOString(),language:c?.language||'zh',sources:[c?sourceLabel(c):'Cowork 对话'],engine:m.engine,note:'从对话手动保存的素材，请核对内容和适用对象后使用。'};
      state().artifacts.unshift(a);m.savedArtifactId=a.id;chat.selectedArtifactId=a.id;api.save();api.render();api.toast('已保存为素材，没有创建新任务。');
    }
    if(act==='chat-select'){api.closeModal?.();if(state().conversations.some(c=>c.id===data.id)){ui().conversationId=data.id;scrollNext=true;api.navigate('chat');}}
    if(act==='chat-send-home')await send(document.querySelector('#cowork-home-input').value,{customerId:document.querySelector('#cowork-home-customer').value,fromHome:true});
    if(act==='chat-example'){
      if(ui().homeLanding){homeDraft=data.example;const input=document.querySelector('#cowork-home-input');input.value=homeDraft;input.focus();return true;}
      const chat=current()||makeConversation();drafts.set(chat.id,data.example);chat.draft=data.example;api.save();document.querySelector('#cowork-chat-input').value=data.example;document.querySelector('#cowork-chat-input').focus();
    }
    if(act==='chat-stop'){
      const run=pending.get(current()?.id);if(run){run.message.status='cancelled';run.message.content='已停止这次回复。';run.controller.abort();if(run.message.taskId)api.cancelTask(run.message.taskId);redraw();}
      else{const task=state().tasks.find(t=>t.conversationId===current()?.id&&t.status==='running');if(task){api.cancelTask(task.id);syncGeneration(task.id);redraw();}}
    }
    if(act==='chat-retry'){const m=current()?.messages.find(m=>m.id===data.id);if(m)await send(m.request,{retryId:m.id});}
    if(act==='chat-work'){const w=state().works.find(w=>w.customerId===data.id);if(w){w.activated=true;api.save();ui().workId=w.id;api.navigate('work');}}
    return true;
  }
  function onInput(target){
    workbench.onInput(target);
    if(target.id==='cowork-home-input')homeDraft=target.value;
    if(target.id==='cowork-chat-input'){const chat=current()||makeConversation();drafts.set(chat.id,target.value);chat.draft=target.value;api.save();}
  }
  async function onChange(target){
    if(workbench.onChange(target))return;
    if(target.dataset?.chatSource){const chat=current();if(!chat||busy(chat))return;chat.sourceSelection??={};chat.sourceSelection[target.dataset.chatSource]=target.checked;api.save();return;}
    if(target.id==='cowork-home-customer'){homeCustomer=target.value;return;}
    if(target.id==='cowork-chat-customer'){
      const old=current();if(busy(old))return;
      if((old?.customerId||'')===target.value)return;
      const follow=old?.awaitingCustomerPrompt;
      const draft=drafts.get(old?.id||'new')||'';
      const next=(!old?.messages.length||follow)&&old?old:makeConversation(target.value);next.customerId=target.value;next.tracked=!!old?.tracked;drafts.set(next.id,draft);api.save();api.render();
      if(follow&&target.value)await send(follow);
    }
  }
  function continueChat(id,prompt){const chat=state().conversations.find(c=>c.id===id);if(!chat)return;ui().conversationId=id;if(prompt){drafts.set(id,prompt);chat.draft=prompt;api.save();}api.navigate('chat');}
  function syncGeneration(id,create=false){
    const task=state().tasks.find(t=>t.id===id);if(!task)return null;
    let chat=state().conversations.find(c=>c.id===task.conversationId);
    if(!chat&&create){chat=makeConversation(task.customerId,{home:false});chat.persona=task.persona||(['campaign','review'].includes(task.kind)?'marketing':task.kind==='regional'?'regional':'sales');trackConversation(state(),chat,task.prompt);chat.title=task.title;chat.messages=[{id:uid('msg'),role:'user',status:'done',content:task.prompt,at:task.createdAt},{id:uid('msg'),role:'assistant',taskId:task.id,at:task.createdAt}];task.conversationId=chat.id;}
    if(!chat)return null;
    const m=chat.messages.find(m=>m.taskId===task.id);if(m){Object.assign(m,{status:task.status==='running'?'creating':['failed','stale','cancelled'].includes(task.status)?task.status:'done',content:task.error||(task.status==='running'?'正在准备成果…':'成果已放入工作台，可以在右侧继续讨论和调整。'),request:task.prompt,artifactId:task.artifactId,posterId:task.posterId,engine:state().artifacts.find(a=>a.id===task.artifactId)?.engine});if(task.artifactId&&!chat.selectedArtifactId)chat.selectedArtifactId=task.artifactId;}
    api.save();return chat;
  }
  function openGeneration(id){const chat=syncGeneration(id,true);if(!chat)return;api.closeModal?.();continueChat(chat.id);}
  function captureView(){
    const conversation=document.querySelector('#cowork-conversation'),canvas=document.querySelector('.wb-canvas');
    const messages=document.querySelector('.chat-messages'),paper=document.querySelector('.wb-canvas-scroll');
    if(conversation?.dataset?.conversationId&&Number.isFinite(messages?.scrollTop))viewPositions.set('chat:'+conversation.dataset.conversationId,messages.scrollTop);
    if(canvas?.dataset?.artifactId&&Number.isFinite(paper?.scrollTop))viewPositions.set('artifact:'+canvas.dataset.artifactId,paper.scrollTop);
  }
  function afterRender(){
    const conversation=document.querySelector('#cowork-conversation'),canvas=document.querySelector('.wb-canvas');
    const messages=document.querySelector('.chat-messages'),paper=document.querySelector('.wb-canvas-scroll');
    if(messages&&conversation?.dataset?.conversationId)messages.scrollTop=viewPositions.get('chat:'+conversation.dataset.conversationId)||0;
    if(paper&&canvas?.dataset?.artifactId)paper.scrollTop=viewPositions.get('artifact:'+canvas.dataset.artifactId)||0;
    if(['home','chat'].includes(ui().page)&&scrollNext){scrollNext=false;requestAnimationFrame(()=>document.querySelector('#chat-end')?.scrollIntoView?.({block:'nearest'}));}
  }
  return {render,renderHome,prepareHome,isWorkbench,renderHomeComposer,refreshConnection,onTaskProgress,open,newTask,continueChat,openGeneration,syncGeneration,send,submit,handleAction,onInput,onChange,captureView,afterRender};
}
