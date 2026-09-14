import {uid, daysSince} from './domain.js';
import {markets, stages} from './data.js';
import {openActions} from './task-flow.js';

export const PRIMARY_NAV = [
  {id:'home',label:'AI 协作',note:'Cowork',icon:'message',pages:['home','chat']},
  {id:'desk',label:'工作台',icon:'grid',pages:['desk','work','workspace','inbox','deliverables','automations']},
  {id:'customers',label:'客户与画像',icon:'users',pages:['customers']},
  {id:'inventory',label:'车源与方案',icon:'car',pages:['inventory']},
  {id:'campaigns',label:'营销活动',icon:'megaphone',pages:['campaigns']},
  {id:'connections',label:'资料与连接',icon:'link',pages:['connections','knowledge']}
];
export const MARKET_DEFAULTS = {
  US:{currency:'USD',language:'en',timezone:'America/Chicago'},
  AE:{currency:'AED',language:'ar',timezone:'Asia/Dubai'},
  GB:{currency:'GBP',language:'en',timezone:'Europe/London'},
  DE:{currency:'EUR',language:'de',timezone:'Europe/Berlin'}
};
export const CONNECTORS = [
  {id:'toyota',name:'丰田门店 CRM / DMS',category:'客户与销售',icon:'users',description:'查询线索、联系记录、销售阶段与负责人。具体系统由所在市场和门店提供。',fields:'客户编号、姓名、电话、车型意向、销售阶段、联系许可、最近联系时间',requires:'所在国家、实际 CRM / DMS 产品、门店编号、供应商开放接口与门店授权'},
  {id:'inventory',name:'门店库存与报价',category:'车辆与交易',icon:'car',description:'核实当地车源、配置、价格有效期和可交付时间。',fields:'车辆编号、配置、所在门店、币种、车价、更新时间',requires:'库存或 DMS 接口、价格权限、门店范围'},
  {id:'calendar',name:'试驾与售后预约',category:'门店运营',icon:'calendar',description:'查询真实接待容量，并在门店系统确认后登记回执。',fields:'车辆、人员、时段、容量、预约编号',requires:'日历或售后系统、门店时区、读写范围'},
  {id:'external',name:'品牌与外部数据',category:'市场资料',icon:'globe',description:'接入厂商车型资料、活动政策与有使用许可的市场数据。',fields:'来源网址、适用市场、发布日期、有效期、内容',requires:'官方资料来源或数据服务商、访问方式与使用范围'}
];
export function initializeWorkspace(state) {
  state.dataSources ??= [];
  state.connectionRequests ??= [];
}
export function storeSubject(state,market) {
  if(!MARKET_DEFAULTS[market])throw new Error('请先选择一个具体市场。');
  return {id:'store:'+market,name:state.settings.name,market,...MARKET_DEFAULTS[market],city:markets[market],stage:'门店工作',vehicle:'待按任务确定',need:'根据当前门店资料准备经营工作。',concern:'真实库存、价格和活动权益需核实。',next:'核对方案与执行安排',budget:[0,0],budgetUnknown:true,channel:'Email',consent:{Email:false},memories:[],tags:[],timeline:[],contextVersion:0,scope:'store'};
}
export function customerSearchText(c) {
  return [c.name,c.contact,c.email,c.vehicle,c.city,c.need,c.concern,c.purchaseTiming,c.decisionProcess,c.tradeIn,c.preference,...(c.memories||[]).filter(m=>!m.superseded).map(m=>m.text),...(c.tags||[]),c.dataSource?.name].filter(Boolean).join(' ').toLowerCase();
}
export function searchCustomerRecords(state,query,{market='all',dormant=false,limit=12}={}) {
  const q=String(query).trim().toLowerCase();
  const phoneQuery=/^[+\d\s().-]+$/.test(q)&&q.replace(/\D/g,'').length>=4?q.replace(/\D/g,''):null;
  return state.customers.filter(c=>(market==='all'||c.market===market)&&(!dormant||!!c.lastContact&&daysSince(c.lastContact)>=14)&&(!q||customerSearchText(c).includes(q)||phoneQuery&&(c.contact||'').replace(/\D/g,'').includes(phoneQuery))).slice(0,limit);
}
export function sourceLabel(c) { return c?.scope==='store'?`${markets[c.market]} · 门店工作区资料`:c?.dataSource?`${c.dataSource.name} · 导入快照`:c?.recordOrigin==='manual'||['手动新增','手动登记咨询'].includes(c?.source)?`${c.source} · 人工记录`:'工作区记录 · 含初始示例'; }
export function customerLookup(message) {
  if(/(?:查找|查询|找出|看看).*(?:14\s*天).*(?:未联系|没联系)/.test(message))return {query:'',dormant:true};
  const match=message.match(/^(?:查找|查询|搜索)客户[：:\s]+(.+)$/i);
  return match?{query:match[1].trim().replace(/[。？?]$/,''),dormant:false}:null;
}
export function conversationStatus(chat,state) {
  if(chat.completedAt)return {id:'done',label:'已完成'};
  const last=chat.messages?.filter(m=>!m.event).at(-1);
  if(chat.messages?.some(m=>['thinking','creating'].includes(m.status)))return {id:'running',label:'准备中'};
  if(['failed','stale','cancelled'].includes(last?.status))return {id:'blocked',label:'需要处理'};
  if(openActions(chat).length)return {id:'review',label:'有待办需跟进'};
  const latest=chat.messages?.findLast(m=>m.artifactId);
  if(state&&latest&&state.artifacts.find(a=>a.id===latest.artifactId)?.status==='stale')return {id:'blocked',label:'资料已更新'};
  if(chat.messages?.some(m=>m.artifactId))return {id:'review',label:'待查看成果'};
  return {id:'active',label:'进行中'};
}
export function visibleWork(w) {return w.activated||w.events.some(e=>!['已整理已有记录','工作包已更新','客户画像已更新'].includes(e.title));}
export function workspaceItems(state) {
  const conversations=(state.conversations||[]).filter(c=>c.tracked).map(c=>({type:'chat',title:c.goal||c.title,customerId:c.customerId,market:c.market||c.customerId?.split(':')[1],owner:c.owner||state.settings.operator,at:c.updatedAt||c.createdAt,next:openActions(c)[0]?.title,...conversationStatus(c,state),key:c.id}));
  // A generation attempt belongs to its conversation/customer work, not another task row.
  const generations=state.tasks.filter(t=>!t.workId&&!t.conversationId).map(t=>({key:t.id,id:({running:'running',failed:'blocked',stale:'blocked',cancelled:'blocked',review:'review',approved:'done',contacted:'done'})[t.status]||'active',type:'generation',title:t.title,customerId:t.customerId,owner:state.settings.operator,at:t.createdAt,label:({running:'准备中',failed:'生成失败',stale:'资料已更新',cancelled:'已停止',review:'待查看成果',approved:'材料已审核',contacted:'已记录联系'})[t.status]||'进行中'}));
  const works=state.works.filter(w=>visibleWork(w)&&(w.activated||!conversations.some(c=>c.customerId===w.customerId))).map(w=>({key:w.id,type:'work',id:['paused','declined'].includes(w.status)?'blocked':w.status==='booked'?'done':w.human?.status==='done'?'active':'review',label:({paused:'已暂停',declined:'暂不考虑',booked:'已登记预约',service:'待服务处理'})[w.status]||'待跟进',title:w.goal,customerId:w.customerId,owner:w.human?.owner,at:w.createdAt,next:w.human?.title}));
  return [...conversations,...generations,...works].sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0));
}

export const CRM_TEMPLATE = 'customer_id,name,phone,email,market,city,vehicle,stage,need,last_contact,consent_email,consent_whatsapp\r\nDEMO-001,Jamie Demo,+1 202-555-0148,jamie@example.com,US,Austin,Toyota RAV4 Hybrid,新线索,想了解家庭用车与购车总费用,,false,false\r\n';
const aliases={客户编号:'customer_id',姓名:'name',客户姓名:'name',电话:'phone',电话号码:'phone',邮箱:'email',市场:'market',国家:'market',城市:'city',意向车型:'vehicle',销售阶段:'stage',需求:'need',最近联系:'last_contact',邮件授权:'consent_email',WhatsApp授权:'consent_whatsapp'};
export function parseCSV(input) {
  if(typeof input!=='string'||input.length>2000000)throw new Error('请使用不超过 2 MB 的 UTF-8 CSV 文件。');
  input=input.replace(/^\uFEFF/,'');
  const rows=[];let row=[],cell='',quoted=false;
  for(let n=0;n<input.length;n++){
    const ch=input[n];
    if(ch==='"'){if(quoted&&input[n+1]==='"'){cell+='"';n++;}else if(quoted){quoted=false;}else if(!cell){quoted=true;}else throw new Error('CSV 引号格式不正确。');}
    else if(ch===','&&!quoted){row.push(cell);cell='';}
    else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&input[n+1]==='\n')n++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}
    else cell+=ch;
    if(rows.length>501)throw new Error('单次最多导入 500 位客户。');
  }
  if(quoted)throw new Error('CSV 中存在未闭合的引号。');
  row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
  if(rows.length<2||rows.length>501)throw new Error('请提供表头和 1–500 行客户记录。');
  const headers=rows.shift().map(h=>h.replace(/^\uFEFF/,'').trim()).map(h=>aliases[h]||h.toLowerCase());
  if(new Set(headers).size!==headers.length)throw new Error('存在重复字段，请检查表头。');
  for(const required of ['name','phone','market'])if(!headers.includes(required))throw new Error(`缺少字段：${required}。请参考导入模板。`);
  return rows.map((values,index)=>{if(values.length!==headers.length)throw new Error(`第 ${index+2} 行字段数量不正确。`);return Object.fromEntries(headers.map((h,i)=>[h,values[i].trim()]));});
}
const canonicalPhone=p=>p.replace(/\D/g,'');
export function previewCRMImport(state,text) {
  const rows=parseCSV(text),valid=[],errors=[],duplicates=[];
  const seenPhones=new Set(state.customers.map(c=>canonicalPhone(c.contact||'')).filter(Boolean));
  const seenIds=new Set();
  for(const [index,r] of rows.entries()){
    const line=index+2;
    if(!r.name||r.name.length>100||!/^\+?[\d\s().-]{7,30}$/.test(r.phone)||r.phone.replace(/\D/g,'').length<7||r.phone.replace(/\D/g,'').length>15||!MARKET_DEFAULTS[r.market]){errors.push(`第 ${line} 行：姓名、电话号码或市场无效（支持 US / AE / GB / DE）。`);continue;}
    if(r.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)){errors.push(`第 ${line} 行：邮箱格式无效。`);continue;}
    if(r.stage&&!stages.includes(r.stage)){errors.push(`第 ${line} 行：销售阶段不受支持。`);continue;}
    if(r.stage==='已约试驾'){errors.push(`第 ${line} 行：预约阶段需要通过客户工作登记真实回执，请先使用“需求确认”。`);continue;}
    if(r.last_contact&&(!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(r.last_contact)||!Number.isFinite(Date.parse(r.last_contact))||Date.parse(r.last_contact)>Date.now()||new Date(r.last_contact.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)!==r.last_contact.slice(0,10))){errors.push(`第 ${line} 行：最近联系时间无效或在未来。`);continue;}
    if(['consent_email','consent_whatsapp'].some(k=>r[k]&&!['true','false'].includes(r[k].toLowerCase()))){errors.push(`第 ${line} 行：联系授权只能填写 true 或 false。`);continue;}
    if(r.consent_email?.toLowerCase()==='true'&&!r.email){errors.push(`第 ${line} 行：邮件授权为 true 时需要邮箱。`);continue;}
    if((r.need||'').length>2000||(r.vehicle||'').length>200||(r.city||'').length>120||(r.customer_id||'').length>100){errors.push(`第 ${line} 行：字段过长。`);continue;}
    const phone=canonicalPhone(r.phone);
    if(seenPhones.has(phone)||r.customer_id&&seenIds.has(r.customer_id)){duplicates.push({line,name:r.name});continue;}
    seenPhones.add(phone);if(r.customer_id)seenIds.add(r.customer_id);valid.push(r);
  }
  return {valid,errors,duplicates,total:rows.length};
}
export function importCRMRecords(state,preview,{name,operator,now=new Date().toISOString()}={}) {
  if(preview.errors.length||!preview.valid.length)throw new Error('请先修正导入错误，并确认存在可导入记录。');
  const source={id:uid('source'),name:String(name||'CRM 导出文件').slice(0,120),kind:'csv',importedAt:now,count:0};
  const phones=new Set(state.customers.map(c=>canonicalPhone(c.contact||'')));
  for(const r of preview.valid){
    if(phones.has(canonicalPhone(r.phone)))continue;
    phones.add(canonicalPhone(r.phone));
    const consent={Email:r.consent_email?.toLowerCase()==='true',WhatsApp:r.consent_whatsapp?.toLowerCase()==='true'};
    const c={id:uid('c'),name:r.name,initials:r.name.split(/\s+/).slice(0,2).map(n=>n[0]).join('').toUpperCase(),color:'sage',market:r.market,...MARKET_DEFAULTS[r.market],city:r.city||markets[r.market],contact:r.phone,email:r.email||'',channel:r.email?'Email':'WhatsApp',consent,budget:[0,0],budgetUnknown:true,vehicle:r.vehicle||'车型待确认',stage:r.stage||'新线索',intent:0,intentUnknown:true,role:'CRM 导入客户',source:'CRM 导出文件',owner:operator||state.settings.operator,lastContact:r.last_contact?new Date(r.last_contact).toISOString():null,need:r.need||'需求待确认',concern:'购车顾虑待确认',next:'核实需求并确定跟进安排',tags:['CRM 导入'],memories:[{id:uid('memory'),text:r.need||'尚未记录购车需求',type:'record',field:'need',source:source.name+' · 导入基础资料',at:now}],timeline:[{title:'从 CRM 文件导入',body:'已导入基础资料。客户画像将通过后续销售对话持续补充。',at:now}],dataSource:{id:source.id,name:source.name,recordId:r.customer_id||'',importedAt:now}};
    state.customers.push(c);source.count++;
  }
  if(!source.count)throw new Error('这些客户已经存在，没有重复导入。');
  state.dataSources.unshift(source);return source;
}
