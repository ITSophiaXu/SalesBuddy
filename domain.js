export const uid = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
export const money = (value, currency = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
export const moneyExact = (value, currency = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(value);
export const daysSince = (date, now = new Date()) => date ? Math.max(0, Math.floor((now - new Date(date)) / 86400000)) : 0;
export function localParts(timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  return Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
}
export function contactEligibility(customer, { now = new Date(), minGapDays = 7, checkHours = true } = {}) {
  if(customer.doNotContact)return {ok:false,reason:'客户已退订'};
  if(customer.serviceIssue?.status==='open')return {ok:false,reason:'未结服务问题，暂停营销跟进'};
  if (!customer.consent?.[customer.channel]) return { ok: false, reason: `${customer.channel} 未获营销联系授权` };
  if (customer.lastContact && daysSince(customer.lastContact, now) < minGapDays) return { ok: false, reason: `距上次联系不足 ${minGapDays} 天` };
  const hour = Number(localParts(customer.timezone, now).hour);
  if (checkHours && (hour < 9 || hour >= 18)) return { ok: false, reason: '客户当地不在 09:00–18:00 联系时段' };
  return { ok: true, reason: '授权、频率与当地时间检查通过' };
}
export function matchesSegment(c, segment, now = new Date()) {
  if(['family','charging','fleet','tradein'].includes(segment)){
    if(['已成交','售后维护'].includes(c.stage))return false;
    return ({family:/家庭|后排|孩子|儿童|family|child/i,charging:/充电|charging/i,fleet:/企业|车队|fleet|corporate/i,tradein:/置换|评估|trade.?in/i})[segment].test(`${c.need} ${c.concern}`);
  }
  if (segment === 'hot') return c.intent >= 75 && !['已成交', '售后维护'].includes(c.stage);
  if (segment === 'owners') return ['已成交', '售后维护'].includes(c.stage);
  if (segment === 'dormant') return !['已成交', '售后维护'].includes(c.stage) && daysSince(c.lastContact, now) >= 14;
  return !['已成交', '售后维护'].includes(c.stage);
}
export function calculateQuote({ price, discount = 0, fee = 0, taxRate = 0, downPayment = 0, apr = 0, months = 60 }) {
  const values = [price, discount, fee, taxRate, downPayment, apr, months];
  if (values.some(v => !Number.isFinite(v) || v < 0) || !Number.isInteger(months) || months < 1 || months > 120 || taxRate > 100 || apr > 100 || discount > price) throw new Error('请输入合理的报价参数');
  const subtotal = price - discount + fee;
  const tax = Math.round(subtotal * taxRate) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;
  if (downPayment > total) throw new Error('首付不能高于费用合计');
  const principal = total - downPayment;
  const monthlyRate = apr / 1200;
  const monthly = monthlyRate ? principal * monthlyRate / (1 - Math.pow(1 + monthlyRate, -months)) : principal / months;
  return { subtotal, tax, total, principal, monthly: Math.round(monthly * 100) / 100 };
}
export function vehicleMatches(customer, vehicles) {
  return vehicles.filter(v => v.market === customer.market && v.currency === customer.currency).sort((a, b) => Number(b.name === customer.vehicle) - Number(a.name === customer.vehicle) || (customer.budgetUnknown?0:Math.abs(a.price - customer.budget[1]) - Math.abs(b.price - customer.budget[1])));
}
export function draftArtifact(kind, customer, vehicles, instruction = '', knowledge = [], options = {}) {
  const c = customer;
  const name = c.name.split(' ')[0];
  const candidates = vehicleMatches(c, vehicles);
  const match = candidates.find(v => v.id === options.preferredVehicleId) || candidates[0];
  const insight = `${c.name} · ${c.city}\n${c.need}\n核心顾虑：${c.concern}\n下一步：${c.next}\n\n已记录的客户记忆：\n${c.memories.map(m => `• ${m.text}（${m.source}）`).join('\n')}`;
  const english = `Hi ${name}, following up on your interest in the ${c.vehicle}. ${c.id === 'c1' ? 'I remembered you wanted space for both child seats and a clear plan for charging at your apartment. We can try the seats together and review the questions to ask your property manager.' : c.id === 'c3' ? 'I can prepare a clear cost breakdown for your commute and arrange an appraisal of your Accord. Any trade-in value and financing terms would need confirmation.' : `I would be happy to walk through the options for your ${c.stage === '方案洽谈' ? 'purchase' : 'next vehicle'} and confirm availability and local specifications with our team.`} Would a quick conversation this week work for you?`;
  const arabic = `مرحباً ${name}، أتابع معك بخصوص ${c.vehicle}. أتذكر أهمية المواصفات الخليجية والضمان المحلي وموعد التسليم بالنسبة لك. يمكنني تجهيز مقارنة واضحة بعد التأكد من هذه التفاصيل مع الفريق. هل يناسبك اتصال قصير هذا الأسبوع؟`;
  const german = `Hallo ${name}, ich melde mich zu Ihrem Interesse am ${c.vehicle}. Gerne kläre ich die lokale Verfügbarkeit und erstelle eine transparente Kostenübersicht. Passt Ihnen diese Woche ein kurzes Gespräch?`;
  let title, sections;
  if(['intake','relationship','review','regional'].includes(kind)) {
    const business=options.businessContext;
    const internal=(label,text)=>({label,text,dir:'ltr',audience:'internal'});
    if(kind==='intake'){
      title=`${name} · 线索识别与交接卡`;
      sections=[internal('已知事实与来源',insight),internal('少量关键追问',`用途：${c.need||'尚未确认'}\n车型：${c.vehicle||'尚未确认'}\n需核实：购车时间、预算是否含税、实际使用条件。不能从联系方式补齐身份或购买能力。`),{label:'需求确认 · English',text:`Hi ${name}, thank you for getting in touch. What would you like your next vehicle to help with, and when are you hoping to make a decision? We can confirm suitable local options together.`,audience:'customer',dir:'ltr'},internal('销售可接续的交接卡',`当前阶段：${c.stage}\n待核实：${c.concern}\n下一步：${c.next}\n接手时沿用上述记录，不重复询问已确认的事实。`)];
    }else if(kind==='relationship'){
      title=`${name} · 客户关系经营卡`;
      sections=[internal('关系状态与依据',insight),internal('本次联系计划',c.serviceIssue?.status==='open'?`优先处理服务：${c.serviceIssue.summary}。暂停促销，联系售后责任人。`:`联系围绕已有需求：${c.need}。不能把沉默解释成拒绝或高意向。`),{label:'关系沟通 · English',text:`Hi ${name}, I wanted to check how things are going and whether there is anything you would like our team to help with. Please let me know what would be most useful for you.`,audience:'customer',dir:'ltr'},internal('带回的信息',`客户的真实反馈、当前需要、希望的联系时间。\n${options.workflow?.requiredHumanAction||'将新事实记入客户工作，并更新下一次行动。'}`)];
    }else{
      title=kind==='regional'?'门店经营进展与行动清单':'活动漏斗复盘与下一轮调整';
      const totals=business?.totals;
      sections=[internal('资料口径',`${business?.source||'尚未提供经营记录'}\n时间：${business?.asOf||'待补充'}\n仅依据工作区记录；这些是登记量，不是经过归因的转化率。`),internal('实际记录',totals?`客户 ${totals.customers}；已记录联系 ${totals.contacted}；明确接受 ${totals.explicitAcceptance}；已登记预约 ${totals.booked}；未结服务 ${totals.unresolvedService}。`:'缺少可比较的业务记录。'),internal(kind==='regional'?'门店差异':'流失环节与待验证问题',(business?.stores||[]).map(s=>`${s.store}：${s.customers} 位客户，${s.waitingReply} 位待回复，${s.booked} 个预约，${s.openIssues} 个未结问题。`).join('\n')||'尚无门店汇总。'),internal('负责人行动表',(business?.actions||[]).map(a=>`${a.store} | ${a.owner} | ${a.action} | ${a.dueAt} | ${a.status}`).join('\n')||'需先补充责任人与期限。'),internal('下轮调整与资料缺口',`${(business?.missing||['费用、到店、收入与毛利数据尚未接入']).join('\n')}\n先补齐回执和未回复原因，再调整活动范围；没有成本、同口径客群和对照数据时，不计算 ROI 或声称活动带来增长。`)];
    }
  } else if (kind === 'quote') {
    title = `${c.name.split(' ')[0]} · 选车与报价方案`;
    sections = [{ label: '客户需求摘要', text: insight }, { label: '推荐方案', text: match ? `${match.name} · ${match.trim}\n示例车价 ${money(match.price, match.currency)} · ${match.location}\n${match.detail}\n${match.checked}\n${c.budgetUnknown ? '预算待确认，暂不判断价格匹配。' : match.price > c.budget[1] ? '提示：车价高于客户预算，需要重新确认方案。' : '预算匹配：车价在预算上限内；总购车费用仍需核算。'}` : '该市场暂无已接入车源。需要取得本地配置、库存与报价，不能套用其他市场价格。' }, { label: '购车费用与金融', text: match ? `车辆示例价格：${money(match.price, match.currency)}\n当地税费、牌照与经销商费用：待确认\n置换估值：需实车检测\n首付、APR、贷款期限：需客户确认及金融机构审批\n点击“费用试算”可生成假设条件下的月供；本方案不构成正式报价。` : '待取得本地有效报价后补充。' }, { label: '客户沟通 · English', text: english }, { label: '下一步', text: '1. 核对配置与可用车源\n2. 确认预算是否包含税费\n3. 如需置换，预约车辆评估\n4. 经门店审核后提供正式报价与有效期' }];
  } else if (kind === 'campaign') {
    title = options.campaign ? `${options.campaign.title} · 活动包` : `${c.market === 'AE' ? 'Dubai' : c.city.split(',')[0]} · SUV 试驾活动包`;
    sections = [{ label: '活动简报', text: `主题：Your next chapter starts with a drive.\n目标：邀请${c.market === 'AE' ? '当地家庭及企业 SUV 客群' : '家庭与换购意向客户'}到店体验。\n时间：拟定周末，日期、场地、试驾车及人员须确认。\n客群：同市场、有联系授权、尚未成交的 SUV 意向客户。\n转化路径：活动触达 → 客户回复 → 确认预约 → 到店试驾 → 个性化报价。` }, { label: 'WhatsApp / Email · English', text: `Hi ${name}, your next SUV should fit your everyday life. We'd love to welcome you for a relaxed test drive at Atlas Motors. Bring your questions, explore the space, and get a clear picture of your options. Interested? Reply with your preferred day and we'll confirm a time. Availability and local specifications will be confirmed by our team.` }, { label: 'WhatsApp · العربية', text: 'مرحباً، ندعوك لتجربة قيادة سيارة SUV في أطلس موتورز. تعرّف على المساحة والمزايا واطرح أسئلتك على فريقنا. إذا كنت مهتماً، أرسل اليوم المفضل لديك وسنؤكد الموعد والتوفر والمواصفات المحلية معك.' }, { label: 'Instagram 文案 · English', text: 'Room for your people. Ready for your plans.\nFind the SUV that fits your everyday life. Explore, ask questions, and take a test drive with Atlas Motors. Message us to request an appointment.\n#AtlasMotors #FindYourDrive #SUVLife\n素材建议：后排空间、行李厢与展厅试驾；使用门店授权图片。' }, { label: '执行与交付清单', text: '活动前 7 天：确认车辆、场地、名额与费用口径\n活动前 3 天：筛选授权客群，审核多语言内容\n活动前 1 天：仅向已预约客户确认时间\n活动后 1 天：记录试驾反馈与顾虑，准备个人方案\n复盘：回复率、预约率、到店率、报价率与成交归因；使用接入后的真实数据' }];
  } else if (kind === 'testdrive') {
    title = `${name} · 试驾邀约与准备清单`;
    sections = [{ label: '为什么这样邀请', text: insight }, { label: '客户邀约 · English', text: `Hi ${name}, would you like to experience the ${c.vehicle} with us? ${c.id === 'c1' ? 'You are welcome to bring both child seats so we can check the fit together, and we can talk through apartment charging options.' : 'We can focus on the features that matter most to your everyday driving.'} Please share a day and time that works for you in ${c.city}. I'll confirm vehicle and staff availability before booking.` }, { label: '中文对照', text: `邀请 ${name} 亲自体验 ${c.vehicle}，围绕已确认的用车需求安排体验。请客户提供当地时间偏好，确认试驾车和接待人员后再正式预约。` }, { label: '到店准备', text: '□ 确认门店位置、客户当地时间与时长\n□ 核实试驾车状态、配置与可用性\n□ 按当地政策确认驾驶资格和保险要求\n□ 准备与客户需求对应的体验项目\n□ 试驾后记录反馈与下一步，不预填客户满意度' }];
  } else if (kind === 'aftersales') {
    title = `${name} · 车主关怀方案`;
    sections = [{ label: '客户记忆', text: insight }, { label: '关怀消息 · English', text: `Hi ${name}, how are you settling in with your ${c.vehicle}? I wanted to check whether there is anything you would like help with. If you share your current mileage and any questions, I can ask our service team to check the appropriate maintenance guidance for your vehicle. Happy to help whenever you need us.` }, { label: '中文对照', text: `关心 ${name} 的真实用车体验，询问当前里程与使用问题。取得里程后，请售后团队依据车辆手册确认保养计划，不直接断言已到保养周期。` }, { label: '服务跟进清单', text: '1. 记录实际里程与使用体验\n2. 有故障或安全问题时转交专业售后团队\n3. 按 VIN、手册与本地政策确认服务计划\n4. 有服务需求再预约；明确预约尚待门店确认\n5. 经客户同意后，再讨论评价或转介绍' }];
  } else {
    title = `${name} · 个性化跟进话术`;
    sections = [{ label: '客户洞察', text: insight }, { label: c.language === 'ar' ? 'WhatsApp · العربية' : c.language === 'de' ? 'Email · Deutsch' : `${c.channel} · English`, text: c.language === 'ar' ? arabic : c.language === 'de' ? german : english, dir: c.language === 'ar' ? 'rtl' : 'ltr' }, { label: '中文对照与沟通重点', text: c.language === 'ar' ? '回应 GCC 规格、本地保修和交期需求，承诺核实信息后提供清晰对比，邀请一次简短沟通。' : c.id === 'c1' ? '记住两个儿童座椅和公寓充电的需求；邀请客户试装座椅，一起整理给物业的问题。用一个轻量问题推进下一步，不承诺可以安装。' : `围绕“${c.need}”开启对话。对“${c.concern}”先确认事实，再提供方案。以客户方便的时间推动下一次沟通。` }, { label: '建议下一步', text: `${c.next}。客户回复后，把新的事实和顾虑写回画像，再决定下一步。` }];
  }
  if (kind === 'quote' && match) {
    const outbound = sections.find(s => s.label === '客户沟通 · English');
    if (outbound) outbound.text = outbound.text.replaceAll(c.vehicle, match.name);
  }
  if(['intake','relationship'].includes(kind)&&['ar','de'].includes(c.language)){
    const outbound=sections.find(s=>s.audience==='customer');
    outbound.label=c.language==='ar'?'客户沟通 · العربية':'客户沟通 · Deutsch';outbound.dir=c.language==='ar'?'rtl':'ltr';
    outbound.text=c.language==='ar'?(kind==='intake'?`مرحباً ${name}، شكراً لتواصلك. ما الاستخدام الرئيسي للسيارة، ومتى تفكر في الشراء؟ سنراجع الخيارات المحلية المناسبة بعد تأكيد احتياجاتك.`:`مرحباً ${name}، نود الاطمئنان ومعرفة إن كان هناك ما يمكن لفريقنا مساعدتك به. ما الذي سيكون مفيداً لك الآن؟`):(kind==='intake'?`Hallo ${name}, vielen Dank für Ihre Anfrage. Wofür möchten Sie das Fahrzeug nutzen, und wann planen Sie einen Kauf? Wir klären passende lokale Optionen gemeinsam.`:`Hallo ${name}, wie geht es Ihnen? Gibt es etwas, bei dem unser Team Ihnen helfen kann? Teilen Sie uns gerne mit, was Ihnen gerade wichtig ist.`);
  }
  if (c.language === 'ar' && ['quote', 'testdrive', 'aftersales'].includes(kind)) {
    const outbound = sections.find(s => s.label.includes('English'));
    outbound.label = `${kind === 'aftersales' ? '关怀消息' : kind === 'testdrive' ? '客户邀约' : '客户沟通'} · العربية`;
    outbound.dir = 'rtl';
    outbound.text = kind === 'testdrive' ? `مرحباً ${name}، هل ترغب في تجربة قيادة ${c.vehicle}؟ يسعدنا التركيز على المزايا التي تهمك في استخدامك اليومي. أرسل اليوم والوقت المناسبين لك في ${c.city}، وسنؤكد توفر السيارة والفريق قبل تثبيت الموعد.` : kind === 'aftersales' ? `مرحباً ${name}، كيف تسير تجربتك مع ${c.vehicle}؟ هل هناك أي أسئلة أو أمور تحتاج إلى مساعدة بشأنها؟ إذا أرسلت المسافة المقطوعة حالياً، يمكن لفريق الصيانة مراجعة الإرشادات المناسبة لسيارتك. يسعدنا مساعدتك.` : arabic.replaceAll(c.vehicle, match?.name || c.vehicle);
  }
  if (c.language === 'de' && ['quote', 'testdrive', 'aftersales'].includes(kind)) {
    const outbound = sections.find(s => s.label.includes('English'));
    outbound.label = `${kind === 'aftersales' ? '关怀消息' : kind === 'testdrive' ? '客户邀约' : '客户沟通'} · Deutsch`;
    outbound.text = kind === 'testdrive' ? `Hallo ${name}, möchten Sie den ${c.vehicle} bei einer Probefahrt kennenlernen? Nennen Sie uns gerne einen passenden Tag und eine Uhrzeit in ${c.city}. Wir bestätigen die Fahrzeug- und Mitarbeiterverfügbarkeit, bevor der Termin feststeht.` : kind === 'aftersales' ? `Hallo ${name}, wie sind Ihre ersten Erfahrungen mit Ihrem ${c.vehicle}? Gibt es Fragen, bei denen wir helfen können? Teilen Sie uns gerne Ihren aktuellen Kilometerstand mit, damit unser Serviceteam die passenden Wartungshinweise prüfen kann.` : german.replaceAll(c.vehicle, match?.name || c.vehicle);
  }
  if(c.serviceIssue?.status==='open'&&['aftersales','relationship'].includes(kind)){
    const outbound=sections.find(s=>s.audience==='customer'||/English|العربية|Deutsch/.test(s.label));
    outbound.text=c.language==='ar'?`مرحباً ${name}، يؤسفني أن المشكلة لم تُحل بعد. أود التأكد من آخر المستجدات وتنسيق المتابعة مع فريق الخدمة. ما الوقت المناسب للتواصل معك؟`:c.language==='de'?`Hallo ${name}, es tut mir leid, dass Ihr Anliegen noch offen ist. Ich möchte den aktuellen Stand mit unserem Serviceteam klären und die nächsten Schritte mit Ihnen abstimmen. Wann dürfen wir Sie erreichen?`:`Hi ${name}, I’m sorry your concern is still unresolved. I’d like to confirm the current situation and coordinate the next steps with our service team. When would be a convenient time to speak?`;
    sections.push({label:'服务问题优先',text:`${c.serviceIssue.summary}\n暂停促销、指定售后负责人并记录下一次答复。客户未确认前不能标为已解决。`,audience:'internal',dir:'ltr'});
  }
  if (kind === 'campaign' && c.market !== 'AE' && c.language !== 'ar') sections = sections.filter(s => !s.label.includes('العربية'));
  if (kind === 'campaign' && c.language === 'de') sections.splice(2, 0, { label: 'Email · Deutsch', text: `Hallo ${name}, entdecken Sie einen SUV, der zu Ihrem Alltag passt. Gerne laden wir Sie zu einer entspannten Probefahrt bei Atlas Motors ein. Antworten Sie mit Ihrem Wunschtermin; wir bestätigen anschließend Verfügbarkeit und lokale Ausstattung.` });
  if (options.campaign && kind === 'campaign') sections.unshift({ label: '本次活动目标', text: `活动：${options.campaign.title}\n目标市场：${c.market}\n客群：${options.campaign.audience}\n目标：${options.campaign.goal}\n渠道：${options.campaign.channel}\n以下为基础活动模板，请按活动实际安排审核调整。` });
  if (instruction.trim()) sections.push({ label: '本次协作要求 · 审核参考', text: instruction.trim() });
  if (knowledge.length) sections.push({ label: '参考知识', text: knowledge.map(k => `${k.title}：${k.body}`).join('\n\n') });
  if (options.workspaceName) sections.forEach(s => { s.text = s.text.replaceAll('Atlas Motors', options.workspaceName).replaceAll('أطلس موتورز', options.workspaceName); });
  if(options.workflow)sections.push({label:'当前工作安排与最新反馈',audience:'internal',dir:'ltr',text:`${options.workflow.goal}\n${options.workflow.steps.join('\n')}\n${options.workflow.candidateSlot?.localTime||'时段待确认'}\n${options.workflow.latestFeedback.map(f=>`${f.text}（${f.source}）`).join('\n')}\n需要同事：${options.workflow.requiredHumanAction}`});
  let posterBrief;
  if(options.needsPoster||kind==='campaign')posterBrief={kicker:'YOUR PERSONAL VISIT',headline:options.workflow?.path==='置换评估'?'A fresh start for your next drive.':'A visit built around you.',subheadline:'Explore your options and bring the questions that matter to you.',details:options.workflow?.candidateSlot?`${options.workflow.candidateSlot.localTime} · Proposed visit`:`${c.city} · Time to be confirmed`,cta:'Request a visit',disclaimer:'Template draft. Confirm local vehicle and appointment availability.'};
  if(posterBrief&&c.language==='ar')posterBrief={kicker:'تجربة تناسبك',headline:'ابدأ تجربتك القادمة.',subheadline:'ناقش احتياجاتك واستكشف الخيارات المناسبة لك.',details:options.workflow?.candidateSlot?`${options.workflow.candidateSlot.localTime} · موعد مقترح`:'الموعد والتوفر بانتظار التأكيد',cta:'طلب موعد',disclaimer:'تصميم مبدئي. يجب تأكيد السيارة والموعد والتفاصيل محلياً.'};
  if(posterBrief&&c.language==='de')posterBrief={kicker:'IHRE PERSÖNLICHE PROBEFAHRT',headline:'Bereit für Ihr nächstes Kapitel.',subheadline:'Entdecken Sie die Möglichkeiten für Ihren Alltag.',details:options.workflow?.candidateSlot?`${options.workflow.candidateSlot.localTime} · Vorschlag`:'Termin und Verfügbarkeit sind noch zu bestätigen.',cta:'Termin anfragen',disclaimer:'Entwurf. Fahrzeug und Termin vor Ort bestätigen.'};
  return { id: uid('doc'), customerId: c.id, kind, title, sections, status: 'review', createdAt: new Date().toISOString(), language: c.language, sources: c.memories.map(m => m.source),...(posterBrief?{posterBrief}:{}), note: '基于本地示例资料与场景模板生成；需人工核实事实并审核语言。' };
}
export function artifactText(a) { return `${a.title}\n${'═'.repeat(36)}\n\n${a.sections.map(s => `${s.label}\n${s.text}`).join('\n\n')}\n\n${a.note}`; }
export function dueAutomation(rule, customer, now = new Date()) {
  if (!rule.enabled || !matchesSegment(customer, rule.segment, now)) return false;
  const p = localParts(customer.timezone, now);
  const localDay = `${p.year}-${p.month}-${p.day}`;
  if (rule.runs?.[customer.id] === localDay || Number(p.hour) < rule.hour || Number(p.hour) >= 18) return false;
  const previous = rule.lastRuns?.[customer.id];
  return !previous || daysSince(previous, now) >= rule.cadence;
}
