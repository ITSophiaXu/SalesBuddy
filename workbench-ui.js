import {renderVehicleComparison,comparisonCSS,exportComparisonHTML} from './vehicle-comparison.js';
import {buildPosterSVG, normalizePoster, posterToPNG, POSTER_SIZES, POSTER_THEMES} from './poster.js';
import {isArtifactCurrent} from './cowork.js';
import {conversationArtifacts, selectedArtifact, artifactFamily, versionArtifact, attachArtifact} from './artifact-workbench.js';

const posterFields = [['brand','品牌',50],['kicker','活动标签',80],['headline','主标题',100],['subheadline','副标题',180],['vehicle','车型',100],['details','时间与地点',180],['cta','行动文案',50],['disclaimer','页脚说明',230]];

export function createArtifactWorkbench(api) {
  const {esc,i,btn}=api, state=api.state, chat=api.current;
  const drafts=new Map(Object.entries(state().artifactDrafts||{}));
  const saveDrafts=()=>{state().artifactDrafts=Object.fromEntries(drafts);api.save();};
  const selected=()=>selectedArtifact(state(),chat());
  const owned=id=>conversationArtifacts(state(),chat()).find(a=>a.id===id);
  const draftFor=a=>a&&drafts.get(a.id);
  const changed=(a,d)=>!!d && (d.title!==a.title || (a.format==='poster'?JSON.stringify(normalizePoster(d.poster))!==JSON.stringify(a.poster):JSON.stringify(d.sections)!==JSON.stringify(a.sections)));
  const hasDirtyDraft=()=>{const a=selected();return !!a&&changed(a,draftFor(a));};
  const version=a=>'v'+(a.artifactVersion||1);
  const origin=a=>a.versionSource==='manual'?'手动修改':a.artifactVersion>1?'Cowork 修改':'初稿';

  function renderTarget() {
    const a=selected();if(!a)return '';
    return `<div class="wb-chat-target" aria-label="当前对话参考成果" data-artifact-id="${esc(a.id)}"><span>${i(a.format==='poster'?'megaphone':'doc')}</span><div><small>当前${a.format==='poster'?'海报':a.format==='comparison'?'车型对比':'文档'} · ${version(a)}</small><strong title="${esc(a.title)}">${esc(a.title)}</strong><p>${hasDirtyDraft()?'有未保存修改，请先保存或取消编辑。':'提出修改会生成新版本；提问会直接回答。'}</p></div></div>`;
  }

  function renderDocument(a,d) {
    if(d)return `<form id="chat-canvas-form" data-id="${a.id}" class="artifact-paper xp-document"><label class="field-label" for="canvas-title">文档标题</label><input class="field" id="canvas-title" name="title" data-canvas="title" data-id="${a.id}" value="${esc(d.title)}" required maxlength="200">${d.sections.map((s,n)=>`<section class="paper-section"><label class="field-label" for="canvas-section-${n}">${esc(a.format==='comparison'?(s.label==='summary'?'对比摘要':s.label==='nextStep'?'下一步':s.label==='review'?'内部审核说明':a.comparison.vehicles.find(v=>'vehicle:'+v.id===s.label)?.name||s.label):s.label)}</label><textarea class="field" id="canvas-section-${n}" name="section-${n}" data-canvas="${n}" data-id="${a.id}" dir="${s.dir||'auto'}" maxlength="20000" required>${esc(s.text)}</textarea></section>`).join('')}</form>`;
    return `<article class="artifact-paper xp-document"><div class="paper-brand"><strong>motive.</strong><span>${version(a)} · ${origin(a)}</span></div><h1>${esc(a.title)}</h1><div class="paper-meta">${esc(a.language?.toUpperCase()||'')} · ${new Date(a.createdAt).toLocaleDateString('zh-CN')}</div>${(a.sections||[]).map(s=>`<section class="paper-section"><h3>${esc(s.label)}</h3><p dir="${s.dir||'auto'}">${esc(s.text)}</p></section>`).join('')}<details class="wb-document-sources"><summary>来源与使用说明</summary><p>${esc(a.note||'')}<br>${(a.sources||[]).map(esc).join(' · ')}</p></details></article>`;
  }

  function renderPoster(a,d) {
    const p=d?.poster||a.poster;
    const select=(name,label,options)=>`<label class="field-label" for="canvas-poster-${name}">${label}</label><select class="field" id="canvas-poster-${name}" name="${name}" data-canvas-poster="${name}" data-id="${a.id}">${Object.entries(options).map(([id,v])=>`<option value="${id}" ${p[name]===id?'selected':''}>${esc(v.label||v)}</option>`).join('')}</select>`;
    return `<div class="wb-poster-layout ${d?'is-editing':''}"><div class="wb-poster-preview"><div class="wb-poster-dimensions">${POSTER_SIZES[p.size].label} · ${POSTER_SIZES[p.size].width} × ${POSTER_SIZES[p.size].height}</div><div class="xp-poster-canvas" id="canvas-poster-preview">${buildPosterSVG(p,{approved:!d&&a.status==='approved'&&isArtifactCurrent(state(),a)})}</div></div>${d?`<form id="chat-canvas-form" class="wb-poster-controls" data-id="${a.id}"><h3>编辑海报</h3><label class="field-label" for="canvas-poster-title">成果名称</label><input class="field" id="canvas-poster-title" name="title" value="${esc(d.title)}" data-canvas="title" data-id="${a.id}" required maxlength="200">${select('size','发布尺寸',POSTER_SIZES)}${select('theme','品牌配色',POSTER_THEMES)}${select('language','语言与排版方向',{en:'English',ar:'العربية · RTL',de:'Deutsch',zh:'中文'})}${posterFields.map(([name,label,max])=>`<label class="field-label" for="canvas-poster-${name}">${label}</label><textarea class="field" id="canvas-poster-${name}" name="${name}" data-canvas-poster="${name}" data-id="${a.id}" maxlength="${max}" rows="2">${esc(p[name])}</textarea>`).join('')}<p>选择语言不会翻译手动文案。请在右侧提出翻译要求。</p></form>`:''}</div>`;
  }

  function render() {
    const c=chat(),a=selected(),all=conversationArtifacts(state(),c),d=draftFor(a),running=api.busy(c);
    const groups=new Map();for(const item of all)groups.set(artifactFamily(item),item);
    const versions=a?all.filter(x=>artifactFamily(x)===artifactFamily(a)).reverse():[];
    const old=a&&versions[0]?.id!==a.id,stale=a&&!isArtifactCurrent(state(),a);
    return `<section class="xp-canvas wb-canvas" data-artifact-id="${esc(a?.id||'')}" aria-label="成果工作台"><div class="wb-output-bar"><div class="wb-output-tabs" aria-label="工作成果">${[...groups.values()].map(x=>`<button data-act="chat-artifact" data-id="${x.id}" aria-pressed="${a&&artifactFamily(a)===artifactFamily(x)}" title="${esc(x.title)}">${i(x.format==='poster'?'megaphone':'doc')}<span>${esc(x.title)}</span>${drafts.has(x.id)?'<em>编辑中</em>':''}</button>`).join('')||'<span class="wb-output-placeholder">'+i('doc')+'工作成果</span>'}</div>${a?`<select class="wb-version-select" data-canvas-version="true" aria-label="查看成果版本">${versions.map(x=>`<option value="${x.id}" ${x.id===a.id?'selected':''}>${version(x)} · ${origin(x)}${x.id===versions[0].id?' · 最新':''}</option>`).join('')}</select>`:''}</div>${a?`<div class="wb-toolbar"><span class="wb-status ${stale?'is-stale':''}">${stale?'资料已更新':d?'编辑中':a.status==='approved'?'已审核':'待审核'}${old?' · 历史版本':''}</span><span class="grow"></span>${d?`${btn('取消','chat-canvas-cancel',null,'sm',`data-id="${a.id}"`)}<button class="btn primary sm" type="submit" form="chat-canvas-form">保存新版本</button>`:`${btn('编辑','chat-canvas-edit','edit','sm',`data-id="${a.id}" ${running?'disabled':''}`)}${btn('让 Cowork 修改','chat-revision-tip','spark','sm',running?'disabled':'')}<details class="wb-export"><summary class="btn sm">${i('download')}审核与导出</summary><div>${btn('审核通过','chat-canvas-approve','check','sm',`data-id="${a.id}" ${stale||running?'disabled':''}`)}${a.format==='poster'?`${btn('导出 PNG','chat-canvas-export',null,'sm',`data-id="${a.id}" data-format="png"`)}${btn('导出 SVG','chat-canvas-export',null,'sm',`data-id="${a.id}" data-format="svg"`)}`:btn(a.format==='comparison'?'导出客户对比页':'导出 Markdown','chat-canvas-export',null,'sm',`data-id="${a.id}"`)}<small>未审核的成果带草稿标记。</small></div></details>`}</div>`:''}<div class="xp-canvas-scroll wb-canvas-scroll" aria-busy="${running}">${running?'<div class="wb-generation-note" role="status">Cowork 正在准备成果，你可以继续查看已有版本。</div>':''}${stale?'<div class="xp-source-notice">关联资料已变化。请依据最新资料重新准备成果。</div>':''}${old?`<div class="wb-history-note">正在查看 ${version(a)}；继续修改会基于此版本。${btn('回到最新版','chat-artifact',null,'sm',`data-id="${versions[0].id}"`)}</div>`:''}${a?(a.format==='poster'?renderPoster(a,d):a.format==='comparison'&&!d?'<style>'+comparisonCSS+'</style>'+renderVehicleComparison(a,{approved:a.status==='approved'&&!stale}):renderDocument(a,d)):`<div class="wb-empty"><span class="xp-canvas-mark">${i('doc')}</span><span class="eyebrow">YOUR WORK, HERE</span><h2>${esc(c?.goal||'这次要完成什么？')}</h2><p>在右侧交代目标和要求。成果会在这里展开，之后可以直接编辑，也可以通过对话继续修改。</p>${c?.workflowSteps?`<div class="wb-output-outline">${c.workflowSteps.map((step,n)=>`<div><span>${String(n+1).padStart(2,'0')}</span>${esc(step)}</div>`).join('')}</div>`:''}</div>`}</div><footer class="wb-canvas-footer"><span>${a?`${a.format==='poster'?'海报':'文档'} · ${version(a)} · ${origin(a)}`:'成果工作区域'}</span><span>${a?'中间编辑成果 · 右侧对话调整':'等待右侧提交工作要求'}</span></footer></section>`;
  }

  function submit(form,data) {
    const a=owned(form.dataset.id),d=draftFor(a);if(!a||!d)return;
    if(api.busy(chat())){api.toast('Cowork 正在准备成果，请完成后再保存。');return;}
    if(d.base!==JSON.stringify(a)){api.toast('成果已被修改，请取消编辑并重新打开。');return;}
    const title=String(data.title??d.title).trim();if(!title||title.length>200){api.toast('请填写 200 字以内的标题。');return;}
    let result={...a,title};
    if(a.format==='poster'){
      const p=normalizePoster({...d.poster,...Object.fromEntries(['size','theme','language',...posterFields.map(x=>x[0])].filter(k=>k in data).map(k=>[k,data[k]]))});
      result={...result,poster:p,language:p.language,sections:[{label:'海报文案',text:p.headline+'\n'+p.subheadline}]};
    }else{
      result.sections=d.sections.map((s,n)=>({...s,text:String(data['section-'+n]??s.text)}));
      if(result.sections.some(s=>!s.text.trim()||s.text.length>20000)){api.toast('每个段落需填写内容，且不超过 20000 字。');return;}
    }
    if(!changed(a,{...d,...result})){drafts.delete(a.id);saveDrafts();api.render();return;}
    const next=versionArtifact(state(),a,result,'manual');
    if(!isArtifactCurrent(state(),a)){next.status='stale';next.staleReason=a.staleReason||'关联资料已更新';}
    state().artifacts.unshift(next);attachArtifact(chat(),next);drafts.delete(a.id);saveDrafts();api.render();api.toast('新版本已保存，原版保留。右侧将参考这个版本。');
  }

  async function handleAction(act,data) {
    if(!['chat-artifact','chat-canvas-edit','chat-canvas-cancel','chat-canvas-approve','chat-canvas-export'].includes(act))return false;
    const a=owned(data.id);if(!a)return true;
    if(act==='chat-artifact'){chat().selectedArtifactId=a.id;api.save();api.render();return true;}
    if(act==='chat-canvas-cancel'){drafts.delete(a.id);saveDrafts();api.render();return true;}
    if(api.busy(chat())){api.toast('Cowork 正在准备成果，请完成后再编辑或导出。');return true;}
    if(act==='chat-canvas-edit'){if(!drafts.has(a.id))drafts.set(a.id,{base:JSON.stringify(a),title:a.title,sections:structuredClone(a.sections),...(a.poster?{poster:structuredClone(a.poster)}:{})});saveDrafts();api.render();return true;}
    if(changed(a,draftFor(a))){api.toast('请先保存或取消编辑。');return true;}
    const valid=isArtifactCurrent(state(),a);
    if(act==='chat-canvas-approve'){
      if(!valid){api.toast('资料已更新，请重新准备成果。');return true;}
      a.status='approved';a.approvedAt=new Date().toISOString();state().tasks.filter(t=>t.artifactId===a.id).forEach(t=>t.status='approved');api.save();api.render();api.toast('当前版本已审核。');
    }
    if(act==='chat-canvas-export'){
      try{
        const approved=valid&&a.status==='approved',name=a.title+'-'+version(a);
        if(a.format==='poster'){
          if(data.format==='png')api.download(await posterToPNG(a.poster,{approved}),name+'.png','image/png');
          else api.download(buildPosterSVG(a.poster,{approved}),name+'.svg','image/svg+xml;charset=utf-8');
        }else if(a.format==='comparison')api.download(exportComparisonHTML(a,{approved}),name+'.html','text/html;charset=utf-8');
        else api.download(`${approved?'':'> 草稿 · 待审核\n\n'}# ${a.title}\n\n${a.sections.map(s=>'## '+s.label+'\n\n'+s.text).join('\n\n')}\n\n${a.note||''}`,name+'.md');
      }catch(error){api.toast(error.message);}
    }
    return true;
  }

  function onInput(target) {
    const a=owned(target.dataset?.id),d=draftFor(a);if(!d)return;
    if(target.dataset.canvas!==undefined){if(target.dataset.canvas==='title')d.title=target.value;else if(d.sections[Number(target.dataset.canvas)])d.sections[Number(target.dataset.canvas)].text=target.value;}
    if(target.dataset.canvasPoster){d.poster=normalizePoster({...d.poster,[target.dataset.canvasPoster]:target.value});const preview=document.querySelector('#canvas-poster-preview');if(preview)preview.innerHTML=buildPosterSVG(d.poster);const dimensions=document.querySelector('.wb-poster-dimensions');if(dimensions)dimensions.textContent=`${POSTER_SIZES[d.poster.size].label} · ${POSTER_SIZES[d.poster.size].width} × ${POSTER_SIZES[d.poster.size].height}`;}
    saveDrafts();
    const region=document.querySelector('.wb-chat-target');if(region)region.outerHTML=renderTarget();
  }

  function onChange(target) {
    if(target.dataset?.canvasVersion){const a=owned(target.value);if(a){chat().selectedArtifactId=a.id;api.save();api.render();}return true;}
    if(target.dataset?.canvasPoster){onInput(target);return true;}
    return false;
  }
  return {render,renderTarget,selected,hasDirtyDraft,submit,handleAction,onInput,onChange};
}
