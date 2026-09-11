import {uid, localParts, daysSince, vehicleMatches} from './domain.js';
import {createPoster} from './poster.js';

export const WORK_ROLES = [
  {id:'sales', label:'销售', kinds:['intake','testdrive','quote'], goal:'把线索推进到有效到店'},
  {id:'marketing', label:'营销', kinds:['campaign','followup'], goal:'为不同需求准备内容与海报'},
  {id:'relationship', label:'客户经理', kinds:['relationship','aftersales'], goal:'找到有理由的关系经营机会'},
  {id:'manager', label:'市场经理', kinds:['review','campaign'], goal:'把活动反馈变成下一轮行动'},
  {id:'regional', label:'区域负责人', kinds:['regional','review'], goal:'定位跨店瓶颈，落实责任与期限'},
  {id:'service', label:'售后', kinds:['aftersales','relationship'], goal:'安排服务，优先处理未结问题'},
  {id:'presales', label:'售前', kinds:['intake','quote'], goal:'补齐未知，交给销售直接接续'}
];

const paths = {
  complaint:{label:'服务挽回',goal:'先解决服务问题',reason:'有未解决的服务反馈，促销不适合当前关系。',ask:'确认问题进展、处理负责人，以及下一次答复时间。',owner:'Service team',steps:['暂停促销与旧邀约','整理问题和已做的处理','由售后联系并记录解决证据'],experience:'服务问题沟通',kind:'aftersales'},
  service:{label:'车主关怀',goal:'把用车问题接住',reason:'客户已进入用车阶段，应先了解真实体验与里程。',ask:'带回当前里程、使用问题和方便接听的时间。',steps:['梳理交付与使用记录','确认里程及保养条件','安排服务并记录客户确认'],experience:'用车与服务回访',kind:'aftersales'},
  fleet:{label:'企业采购',goal:'推进企业试驾与采购条件',reason:'客户明确提出企业用车，需要对齐采购与体验安排。',ask:'确认联系人权限、体验人数和可到店时间；核实当地规格证明。',steps:['核实企业采购与规格要求','协调接待人员及试驾车','准备本地采购资料与邀约'],experience:'企业 SUV 体验',kind:'testdrive'},
  charging:{label:'充电体验',goal:'把充电顾虑变成可验证的体验',reason:'充电条件尚未确认，先准备使用场景核实，再安排试驾。',ask:'确认物业安装条件、日常充电方式及可到店时间。',steps:['列出充电条件待核实项','准备空间与充电体验','确认接待时段，再讨论购车方案'],experience:'空间与充电体验',kind:'testdrive'},
  tradein:{label:'置换评估',goal:'让评估与试驾一次完成',reason:'有明确的置换需求，估值必须依据实车评估。',ask:'确认旧车资料、是否带车到店，以及评估师可用时间。',steps:['准备旧车资料清单','协调评估师与试驾时段','提供费用方案，不预填置换估值'],experience:'置换评估与试驾',kind:'testdrive'},
  family:{label:'家庭体验',goal:'安排符合家庭需要的试驾',reason:'客户提到家庭空间，需要围绕实际乘坐安排体验。',ask:'确认同行人数、儿童座椅及到店时间。',steps:['核实同行与空间需求','准备儿童座椅和后排体验','采用预约接待，减少等候'],experience:'家庭空间体验',kind:'testdrive'},
  qualify:{label:'需求识别',goal:'补齐需求，再给合适的建议',reason:'当前资料不足以确定下一步体验，先核实关键需求。',ask:'确认用途、购车时间、预算口径及关注车型。',steps:['整理已有记录与未知','准备少量有针对性的追问','形成销售交接卡'],experience:'车型需求沟通',kind:'intake'}
};
export const feedbackTypes = {reply:'客户新回复',need:'需求有变化',reschedule:'客户改期',complaint:'新增投诉 / 未结服务问题',resolution:'客户确认问题已解决',withdraw:'客户退订'};
export const workStatusLabels = {active:'等待关键确认',waiting:'等待客户回复',booked:'已登记预约',service:'先处理服务',paused:'已暂停',declined:'客户暂不考虑'};
export const openHuman = h => h && !['done','cancelled'].includes(h.status);
const nowISO = now => new Date(now).toISOString();
const getCustomer = (state,id) => state.customers.find(c=>c.id===id);
const getWork = (state,id) => state.works.find(w=>w.id===id);
const isOwner = c => ['已成交','售后维护'].includes(c.stage);

export function classifyCustomer(c) {
  if(c.serviceIssue?.status==='open')return 'complaint';
  if(isOwner(c))return 'service';
  const value=[c.need,c.concern].join(' ');
  if(/企业|车队|fleet|corporate/i.test(value))return 'fleet';
  if(/充电|charging/i.test(value))return 'charging';
  if(/置换|评估|trade.?in/i.test(value))return 'tradein';
  if(/孩子|儿童|家庭|后排|family|child/i.test(value))return 'family';
  return 'qualify';
}
export function workPlan(c) {
  const path=classifyCustomer(c), plan={path,...paths[path]};
  if(c.need&&/不.*等|无需等|不想等|no wait/i.test(c.need))plan.steps=[...plan.steps.slice(0,2),'先核对接待时间，安排预约体验以减少等候'];
  return plan;
}
export function logWork(w,title,detail,now=new Date()) {
  w.events.unshift({id:uid('event'),title,detail,at:nowISO(now),revision:w.revision});
}
function localDate(c,now){const p=localParts(c.timezone,now);return `${p.year}-${p.month}-${p.day}`;}

// Local appointment inventory is explicitly sample data. Receipt entries are
// separate, human-recorded evidence from the dealership's actual calendar.
function seedSlots(state,now) {
  for(const c of state.customers){
    if(!c.city||c.city==='城市待确认')continue;
    const key=`${c.market}:${c.city}:${c.timezone}`;
    if(state.visitSlots.some(s=>s.locationKey===key))continue;
    const local=new Date(`${localDate(c,now)}T12:00:00Z`);
    local.setUTCDate(local.getUTCDate()+((6-local.getUTCDay()+7)%7||7));
    const date=local.toISOString().slice(0,10);
    for(const hour of ['10:00','14:00'])state.visitSlots.push({id:uid('slot'),locationKey:key,market:c.market,city:c.city,timezone:c.timezone,day:date,time:hour,capacity:1,source:'本地示例接待日历'});
  }
}
export function availableSlots(state,c,workId,now=new Date()) {
  const p=localParts(c.timezone,now), current=`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  return state.visitSlots.filter(s=>s.market===c.market&&s.city===c.city&&s.timezone===c.timezone&&`${s.day}T${s.time}`>current).map(s=>{
    const used=state.works.filter(w=>w.id!==workId&&w.reservation?.slotId===s.id&&w.reservation?.status==='confirmed').length;
    return {...s,remaining:Math.max(0,s.capacity-used)};
  });
}
export const slotText=s=>s?`${s.day} ${s.time} · ${s.timezone}`:'时段待确认';

export function initializeCowork(state,now=new Date()) {
  state.works??=[];state.visitSlots??=[];state.morningBriefs??=[];
  state.coworkSettings??={morningEnabled:true,time:'08:00',timezone:'America/Chicago'};
  if(!state.coworkVersion&&!state.automations.some(a=>a.id==='a-segment'))state.automations.push({id:'a-segment',name:'分客群活动 · 内容与海报准备',description:'针对家庭体验客群，检查最新需求与服务状态，按当地时间准备活动文案和海报，全部进入审核。',segment:'family',kind:'campaign',cadence:7,hour:14,enabled:false,lastRun:null,createdAt:nowISO(now)});
  state.team??=[{name:state.settings.operator,role:'销售顾问'},{name:'Mia Wang',role:'客户经理'},{name:'Service team',role:'售后负责人'}];
  for(const c of state.customers){
    c.contextVersion??=1;
    for(const m of c.memories){m.id??=uid('memory');m.type??='record';m.at??=c.lastContact||nowISO(now);}
  }
  seedSlots(state,now);
  for(const c of state.customers){
    if(state.works.some(w=>w.customerId===c.id))continue;
    const w={id:`work_${c.id}`,customerId:c.id,revision:c.contextVersion,events:[],decisions:{},status:'active',createdAt:nowISO(now),feedback:[]};
    state.works.push(w);
    logWork(w,'已整理已有记录',`${c.memories.length} 条客户记忆；车源限定在 ${c.market} / ${c.currency}。`,now);
    prepareWork(state,w,'建立工作记录',now);
  }
  state.coworkVersion=1;
  return state;
}

export function prepareWork(state,w,reason,now=new Date()) {
  const c=getCustomer(state,w.customerId), plan=workPlan(c);
  if(w.reply?.outcome==='accepted'&&c.serviceIssue?.status!=='open'){
    plan.goal='确认预约依据，把接待准备好';plan.ask='核实门店预约回执、试驾车与接待人员；不能只凭客户同意占位。';
    plan.steps=['核对客户接受的时段','取得外部日历预约回执','安排符合需要的接待'];
  }
  w.plan=plan;w.goal=plan.goal;
  if(c.doNotContact||w.manuallyPaused)w.status='paused';
  else if(c.serviceIssue?.status==='open')w.status='service';
  else if(!['paused','declined','booked','waiting'].includes(w.status))w.status='active';
  const keepHuman=w.human&&openHuman(w.human)&&w.human.path===plan.path;
  w.human=keepHuman?{...w.human,title:plan.ask,expected:plan.ask,reason:plan.reason}:{id:uid('human'),path:plan.path,title:plan.ask,reason:plan.reason,owner:plan.owner||c.owner||state.settings.operator,status:'open',dueAt:nowISO(new Date(now).getTime()+4*3600000),expected:plan.ask};
  if(w.status==='paused'||w.status==='declined')w.human.status='cancelled';
  const localVehicles=vehicleMatches(c,state.vehicles);
  const slot=state.visitSlots.find(s=>s.id===w.proposedSlotId);
  const facts=c.memories.filter(m=>!m.superseded&&m.type!=='inference');
  const sections=[
    {label:'目标与判断依据',text:`${plan.goal}\n${plan.reason}\n本次变化：${reason}`},
    {label:'已记录的客户需要',text:`${c.need||'用途待确认'}\n${facts.map(m=>`• ${m.text}（${m.source}）`).join('\n')}`},
    {label:'待核实，不能作为承诺',text:`${c.concern||'预算口径、购车时间与本地配置待核实'}\n${localVehicles.length?`${localVehicles.length} 款同市场示例车源；实际配置、价格与可用性需门店确认。`:'尚无同市场车源，需先补充本地资料。'}\n${slot?`候选时段：${slotText(slot)}，来源为示例日历，实际接待容量需核实。`:'接待时间及容量待确认。'}`},
    {label:'接下来如何推进',text:plan.steps.map((s,n)=>`${n+1}. ${s}`).join('\n')},
    {label:'交给同事的关键工作',text:`${w.human.owner}：${w.human.title}\n需要带回：${w.human.expected}`},
    {label:'客户结果',text:`${w.reply?`客户原话：${w.reply.text}\n回复判断：${({accepted:'明确接受所选时段',unsure:'未明确接受',declined:'暂不考虑'})[w.reply.outcome]||'待核实'}`:'尚无新回复。'}\n发送记录、客户明确接受、预约回执分开记录；仅发送消息不能更新为已预约。`}
  ].map(s=>({...s,audience:'internal',dir:'ltr'}));
  const brief={id:uid('doc'),customerId:c.id,workId:w.id,customerRevision:c.contextVersion,kind:'journey',title:`${c.name.split(' ')[0]} · ${plan.label}工作包`,sections,status:'review',createdAt:nowISO(now),language:c.language,sources:facts.map(m=>m.source),engine:'rules',note:'根据当前工作区记录整理的内部工作包；属于本地业务规则产物，未调用大模型，未查询外部日历或发送消息。'};
  if(w.briefId){const old=state.artifacts.find(a=>a.id===w.briefId);if(old&&!old.staleReason){old.staleReason=reason;old.status='stale';}}
  state.artifacts.unshift(brief);w.briefId=brief.id;
  if(!['complaint','service','qualify'].includes(plan.path)&&!c.doNotContact&&!['paused','declined'].includes(w.status)){
    const poster=createPoster({customer:c,workspaceName:state.settings.name});
    const words={
      charging:['Space to explore.','Bring your charging questions. We can review the conditions together.'],
      tradein:['Your next chapter.','Explore your next drive and discuss a vehicle appraisal.'],
      fleet:['A drive for your team.','Discuss local specifications, service and your team’s needs.'],
      family:['Room for your everyday.','Explore the space that matters to your family.']
    }[plan.path];
    const copy=c.language==='ar'?{headline:'تجربة تناسب احتياجاتك',subheadline:'نراجع احتياجاتك ونرتب تجربة مناسبة بعد تأكيد التفاصيل.',details:slot?`${slot.day} ${slot.time} · ${slot.timezone} · موعد مقترح`:'الوقت والتوفر بانتظار التأكيد',cta:'طلب موعد',disclaimer:'تصميم مبدئي. يجب تأكيد السيارة والموعد والتفاصيل محلياً.'}:c.language==='de'?{headline:'Platz für Ihren Alltag.',subheadline:'Erleben Sie das Fahrzeug passend zu Ihren Bedürfnissen.',details:slot?`${slotText(slot)} · Terminvorschlag`:'Termin und Verfügbarkeit sind noch zu bestätigen.',cta:'Termin anfragen',disclaimer:'Entwurf. Fahrzeug und Termin vor Ort bestätigen.'}:{headline:words[0],subheadline:words[1],details:slot?`${slotText(slot)} · Proposed visit`:`${c.city} · Appointment details to be confirmed`,cta:'Request a visit',disclaimer:'Draft invitation. Vehicle, local terms and appointment subject to confirmation.'};
    Object.assign(poster,{workId:w.id,customerRevision:c.contextVersion,engine:'rules',title:`${c.name.split(' ')[0]} · ${plan.label}邀请海报`});
    Object.assign(poster.poster,copy,{kicker:'A VISIT, BUILT AROUND YOU',vehicle:c.vehicle,language:c.language});
    poster.language=c.language;poster.sections=[{label:'海报文案',text:copy.headline+'\n'+copy.subheadline}];
    if(w.posterId){const old=state.artifacts.find(a=>a.id===w.posterId);if(old&&!old.staleReason){old.staleReason=reason;old.status=old.status==='contacted'?'contacted':'stale';}}
    state.artifacts.unshift(poster);w.posterId=poster.id;
  }else w.posterId=null;
  logWork(w,'工作包已更新',`${plan.label} · ${plan.steps.join(' → ')}。${w.posterId?'邀请海报已作为草稿备好。':'已准备内部沟通提纲。'}`,now);
  return w;
}

export function isArtifactCurrent(state,a){return !!a&&!a.staleReason&&(!a.customerRevision||getCustomer(state,a.customerId)?.contextVersion===a.customerRevision)&&(!a.cohort||a.cohort.every(c=>getCustomer(state,c.id)?.contextVersion===c.revision));}
export function invalidateCustomer(state,customerId,reason,now=new Date()) {
  const c=getCustomer(state,customerId);c.contextVersion=(c.contextVersion||1)+1;
  for(const a of state.artifacts.filter(a=>(a.customerId===customerId||a.cohort?.some(x=>x.id===customerId))&&!a.staleReason)){
    a.staleReason=reason;delete a.approvedAt;if(a.status!=='contacted')a.status='stale';
  }
  for(const t of state.tasks.filter(t=>(t.customerId===customerId||t.cohort?.some(x=>x.id===customerId))&&!['failed','cancelled','stale'].includes(t.status))){t.staleReason=reason;if(t.status!=='contacted')t.status='stale';}
  const w=state.works.find(w=>w.customerId===customerId);
  if(w){
    w.revision=c.contextVersion;w.decisions={};w.status='active';w.aiTaskId=null;w.outbound=null;
    if(w.reservation){w.reservationHistory??=[];w.reservationHistory.push({...w.reservation,status:'needs_reconfirmation',reason});w.reservation=null;}
    if(w.reply){w.replyHistory??=[];w.replyHistory.push(w.reply);w.reply=null;}
    if(c.stage==='已约试驾'){c.stage='需求确认';c.next='客户资料变化，需重新确认预约';}
    logWork(w,'相关草稿与确认已失效',`${reason}。已发送记录保留；待执行安排需要重审。`,now);
  }
  return w;
}

export function updateCustomerContext(state,customerId,reason,now=new Date()) {
  const w=invalidateCustomer(state,customerId,reason,now);if(w)prepareWork(state,w,reason,now);return w;
}

export function applyFeedback(state,workId,input,now=new Date()) {
  const w=getWork(state,workId),c=getCustomer(state,w?.customerId);
  if(!w||!c)throw new Error('工作记录不存在。');
  const message=String(input.message||'').trim();if(!message||message.length>2000)throw new Error('请填写 1–2000 字的真实反馈。');
  if(!Object.hasOwn(feedbackTypes,input.type))throw new Error('请选择反馈类型。');
  const slot=input.slotId?availableSlots(state,c,w.id,now).find(s=>s.id===input.slotId):null;
  if(input.slotId&&!slot)throw new Error('该时段不属于客户所在地或已过期，请重新选择。');
  if(input.type==='reply'&&input.outcome==='accepted'&&(!slot||slot.remaining<1))throw new Error('请先选择仍有名额的时段，再记录客户明确接受。');
  if(input.type==='resolution'&&(input.confirmed!==true||c.serviceIssue?.status!=='open'))throw new Error('需要有未结服务问题，并记录客户确认解决的依据。');
  const previouslyProposed=w.proposedSlotId,previousOutbound=w.outbound;
  const reason=`${feedbackTypes[input.type]}：${message}`;
  invalidateCustomer(state,c.id,reason,now);
  const record={id:uid('memory'),text:message,source:input.source||`${state.settings.operator} · 手动录入客户反馈`,type:'record',at:nowISO(now)};
  c.memories.push(record);w.feedback.push({type:input.type,...record});
  c.timeline.unshift({title:feedbackTypes[input.type],body:message,at:nowISO(now)});
  if(input.type==='need'){
    // A replacement is explicitly chosen by the employee, never inferred from a phone number.
    for(const m of c.memories){if(m.id!==record.id&&!m.superseded&&(m.field==='need'||m.text===c.need))m.superseded=true;}
    record.field='need';
    c.need=message;c.concern='需求已调整；请根据新需求重新核实条件。';
  }
  if(input.type==='complaint'){c.serviceIssue={status:'open',summary:message,at:nowISO(now)};w.proposedSlotId=null;}
  if(input.type==='resolution'){c.serviceIssue={status:'resolved',summary:message,at:nowISO(now)};w.status='active';}
  if(input.type==='withdraw'){c.doNotContact=true;c.consent={WhatsApp:false,Email:false};w.status='paused';w.proposedSlotId=null;}
  if(input.type==='reschedule'){w.proposedSlotId=slot?.id||null;w.status='active';}
  if(input.type==='reply'){
    const outcome=['accepted','declined'].includes(input.outcome)?input.outcome:'unsure';
    w.reply={text:message,outcome,slotId:outcome==='accepted'?slot.id:null,at:nowISO(now),revision:w.revision};
    w.proposedSlotId=slot?.id||previouslyProposed||null;
    if(previousOutbound?.slotId===w.proposedSlotId)w.outbound=previousOutbound;
    w.status=outcome==='declined'?'declined':'active';
  }
  prepareWork(state,w,reason,now);
  return w;
}

export function selectVisitSlot(state,workId,slotId,now=new Date()) {
  const w=getWork(state,workId),c=getCustomer(state,w.customerId);
  const slot=availableSlots(state,c,w.id,now).find(s=>s.id===slotId);
  if(!slot||slot.remaining<1)throw new Error('该时段无可用名额或已过期。');
  if(c.serviceIssue?.status==='open'||c.doNotContact)throw new Error('当前应先处理服务或联系限制。');
  if(w.proposedSlotId===slotId)return w;
  invalidateCustomer(state,c.id,'调整候选体验时段',now);w.proposedSlotId=slot.id;
  return prepareWork(state,w,`候选体验改为 ${slotText(slot)}`,now);
}

export function decideWork(state,workId,decision,now=new Date()) {
  const w=getWork(state,workId),c=getCustomer(state,w?.customerId);
  if(!w||!c)throw new Error('工作记录不存在。');
  if(!['strategy','activity'].includes(decision))throw new Error('无效的业务决定。');
  if(decision==='activity'){
    if(c.serviceIssue?.status==='open'||c.doNotContact||['paused','declined'].includes(w.status))throw new Error('当前邀约已暂停。');
    if(w.decisions.strategy?.revision!==w.revision)throw new Error('请先确认这版跟进策略。');
    const slot=availableSlots(state,c,w.id,now).find(s=>s.id===w.proposedSlotId);
    if(!slot||slot.remaining<1)throw new Error('请先选择可用的候选时段。');
    const a=state.artifacts.find(a=>a.id===w.posterId);
    if(!isArtifactCurrent(state,a)||a.status!=='approved')throw new Error('请先检查并审核当前版本的海报。');
  }
  w.decisions[decision]={revision:w.revision,at:nowISO(now),by:state.settings.operator};
  logWork(w,decision==='strategy'?'已确认跟进策略':'已确认活动与海报',`确认绑定工作包 v${w.revision}；未发送客户内容。`,now);
  return w;
}

export function recordOutbound(state,workId,{confirmed,note},now=new Date()) {
  const w=getWork(state,workId),c=getCustomer(state,w?.customerId);
  if(!confirmed||!String(note||'').trim())throw new Error('请确认已实际联系并填写发送记录。');
  if(w.decisions.activity?.revision!==w.revision)throw new Error('请先确认当前活动与海报。');
  const poster=state.artifacts.find(a=>a.id===w.posterId);
  if(!isArtifactCurrent(state,poster)||poster.status!=='approved')throw new Error('发送版本已变化，请重新审核。');
  if(c.serviceIssue?.status==='open'||c.doNotContact||!c.consent[c.channel]||['paused','declined'].includes(w.status))throw new Error('当前客户不适合营销联系。');
  w.outbound={at:nowISO(now),note:String(note).trim(),revision:w.revision,slotId:w.proposedSlotId,posterId:w.posterId,source:'销售手动记录'};
  w.outboundHistory??=[];w.outboundHistory.push(w.outbound);w.reply=null;w.status='waiting';c.lastContact=nowISO(now);
  logWork(w,'已记录外部发送',`${note}。仅记录事实，等待客户回复与预约回执。`,now);
}

export function recordReservation(state,workId,{reference,confirmed},now=new Date()) {
  const w=getWork(state,workId),c=getCustomer(state,w?.customerId);
  if(w.reservation?.status==='confirmed')throw new Error('该预约已经登记，请先记录改期或取消再调整。');
  if(!confirmed||!String(reference||'').trim())throw new Error('请填写真实预约回执编号，并确认已核实。');
  if(c.doNotContact||c.serviceIssue?.status==='open'||['paused','declined'].includes(w.status))throw new Error('客户计划已暂停，不能登记邀约成功。');
  if(!w.outbound||w.outbound.slotId!==w.proposedSlotId)throw new Error('缺少当前时段的实际发送记录。');
  if(w.reply?.outcome!=='accepted'||w.reply.slotId!==w.proposedSlotId)throw new Error('客户尚未明确接受当前时段；“考虑一下”不能算预约。');
  const slot=availableSlots(state,c,w.id,now).find(s=>s.id===w.proposedSlotId);
  if(!slot||slot.remaining<1)throw new Error('当前时段已无名额或已过期，请重新安排。');
  w.reservation={reference:String(reference).trim(),source:'销售手动录入外部日历回执',at:nowISO(now),slotId:slot.id,status:'confirmed'};
  w.status='booked';c.stage='已约试驾';c.next=`按 ${slotText(slot)} 接待`;
  w.goal='让这次到店有准备';w.plan.steps=['预约回执已登记','准备车辆、人员与体验项目','实际到店后记录反馈'];
  w.human={id:uid('human'),path:w.plan.path,status:'open',owner:c.owner||state.settings.operator,title:`准备 ${c.name} 的到店接待`,reason:`已记录客户明确同意与预约回执 ${w.reservation.reference}。`,expected:`确认试驾车辆、${w.plan.experience}与接待人员，实际到店后记录反馈。`,dueAt:nowISO(now)};
  c.timeline.unshift({title:'已登记预约（人工回执）',body:`${slotText(slot)} · 回执 ${w.reservation.reference}`,at:nowISO(now)});
  logWork(w,'预约依据已齐备',`发送记录 + 客户明确接受 + 人工录入回执 ${w.reservation.reference}。已建立接待任务。`,now);
  const brief=state.artifacts.find(a=>a.id===w.briefId);
  if(brief){brief.sections.push({label:'预约回执与接待任务',text:`${slotText(slot)}\n回执：${w.reservation.reference}（人工登记）\n接待负责人：${w.human.owner}\n${w.human.expected}`,audience:'internal',dir:'ltr'});brief.status='review';delete brief.approvedAt;}
}

export function changeHumanTask(state,workId,{action,owner,result,dueAt},now=new Date()) {
  const w=getWork(state,workId),h=w?.human;if(!h)throw new Error('没有可调整的同事任务。');
  if(action==='defer'){
    const date=new Date(dueAt);if(!Number.isFinite(date.getTime())||date<=new Date(now))throw new Error('请选择未来的提醒时间。');
    h.status='deferred';h.dueAt=date.toISOString();logWork(w,'同事任务已延后',`${h.owner} · ${h.dueAt}。在此之前不进入今日待办。`,now);
  }else if(action==='assign'){
    if(!state.team.some(t=>t.name===owner))throw new Error('请选择工作区中的同事。');
    h.owner=owner;h.status='open';logWork(w,'任务已转派',`${owner}：${h.title}。这是一条内部待办，尚未通知外部团队。`,now);
  }else if(action==='done'){
    if(!String(result||'').trim())throw new Error('请带回沟通结果，不能只标记完成。');
    applyFeedback(state,workId,{type:'reply',message:result,outcome:'unsure'},now);
    w.human.status='done';w.human.result=String(result).trim();logWork(w,'已带回人工沟通结果',String(result),now);
  }else if(action==='cancel'){
    invalidateCustomer(state,w.customerId,'员工暂停此工作',now);w.manuallyPaused=true;w.status='paused';h.status='cancelled';prepareWork(state,w,'员工暂停此工作',now);
  }else if(action==='resume'){
    w.manuallyPaused=false;w.status='active';prepareWork(state,w,'员工恢复内部准备',now);
  }else throw new Error('无效的任务调整。');
  return w;
}

export function campaignAudience(state,campaign,now=new Date()) {
  const groups=new Map(),excluded=[];
  const owners=/车主|交付|保养|服务|关怀/.test(`${campaign.audience} ${campaign.goal}`);
  for(const c of state.customers.filter(c=>c.market===campaign.market)){
    let reason='';
    if(c.doNotContact||!c.consent[c.channel])reason='缺少当前渠道授权 / 已退订';
    else if(c.serviceIssue?.status==='open')reason='未结投诉，转售后处理';
    else if(isOwner(c)!==owners)reason=owners?'当前活动面向已交付车主':'当前活动面向购车客户';
    else if(state.works.some(w=>w.customerId===c.id&&['paused','declined'].includes(w.status)))reason='该客户工作已暂停或客户暂不考虑';
    if(reason){excluded.push({customer:c,reason});continue;}
    const plan=workPlan(c);if(!groups.has(plan.path))groups.set(plan.path,{id:plan.path,label:plan.label,reason:plan.reason,experience:plan.experience,customers:[]});
    groups.get(plan.path).customers.push({id:c.id,name:c.name,language:c.language,timezone:c.timezone,channel:c.channel,need:c.need,contextVersion:c.contextVersion,contactGap:daysSince(c.lastContact,now)});
  }
  return {groups:[...groups.values()],excluded};
}

export function businessContext(state,kind,customer,now=new Date()) {
  const customers=kind==='regional'?state.customers:state.customers.filter(c=>c.market===customer.market);
  const ids=new Set(customers.map(c=>c.id));
  const works=state.works.filter(w=>ids.has(w.customerId));
  const byStore=[...new Set(customers.map(c=>`${c.market} · ${c.city}`))].map(store=>{
    const local=customers.filter(c=>`${c.market} · ${c.city}`===store),localIds=new Set(local.map(c=>c.id)),jobs=works.filter(w=>localIds.has(w.customerId));
    return {store,customers:local.length,openIssues:local.filter(c=>c.serviceIssue?.status==='open').length,waitingReply:jobs.filter(w=>w.status==='waiting').length,booked:jobs.filter(w=>w.reservation?.status==='confirmed').length,needsHuman:jobs.filter(w=>openHuman(w.human)).length};
  });
  return {source:'当前浏览器工作区记录（初始资料为合成示例）',asOf:nowISO(now),kind,stores:byStore,totals:{customers:customers.length,contacted:works.filter(w=>w.outbound).length,explicitAcceptance:works.filter(w=>w.reply?.outcome==='accepted').length,booked:works.filter(w=>w.reservation?.status==='confirmed').length,unresolvedService:customers.filter(c=>c.serviceIssue?.status==='open').length},missing:['未接入广告费用与预算','未接入真实到店、收入与毛利','不能用示例客户或登记数量推断增长归因'],actions:works.filter(w=>openHuman(w.human)).map(w=>({store:`${getCustomer(state,w.customerId).market} · ${getCustomer(state,w.customerId).city}`,owner:w.human.owner,action:w.plan.label,dueAt:w.human.dueAt,status:w.human.status}))};
}

export function createMorningBrief(state,now=new Date(),manual=false) {
  const rule=state.coworkSettings,p=localParts(rule.timezone,now),day=`${p.year}-${p.month}-${p.day}`;
  const existing=state.morningBriefs.find(b=>b.day===day&&b.timezone===rule.timezone);
  if(existing)return existing;
  if(!manual&&(!rule.morningEnabled||`${p.hour}:${p.minute}`<rule.time))return null;
  const actions=state.works.filter(w=>openHuman(w.human)&&(w.human.status!=='deferred'||new Date(w.human.dueAt)<=new Date(now))&&!['paused','declined'].includes(w.status));
  const brief={id:uid('morning'),day,timezone:rule.timezone,createdAt:nowISO(now),source:'当前工作区快照',items:actions.map(w=>({workId:w.id,customerId:w.customerId,name:getCustomer(state,w.customerId).name,owner:w.human.owner,title:w.human.title,reason:w.human.reason})),booked:state.works.filter(w=>w.status==='booked').length,openIssues:state.customers.filter(c=>c.serviceIssue?.status==='open').length};
  state.morningBriefs.unshift(brief);state.morningBriefs=state.morningBriefs.slice(0,30);return brief;
}

export function workflowContext(state,w) {
  const c=getCustomer(state,w.customerId),slot=state.visitSlots.find(s=>s.id===w.proposedSlotId);
  return {revision:w.revision,goal:w.goal,path:w.plan.label,reason:w.plan.reason,steps:w.plan.steps,requiredHumanAction:w.human.expected,latestFeedback:w.feedback.slice(-4).map(f=>({type:f.type,text:f.text,source:f.source})),candidateSlot:slot?{localTime:slotText(slot),source:slot.source,confirmed:false}:null,reply:w.reply?{text:w.reply.text,outcome:w.reply.outcome}:null,serviceIssue:c.serviceIssue||null,marketingPaused:!!c.doNotContact||w.status==='service'||w.status==='paused',evidence:{outbound:!!w.outbound,explicitAcceptance:w.reply?.outcome==='accepted',reservation:!!w.reservation}};
}

export function addQuickLead(state,{name,contact,market,channel,need},now=new Date()) {
  if(!String(contact||'').trim())throw new Error('请填写联系方式。');
  if(!['US','AE','GB','DE'].includes(market)||!['WhatsApp','Email'].includes(channel))throw new Error('请选择市场与渠道。');
  if(channel==='Email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact))throw new Error('请输入有效邮箱。');
  if(state.customers.some(c=>c.contact===contact.trim()||c.email===contact.trim()))throw new Error('该联系方式已有客户，请搜索后接续原工作。');
  const defaults={US:['America/Chicago','USD','en'],AE:['Asia/Dubai','AED','ar'],GB:['Europe/London','GBP','en'],DE:['Europe/Berlin','EUR','de']}[market];
  const label=String(name||'').trim()||`新线索 ${contact.trim().slice(-4)}`;
  const c={id:uid('c'),name:label,initials:label.split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase(),color:'sage',market,city:'城市待确认',timezone:defaults[0],currency:defaults[1],language:defaults[2],channel,contact:channel==='WhatsApp'?contact.trim():'',email:channel==='Email'?contact.trim():'',need:need?.trim()||'用车需求待确认',concern:'城市、购车时间、预算、语言偏好与联系授权待核实。',next:'核实咨询意图与联系授权，向销售交接',stage:'新线索',vehicle:'车型待确认',budget:[0,0],budgetUnknown:true,intent:0,role:'新咨询 · 待了解',source:'手动登记咨询',owner:state.settings.operator,lastContact:null,consent:{WhatsApp:false,Email:false},tags:['待核实'],memories:[],timeline:[{title:'登记新咨询',body:'已记录联系方式；身份、预算与授权未推断。',at:nowISO(now)}]};
  if(need?.trim())c.memories.push({id:uid('memory'),text:need.trim(),field:'need',source:state.settings.operator+' · 咨询原话',type:'record',at:nowISO(now)});
  state.customers.unshift(c);initializeCowork(state,now);return c;
}

export function addVisitSlot(state,workId,{day,time,capacity,confirmed},now=new Date()) {
  const w=getWork(state,workId),c=getCustomer(state,w?.customerId);
  if(!c||c.city==='城市待确认')throw new Error('请先在客户画像中确认所在城市与时区。');
  if(!confirmed)throw new Error('请确认已向门店核实此时段。');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||new Date(day+'T12:00:00Z').toISOString().slice(0,10)!==day)throw new Error('日期或时间格式无效。');
  const p=localParts(c.timezone,now);if(`${day}T${time}`<=`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`)throw new Error('请登记未来的可约时段。');
  const n=Number(capacity);if(!Number.isInteger(n)||n<1||n>20)throw new Error('接待容量应为 1–20 人。');
  if(state.visitSlots.some(s=>s.market===c.market&&s.city===c.city&&s.timezone===c.timezone&&s.day===day&&s.time===time))throw new Error('该时段已经存在。');
  const slot={id:uid('slot'),locationKey:`${c.market}:${c.city}:${c.timezone}`,market:c.market,city:c.city,timezone:c.timezone,day,time,capacity:n,source:`${state.settings.operator} · 手动核实门店时段`};
  state.visitSlots.push(slot);logWork(w,'登记门店可约时段',`${slotText(slot)}，容量 ${n}；来源为人工核实。`,now);return slot;
}
