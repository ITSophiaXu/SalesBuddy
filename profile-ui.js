import {PROFILE_FIELDS,profileValues,confirmCustomerProfile} from './customer-profile.js';

export function createProfileUI(api) {
  const {esc,i,btn}=api,state=()=>api.state();
  let reviewing=null;
  const find=(chatId,messageId)=>{const chat=state().conversations.find(c=>c.id===chatId);return {chat,message:chat?.messages.find(m=>m.id===messageId)};};
  function proposalCard(chat,m){
    const p=m.profileProposal;if(!p)return '';
    return `<section class="profile-proposal"><div class="row between"><strong>${i('users')} 客户画像更新</strong><span class="badge ${p.status==='saved'?'green':'gray'}">${p.status==='saved'?'已记入画像':p.status==='discarded'?'未记录':'待你核对'}</span></div><p>${p.status==='saved'?`已记住 ${p.savedCount} 条内容，后续话术、选车和转化方案将参考最新画像。`:p.status==='discarded'?'原对话仍保留，客户画像没有改变。':'从销售描述中整理；核对后才会更新客户画像。'}</p><div class="profile-proposal-facts">${(p.savedFacts||p.facts).map(f=>`<div><span>${PROFILE_FIELDS[f.field]}</span><p>${esc(f.value)}${f.type==='inference'?'<small>待核实判断</small>':''}</p></div>`).join('')}</div><div class="row">${p.status==='pending'?btn('核对并记入画像','profile-review','check','primary sm',`data-chat="${chat.id}" data-message="${m.id}"`)+btn('暂不记录','profile-discard',null,'sm',`data-chat="${chat.id}" data-message="${m.id}"`):p.status==='saved'?btn('查看客户画像','customer','users','sm',`data-id="${p.customerId}"`):''}</div></section>`;
  }
  function summary(c){
    return `<section class="profile-summary"><div class="row between"><div><h3>持续积累的客户画像</h3><p>从销售沟通中了解需求与决策条件，保留原话和来源。</p></div>${btn('记录沟通','chat-profile','message','primary sm',`data-customer="${c.id}"`)}</div><div class="profile-dimensions">${Object.entries(PROFILE_FIELDS).map(([key,label])=>{const values=profileValues(c,key);return `<div><span>${label}</span><p class="${values.length?'':'muted'}">${values.length?values.map(esc).join('<br>'):'还没有记录，可在下次沟通时了解'}</p></div>`;}).join('')}</div>${c.memories.some(m=>m.type==='inference'&&!m.superseded)?`<div class="profile-inferences"><strong>销售判断 · 待核实</strong>${c.memories.filter(m=>m.type==='inference'&&!m.superseded).map(m=>`<p>${esc(m.text)}</p>`).join('')}</div>`:''}</section>`;
  }
  function review(chat,m){
    const p=m?.profileProposal,c=state().customers.find(c=>c.id===p?.customerId);
    if(!p||p.status!=='pending'||!c)return;
    reviewing={chatId:chat.id,messageId:m.id};
    api.showModal(`更新 ${c.name} 的画像`,'勾选要记住的内容，可以修改整理结果；客户原话会一并保留。',`<form id="profile-confirm-form">${p.facts.map((f,n)=>`<section class="profile-review-fact"><label class="checkbox"><input type="checkbox" name="include_${n}" checked><strong>${PROFILE_FIELDS[f.field]}</strong></label><blockquote>销售原话：${esc(f.evidence)}</blockquote><label class="field-label" for="profile-field-${n}">画像维度</label><select class="field" id="profile-field-${n}" name="field_${n}" data-profile-field="${n}">${Object.entries(PROFILE_FIELDS).map(([key,label])=>`<option value="${key}" ${key===f.field?'selected':''}>${label}</option>`).join('')}</select><label class="field-label" for="profile-value-${n}">整理后的记录</label><textarea class="field" id="profile-value-${n}" name="value_${n}" maxlength="${f.field==='vehicle'?200:1000}">${esc(f.value)}</textarea><div class="form-grid"><div><label class="field-label" for="profile-type-${n}">记录性质</label><select class="field" id="profile-type-${n}" name="type_${n}"><option value="record" ${f.type==='record'?'selected':''}>销售确认的客户信息</option><option value="inference" ${f.type==='inference'?'selected':''}>销售判断，仍需核实</option></select></div><div><label class="field-label" for="profile-action-${n}">如何更新</label><select class="field" id="profile-action-${n}" name="action_${n}"><option value="add">补充一条记录</option><option value="replace">替换这一类的旧描述</option></select></div></div><p class="profile-previous" id="profile-previous-${n}">当前画像：${profileValues(c,f.field).map(esc).join('；')||'尚未记录'}</p><div class="profile-budget" id="profile-budget-${n}" ${f.field==='budgetNote'?'':'hidden'}><p>如已确认购车总预算，可填写 ${esc(c.currency)} 金额。月供、首付和未确认预算请留空；旧金额将停止用于匹配。</p><div class="form-grid"><input type="number" min="0" max="100000000" class="field" name="budgetMin_${n}" aria-label="预算下限 ${n+1}" placeholder="预算下限"><input type="number" min="0" max="100000000" class="field" name="budgetMax_${n}" aria-label="预算上限 ${n+1}" placeholder="预算上限"></div></div></section>`).join('')}<p class="tiny muted">替换时保留旧记录；待核实判断不会覆盖已确认事实。保存后，旧版话术与方案会提示资料已更新。</p></form>`,`${btn('稍后处理','close-modal',null)}<button class="btn primary" type="submit" form="profile-confirm-form">${i('check')}确认记入画像</button>`,'wide');
  }
  function handleAction(act,data){
    if(!['profile-review','profile-discard'].includes(act))return false;
    const {chat,message}=find(data.chat,data.message);if(!chat||!message?.profileProposal)return true;
    if(act==='profile-review')review(chat,message);
    else if(message.profileProposal.status==='pending'){message.profileProposal.status='discarded';api.save();api.render();}
    return true;
  }
  function handleSubmit(form,data){
    if(form.id!=='profile-confirm-form')return false;
    try{
      const {chat,message}=find(reviewing?.chatId,reviewing?.messageId);
      if(!chat||!message)throw new Error('找不到这段沟通记录。');
      const edits=message.profileProposal.facts.flatMap((f,n)=>data[`include_${n}`]?[{id:f.id,field:data[`field_${n}`]||f.field,value:data[`value_${n}`],type:data[`type_${n}`],action:data[`action_${n}`],budgetMin:data[`budgetMin_${n}`],budgetMax:data[`budgetMax_${n}`]}]:[]);
      confirmCustomerProfile(state(),chat,message,edits);api.save();api.closeModal();api.render();api.toast('客户画像已更新，后续协作会参考这些记录。');
    }catch(error){api.toast(error.message);}
    return true;
  }
  function handleChange(target){if(target.dataset?.profileField==null)return;const index=target.dataset.profileField;if(!/^\d+$/.test(index))return;const {chat}=find(reviewing?.chatId,reviewing?.messageId);const c=state().customers.find(c=>c.id===chat?.customerId);if(!c||!Object.hasOwn(PROFILE_FIELDS,target.value))return;const budget=document.querySelector('#profile-budget-'+index);if(budget)budget.hidden=target.value!=='budgetNote';const previous=document.querySelector('#profile-previous-'+index);if(previous)previous.textContent='当前画像：'+(profileValues(c,target.value).join('；')||'尚未记录');}
  return {proposalCard,summary,handleAction,handleSubmit,handleChange};
}
