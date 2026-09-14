import {roleItems} from './experience-model.js';
import {markets} from './data.js';
import {CONNECTORS,CRM_TEMPLATE,workspaceItems,previewCRMImport,importCRMRecords,searchCustomerRecords} from './workspace-model.js';
import {initializeCowork,addQuickLead} from './cowork.js';

export function createWorkspaceUI(api) {
  const {esc,i,btn}=api,state=()=>api.state(),ui=()=>api.ui();
  let pendingImport=null;
  let importSequence=0;
  const marketOptions=()=>Object.entries(markets).map(([key,label])=>`<option value="${key}" ${ui().market===key?'selected':''}>${label}</option>`).join('');
  const tabs=(entries,selected)=>`<nav class="ux-tabs" aria-label="当前工作区视图">${entries.map(([id,label])=>`<a href="#${id}" ${selected===id?'aria-current="page"':''}>${label}</a>`).join('')}</nav>`;
  function deskTabs(){return tabs([['desk','任务'],['inbox','待办'],['deliverables','成果'],['automations','定时任务']],['work','workspace'].includes(ui().page)?'desk':ui().page);}
  function dataTabs(){return tabs([['connections','数据连接'],['knowledge','品牌与知识'],['ecosystem','插件、Skills 与 MCP']],ui().page);}
  function home(){
    const recent=(state().conversations||[]).filter(c=>c.messages.length).slice(0,3);
    const needs=workspaceItems(state()).filter(w=>w.id==='review').length;
    return `<div class="ux-home"><div class="ux-home-title"><span class="ux-orbit">${i('spark')}</span><span class="eyebrow">AI 协作 / AUTOMOTIVE COWORK</span><h1>今天，一起推进什么？</h1><p>描述客户沟通，积累画像；一起写话术、选车和推进成交。</p></div>${api.homeComposer()}<div class="ux-home-starters"><button data-act="chat-profile">${i('users')}记录沟通，完善画像</button><button data-act="chat-example" data-example="帮 Sarah 写一句自然的英文跟进话术，先问她是否还有充电方面的问题。">${i('message')}写一句跟进话术</button><button data-act="ux-task-new" data-template="为一个新销售线索制定转化计划，先梳理已有资料、待确认需求、首次沟通重点和下一步跟进。">${i('target')}制定线索转化计划</button><button data-act="ux-task-new" data-template="为本周末制定一份家庭 SUV 营销方案，包含目标客群、邀请内容、活动海报和执行安排。">${i('megaphone')}准备营销方案</button></div><div class="ux-home-foot"><span>${i('book')}客户画像来自销售对话，CRM 提供基础资料</span><a href="#connections">管理资料与连接 ${i('arrow')}</a></div><section class="ux-scenario-launchers" aria-label="核心销售场景"><div class="row between"><h2>把客户关系推进一步</h2><a class="link" href="#customers">客户与画像 ${i('arrow')}</a></div><div class="ux-scenario-grid">${[['唤醒沉睡客户','找回联系的理由，准备个性化跟进与后续安排。','为一位长时间未联系的客户制定唤醒方案：参考历史沟通与画像，解释再次联系的理由，准备话术与跟进节奏，用真实回复衡量进展。'],['促成犹豫客户','找到迟迟未决定的原因，补齐决策所需的信息。','为一位正在犹豫的客户制定成交推进方案：根据画像分析预算、竞品和家庭决策顾虑，给出可核实的选车建议、沟通话术与下一步，用实际订单和付款验证结果。']].map(([title,detail,template])=>`<button data-act="ux-task-new" data-template="${esc(template)}"><strong>${title} ${i('arrow')}</strong><p>${detail}</p></button>`).join('')}<a href="#inventory"><strong>车源与方案 ${i('car')}</strong><p>结合画像匹配当地车源、对比车型与试算费用。</p></a><a href="#campaigns"><strong>营销活动 ${i('megaphone')}</strong><p>从客群分群到活动方案、多语言内容与海报。</p></a></div></section><section class="ux-recent"><div class="row between"><h2>接着上次的工作</h2><a class="link" href="#desk">工作台 ${needs?`· ${needs} 项待跟进`:''} ${i('arrow')}</a></div>${recent.length?recent.map(c=>`<button class="ux-recent-row" data-act="chat-select" data-id="${esc(c.id)}">${i(c.tracked?'target':'message')}<strong>${esc(c.title)}</strong><span>${c.tracked?'任务':'对话'}</span>${i('chevron')}</button>`).join(''):`<p class="ux-empty-note">新对话会自动保留。需要长期跟进的工作，可以随时加入工作台。</p>`}</section></div>`;
  }
  function desk(){
    const rows=roleItems(state(),ui().role,ui().market).filter(r=>{
      const c=state().customers.find(c=>c.id===r.customerId);
      return (ui().market==='all'||(c?.market||r.market)===ui().market)&&(!ui().deskFilter||ui().deskFilter==='all'||r.id===ui().deskFilter)&&(!ui().deskQuery||`${r.title} ${c?.name||''} ${r.owner||''}`.toLowerCase().includes(ui().deskQuery.toLowerCase()));
    });
    return `<div class="page-heading ux-section-heading"><div><h2>进行中的工作</h2><p>打开一项工作，接着上次的成果和对话继续。</p></div>${btn('新建任务','ux-task-new','plus','primary')}</div><form id="ux-desk-search-form" class="ux-desk-search"><div class="search-field">${i('search')}<input class="field" name="query" aria-label="搜索任务目标、客户或负责人" placeholder="搜索任务目标、客户或负责人" value="${esc(ui().deskQuery||'')}" maxlength="200"></div><button class="btn sm" type="submit">搜索</button></form><div class="ux-desk-toolbar"><div class="ux-filter" role="group" aria-label="筛选任务状态">${[['all','全部'],['review','待我处理'],['running','准备中'],['blocked','需处理'],['done','已完成']].map(([id,label])=>`<button data-act="ux-desk-filter" data-id="${id}" aria-pressed="${(ui().deskFilter||'all')===id}">${label}</button>`).join('')}</div><select class="select" data-change="market" aria-label="工作台市场">${marketOptions()}</select></div><div class="ux-work-list"><div class="ux-work-list-head"><span>任务与下一步</span><span>负责人 / 对象</span><span>状态</span></div>${rows.map(r=>{const c=state().customers.find(c=>c.id===r.customerId);return `<button class="ux-work-row" data-act="${r.type==='chat'?'chat-select':r.type==='work'?'cw-open':'select-task'}" data-id="${esc(r.key)}"><span class="ux-work-title"><span class="ux-work-icon">${i(r.type==='work'?'users':r.type==='chat'?'message':'doc')}</span><span><strong>${esc(r.title)}</strong><small>${esc(r.next|| (r.type==='chat'?'继续对话、调整目标或查看成果':'打开查看材料与实际工作记录'))}</small></span></span><span class="ux-work-owner">${esc(r.owner||'待分配')}<small>${esc(c?.name||'门店工作')}</small></span><span class="ux-status ${r.id}"><span class="dot"></span>${r.label}</span></button>`;}).join('')||'<div class="empty"><h3>这里还没有任务</h3><p>在 Cowork 中说出目标，或从“新建任务”开始。</p></div>'}</div><p class="ux-quiet-note">“已完成”表示该项工作完成。实际成交、付款和预约须以门店系统记录为准。</p>`;
  }
  function connections(){
    return `<div class="page-heading ux-section-heading"><div><h1>资料与连接</h1><p>让 Cowork 参考门店自己的资料，每次使用都有来源可查。</p></div>${btn('导入客户 CSV','ux-import','plus','primary')}</div>${dataTabs()}<section class="ux-source-strip"><div><span class="ux-source-icon">${i('book')}</span><div><strong>当前工作区资料</strong><p>${state().customers.length} 位客户 · ${state().knowledge.length} 条团队知识 · ${state().vehicles.length} 款示例车型</p></div></div><span class="ux-status active">本地可用</span></section><p class="ux-source-caption">初始数据为示例；导入记录保留文件来源与时间。当前没有已连接的外部业务系统。</p>${state().dataSources.length?`<section class="ux-imported"><h2>已导入的客户资料</h2>${state().dataSources.map(s=>`<div><span>${i('doc')}<strong>${esc(s.name)}</strong></span><small>${s.count} 位客户 · ${new Date(s.importedAt).toLocaleDateString('zh-CN')} · 文件快照</small><a class="link" href="#customers">查看客户 ${i('arrow')}</a></div>`).join('')}</section>`:''}<div class="ux-section-label"><h2>连接门店系统</h2><p>从读取资料开始，按工作需要逐步开放能力。</p></div><div class="ux-connector-grid">${CONNECTORS.map(c=>{const saved=state().connectionRequests.find(r=>r.id===c.id);return `<article class="ux-connector"><div class="row between"><span class="ux-connector-symbol">${i(c.icon)}</span><span class="badge gray">${saved?'接入需求已保存':'未连接'}</span></div><span class="eyebrow">${c.category}</span><h3>${c.name}</h3><p>${c.description}</p><div class="ux-connector-bottom"><span>${saved?'等待实际接口与授权':'尚未读取外部数据'}</span>${btn('接入准备','ux-connector',null,'sm',`data-id="${c.id}"`)}</div></article>`;}).join('')}</div><details class="ux-disclosure"><summary>接入后，团队怎样使用资料？</summary><div class="ux-steps"><p><b>01 · 确定范围</b>管理员选择市场、门店、记录类型与人员权限。</p><p><b>02 · 校验数据</b>测试客户编号、字段映射、更新时间与联系许可。</p><p><b>03 · 在对话里使用</b>员工查询客户或制定方案，答案标注记录来源和资料时间。</p><p><b>04 · 关键动作可确认</b>写回 CRM、正式报价和发送消息需要真实连接与对应授权。</p></div></details>`;
  }
  function showConnector(id){
    const c=CONNECTORS.find(c=>c.id===id);if(!c)return;
    const saved=state().connectionRequests.find(r=>r.id===id);
    api.showModal(c.name,'准备接入信息 · 当前尚未连接',`<div class="ux-connector-note"><strong>希望支持的工作</strong><p>${esc(c.description)}</p><strong>需要的数据</strong><p>${esc(c.fields)}</p><strong>接入前需要确认</strong><p>${esc(c.requires)}</p></div><form id="ux-connector-form" data-id="${c.id}"><label class="field-label" for="ux-system">实际系统 / 数据源名称</label><input class="field" id="ux-system" name="system" required maxlength="120" value="${esc(saved?.system||'')}" placeholder="例如：门店当前使用的 CRM 产品名称"><label class="field-label" for="ux-scope">希望接入的门店与资料范围</label><textarea class="field" id="ux-scope" name="scope" required maxlength="1000" placeholder="例如：美国某门店，由本人负责的客户、联系记录和销售阶段">${esc(saved?.scope||'')}</textarea><p class="ux-quiet-note">这里仅保存接入需求。请勿填写密码或访问密钥；正式接入需通过服务端认证，并完成连接测试。</p></form>`,`${btn('关闭','close-modal')}<button class="btn primary" form="ux-connector-form" type="submit">保存接入需求</button>`);
  }
  function showImport(){
    importSequence++;
    pendingImport=null;
    api.showModal('导入客户资料','从门店 CRM 导出 CSV，在导入前核对字段与记录。',`<div class="ux-steps"><p><b>1. 选择文件</b>UTF-8 CSV，最多 500 行、2 MB。支持电话、姓名、市场、车型与需求等字段。</p><p><b>2. 查看预览</b>重复电话号码会跳过，不覆盖已有客户。空白预算与需求保留待确认。</p><p><b>3. 确认导入</b>保存到当前浏览器工作区。联系许可仅采纳文件中的明确记录。</p></div><div class="ux-upload"><label class="field-label" for="ux-crm-file">选择客户 CSV</label><input class="field" type="file" accept=".csv,text/csv" id="ux-crm-file"></div><div id="ux-import-preview" aria-live="polite"></div>`,`${btn('下载字段模板','ux-import-template','download')}${btn('关闭','close-modal')}`,'wide');
  }
  async function handleFile(target){
    if(target.id!=='ux-crm-file')return;
    const file=target.files?.[0];if(!file)return;
    pendingImport=null;const sequence=++importSequence;
    const output=document.querySelector('#ux-import-preview');
    try{
      if(file.size>2000000)throw new Error('文件超过 2 MB，请分批导入。');
      const text=await file.text();if(sequence!==importSequence||!output.isConnected)return;const preview=previewCRMImport(state(),text);pendingImport={text,preview,name:file.name};
      output.innerHTML=`<div class="ux-preview-summary">${preview.total} 条记录 · ${preview.valid.length} 条可导入 · ${preview.duplicates.length} 条重复 · ${preview.errors.length} 条有误</div>${preview.errors.length?`<div class="ux-import-errors">${preview.errors.slice(0,8).map(e=>`<p>${esc(e)}</p>`).join('')}</div>`:''}<div class="table-wrap"><table><thead><tr><th>姓名</th><th>电话</th><th>市场 / 车型</th><th>需求</th></tr></thead><tbody>${preview.valid.slice(0,8).map(r=>`<tr><td>${esc(r.name)}</td><td>${esc(r.phone)}</td><td>${esc(r.market)} / ${esc(r.vehicle||'待确认')}</td><td>${esc(r.need||'待确认')}</td></tr>`).join('')}</tbody></table></div><p class="ux-quiet-note">展示前 8 条。预算、意向分数与未提供的资料不会自动推断。来源：${esc(file.name)}</p>${btn('确认导入客户','ux-import-confirm','check','primary',preview.errors.length||!preview.valid.length?'disabled':'')}`;
    }catch(error){if(sequence===importSequence&&output.isConnected)output.innerHTML=`<p class="ux-import-errors">${esc(error.message)}</p>`;}
  }
  async function handleAction(act,data={}){
    if(!act.startsWith('ux-'))return false;
    if(act==='ux-task-new')api.newTask(data.template||'');
    if(act==='ux-lead'){
      api.showModal('新增销售线索','从电话号码和已有信息开始，其余需求可以边沟通边补充。',`<form id="ux-lead-form"><div class="form-grid"><div><label class="field-label" for="ux-lead-name">客户姓名（选填）</label><input class="field" name="name" id="ux-lead-name" maxlength="70" placeholder="Jamie"></div><div><label class="field-label" for="ux-lead-market">所在市场</label><select class="field" id="ux-lead-market" name="market">${Object.entries(markets).filter(([id])=>id!=='all').map(([id,label])=>`<option value="${id}" ${ui().market===id?'selected':''}>${label}</option>`).join('')}</select></div></div><label class="field-label" for="ux-lead-phone">电话号码 *</label><input class="field" type="tel" name="contact" id="ux-lead-phone" required maxlength="30" placeholder="+1 202 555 0148"><label class="field-label" for="ux-lead-need">已有客户信息（选填）</label><textarea class="field" name="need" id="ux-lead-need" maxlength="1000" placeholder="例如：官网留下电话，关注家庭 SUV，想了解总费用。"></textarea><label class="field-label" for="ux-lead-source">线索来源</label><input class="field" name="source" id="ux-lead-source" maxlength="120" placeholder="例如：官网咨询 / 车展 / 门店来电"><p class="ux-quiet-note">未知预算、意向和联系许可保留待确认。</p></form>`,`${btn('取消','close-modal')}<button class="btn primary" type="submit" form="ux-lead-form">保存并制定转化计划</button>`);
    }
    if(act==='ux-desk-filter'){ui().deskFilter=data.id;api.render();}
    if(act==='ux-connector')showConnector(data.id);
    if(act==='ux-import')showImport();
    if(act==='ux-import-template')api.download('\uFEFF'+CRM_TEMPLATE,'Motive-CRM客户导入模板.csv','text/csv;charset=utf-8');
    if(act==='ux-import-confirm'){
      try{if(!pendingImport)throw new Error('请重新选择文件。');const preview=previewCRMImport(state(),pendingImport.text);const source=importCRMRecords(state(),preview,{name:pendingImport.name});initializeCowork(state());api.save();pendingImport=null;api.closeModal();ui().query='';ui().market='all';ui().stage='all';api.navigate('customers');api.toast(`已导入 ${source.count} 位客户，保留文件来源；没有发送消息。`);}catch(error){api.toast(error.message);}
    }
    return true;
  }
  function submit(form,data){
    if(form.id==='ux-desk-search-form'){ui().deskQuery=data.query.trim();api.render();return true;}
    if(form.id==='ux-lead-form'){
      try{
        if(!/^\+?[\d\s().-]{7,30}$/.test(data.contact)||data.contact.replace(/\D/g,'').length<7||data.contact.replace(/\D/g,'').length>15)throw new Error('请输入有效的电话号码，建议包含国家区号。');
        if(searchCustomerRecords(state(),data.contact).length)throw new Error('这个电话已有客户，请搜索并接续原档案。');
        const c=addQuickLead(state(),{...data,channel:'WhatsApp'});c.intentUnknown=true;c.source=data.source?.trim()||'手动新增';c.recordOrigin='manual';c.next='确认购车需求，安排首次跟进';
        api.save();api.closeModal();api.newTask('请根据这条销售线索的已有信息制定转化计划，整理已知事实、需要确认的问题、首次沟通内容和下一步安排。',c.id);
        api.toast('线索已保存，在 Cowork 中继续制定转化计划。');
      }catch(error){api.toast(error.message);}
      return true;
    }
    if(form.id!=='ux-connector-form')return false;
    const id=form.dataset.id;if(!CONNECTORS.some(c=>c.id===id))return true;
    state().connectionRequests=state().connectionRequests.filter(r=>r.id!==id);
    state().connectionRequests.push({id,system:data.system.trim().slice(0,120),scope:data.scope.trim().slice(0,1000),updatedAt:new Date().toISOString()});
    api.save();api.closeModal();api.render();api.toast('已保存接入需求，外部系统尚未连接。');return true;
  }
  return {home,desk,connections,deskTabs,dataTabs,handleAction,handleFile,submit};
}
