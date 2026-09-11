import test from 'node:test';
import assert from 'node:assert/strict';
import {createPoster,normalizePoster,buildPosterSVG,POSTER_SIZES,wrapText,fitPosterText} from '../poster.js';
import {seedState} from '../data.js';
test('海报是独立可审核的视觉交付物，使用模型视觉文案',()=>{
  const s=seedState(),brief={headline:'Room for what matters.',subheadline:'A family drive.',kicker:'WEEKEND',details:'By appointment',cta:'Request a test drive',disclaimer:'Details to be confirmed.'};
  const a=createPoster({campaign:s.campaigns[0],customer:s.customers[1],artifact:{id:'doc1',language:'en',posterBrief:brief,engine:'copilot',sources:['M1']}});
  assert.equal(a.format,'poster');assert.equal(a.status,'review');assert.equal(a.poster.headline,brief.headline);assert.equal(a.poster.language,'en');assert.equal(a.parentArtifactId,'doc1');
});
test('方形、竖版、Story 使用真实尺寸，并区分审核前后水印',()=>{
  for(const [size,dimension] of Object.entries(POSTER_SIZES)){
    const svg=buildPosterSVG({size,headline:'Your next chapter.'});assert.match(svg,new RegExp(`width="${dimension.width}" height="${dimension.height}"`));assert.match(svg,/DRAFT \/ CONCEPT/);
    assert.doesNotMatch(buildPosterSVG({size,headline:'Your next chapter.'},{approved:true}),/DRAFT \/ CONCEPT/);
  }
});
test('海报字段作为文字转义，不能执行脚本或加载外部资产',()=>{
  const svg=buildPosterSVG({headline:'<script>alert(1)</script>',brand:'A & B',theme:'javascript:alert(1)',language:'ar'});
  assert.doesNotMatch(svg,/<script>/);assert.match(svg,/&lt;script&gt;/);assert.match(svg,/A &amp; B/);assert.match(svg,/direction="rtl"/);assert.doesNotMatch(svg,/href=/);
});
test('长度与版式参数受控，长标题有明确截断',()=>{
  assert.equal(normalizePoster({size:'unknown',theme:'unknown'}).size,'portrait');assert.equal(normalizePoster({headline:'a'.repeat(1000)}).headline.length,100);
  const lines=wrapText('a'.repeat(200),10,2);assert.equal(lines.length,2);assert.ok(lines[1].endsWith('…'));
});
test('自适应字号保留长标题和说明全文，英文优先按单词折行',()=>{
  assert.deepEqual(wrapText('Room for what matters.',7,5),['Room for','what matters.']);
  for(const value of ['Family test-drive weekend: bring your questions and find the space for everyone you love.','确'.repeat(100),'تجربة قيادة '.repeat(8).trim()]){
    const fitted=fitPosterText(value,{height:184,maxSize:80});
    assert.equal(fitted.lines.join('').replace(/\s/g,''),value.replace(/\s/g,''));
    assert.ok(fitted.lines.length*fitted.size*fitted.lineHeight<=184);
  }
  const a=buildPosterSVG({headline:'First'}),b=buildPosterSVG({headline:'Second'});
  assert.notEqual(a.match(/id="([^"]+)-background"/)[1],b.match(/id="([^"]+)-background"/)[1]);
});
