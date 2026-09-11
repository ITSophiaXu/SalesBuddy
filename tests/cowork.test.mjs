import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState,scenarios} from '../data.js';
import {draftArtifact,contactEligibility} from '../domain.js';
import {initializeCowork,applyFeedback,selectVisitSlot,decideWork,recordOutbound,recordReservation,changeHumanTask,campaignAudience,createMorningBrief,availableSlots,isArtifactCurrent,updateCustomerContext,businessContext,workflowContext,addQuickLead,addVisitSlot} from '../cowork.js';
import {normalizeRequest,parseArtifact} from '../server/protocol.js';

const now=new Date('2026-09-11T13:00:00Z');
const setup=()=>initializeCowork(seedState(),now);
const find=(s,id='c1')=>s.works.find(w=>w.customerId===id);
function prepareInvitation(s,id='c1'){
  const w=find(s,id),c=s.customers.find(c=>c.id===id),slot=availableSlots(s,c,w.id,now)[0];
  selectVisitSlot(s,w.id,slot.id,now);decideWork(s,w.id,'strategy',now);
  s.artifacts.find(a=>a.id===w.posterId).status='approved';decideWork(s,w.id,'activity',now);
  recordOutbound(s,w.id,{confirmed:true,note:'已通过外部 WhatsApp 发送所选时段邀请'},now);
  return {w,c,slot};
}
test('已有客户自动形成工作包与有理由的人工任务，重新加载不重复创建',()=>{
  const s=setup();assert.equal(s.works.length,8);assert.equal(find(s).plan.path,'charging');
  assert.equal(find(s,'c2').plan.path,'fleet');assert.equal(find(s,'c3').plan.path,'tradein');assert.equal(find(s,'c7').plan.path,'service');
  assert.ok(find(s).human.expected);const count=s.artifacts.length;
  const restored=JSON.parse(JSON.stringify(s));initializeCowork(restored,now);
  assert.equal(restored.artifacts.length,count);assert.equal(restored.works.length,8);
  const ar=s.artifacts.find(a=>a.id===find(s,'c2').posterId);assert.equal(ar.poster.language,'ar');
});
test('需求更正改变体验、工作包与海报，同时让旧审核失效',()=>{
  const s=setup(),w=find(s),old=s.artifacts.find(a=>a.id===w.posterId);old.status='approved';old.approvedAt=now.toISOString();
  const oldBrief=w.briefId;
  applyFeedback(s,w.id,{type:'need',message:'已决定不买电车。需要置换旧车，希望一次到店完成评估和混动车试驾。'},now);
  assert.equal(w.plan.path,'tradein');assert.notEqual(w.briefId,oldBrief);assert.notEqual(w.posterId,old.id);
  assert.equal(old.status,'stale');assert.equal(old.approvedAt,undefined);assert.ok(!isArtifactCurrent(s,old));
  assert.match(s.artifacts.find(a=>a.id===w.posterId).poster.subheadline,/appraisal/);
  assert.match(w.human.expected,/旧车/);
});
test('投诉中止邀约、失效同客群材料并交给售后；解决必须有确认依据',()=>{
  const s=setup(),{w,c}=prepareInvitation(s);
  s.artifacts.push({id:'batch-doc',customerId:'c3',cohort:[{id:'c1',revision:1}],status:'approved'});
  applyFeedback(s,w.id,{type:'complaint',message:'上次服务问题还没有人联系我。'},now);
  assert.equal(w.status,'service');assert.equal(w.human.owner,'Service team');assert.equal(w.posterId,null);assert.equal(w.outbound,null);
  assert.equal(s.artifacts.find(a=>a.id==='batch-doc').status,'stale');
  assert.equal(contactEligibility(c,{now,checkHours:false}).ok,false);
  assert.throws(()=>recordReservation(s,w.id,{confirmed:true,reference:'fake'},now),/暂停/);
  assert.throws(()=>applyFeedback(s,w.id,{type:'resolution',message:'已解决'},now),/确认解决/);
  applyFeedback(s,w.id,{type:'resolution',message:'客户确认问题已处理',confirmed:true},now);
  assert.equal(c.serviceIssue.status,'resolved');assert.notEqual(w.status,'service');
});
test('发送、客户明确接受和外部回执分别登记，含糊回复不能推进预约',()=>{
  const s=setup(),{w,c,slot}=prepareInvitation(s);
  assert.equal(w.status,'waiting');assert.notEqual(c.stage,'已约试驾');
  applyFeedback(s,w.id,{type:'reply',message:'我考虑一下。',outcome:'unsure'},now);
  assert.throws(()=>recordReservation(s,w.id,{confirmed:true,reference:'R-1'},now),/尚未明确/);
  applyFeedback(s,w.id,{type:'reply',message:'确定周六上午十点到店。',outcome:'accepted',slotId:slot.id},now);
  assert.notEqual(c.stage,'已约试驾');assert.throws(()=>recordReservation(s,w.id,{reference:'R-1',confirmed:false},now),/回执/);
  recordReservation(s,w.id,{reference:'R-1',confirmed:true},now);
  assert.equal(c.stage,'已约试驾');assert.equal(w.status,'booked');assert.match(w.human.title,/接待/);
  assert.throws(()=>recordReservation(s,w.id,{reference:'R-2',confirmed:true},now),/已经登记/);
});
test('改期保留旧预约历史，停止旧时间，必须重新取得发送与客户同意',()=>{
  const s=setup(),{w,c,slot}=prepareInvitation(s);
  applyFeedback(s,w.id,{type:'reply',message:'我接受这个时段。',outcome:'accepted',slotId:slot.id},now);
  recordReservation(s,w.id,{reference:'R-2',confirmed:true},now);
  const other=availableSlots(s,c,w.id,now).find(x=>x.id!==slot.id);
  applyFeedback(s,w.id,{type:'reschedule',message:'请改到下午。',slotId:other.id},now);
  assert.equal(w.proposedSlotId,other.id);assert.equal(w.outbound,null);assert.equal(w.reply,null);assert.equal(w.reservation,null);
  assert.equal(w.reservationHistory[0].reference,'R-2');assert.equal(c.stage,'需求确认');
  assert.match(s.artifacts.find(a=>a.id===w.posterId).poster.details,/14:00/);
  assert.throws(()=>recordReservation(s,w.id,{confirmed:true,reference:'R-3'},now),/发送记录/);
});
test('只接受同城市、未来、有剩余容量的时段',()=>{
  const s=setup(),{w,c,slot}=prepareInvitation(s);
  const foreign=availableSlots(s,s.customers.find(c=>c.id==='c2'),'work_c2',now)[0];
  assert.throws(()=>selectVisitSlot(s,w.id,foreign.id,now),/无可用/);
  s.works.push({id:'another',reservation:{slotId:slot.id,status:'confirmed'}});
  assert.throws(()=>applyFeedback(s,w.id,{type:'reply',message:'同意',outcome:'accepted',slotId:slot.id},now),/名额/);
  assert.equal(availableSlots(s,c,w.id,new Date('2027-01-01')).length,0);
});
test('退订立刻取消后续营销；其他反馈不能恢复营销授权',()=>{
  const s=setup(),w=find(s);applyFeedback(s,w.id,{type:'withdraw',message:'请不要再联系我。'},now);
  assert.equal(w.status,'paused');assert.equal(w.posterId,null);
  applyFeedback(s,w.id,{type:'need',message:'正在了解企业用车。'},now);
  assert.equal(w.status,'paused');assert.equal(w.posterId,null);
  const c=s.customers.find(c=>c.id==='c1');assert.deepEqual(c.consent,{WhatsApp:false,Email:false});
});
test('延后、转派、带回结果、取消会改变同事待办及后续计划',()=>{
  const s=setup(),w=find(s);changeHumanTask(s,w.id,{action:'defer',dueAt:'2026-09-12T15:00:00Z'},now);
  assert.equal(w.human.status,'deferred');
  const brief=createMorningBrief(s,now,true);assert.ok(!brief.items.some(i=>i.workId===w.id));
  changeHumanTask(s,w.id,{action:'assign',owner:'Mia Wang'},now);assert.equal(w.human.owner,'Mia Wang');
  assert.throws(()=>changeHumanTask(s,w.id,{action:'assign',owner:'Unknown'},now),/同事/);
  changeHumanTask(s,w.id,{action:'done',result:'客户希望下午再沟通，尚未确认到店。'},now);
  assert.equal(w.human.status,'done');assert.equal(w.reply.outcome,'unsure');assert.notEqual(w.status,'booked');
  changeHumanTask(s,w.id,{action:'cancel'},now);assert.equal(w.status,'paused');assert.equal(w.posterId,null);
});
test('分群活动区分需求，排除未结服务、退订与不合适生命周期',()=>{
  const s=setup(),p=s.campaigns.find(p=>p.market==='US');
  const before=campaignAudience(s,p,now);assert.ok(before.groups.some(g=>g.id==='charging'));assert.ok(before.groups.some(g=>g.id==='tradein'));
  applyFeedback(s,find(s).id,{type:'complaint',message:'未解决服务问题'},now);
  const after=campaignAudience(s,p,now);assert.ok(after.excluded.some(e=>e.customer.id==='c1'&&e.reason.includes('未结投诉')));
  assert.ok(!after.groups.some(g=>g.customers.some(c=>c.id==='c1')));
});
test('晨报按团队时区到点运行，同一天去重，暂停后仍可手动查看',()=>{
  const s=setup();s.coworkSettings.timezone='Asia/Dubai';
  assert.equal(createMorningBrief(s,new Date('2026-09-11T03:59:00Z')),null);
  const b=createMorningBrief(s,new Date('2026-09-11T04:00:00Z'));assert.ok(b);
  assert.equal(createMorningBrief(s,new Date('2026-09-11T06:00:00Z')).id,b.id);
  s.coworkSettings.morningEnabled=false;assert.equal(createMorningBrief(s,new Date('2026-09-12T05:00:00Z')),null);
  assert.ok(createMorningBrief(s,new Date('2026-09-12T05:00:00Z'),true));assert.equal(s.morningBriefs.length,2);
});
test('快速新线索只凭联系方式建立交接，预算、身份与营销授权保持未知',()=>{
  const s=setup(),c=addQuickLead(s,{market:'GB',channel:'Email',contact:'new@example.com'},now);
  assert.equal(c.budgetUnknown,true);assert.equal(c.intent,0);assert.equal(c.consent.Email,false);assert.equal(c.stage,'新线索');
  assert.equal(find(s,c.id).plan.path,'qualify');assert.match(find(s,c.id).human.expected,/用途/);
  assert.throws(()=>addQuickLead(s,{market:'GB',channel:'Email',contact:'new@example.com'},now),/已有客户/);
});
test('手动确认的门店时段可继续排期，未知城市、过去时间和重复登记被阻止',()=>{
  const s=setup(),w=find(s);
  const fields={day:'2026-09-20',time:'11:00',capacity:2,confirmed:true};
  const slot=addVisitSlot(s,w.id,fields,now);assert.match(slot.source,/手动核实/);
  assert.ok(availableSlots(s,s.customers[0],w.id,now).some(s=>s.id===slot.id));
  assert.throws(()=>addVisitSlot(s,w.id,fields,now),/已经存在/);
  assert.throws(()=>addVisitSlot(s,w.id,{...fields,day:'2026-09-01'},now),/未来/);
  const c=addQuickLead(s,{market:'GB',channel:'Email',contact:'slot@example.com'},now);
  assert.throws(()=>addVisitSlot(s,find(s,c.id).id,fields,now),/所在城市/);
});
test('员工暂停不会被新反馈静默恢复，恢复准备也不恢复客户营销授权',()=>{
  const s=setup(),w=find(s);changeHumanTask(s,w.id,{action:'cancel'},now);
  applyFeedback(s,w.id,{type:'reply',message:'周末也许方便。',outcome:'unsure'},now);assert.equal(w.status,'paused');assert.equal(w.posterId,null);
  changeHumanTask(s,w.id,{action:'resume'},now);assert.equal(w.status,'active');assert.ok(w.posterId);
  applyFeedback(s,w.id,{type:'withdraw',message:'不要再发消息'},now);
  changeHumanTask(s,w.id,{action:'resume'},now);assert.equal(w.status,'paused');assert.equal(w.posterId,null);
});
test('七类岗位的交付场景拥有不同工作内容，管理简报只使用内部汇总',()=>{
  const s=setup(),c=s.customers[0];
  for(const kind of ['intake','relationship','review','regional']){
    assert.ok(scenarios.some(x=>x.id===kind));
    const a=draftArtifact(kind,c,s.vehicles,'',[],{businessContext:businessContext(s,kind,c,now),workflow:workflowContext(s,find(s))});
    assert.ok(a.sections.length>=4);
    if(['review','regional'].includes(kind)){
      assert.ok(a.sections.every(x=>x.audience==='internal'));assert.match(a.sections[1].text,/预约 0/);assert.match(JSON.stringify(a),/不计算 ROI/);
    }
  }
});
test('模型协议包含变化和业务上下文，过滤失效记忆，管理成果不允许泄露为对客文案',()=>{
  const s=setup(),c=s.customers[0];c.memories[0].superseded=true;
  const r=normalizeRequest({kind:'review',prompt:'复盘',customer:c,vehicles:s.vehicles,knowledge:s.knowledge,workflow:workflowContext(s,find(s)),businessContext:businessContext(s,'review',c,now)});
  assert.ok(r.workflow.goal);assert.ok(!r.customer.memories.some(m=>m.text===c.memories[0].text));assert.equal(r.businessContext.totals.booked,0);
  const content={title:'复盘',sections:['口径','记录','建议'].map(label=>({label,text:'内部分析',audience:'internal',dir:'ltr'}))};
  assert.equal(parseArtifact(JSON.stringify(content),r).status,'review');
  content.sections[0].audience='customer';assert.throws(()=>parseArtifact(JSON.stringify(content),r),/必要内容/);
  const invite=normalizeRequest({...r,kind:'testdrive',needsPoster:true});
  content.sections[1].audience='customer';assert.throws(()=>parseArtifact(JSON.stringify(content),invite),/必要内容/);
});
