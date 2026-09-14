import {markets} from './data.js';
import {FEEDBACK_TYPES,openActions,updateTaskDetails,saveTaskAction,finishTaskAction,recordTaskFeedback} from './task-flow.js';

export function createTaskUI(api) {
  const {esc,i,btn}=api,state=()=>api.state(),ui=()=>api.ui();
  const find=id=>state().conversations.find(c=>c.id===id);
  const current=()=>find(ui().conversationId);
  const stamp=value=>value?new Date(value).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'未设时间';
  const local=value=>{const d=new Date(value||Date.now());return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
  const owners=selected=>[...new Set([selected,state().settings.operator,...state().team.map(t=>t.name)].filter(Boolean))].map(name=>`<option ${name===selected?'selected':''}>${esc(name)}</option>`).join('');
  function renderSummary(chat) {
    const actions=openActions(chat),c=state().customers.find(c=>c.id===chat.customerId);
    return `<div class="ux-task-meta"><span>${i('users')}${esc(chat.owner||state().settings.operator)}${chat.dueDate?' · '+esc(chat.dueDate)+' 前':''}</span>${btn('任务设置','flow-details','edit','sm',`data-id="${chat.id}"`)}</div><details class="ux-task-actions" ${ui().taskActions?'open':''}><summary>下一步与反馈 <span>${actions.length?'还有 '+actions.length+' 项待办':'安排具体动作，记录工作结果'}</span></summary><div class="ux-action-list">${(chat.actions||[]).map(a=>`<div class="ux-action-row ${a.status==='done'?'done':''}"><span>${i(a.status==='done'?'checkCircle':'clock')}</span><div><strong>${esc(a.title)}</strong><small>${esc(a.owner)} · ${stamp(a.dueAt)}</small><p>${esc(a.status==='done'?a.result:'需要带回：'+a.expected)}</p></div>${a.status==='done'?'<span class="badge gray">已回报</span>':`<div>${btn('回报结果','flow-result',null,'sm',`data-id="${chat.id}" data-action-id="${a.id}"`)}${btn('调整','flow-action',null,'sm',`data-id="${chat.id}" data-action-id="${a.id}"`)}</div>`}</div>`).join('')||'<p class="ux-quiet-note">方案准备好后，把电话沟通、报价核实或活动准备安排给具体同事。</p>'}<div class="row ux-action-footer">${btn('添加下一步','flow-action','plus','sm',`data-id="${chat.id}"`)}${c?btn('记录客户反馈','flow-feedback','message','sm',`data-id="${chat.id}"`):''}<a class="link" href="#inbox">查看全部待办</a></div></div></details>`;
  }
  function renderInbox() {
    const rows=state().conversations.filter(c=>c.tracked).flatMap(chat=>(chat.actions||[]).map(a=>({chat,a,c:state().customers.find(c=>c.id===chat.customerId)}))).filter(({chat,a,c})=>(ui().market==='all'||(c?.market||chat.customerId?.split(':')[1])===ui().market)&&(ui().todoFilter==='done'?a.status==='done':a.status!=='done')&&(!ui().todoMine||a.owner===state().settings.operator));
    rows.sort((x,y)=>(Date.parse(x.a.dueAt)||Infinity)-(Date.parse(y.a.dueAt)||Infinity));
    return `<div class="page-heading ux-section-heading"><div><h1>待办</h1><p>明确谁来做、需要带回什么结果。所有安排都能回到原任务。</p></div><select class="select" data-change="market" aria-label="待办市场">${Object.entries(markets).map(([id,label])=>`<option value="${id}" ${ui().market===id?'selected':''}>${label}</option>`).join('')}</select></div><div class="ux-desk-toolbar"><div class="ux-filter"><button data-act="flow-filter" data-id="open" aria-pressed="${ui().todoFilter!=='done'}">待处理</button><button data-act="flow-filter" data-id="done" aria-pressed="${ui().todoFilter==='done'}">已回报</button></div><button class="btn sm" data-act="flow-mine" aria-pressed="${!!ui().todoMine}">${ui().todoMine?'只看我的':'全部负责人'}</button></div><div class="ux-todo-list">${rows.map(({chat,a,c})=>`<article class="ux-todo-row"><div><a href="#chat?conversation=${encodeURIComponent(chat.id)}" class="ux-todo-parent">${esc(chat.goal||chat.title)}</a><h3>${esc(a.title)}</h3><p>${esc(a.status==='done'?a.result:a.expected)}</p><small>${esc(c?.name||markets[chat.customerId?.split(':')[1]]||'未指定对象')} · ${esc(a.owner)} · ${stamp(a.dueAt)}${a.status!=='done'&&a.dueAt&&Date.parse(a.dueAt)<Date.now()?' · 已逾期':''}</small></div><div class="row">${btn('回到任务','chat-select','arrow','sm',`data-id="${chat.id}"`)}${a.status==='done'?'':btn('回报结果','flow-result',null,'soft sm',`data-id="${chat.id}" data-action-id="${a.id}"`)}</div></article>`).join('')||'<div class="empty"><h3>这里没有符合条件的待办</h3><p>打开 Cowork 任务，在“下一步与反馈”里添加具体动作。</p></div>'}</div>`;
  }
  function showDetails(chat){
    api.showModal('任务设置','目标和负责人会同步到工作台。',`<form id="flow-details-form" data-id="${chat.id}"><label class="field-label" for="flow-goal">想达成什么结果</label><textarea class="field" name="goal" id="flow-goal" required maxlength="160">${esc(chat.goal||chat.title)}</textarea><div class="form-grid"><div><label class="field-label" for="flow-owner">负责人</label><select class="field" name="owner" id="flow-owner">${owners(chat.owner||state().settings.operator)}</select></div><div><label class="field-label" for="flow-date">目标日期（选填）</label><input class="field" type="date" id="flow-date" name="dueDate" value="${esc(chat.dueDate||'')}"></div></div></form>`,`${btn('取消','close-modal')}<button class="btn primary" form="flow-details-form" type="submit">保存任务</button>`);
  }
  function showAction(chat,id){
    const a=chat.actions?.find(a=>a.id===id);
    api.showModal(a?'调整下一步':'添加下一步',chat.goal||chat.title,`<form id="flow-action-form" data-id="${chat.id}" data-action-id="${esc(id||'')}"><label class="field-label" for="flow-title">具体做什么</label><input class="field" name="title" id="flow-title" required maxlength="160" value="${esc(a?.title||'')}" placeholder="例如：致电确认预算和旧车置换意向"><label class="field-label" for="flow-expected">完成后需要带回什么结果</label><textarea class="field" name="expected" id="flow-expected" required maxlength="1000" placeholder="例如：客户可接受的总价、月供范围，以及旧车评估时间">${esc(a?.expected||'')}</textarea><div class="form-grid"><div><label class="field-label" for="flow-owner">交给谁</label><select class="field" id="flow-owner" name="owner">${owners(a?.owner||chat.owner||state().settings.operator)}</select></div><div><label class="field-label" for="flow-due">计划完成时间（选填）</label><input class="field" id="flow-due" type="datetime-local" name="dueAt" value="${a?.dueAt?local(a.dueAt):''}"></div></div><p class="ux-quiet-note">当前是本地工作安排，不会向同事发送通知。</p></form>`,`${btn('取消','close-modal')}<button class="btn primary" form="flow-action-form" type="submit">保存下一步</button>`);
  }
  function showResult(chat,id){
    const a=chat.actions?.find(a=>a.id===id);if(!a)return;
    api.showModal('回报工作结果',a.title,`<form id="flow-result-form" data-id="${chat.id}" data-action-id="${a.id}"><div class="cw-return"><strong>需要带回</strong>${esc(a.expected)}</div><label class="field-label" for="flow-result">实际完成了什么</label><textarea class="field" id="flow-result" name="result" required maxlength="2000" placeholder="请记录实际结果；如果是客户的新需求，保存后还可通过“记录客户反馈”更新档案。"></textarea><p class="ux-quiet-note">此记录会回到原任务。客户阶段、预约和订单不会因此自动改变。</p></form>`,`${btn('取消','close-modal')}<button class="btn primary" form="flow-result-form" type="submit">保存结果</button>`);
  }
  function showFeedback(chat){
    const c=state().customers.find(c=>c.id===chat.customerId);if(!c)return;
    api.showModal('记录客户反馈',`${c.name} · 保存后可继续调整同一项任务`, `<form id="flow-feedback-form" data-id="${chat.id}"><label class="field-label" for="flow-feedback-type">发生了什么</label><select class="field" id="flow-feedback-type" name="type">${Object.entries(FEEDBACK_TYPES).map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select><label class="field-label" for="flow-feedback-text">客户原话或已核实的记录</label><textarea class="field" id="flow-feedback-text" name="text" required maxlength="2000" placeholder="例如：总价可以接受，但希望月供不超过 $500，需要重新核实首付方案。"></textarea><div class="form-grid"><div><label class="field-label" for="flow-source">反馈来源</label><input class="field" id="flow-source" name="source" required maxlength="200" value="${esc(state().settings.operator)} · 电话记录"></div><div><label class="field-label" for="flow-occurred">发生时间（当前设备时区）</label><input class="field" id="flow-occurred" name="occurredAt" type="datetime-local" required value="${local()}"></div></div><label class="checkbox cw-confirm"><input name="contacted" type="checkbox">这是一次实际客户联系，同时更新最近联系时间</label><p class="ux-quiet-note">选择需求或顾虑变化，会替换对应当前信息，保留旧记录。未回复只登记联系结果，不算客户重新产生兴趣。</p></form>`,`${btn('取消','close-modal')}<button class="btn primary" form="flow-feedback-form" type="submit">保存并继续任务</button>`);
  }
  async function handleAction(act,data){
    if(!act.startsWith('flow-'))return false;
    const chat=find(data.id)||current();
    if(act==='flow-filter'){ui().todoFilter=data.id;api.render();return true;}
    if(act==='flow-mine'){ui().todoMine=!ui().todoMine;api.render();return true;}
    if(!chat)return true;
    if(act==='flow-details')showDetails(chat);
    if(act==='flow-action')showAction(chat,data.actionId);
    if(act==='flow-result')showResult(chat,data.actionId);
    if(act==='flow-feedback')showFeedback(chat);
    return true;
  }
  function submit(form,data){
    if(!form.id.startsWith('flow-'))return false;
    const chat=find(form.dataset.id);if(!chat)return true;
    try{
      if(form.id==='flow-details-form')updateTaskDetails(state(),chat,data);
      if(form.id==='flow-action-form')saveTaskAction(state(),chat,data,form.dataset.actionId);
      if(form.id==='flow-result-form')finishTaskAction(chat,form.dataset.actionId,data.result);
      if(form.id==='flow-feedback-form')recordTaskFeedback(state(),chat,{...data,contacted:!!data.contacted});
      api.save();api.closeModal();ui().taskActions=true;
      if(form.id==='flow-feedback-form')api.continueChat(chat.id,'请根据刚记录的客户反馈调整方案，说明下一步有什么变化。');
      else api.render();
      api.toast(form.id==='flow-feedback-form'?'反馈已保存，请检查输入框中的要求，再继续调整方案。':'已保存到原任务。');
    }catch(error){api.toast(error.message);}
    return true;
  }
  return {renderSummary,renderInbox,handleAction,submit};
}
