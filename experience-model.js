import {uid,daysSince,localParts} from './domain.js';
import {markets} from './data.js';
import {workspaceItems} from './workspace-model.js';

export const PERSONAS = {
  sales:{label:'销售',en:'SALES',headline:'把每一次跟进，推进到下一步。',description:'先处理需要你判断的客户，再和 Cowork 一起准备行动。',workTitle:'从线索到成交',icon:'users'},
  marketing:{label:'市场',en:'MARKETING',headline:'让下一场活动，有人群，也有好内容。',description:'从客群、活动准备到内容审核，把营销工作完整交付。',workTitle:'从客群到活动落地',icon:'megaphone'},
  regional:{label:'区域经理',en:'REGIONAL',headline:'看清经营问题，把行动落实到人。',description:'核对数据、发现跟进缺口，形成门店行动计划并追踪反馈。',workTitle:'从经营诊断到门店行动',icon:'globe'}
};
export const WORKFLOWS = [
  {id:'lead',role:'sales',title:'新线索转化',icon:'target',scope:'customer',output:'客户转化计划',steps:['电话与已知信息','核对需求与顾虑','准备首次沟通','安排下一步'],prompt:'为这条销售线索制定客户转化计划：整理已知事实、待确认的预算和购车时间、首次沟通话术、下一步和负责人。'},
  {id:'conversion',role:'sales',title:'推进犹豫客户',icon:'car',scope:'customer',output:'选车对比与成交推进方案',steps:['梳理决策顾虑','匹配当地车源','对比方案与费用','约定决策下一步'],prompt:'为正在犹豫的客户制定成交推进方案，结合已记录画像、预算、竞品与家庭决策顾虑，比较同市场车源与费用，准备话术和下一步；以实际订单和付款确认成交。'},
  {id:'vehicle-comparison',role:'sales',title:'制作车型对比',icon:'car',scope:'customer',output:'图文车型对比方案',steps:['指定 2–3 款车型','说明比较重点','生成图文对比','按客户反馈调整'],prompt:'为客户生成图文车型对比方案。请先确认要比较的 2–3 款车型和优先事项，例如家庭空间、购车预算、补能便利；缺少的配置和费用数据明确标为待核实。'},
  {id:'reactivation',role:'sales',title:'唤醒沉睡客户',icon:'heart',scope:'customer',output:'个性化唤醒方案',steps:['回看历史沟通','找到联系理由','准备个性化话术','记录真实回复'],prompt:'为长时间未联系的客户制定唤醒方案：结合画像与历史沟通寻找有价值的联系理由，准备客户语言的话术与跟进节奏，以真实回复衡量重新建立联系。'},
  {id:'campaign',role:'marketing',title:'策划营销活动',icon:'megaphone',scope:'store',output:'活动方案 · 邀请文案 · 海报',steps:['明确目标与市场','选择合适客群','准备文案与海报','安排执行与衡量'],prompt:'制定一份家庭 SUV 营销活动方案，包含客群选择依据、多语言邀请文案、活动海报和执行安排；区分活动目标与真实结果。'},
  {id:'content',role:'marketing',title:'制作本地化内容',icon:'doc',scope:'store',output:'渠道文案与活动海报',steps:['确认渠道与语言','引用品牌资料','制作内容与海报','核对权益与发布信息'],prompt:'为本市场准备营销活动内容包，包含渠道文案和活动海报，参考品牌知识，说明受众、语言、渠道和需要门店确认的权益与日期。'},
  {id:'campaign-review',role:'marketing',title:'复盘营销活动',icon:'grid',scope:'store',output:'活动复盘与优化建议',steps:['核对活动记录','梳理触达与回复','检查结果缺口','提出下一轮行动'],prompt:'生成本市场营销活动复盘报告，参考已有活动和工作记录，分别列出已联系、明确回复、预约回执；缺少花费和订单数据时不要计算 ROI 或成交率，给出补数清单及下一轮行动。'},
  {id:'regional-review',role:'regional',title:'经营诊断',icon:'globe',scope:'store',output:'经营诊断与问题清单',steps:['选择市场与范围','核实来源与口径','识别经营问题','准备管理建议'],prompt:'为所选市场生成区域经营诊断报告：基于当前工作区资料梳理线索阶段、实际联系与预约回执、未结服务问题。没有门店编号及目标数据时不做门店排名，列出补充数据清单和可执行建议。'},
  {id:'store-action',role:'regional',title:'制定门店行动计划',icon:'target',scope:'store',output:'门店行动计划与检查点',steps:['确认经营问题','拆解行动','指定负责人和期限','收集执行反馈'],prompt:'为所选市场制定门店经营行动计划：根据已有经营记录提出需要确认的问题，按动作、负责人、截止时间、需要带回的证据编制行动清单。未知人员和期限标为待确认，任务完成不视为业绩完成。'},
  {id:'risk-review',role:'regional',title:'跟进服务与经营风险',icon:'shield',scope:'store',output:'风险处置与跟进清单',steps:['核对服务问题','检查跟进缺口','明确处置优先级','安排复核'],prompt:'生成所选市场服务与经营风险复盘报告，梳理未结服务问题、长期未联系及未完成行动，区分事实和判断，列出负责人、处置建议与复核依据。'}
];
export function initializeExperience(state){
  if(!PERSONAS[state.persona])state.persona='sales';
  state.deliveries??=[];state.ecosystem??={skills:{},mcp:[],plugins:{}};
  state.ecosystem.skills??={};state.ecosystem.mcp??=[];state.ecosystem.plugins??={};
}
export function itemRole(state,row){
  if(row.type==='work')return 'sales';
  const chat=state.conversations?.find(c=>c.id===(row.type==='chat'?row.key:state.tasks.find(t=>t.id===row.key)?.conversationId));
  if(PERSONAS[chat?.persona])return chat.persona;
  const kind=state.tasks.find(t=>row.type==='generation'?t.id===row.key:t.conversationId===row.key)?.kind;
  return kind==='regional'?'regional':['campaign','review'].includes(kind)?'marketing':'sales';
}
export function roleItems(state,role,market='all'){
  return workspaceItems(state).filter(r=>itemRole(state,r)===role&&(market==='all'||(state.customers.find(c=>c.id===r.customerId)?.market||r.market)===market));
}
export function marketFacts(state,market='all',now=new Date()){
  const customers=state.customers.filter(c=>market==='all'||c.market===market);
  const works=state.works.filter(w=>customers.some(c=>c.id===w.customerId));
  return {customers,leads:customers.filter(c=>c.stage==='新线索'),hesitant:customers.filter(c=>c.stage==='方案洽谈'),dormant:customers.filter(c=>c.lastContact&&daysSince(c.lastContact,now)>=14&&!['已成交','售后维护'].includes(c.stage)),issues:customers.filter(c=>c.serviceIssue?.status==='open'),campaigns:state.campaigns.filter(c=>market==='all'||c.market===market),contacted:works.filter(w=>w.outbound).length,reservations:works.filter(w=>w.reservation).length};
}
export function dashboardData(state,role,market='all'){
  const facts=marketFacts(state,market),tasks=roleItems(state,role,market);
  const mine=tasks.filter(t=>!t.owner||t.owner===state.settings.operator||state.conversations?.find(c=>c.id===t.key)?.actions?.some(a=>a.owner===state.settings.operator&&a.status!=='done'));
  const order={blocked:0,review:1,running:2,active:3,done:4};
  const priorities=mine.filter(t=>t.id!=='done').sort((a,b)=>(order[a.id]??3)-(order[b.id]??3));
  const metrics=role==='sales'?[['新线索',facts.leads.length],['方案洽谈',facts.hesitant.length],['待唤醒客户',facts.dormant.length]]:role==='marketing'?[['活动计划',facts.campaigns.length],['本地客户',facts.customers.length],['内容待审核',tasks.filter(t=>t.id==='review').length]]:[['客户记录',facts.customers.length],['未结服务问题',facts.issues.length],['已登记预约',facts.reservations]];
  return {facts,tasks,priorities,metrics};
}
function briefing(state,role,market,now){
  const d=dashboardData(state,role,market),scope=market==='all'?'全部市场':markets[market];
  const specifics=role==='sales'?d.facts.dormant.map(c=>`${c.name}：${daysSince(c.lastContact,now)} 天未联系，${c.next||'下一步待确认'}`).slice(0,6):role==='marketing'?d.facts.campaigns.map(c=>`${c.title}：${c.status}；目标：${c.goal}`).slice(0,6):d.facts.issues.map(c=>`${c.name}：${c.serviceIssue.summary||c.serviceIssue.description||'服务问题待处理'}`).slice(0,6);
  return [{label:'工作区概况',text:d.metrics.map(([k,v])=>`${k}：${v}`).join('\n')},{label:'需要你处理',text:d.priorities.slice(0,6).map(t=>`${t.title} · ${t.label}\n${t.next||'查看已有资料并确定下一步'}`).join('\n\n')||'当前没有分配给你的待处理任务。'},{label:role==='sales'?'客户跟进线索':role==='marketing'?'活动筹备记录':'服务风险记录',text:specifics.join('\n\n')||'当前范围没有符合条件的记录。'},{label:'来源与范围',text:`${scope} · 当前浏览器工作区快照 · ${now.toLocaleString('zh-CN')}。初始数据含示例；文件导入记录保留来源。上述数量是工作记录统计，不代表实时 CRM 或实际销售业绩。`}];
}
export function prepareBriefing(state,role,market='all',now=new Date(),manual=false){
  if(!PERSONAS[role]||!Object.hasOwn(markets,market))throw new Error('请选择有效角色和市场。');
  const p=localParts(state.coworkSettings.timezone,now),day=`${p.year}-${p.month}-${p.day}`;
  const key=`digest:${role}:${market}:${day}`;
  if(!manual&&state.deliveries.some(d=>d.key===key))return false;
  const sections=briefing(state,role,market,now),delivery={id:uid('delivery'),key:manual?`${key}:${uid('refresh')}`:key,role,market,kind:'brief',title:`${PERSONAS[role].label}工作简报 · ${day}`,preview:sections[0].text.replaceAll('\n',' · '),sections,source:'工作区规则整理',at:now.toISOString(),read:false,archived:false};
  state.deliveries.unshift(delivery);return delivery;
}
export function syncDeliveries(state,now=new Date()){
  let changed=false;
  const rule=state.coworkSettings,p=localParts(rule.timezone,now);
  if(rule.morningEnabled&&`${p.hour}:${p.minute}`>=rule.time){for(const role of Object.keys(PERSONAS))if(prepareBriefing(state,role,'all',now))changed=true;}
  for(const task of state.tasks.filter(t=>t.automationId)){
    const artifact=state.artifacts.find(a=>a.id===task.artifactId);
    const kind=artifact?'artifact':task.status==='failed'?'failure':null;
    if(!kind)continue;
    const key=`automation:${task.id}:${kind}`;if(state.deliveries.some(d=>d.key===key))continue;
    state.deliveries.unshift({id:uid('delivery'),key,role:task.persona||(['campaign','review'].includes(task.kind)?'marketing':task.kind==='regional'?'regional':'sales'),market:state.customers.find(c=>c.id===task.customerId)?.market,kind,title:artifact?`${task.title}，已备好`:`${task.title}，需要处理`,preview:artifact?'已保存草稿，打开查看并继续修改。':task.error||'生成没有完成，请检查连接。',taskId:task.id,artifactId:artifact?.id,posterId:task.posterId,source:artifact?.engine==='copilot'?'Copilot · 定时任务':artifact?'演示模板 · 定时任务':'定时任务',at:new Date().toISOString(),read:false,archived:false});changed=true;
  }
  return changed;
}
export const visibleDeliveries=(state,role,market='all')=>state.deliveries.filter(d=>d.role===role&&(market==='all'||d.market==='all'||d.market===market));
export function updateDelivery(state,id,action){
  const item=state.deliveries.find(d=>d.id===id);if(!item)return false;
  if(action==='read')item.read=true;else if(action==='unread')item.read=false;else if(action==='archive')item.archived=true;else if(action==='restore')item.archived=false;else return false;return true;
}
export function saveMCPConfiguration(state,input){
  const name=String(input.name||'').trim(),scope=String(input.scope||'').trim(),endpoint=String(input.endpoint||'').trim();
  if(!name||name.length>100||!scope||scope.length>1000)throw new Error('请填写服务名称与数据范围。');
  let url;try{url=new URL(endpoint);}catch{throw new Error('请输入完整的 HTTPS 服务地址。');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('请使用无凭据、无查询参数的 HTTPS 地址。密钥由服务端管理。');
  if(state.ecosystem.mcp.some(m=>m.endpoint===url.href))throw new Error('该服务地址已有配置。');
  const entry={id:uid('mcp'),name,scope,endpoint:url.href,status:'configured',access:'read',createdAt:new Date().toISOString()};state.ecosystem.mcp.push(entry);return entry;
}
