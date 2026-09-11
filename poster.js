import {uid} from './domain.js';

export const POSTER_SIZES = {square:{label:'方形 · 社交动态',width:1080,height:1080},portrait:{label:'竖版 · Instagram',width:1080,height:1350},story:{label:'Story · 全屏',width:1080,height:1920}};
export const POSTER_THEMES = {forest:{label:'森林绿',bg:'#183e31',end:'#285941',accent:'#d9e6b8',text:'#f5f5e9',muted:'#aabd9f'},sand:{label:'沙漠金',bg:'#e9ddc5',end:'#d2be9b',accent:'#516448',text:'#304739',muted:'#69775c'},midnight:{label:'午夜蓝',bg:'#172e40',end:'#294c64',accent:'#d4e3d1',text:'#f0f3ed',muted:'#a6bac6'}};
const xml = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const units = value => [...String(value)].reduce((sum,char)=>sum+(/[\u2e80-\uffef]/u.test(char)?1.05:/[\u0600-\u06ff]/u.test(char)?.72:/\s/.test(char)?.29:/[ilI.,!':;]/u.test(char)?.28:/[MW@]/.test(char)?.95:/[A-Z]/.test(char)?.72:.57),0);
export function wrapText(text,maxUnits=21,maxLines=3){
  const lines=[];let line='';
  for(const token of String(text).replace(/\r/g,'').match(/\n|[^\S\n]+|[^\s\u2e80-\uffef]+|[\u2e80-\uffef]/gu)||[]){
    if(token==='\n'){if(line.trim())lines.push(line.trim());line='';continue;}
    if(!token.trim()){if(line)line+=' ';continue;}
    if(units(line+token)<=maxUnits){line+=token;continue;}
    if(line.trim())lines.push(line.trim());line='';
    for(const char of token){if(line&&units(line+char)>maxUnits){lines.push(line);line='';}line+=char;}
  }
  if(line.trim())lines.push(line.trim());
  if(lines.length>maxLines){const result=lines.slice(0,maxLines);result[maxLines-1]=result[maxLines-1].replace(/[\s.,]+$/,'')+'…';return result;}
  return lines;
}
// Fit the full text into a reserved region. Legal copy is never silently truncated.
export function fitPosterText(value,{width=936,height,maxSize,lineHeight=1.2}){
  let size=maxSize,lines=wrapText(value,width/size,Infinity);
  while(size>8&&lines.length*size*lineHeight>height){size--;lines=wrapText(value,width/size,Infinity);}
  return {lines,size,lineHeight};
}
export function normalizePoster(spec={}) {
  const limits={brand:50,kicker:80,headline:100,subheadline:180,vehicle:100,details:180,cta:50,disclaimer:230};
  const result={size:POSTER_SIZES[spec.size]?spec.size:'portrait',theme:POSTER_THEMES[spec.theme]?spec.theme:'forest',language:['en','ar','de','zh'].includes(spec.language)?spec.language:'en'};
  for(const [key,max] of Object.entries(limits))result[key]=String(spec[key]??'').slice(0,max);
  return result;
}
export function createPoster({campaign,customer,workspaceName='Atlas Motors',artifact}={}) {
  const brief=artifact?.posterBrief||{};
  const p=normalizePoster({size:'portrait',theme:campaign?.market==='AE'?'sand':'forest',language:artifact?.language||customer?.language||'en',brand:workspaceName,
    kicker:brief.kicker||'ATLAS EXPERIENCE / TEST DRIVE',headline:brief.headline||'Your next chapter.\nStarts with a drive.',
    subheadline:brief.subheadline||'Find the space for everything that matters.',vehicle:customer?.vehicle||'Explore your next SUV',
    details:brief.details||`${customer?.city||'Your local showroom'} · By appointment`,cta:brief.cta||'Book your test drive',
    disclaimer:brief.disclaimer||'Concept creative. Local availability, specifications and event details require confirmation.'});
  if(!artifact?.posterBrief)p.language='en';
  return {id:uid('poster'),customerId:customer?.id,kind:'poster',format:'poster',title:`${campaign?.title||customer?.name||'Motive'} · 活动海报`,
    poster:p,parentArtifactId:artifact?.id,campaignId:campaign?.id,status:'review',createdAt:new Date().toISOString(),language:p.language,
    sections:[{label:'海报文案',text:p.headline}],sources:artifact?.sources||['用户选择的活动与客户资料'],engine:artifact?.engine||'visual-template',
    note:'可编辑的矢量海报。车型插画为示意，活动与价格条件须核实后再发布。'};
}
function car(){return `<g transform="translate(25 0)"><ellipse cx="500" cy="300" rx="442" ry="28" fill="#081f20" opacity=".2"/><path d="M65 237 76 150 114 136 228 127 303 53Q327 25 391 25L590 29Q647 29 695 71L765 129 896 157Q932 167 941 201L948 255 874 280 95 267Z" fill="url(#body)" stroke="#798a7c" stroke-width="2"/><path d="m250 126 71-67q18-17 61-18l204 5q46 0 82 33l53 50Z" fill="url(#window)"/><path d="m420 42-8 84m183-80 34 83" stroke="#9baaa0" stroke-width="9"/><path d="m329 59-65 63 128 1 11-79q-43-2-74 15" fill="#c5d5c8" opacity=".16"/><path d="M84 163h671l154 26M313 133l-6 117m283-116 21 126" stroke="#6c7f71" stroke-width="2" fill="none"/><path d="m94 242 517 10 182 4 133-21v25l-136 28-677-22" fill="#475e50"/><path d="m790 165 132 32 8 14-116-21Z" fill="#f4f3ce"/><path d="m824 213 102 18-5 31-104-17Z" fill="#314a40"/><path d="m72 164 20 1-2 32-20-5Z" fill="#aa6152"/><path d="m748 133-32-19-24 9 10 15 35 7Z" fill="#b6c2b4"/><path d="M153 272c-2-106 158-115 169 5m355 3c-6-115 155-118 169-9" fill="#253c31"/>${[239,762].map(x=>`<g transform="translate(${x} 262)"><ellipse rx="63" ry="68" fill="#24352c" stroke="#69796a" stroke-width="3"/><circle r="43" fill="#536758" stroke="#aebdad" stroke-width="4"/><g stroke="#d2daca" stroke-width="6">${[0,60,120].map(r=>`<path d="M0-40V40" transform="rotate(${r})"/>`).join('')}</g><circle r="14" fill="#879b86" stroke="#d4ddc9" stroke-width="3"/></g>`).join('')}<path d="m347 175 31 0m170 1 30 0" stroke="#637960" stroke-width="5" stroke-linecap="round"/><path d="M305 43q140-39 298-8" stroke="#eff1dc" stroke-width="5" fill="none"/><path d="m108 205 641 9" stroke="#f5f6e8" stroke-width="2" opacity=".4"/></g>`;}
let renderSequence=0;
export function buildPosterSVG(raw,{approved=false}={}) {
  const p=normalizePoster(raw),size=POSTER_SIZES[p.size],t=POSTER_THEMES[p.theme],h=size.height;
  const rtl=p.language==='ar',anchor='start',x=rtl?1008:72;
  const layout={square:{top:56,title:174,titleH:184,font:80,sub:374,subH:65,car:451,scale:.75,vehicle:718,divider:769,details:788,detailsH:53,cta:859,legal:944,legalH:65,footer:1040},portrait:{top:70,title:206,titleH:296,font:92,sub:521,subH:80,car:650,scale:1,vehicle:1005,divider:1065,details:1082,detailsH:51,cta:1152,legal:1239,legalH:61,footer:1324},story:{top:150,title:304,titleH:372,font:108,sub:707,subH:108,car:1060,scale:1,vehicle:1425,divider:1495,details:1520,detailsH:70,cta:1628,legal:1739,legalH:75,footer:1830}}[p.size];
  const prefix=`motive-poster-${++renderSequence}`;
  function block(value,y,height,maxSize,color=t.text,weight=400,width=936,textX=x,textAnchor=anchor,lineHeight=1.22){
    const fit=fitPosterText(value,{width,height,maxSize,lineHeight});
    const direction=rtl&&textX!==72?'rtl':'ltr';
    return `<text x="${textX}" y="${y+fit.size}" text-anchor="${textAnchor}" direction="${direction}" font-family="Arial, Segoe UI, sans-serif" font-size="${fit.size}" font-weight="${weight}" fill="${color}">${fit.lines.map((line,index)=>`<tspan x="${textX}" dy="${index?fit.size*lineHeight:0}">${xml(line)}</tspan>`).join('')}</text>`;
  }
  const cta=fitPosterText(p.cta,{width:356,height:44,maxSize:21,lineHeight:1.15});
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="${h}" viewBox="0 0 1080 ${h}" role="img" aria-label="${xml(p.headline)}"><defs><linearGradient id="background" x2="1" y2="1"><stop stop-color="${t.bg}"/><stop offset="1" stop-color="${t.end}"/></linearGradient><linearGradient id="body" x2=".15" y2="1"><stop stop-color="#f5f5e6"/><stop offset=".32" stop-color="#c4cebf"/><stop offset=".8" stop-color="#98aa97"/><stop offset="1" stop-color="#607564"/></linearGradient><linearGradient id="window" x2="1" y2="1"><stop stop-color="#647e70"/><stop offset="1" stop-color="#203c34"/></linearGradient></defs><rect width="1080" height="${h}" fill="url(#background)"/><g fill="none" stroke="${t.accent}" opacity=".11">${[310,410,520,640].map(r=>`<circle cx="930" cy="${layout.car+100}" r="${r}" stroke-width="1.5"/>`).join('')}</g><path d="M0 ${layout.car+260} 1080 ${layout.car+170}v160H0Z" fill="${t.accent}" opacity=".035"/>${block(p.brand,layout.top,34,25,t.text,600,650,72,'start')}${approved?'':`<text x="1008" y="${layout.top+22}" text-anchor="end" font-family="Arial, sans-serif" font-size="13" letter-spacing="3" fill="${t.muted}">DRAFT / CONCEPT</text>`}${block(p.kicker,layout.top+74,39,16,t.accent,500)}${block(p.headline,layout.title,layout.titleH,layout.font,t.text,500,936,x,anchor,1.12)}${block(p.subheadline,layout.sub,layout.subH,25,t.muted)}<g transform="translate(${(1-layout.scale)*540} ${layout.car}) scale(${layout.scale})">${car()}</g>${block(p.vehicle,layout.vehicle,49,26,t.text,500)}<line x1="72" x2="1008" y1="${layout.divider}" y2="${layout.divider}" stroke="${t.accent}" opacity=".25"/>${block(p.details,layout.details,layout.detailsH,19,t.muted)}<rect x="${rtl?600:72}" y="${layout.cta}" width="408" height="66" rx="33" fill="${t.accent}"/>${block(p.cta,layout.cta+(66-cta.lines.length*cta.size*1.15)/2-1,44,cta.size,t.bg,600,356,rtl?804:276,'middle',1.15)}${block(p.disclaimer,layout.legal,layout.legalH,14,t.muted)}<text x="72" y="${layout.footer}" font-family="Arial, sans-serif" font-size="10" letter-spacing="1" fill="${t.muted}">VEHICLE ILLUSTRATION · DETAILS SUBJECT TO CONFIRMATION</text><text x="1008" y="${layout.footer}" text-anchor="end" font-family="Arial, sans-serif" font-size="10" letter-spacing="2" fill="${t.muted}">PREPARED WITH MOTIVE</text></svg>`;
  // Several previews can share one document; gradient IDs must stay independent.
  return svg.replace(/id="(background|body|window)"/g,`id="${prefix}-$1"`).replace(/url\(#(background|body|window)\)/g,`url(#${prefix}-$1)`);
}
export async function posterToPNG(spec,options={}) {
  const svg=buildPosterSVG(spec,options),size=POSTER_SIZES[normalizePoster(spec).size];
  const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
  try{
    const image=new Image();image.decoding='async';await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('海报图像无法加载，请改用 SVG 导出。'));image.src=url;});
    const canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;const context=canvas.getContext('2d');if(!context)throw new Error('浏览器不支持 PNG 导出，请导出 SVG。');context.drawImage(image,0,0);
    return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG 导出失败，请导出 SVG。')),'image/png'));
  }finally{URL.revokeObjectURL(url);}
}
