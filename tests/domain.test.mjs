import test from 'node:test';
import assert from 'node:assert/strict';
import { seedState } from '../data.js';
import { calculateQuote, contactEligibility, localParts, vehicleMatches, draftArtifact, dueAutomation, matchesSegment, daysSince } from '../domain.js';

test('费用试算：零利率贷款和含税合计', () => {
  const quote = calculateQuote({ price: 40000, discount: 1000, fee: 500, taxRate: 8, downPayment: 12660, apr: 0, months: 60 });
  assert.equal(quote.tax, 3160);
  assert.equal(quote.total, 42660);
  assert.equal(quote.monthly, 500);
});
test('费用试算：固定 APR 等额月供', () => {
  const quote = calculateQuote({ price: 30000, downPayment: 5000, apr: 6, months: 60 });
  assert.equal(quote.monthly, 483.32);
});
test('费用试算拒绝无效期数、超额优惠、首付与非数字', () => {
  for (const options of [{ months: 0 }, { months: 121 }, { months: 60.5 }, { discount: 50000 }, { downPayment: 50000 }, { taxRate: NaN }, { apr: -1 }]) {
    assert.throws(() => calculateQuote({ price: 40000, ...options }));
  }
});
test('授权缺失时阻断自动联系', () => {
  const c = seedState().customers.find(c => c.id === 'c8');
  const result = contactEligibility(c, { now: new Date('2026-09-09T10:00:00Z'), checkHours: false });
  assert.equal(result.ok, false);
  assert.match(result.reason, /未获营销联系授权/);
});
test('刚联系过的客户在最短间隔内不会再次触达', () => {
  const c = { ...seedState().customers[0], lastContact: '2026-09-08T14:00:00Z' };
  const result = contactEligibility(c, { now: new Date('2026-09-09T15:00:00Z') });
  assert.equal(result.ok, false);
  assert.match(result.reason, /不足 7 天/);
});
test('使用客户时区，尊重夏令时与联系窗口边界', () => {
  const c = { ...seedState().customers[0], lastContact: '2026-08-01T00:00:00Z' };
  assert.equal(localParts(c.timezone, new Date('2026-09-09T14:00:00Z')).hour, '09');
  assert.equal(localParts(c.timezone, new Date('2026-01-09T14:00:00Z')).hour, '08');
  assert.equal(contactEligibility(c, { now: new Date('2026-09-09T13:59:00Z') }).ok, false);
  assert.equal(contactEligibility(c, { now: new Date('2026-09-09T14:00:00Z') }).ok, true);
  assert.equal(contactEligibility(c, { now: new Date('2026-09-09T23:00:00Z') }).ok, false);
});
test('从未联系的新客户不会被显示为数万天未联系，也不算沉睡客户', () => {
  const c = { ...seedState().customers[0], lastContact: null };
  assert.equal(daysSince(c.lastContact), 0);
  assert.equal(matchesSegment(c, 'dormant'), false);
});
test('跨市场车源不能用于客户报价', () => {
  const s = seedState(); const uk = s.customers.find(c => c.market === 'GB');
  assert.equal(vehicleMatches(uk, s.vehicles).length, 0);
  const doc = draftArtifact('quote', uk, s.vehicles);
  assert.match(doc.sections.find(s => s.label === '推荐方案').text, /不能套用其他市场价格/);
  assert.doesNotMatch(doc.sections.find(s => s.label === '推荐方案').text, /46,900/);
});
test('明确选择的同市场车源进入方案，跨市场强选仍不可越界', () => {
  const s = seedState(); const c = s.customers[0];
  const preferred = draftArtifact('quote', c, s.vehicles, '', [], { preferredVehicleId: 'v3' });
  assert.match(preferred.sections.find(s => s.label === '推荐方案').text, /Kia EV6/);
  const wrongMarket = draftArtifact('quote', c, s.vehicles, '', [], { preferredVehicleId: 'v4' });
  assert.doesNotMatch(wrongMarket.sections.find(s => s.label === '推荐方案').text, /Land Cruiser/);
});
test('新增记忆与来源进入后续交付物，历史对象独立', () => {
  const s = seedState(); const c = s.customers[0];
  const old = draftArtifact('followup', c, s.vehicles);
  c.memories.push({ text: '客户补充：周日下午 3 点方便到店。', source: 'Alex 手动记录' });
  const fresh = draftArtifact('followup', c, s.vehicles);
  assert.match(fresh.sections[0].text, /周日下午 3 点/);
  assert.ok(fresh.sources.includes('Alex 手动记录'));
  assert.doesNotMatch(old.sections[0].text, /周日下午 3 点/);
});
test('阿拉伯语话术带 RTL，金融与规格待确认事项保留', () => {
  const s = seedState(); const c = s.customers[1];
  const doc = draftArtifact('followup', c, s.vehicles);
  assert.equal(doc.sections[1].dir, 'rtl');
  assert.match(doc.sections[1].text, /مرحباً/);
  assert.match(doc.sections[0].text, /待核实|尚未/);
});
test('自定义营销活动目标成为活动包内容', () => {
  const s = seedState(); const campaign = {title:'车主充电课堂',goal:'帮助新车车主熟悉充电',audience:'已交付车主',channel:'Email'};
  const doc = draftArtifact('campaign', s.customers[0], s.vehicles, '', [], { campaign });
  assert.match(doc.title, /车主充电课堂/);
  assert.match(doc.sections[0].text, /帮助新车车主熟悉充电/);
});
test('阿拉伯语试驾和售后内容使用 RTL 客户文案', () => {
  const s=seedState();const c=s.customers[1];
  for (const kind of ['testdrive','aftersales','quote']) {
    const doc=draftArtifact(kind,c,s.vehicles);
    const outbound=doc.sections.find(section=>section.label.includes('العربية'));
    assert.ok(outbound);assert.equal(outbound.dir,'rtl');
    assert.match(outbound.text,/مرحباً/);
    assert.ok(!doc.sections.some(section=>section.label.includes('English')));
  }
});
test('德语活动与工作区品牌替换适配所选客户', () => {
  const s=seedState();const c=s.customers.find(c=>c.language==='de');
  const doc=draftArtifact('campaign',c,s.vehicles,'',[],{workspaceName:'North Star Motors'});
  assert.ok(doc.sections.some(section=>section.label.includes('Deutsch')));
  assert.ok(!doc.sections.some(section=>section.label.includes('العربية')));
  assert.match(doc.sections.map(section=>section.text).join('\n'),/North Star Motors/);
  assert.doesNotMatch(doc.sections.map(section=>section.text).join('\n'),/Atlas Motors/);
});
test('自动化：目标人群、当地日程、重复周期和暂停', () => {
  const s = seedState(); const c = s.customers[1]; const now = new Date('2026-09-09T06:00:00Z');
  const rule = { ...s.automations[0], hour: 10 };
  assert.equal(dueAutomation(rule, c, now), true);
  assert.equal(dueAutomation({ ...rule, enabled: false }, c, now), false);
  assert.equal(dueAutomation({ ...rule, hour: 11 }, c, now), false);
  assert.equal(dueAutomation({ ...rule, runs: { [c.id]: '2026-09-09' } }, c, now), false);
  assert.equal(dueAutomation({ ...rule, lastRuns: { [c.id]: '2026-09-08T06:00:00Z' } }, c, now), false);
  assert.equal(dueAutomation({ ...rule, lastRuns: { [c.id]: '2026-09-01T06:00:00Z' } }, c, now), true);
  assert.equal(dueAutomation(rule, s.customers.find(c=>c.id==='c7'), now), false);
});
