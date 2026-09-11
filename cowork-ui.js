import {addVisitSlot,addQuickLead,WORK_ROLES,workStatusLabels,feedbackTypes,openHuman,availableSlots,slotText,applyFeedback,selectVisitSlot,decideWork,recordOutbound,recordReservation,changeHumanTask,campaignAudience,createMorningBrief,isArtifactCurrent,workflowContext,businessContext} from './cowork.js';
import {buildPosterSVG} from './poster.js';
import {scenarios,markets} from './data.js';

export function createCoworkUI(api) {
  const {esc,i,btn,avatar,heading}=api;
  const state=()=>api.state(),ui=()=>api.ui();
  const customer=w=>state().customers.find(c=>c.id===w.customerId);
  const work=id=>state().works.find(w=>w.id===id);
  const scoped=()=>state().works.filter(w=>ui().market==='all'||customer(w).market===ui().market);
  const status=w=>`<span class="badge ${w.status==='booked'?'green':w.status==='service'?'rose':'amber'}">${esc(workStatusLabels[w.status]||'待推进')}</span>`;
  const roleOptions=()=>WORK_ROLES.map(r=>`<option value="${r.id}" ${ui().role===r.id?'selected':''}>${r.label}</option>`).join('');
  const marketOptions=()=>Object.entries(markets).map(([key,label])=>`<option value="${key}" ${ui().market===key?'selected':''}>${label}</option>`).join('');
  const date=value=>new Date(value).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
  const action=(label,act,w,icon,cls='')=>btn(label,act,icon,cls,`data-id="${w.id}"`);
  const liveHuman=w=>openHuman(w.human)&&!['paused','declined'].includes(w.status)&&(w.human.status!=='deferred'||new Date(w.human.dueAt)<=new Date());

  function workCard(w) {
    const c=customer(w);
    return `<button class="cw-work-card" data-act="cw-open" data-id="${w.id}"><div class="row between"><span class="cw-path">${esc(w.plan.label)} / ${markets[c.market]}</span>${status(w)}</div><div class="row cw-person">${avatar(c)}<div><h3>${esc(c.name)}</h3><span>${esc(c.city)} · ${esc(c.vehicle)}</span></div>${i('arrow')}</div><p>${esc(w.goal)}</p><div class="cw-work-next">${i(w.status==='service'?'heart':'users')}<span>${esc(w.human.status==='deferred'?`已延后至 ${date(w.human.dueAt)}`:w.status==='booked'?'已建立到店接待任务':w.human.title)}</span></div><div class="cw-work-meta"><span>v${w.revision} · ${w.events.length} 条工作记录</span><span>${w.posterId?'工作包 + 邀请海报':'工作包 + 沟通提纲'}</span></div></button>`;
  }
  function humanCard(w,full=false){
    const h=w.human,c=customer(w);
    return `<article class="cw-human-card"><div class="row between"><span class="cw-path">${esc(h.owner)} · ${esc(c.name)}</span><span class="badge gray">${h.status==='deferred'?'已延后':'需要你'}</span></div><h3>${esc(h.title)}</h3><p>${esc(h.reason)}</p>${full?`<div class="cw-return"><strong>需要带回</strong>${esc(h.expected)}</div><p class="tiny muted">提醒时间：${date(h.dueAt)}（当前设备时间） · 本地内部待办</p>`:''}<div class="row cw-actions">${action('查看材料','cw-open',w,'arrow','soft sm')}${action('安排 / 回报','cw-human',w,'users','sm')}</div></article>`;
  }
  function renderHome(){
    const list=scoped(),tasks=list.filter(liveHuman),selected=list.find(w=>w.posterId&&w.status!=='paused')||list[0];
    const focus=selected&&customer(selected),poster=state().artifacts.find(a=>a.id===selected?.posterId);
    const groups=[['周末到店',list.filter(w=>!['service','complaint'].includes(w.plan.path)&&!['paused','declined','booked'].includes(w.status)), 'calendar'],['关系与用车',list.filter(w=>w.plan.path==='service'),'heart'],['需要调整',list.filter(w=>w.status==='service'||w.status==='paused'),'refresh']];
    const role=WORK_ROLES.find(r=>r.id===ui().role)||WORK_ROLES[0];
    const lastBrief=state().morningBriefs[0];
    return `${heading('今天的下一步，已经有了依据。',`${esc(state().settings.operator)}，从客户变化开始，把工作推进到一个明确结果。`,`<select class="select" data-change="market" aria-label="工作市场">${marketOptions()}</select>`)}
      <div class="cw-topline"><span class="row">${i('spark')}根据 ${list.length} 位客户的当前资料整理</span><span>本地工作记录 · ${ui().ai.ready?(ui().ai.provider==='demo'?'模板演示已启用':'Copilot 已连接'):'AI 文案待连接'}</span></div>
      <div class="cw-objectives">${groups.map(([title,items,icon])=>`<button class="cw-objective" data-act="${items[0]?'cw-open':'cw-inbox'}" ${items[0]?`data-id="${items[0].id}"`:''}><span class="cw-objective-icon">${i(icon)}</span><div><span>${title}</span><strong>${items.length}<small>项工作</small></strong></div>${i('arrow')}</button>`).join('')}<button class="cw-objective cw-morning" data-act="cw-morning"><span class="cw-objective-icon">${i('doc')}</span><div><span>晨间工作简报</span><strong>${lastBrief?lastBrief.day.slice(5):'08:00'}<small>${lastBrief?'查看简报':'当地时间'}</small></strong></div>${i('arrow')}</button></div>
      <div class="cw-desk"><section><div class="cw-section-title"><h2>正在推进</h2><a href="#inbox" class="link">${tasks.length} 项需要你 ${i('arrow')}</a></div><div class="cw-work-grid">${list.slice().sort((a,b)=>Number(b.status==='service')-Number(a.status==='service')).slice(0,4).map(workCard).join('')||'<div class="empty">这个市场暂无客户工作。</div>'}</div>
      <div class="cw-delegate"><div class="row between"><h3>随时交给 Motive 一件事</h3><span class="tiny muted">带上客户上下文</span></div><textarea id="home-prompt" maxlength="2000" aria-label="描述协作任务" placeholder="为这位客户准备周末邀约，重点解决充电顾虑，交付话术和海报…"></textarea><div class="composer-bottom"><div class="context-picker">${i('users')}<select id="home-customer" aria-label="选择协作客户">${state().customers.filter(c=>ui().market==='all'||c.market===ui().market).map(c=>`<option value="${c.id}" ${c.id===focus?.id?'selected':''}>${esc(c.name)} · ${markets[c.market]}</option>`).join('')}</select></div>${btn('交给 Motive','home-run','arrow','primary')}</div></div></section>
      <aside class="cw-side"><div class="cw-section-title"><h2>现在需要你</h2><a href="#inbox" class="link">全部 ${i('arrow')}</a></div>${tasks.slice(0,1).map(w=>humanCard(w)).join('')||'<div class="cw-human-card"><p>当前没有需要处理的事项。</p></div>'}<div class="cw-section-title"><h2>一起备好的材料</h2><span class="tiny muted">可编辑</span></div>${poster?`<button class="cw-preview-card" data-act="artifact" data-id="${poster.id}"><div class="cw-poster-thumb">${buildPosterSVG(poster.poster,{approved:poster.status==='approved'})}</div><div><span class="eyebrow">PERSONAL INVITATION</span><h3>${esc(focus.name)} 的体验邀请</h3><p>${esc(selected.plan.experience)} · ${poster.language.toUpperCase()}</p><span class="link">编辑海报 ${i('arrow')}</span></div></button>`:'<div class="cw-human-card"><p>新成果会显示在这里。</p></div>'}</aside></div>
      <div class="cw-section-title"><div><h2>把岗位里的整件工作交过来</h2><p>${role.goal}</p></div><select class="select" data-change="role" aria-label="岗位工作场景">${roleOptions()}</select></div><div class="scenario-grid cw-scenarios">${role.kinds.map(id=>{const s=scenarios.find(s=>s.id===id);return s?`<button class="scenario-card" data-act="scenario" data-id="${id}"><div class="scenario-top"><span class="scenario-icon ${s.color}">${i(s.icon)}</span>${i('up')}</div><h3>${esc(s.label)}</h3><p>${esc(s.subtitle)}</p><span class="scenario-footer">${i('doc')}${esc(s.deliver)}</span></button>`:'';}).join('')}</div><footer class="page-foot"><span>初始客户与日历为示例 · 新反馈可持续保存 · 日程在页面打开时检查</span><a class="link" href="#workspace">所有 AI 协作 ${i('arrow')}</a></footer>`;
  }

  function renderWork(){
    const w=work(ui().workId)||scoped()[0];if(!w)return heading('还没有客户工作','添加一位客户后，这里会自动整理下一步。');ui().workId=w.id;
    const c=customer(w),slots=availableSlots(state(),c,w.id),poster=state().artifacts.find(a=>a.id===w.posterId),aiTask=state().tasks.find(t=>t.id===w.aiTaskId),aiDoc=state().artifacts.find(a=>a.id===aiTask?.artifactId);
    const strategy=w.decisions.strategy?.revision===w.revision,activity=w.decisions.activity?.revision===w.revision;
    return `<div class="cw-back"><a href="#home" class="link">← 返回工作台</a><span>${esc(c.city)} · ${esc(c.timezone)} · v${w.revision}</span></div>${heading(esc(w.goal),`${esc(c.name)} · ${esc(w.plan.label)} · 本地持续工作记录`,`${status(w)}${action('客户画像','cw-customer',w,'users')}`)}
      <div class="cw-detail-layout"><section class="cw-detail-main"><div class="cw-cause"><span>${i('spark')}为什么是这一步</span><h2>${esc(w.plan.reason)}</h2><p>${esc(c.need)}</p><div class="cw-source">依据：${esc(c.memories.filter(m=>!m.superseded).at(-1)?.source||'当前客户资料')}</div></div>
      <div class="cw-plan-strip">${w.plan.steps.map((s,n)=>`<div><span>${String(n+1).padStart(2,'0')}</span><p>${esc(s)}</p></div>`).join('')}</div>
      <section class="cw-panel"><div class="cw-section-title"><h2>一次看清，再做决定</h2><span class="badge gray">工作包 v${w.revision}</span></div><div class="cw-decision"><div><strong>跟进策略</strong><p>${esc(w.plan.experience)}；${esc(w.human.expected)}</p></div>${action(strategy?'策略已确认':'确认这版策略','cw-strategy',w,'check',strategy?'soft sm':'primary sm')}</div>${!['complaint','service','qualify'].includes(w.plan.path)?`<div class="cw-decision cw-slot"><div class="grow"><strong>候选体验时间</strong><p>示例日历 · ${esc(c.city)} · 实际资源由门店核实</p><select class="field" id="cw-slot" aria-label="候选体验时间"><option value="">选择客户所在地时段</option>${slots.map(s=>`<option value="${s.id}" ${s.id===w.proposedSlotId?'selected':''} ${s.remaining<1?'disabled':''}>${slotText(s)} · ${s.remaining?'余 '+s.remaining+' 席':'已满'}</option>`).join('')}</select>${slots.length?'':'<p class="cw-warning">没有未来可用时段，请先补充门店安排。</p>'}</div><div>${action('更新安排','cw-slot-save',w,'calendar','sm')}${action('登记门店时段','cw-slot-add',w,'plus','sm')}</div></div><div class="cw-decision"><div><strong>活动与最终内容</strong><p>${activity?'已确认当前时段及已审核海报。':'查看右侧海报，确认车型、时间和对客表达。'}</p></div>${action(activity?'活动已确认':'确认活动与海报','cw-activity',w,'check','sm')}</div>`:''}<div class="cw-actions row">${btn('打开完整工作包','artifact','doc','soft sm',`data-id="${w.briefId}"`)}${action('用 AI 完善材料','cw-generate',w,'spark','sm')}${aiTask?btn('查看 AI 协作','select-task','arrow','sm',`data-id="${aiTask.id}"`):''}</div>${aiTask?.status==='failed'?`<p class="cw-warning">AI 未完成：${esc(aiTask.error)}。当前工作包由本地规则整理。</p>`:aiTask?.status==='running'?'<p class="cw-processing">正在请求模型，完成后会更新这里的材料。</p>':aiDoc?`<div class="cw-ai-result">${i('doc')}<span>${esc(aiDoc.title)}</span>${btn('查看话术','artifact','arrow','sm',`data-id="${aiDoc.id}"`)}</div>`:''}</section>
      <section class="cw-panel"><div class="cw-section-title"><h2>客户有了新变化</h2><span class="tiny muted">一次反馈，联动更新</span></div><form id="cw-feedback-form" data-id="${w.id}"><div class="form-grid"><div class="field-group"><label class="field-label" for="cw-feedback-type">这次发生了什么</label><select class="field" id="cw-feedback-type" name="type">${Object.entries(feedbackTypes).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></div><div class="field-group"><label class="field-label" for="cw-reply-outcome">如果是客户回复</label><select class="field" id="cw-reply-outcome" name="outcome"><option value="unsure">没有明确接受时段</option><option value="accepted">客户明确接受下方时段</option><option value="declined">客户暂不考虑</option></select></div></div><label class="field-label" for="cw-feedback-message">客户原话或已核实的反馈</label><textarea class="field" id="cw-feedback-message" name="message" maxlength="2000" required placeholder="例如：周六上午不方便，下午可以，想带两个儿童座椅试一下。"></textarea><label class="field-label" for="cw-feedback-slot">涉及改期 / 接受的时段（客户当地时间）</label><select class="field" id="cw-feedback-slot" name="slotId"><option value="">时间尚未确认</option>${slots.map(s=>`<option value="${s.id}" ${s.id===w.proposedSlotId?'selected':''} ${s.remaining<1?'disabled':''}>${slotText(s)} · ${s.remaining} 席</option>`).join('')}</select><label class="checkbox cw-confirm"><input type="checkbox" name="confirmed">若记录“问题已解决”，我已取得客户明确确认。</label><div class="row between cw-feedback-footer"><span class="tiny muted">需求变化会以新描述替代旧需求；旧记录保留为历史。</span><button class="btn primary" type="submit">${i('refresh')}更新工作与材料</button></div></form></section>
      <section class="cw-panel"><div class="cw-section-title"><h2>邀约结果，要有三份依据</h2><span class="tiny muted">不代发、不虚报预约</span></div><div class="cw-evidence">${[[!!w.outbound,'实际发送',w.outbound?`手动登记 · ${date(w.outbound.at)}`:'由销售在外部渠道发送'],[w.reply?.outcome==='accepted','客户明确接受',w.reply?({accepted:'已记录指定时段',unsure:'尚未明确接受',declined:'暂不考虑'})[w.reply.outcome]:'等待真实回复'],[!!w.reservation,'预约回执',w.reservation?.reference||'等待外部日历确认']].map(([done,title,sub])=>`<div class="${done?'done':''}">${i(done?'checkCircle':'clock')}<strong>${title}</strong><p>${esc(sub)}</p></div>`).join('')}</div><div class="cw-actions row">${action('记录已发送','cw-outbound',w,'message','sm')}${action('登记预约回执','cw-reservation',w,'calendar','sm')}</div>${w.reservation?`<p class="cw-success">已登记预约 · ${esc(w.reservation.source)}。接待工作已交给 ${esc(w.human.owner)}。</p>`:''}</section>
      <details class="cw-history"><summary>工作依据与变更记录 <span>${w.events.length} 条</span></summary>${w.events.map(e=>`<div><time>${date(e.at)} · v${e.revision}</time><h4>${esc(e.title)}</h4><p>${esc(e.detail)}</p></div>`).join('')}</details></section>
      <aside class="cw-detail-side"><div class="cw-section-title"><h2>需要同事完成</h2></div>${humanCard(w,true)}<div class="cw-section-title"><h2>${poster?'当前邀请海报':'当前服务材料'}</h2></div>${poster?`<button class="cw-large-poster" data-act="artifact" data-id="${poster.id}">${buildPosterSVG(poster.poster,{approved:poster.status==='approved'})}<span>${poster.status==='approved'?'已审核':'草稿'} · 点击编辑 / 导出 PNG</span></button>`:`<div class="cw-human-card"><span class="scenario-icon rose">${i('heart')}</span><h3>先把问题接住</h3><p>${esc(w.human.expected)}</p>${btn('查看沟通提纲','artifact','doc','soft sm',`data-id="${w.briefId}"`)}</div>`}<div class="cw-boundary"><strong>还需要核实</strong><p>${esc(c.concern)}</p><p>报价、权益、实际车源和接待容量以当地门店资料为准。</p></div></aside></div>`;
  }

  function renderInbox(){
    const list=scoped().filter(w=>openHuman(w.human)&&!['paused','declined'].includes(w.status));
    const deferred=list.filter(w=>w.human.status==='deferred'&&!liveHuman(w));
    return `${heading('把人的时间，留给关键一步。','带着准备好的材料去沟通，把新的事实带回来。',`<select class="select" data-change="market" aria-label="任务市场">${marketOptions()}</select>`)}<div class="cw-section-title"><h2>现在需要你 <span class="badge">${list.length-deferred.length}</span></h2><span class="small muted">责任人、所需结果与下一步一起交接</span></div><div class="cw-inbox-grid">${list.filter(liveHuman).map(w=>humanCard(w,true)).join('')||'<p class="muted">当前没有待办。</p>'}</div>${deferred.length?`<div class="cw-section-title"><h2>已安排稍后处理</h2></div><div class="cw-inbox-grid">${deferred.map(w=>humanCard(w,true)).join('')}</div>`:''}`;
  }

  function showHuman(w){
    const h=w.human;
    api.showModal('同事任务 · 安排与回报',esc(customer(w).name),`<div class="cw-return"><strong>${esc(h.title)}</strong>${esc(h.expected)}</div><form id="cw-human-form" data-id="${w.id}"><div class="field-group"><label class="field-label" for="cw-human-action">我要</label><select class="field" id="cw-human-action" name="action"><option value="done">带回沟通结果</option><option value="defer">延后提醒</option><option value="assign">转派同事</option><option value="cancel">暂停这项客户工作</option><option value="resume">恢复内部准备</option></select></div><div class="field-group"><label class="field-label" for="cw-human-result">沟通结果 / 原因</label><textarea class="field" name="result" id="cw-human-result" maxlength="2000" placeholder="只记录确认过的事实。到店同意请在客户回复中另行登记。"></textarea></div><div class="form-grid"><div class="field-group"><label class="field-label" for="cw-human-owner">转派给</label><select class="field" name="owner" id="cw-human-owner">${state().team.map(t=>`<option ${t.name===h.owner?'selected':''}>${esc(t.name)}</option>`).join('')}</select></div><div class="field-group"><label class="field-label" for="cw-human-delay">延后多久</label><select class="field" name="delay" id="cw-human-delay"><option value="2">2 小时</option><option value="4">4 小时</option><option value="24">明天此时</option></select></div></div></form>`,`${btn('取消','close-modal') }<button class="btn primary" type="submit" form="cw-human-form">保存安排</button>`);
  }
  function showReceipt(w,kind){
    const reservation=kind==='reservation';
    api.showModal(reservation?'登记外部预约回执':'记录实际发送',`${esc(customer(w).name)} · 本操作仅更新工作记录`, `<form id="cw-${kind}-form" data-id="${w.id}"><div class="cw-return">${reservation?'只有客户明确接受、外部日历也确认后，才登记预约成功。':'请先在实际渠道完成联系，再记录发送的内容。系统不会代发。'}</div><label class="field-label" for="cw-receipt-value">${reservation?'门店日历 / CRM 的实际回执编号':'发送内容及结果'}</label><input class="field" id="cw-receipt-value" name="${reservation?'reference':'note'}" required maxlength="1000"><label class="checkbox cw-confirm"><input type="checkbox" name="confirmed" required>${reservation?'我已核实客户接受的时段、车辆与人员，并取得真实预约回执。':'我确认已在外部渠道实际发送当前版本。'}</label></form>`,`${btn('取消','close-modal')}<button class="btn primary" form="cw-${kind}-form" type="submit">保存记录</button>`);
  }
  function showMorning(){
    const brief=createMorningBrief(state(),new Date(),true);api.save();
    api.showModal('晨间工作简报',`${brief.day} · ${esc(brief.timezone)} · 生成时的工作区快照`,`<div class="cw-brief-stats"><span><strong>${brief.items.length}</strong>项同事工作</span><span><strong>${brief.booked}</strong>个已登记预约</span><span><strong>${brief.openIssues}</strong>个未结问题</span></div>${brief.items.map(item=>`<button class="cw-brief-row" data-act="cw-open" data-id="${item.workId}"><span><strong>${esc(item.name)}</strong><small>${esc(item.owner)}</small></span><span>${esc(item.title)}</span>${i('arrow')}</button>`).join('')||'<p>没有需要处理的工作。</p>'}<p class="tiny muted">简报每天、每个设置时区只生成一次，保留当时快照。打开工作查看最新变化。页面关闭后不执行日程。</p>`,`${btn('晨报设置','cw-morning-settings','settings')}${btn('关闭','close-modal')}`,'wide');
  }
  function showCampaign(id){
    const campaign=state().campaigns.find(p=>p.id===id),audience=campaignAudience(state(),campaign);
    api.showModal('按客户需求准备活动',esc(campaign.title),`<p class="cw-return">每个客群使用自己的沟通重点和体验安排。下面是准备名单；发送时仍需检查频率、当地时间与授权。</p>${audience.groups.map(g=>`<section class="cw-audience-group"><div class="row between"><h3>${esc(g.label)} · ${g.customers.length} 人</h3>${btn('准备此客群内容','cw-segment-generate','spark','soft sm',`data-id="${campaign.id}" data-segment="${g.id}"`)}</div><p>${esc(g.reason)}</p>${g.customers.map(c=>`<div class="cw-audience-row"><strong>${esc(c.name)}</strong><span>${esc(c.language.toUpperCase())} · ${esc(c.timezone)} · ${esc(c.channel)}</span><small>${esc(c.need)}</small></div>`).join('')}</section>`).join('')||'<p>没有符合条件的客户。</p>'}<h3 class="subheading">排除与交接 · ${audience.excluded.length} 人</h3>${audience.excluded.map(({customer:c,reason})=>`<div class="consent-row"><span>${esc(c.name)}</span><span>${esc(reason)}</span></div>`).join('')||'<p class="small muted">当前没有排除对象。</p>'}`,btn('关闭','close-modal'),'wide');
  }
  async function generateForWork(w,background=false){
    const c=customer(w);
    if(background&&!ui().ai.ready)return;
    if(['paused','declined'].includes(w.status))return;
    const current=state().tasks.find(t=>t.id===w.aiTaskId);
    if(current?.status==='running')return;
    await api.startRun(w.plan.kind,c.id,`请交付这项客户工作的完整材料：${w.goal}。根据当前需求与最新反馈更新话术、体验安排、同事需要带回的信息。${w.posterId?'请同时提供个性化邀请海报文案。':''}`,{workId:w.id,needsPoster:!!w.posterId,background,workflow:workflowContext(state(),w)});
  }

  async function handleAction(act,data){
    if(!act.startsWith('cw-'))return false;
    try{
      const w=work(data.id);
      if(act==='cw-slot-add'){api.showModal('登记门店可约时段',`${esc(customer(w).city)} · ${esc(customer(w).timezone)}`,`<form id="cw-slot-form" data-id="${w.id}"><div class="form-grid"><div class="field-group"><label class="field-label" for="slot-day">当地日期</label><input class="field" name="day" id="slot-day" type="date" required></div><div class="field-group"><label class="field-label" for="slot-time">当地时间</label><input class="field" name="time" id="slot-time" type="time" required></div></div><label class="field-label" for="slot-capacity">确认的接待容量</label><input class="field" id="slot-capacity" type="number" name="capacity" min="1" max="20" value="1" required><label class="checkbox cw-confirm"><input type="checkbox" name="confirmed" required>我已向门店核实该时间的人员与试驾资源。</label></form>`,`<button class="btn primary" form="cw-slot-form" type="submit">保存时段</button>`);return true;}
      if(act==='cw-quick-lead'){api.showModal('先接住一条新咨询','仅凭联系方式建档，其余信息明确留待核实。',`<form id="cw-lead-form"><div class="form-grid"><div class="field-group"><label class="field-label" for="lead-name">客户姓名（可稍后补充）</label><input class="field" id="lead-name" name="name" maxlength="70"></div><div class="field-group"><label class="field-label" for="lead-market">来源市场</label><select class="field" name="market" id="lead-market">${Object.entries(markets).filter(([k])=>k!=='all').map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select></div><div class="field-group"><label class="field-label" for="lead-channel">咨询渠道</label><select class="field" id="lead-channel" name="channel"><option>Email</option><option>WhatsApp</option></select></div><div class="field-group"><label class="field-label" for="lead-contact">联系方式</label><input class="field" id="lead-contact" name="contact" maxlength="150" required></div></div><label class="field-label" for="lead-need">已知咨询内容（选填）</label><textarea class="field" name="need" id="lead-need" maxlength="1000"></textarea></form>`,`<button class="btn primary" form="cw-lead-form" type="submit">建档并准备交接</button>`);return true;}
      if(act==='cw-open'){ui().workId=data.id;api.closeModal();api.navigate('work');return true;}
      if(act==='cw-inbox'){api.navigate('inbox');return true;}
      if(act==='cw-customer'){api.customerModal(customer(w).id);return true;}
      if(act==='cw-human'){showHuman(w);return true;}
      if(act==='cw-outbound'||act==='cw-reservation'){showReceipt(w,act==='cw-outbound'?'outbound':'reservation');return true;}
      if(act==='cw-campaign'){showCampaign(data.id);return true;}
      if(act==='cw-morning'){showMorning();return true;}
      if(act==='cw-morning-settings'){
        const s=state().coworkSettings;
        api.showModal('晨报日程','按团队当地时间准备内部简报',`<form id="cw-morning-form"><div class="field-group"><label class="field-label" for="cw-morning-time">准备时间</label><input class="field" id="cw-morning-time" name="time" type="time" required value="${esc(s.time)}"></div><div class="field-group"><label class="field-label" for="cw-morning-zone">团队时区</label><select class="field" id="cw-morning-zone" name="timezone">${['America/Chicago','America/Los_Angeles','America/New_York','Asia/Dubai','Europe/London','Europe/Berlin'].map(t=>`<option ${s.timezone===t?'selected':''}>${t}</option>`).join('')}</select></div><label class="checkbox"><input type="checkbox" name="enabled" ${s.morningEnabled?'checked':''}>页面打开时自动准备每日简报</label></form>`,`<button class="btn primary" form="cw-morning-form" type="submit">保存日程</button>`);return true;
      }
      if(act==='cw-segment-generate'){
        const p=state().campaigns.find(p=>p.id===data.id),g=campaignAudience(state(),p).groups.find(g=>g.id===data.segment);if(!g)throw new Error('客群已变化，请重新查看名单。');
        const first=state().customers.find(c=>c.id===g.customers[0].id);
        const cohort=g.customers.map(c=>({id:c.id,language:c.language,timezone:c.timezone,channel:c.channel,need:c.need,revision:c.contextVersion}));
        await api.startRun('campaign',first.id,`活动：${p.title}\n客群：${g.label}\n体验重点：${g.experience}\n依据：${g.reason}\n请交付分客群内容、海报及发布日历。具体名单在 cohort 中；海报不得暴露其他客户的资料。不得声称已经发送。`,{campaignId:p.id,cohort});return true;
      }
      if(act==='cw-generate'){await generateForWork(w);return true;}
      if(act==='cw-slot-save'){selectVisitSlot(state(),w.id,document.querySelector('#cw-slot').value);api.save();api.render();api.toast('安排与邀请海报已更新，需要确认新版本。');await generateForWork(w,true);return true;}
      if(act==='cw-strategy'||act==='cw-activity'){decideWork(state(),w.id,act==='cw-strategy'?'strategy':'activity');api.save();api.render();api.toast('已记录这版业务决定。');return true;}
    }catch(error){api.toast(error.message);}
    return true;
  }
  async function handleSubmit(form,data){
    try{
      const w=work(form.dataset?.id);
      if(form.id==='cw-slot-form'){addVisitSlot(state(),w.id,{...data,confirmed:!!data.confirmed});api.save();api.closeModal();api.render();api.toast('门店时段已登记，可以选择新的体验安排。');
      }else if(form.id==='cw-lead-form'){const c=addQuickLead(state(),data);ui().workId='work_'+c.id;api.save();api.closeModal();api.navigate('work');api.toast('新线索已建档，未知信息保留待核实。');await generateForWork(work(ui().workId),true);
      }else if(form.id==='cw-feedback-form'){
        applyFeedback(state(),w.id,{...data,confirmed:!!data.confirmed});api.save();api.render();api.toast('客户理解、工作包与相关草稿已一起更新。');await generateForWork(w,true);
      }else if(form.id==='cw-human-form'){
        changeHumanTask(state(),w.id,{...data,dueAt:new Date(Date.now()+Number(data.delay||2)*3600000).toISOString()});api.save();api.closeModal();api.render();api.toast('内部任务已更新。');if(data.action==='done')await generateForWork(w,true);
      }else if(form.id==='cw-outbound-form'||form.id==='cw-reservation-form'){
        const fn=form.id==='cw-outbound-form'?recordOutbound:recordReservation;fn(state(),w.id,{...data,confirmed:!!data.confirmed});api.save();api.closeModal();api.render();api.toast(form.id==='cw-outbound-form'?'已记录实际发送；预约尚待确认。':'预约回执已登记，接待任务已建立。');
      }else if(form.id==='cw-morning-form'){
        if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.time))throw new Error('请输入有效时间。');
        new Intl.DateTimeFormat('en',{timeZone:data.timezone}).format();
        state().coworkSettings={morningEnabled:!!data.enabled,time:data.time,timezone:data.timezone};api.save();api.closeModal();api.render();api.toast('晨报日程已保存。');
      }
    }catch(error){api.toast(error.message);}
  }
  return {renderHome,renderWork,renderInbox,handleAction,handleSubmit,generateForWork};
}
