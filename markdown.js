import {Marked} from './node_modules/marked/lib/marked.esm.js';

const escapeHTML=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const markdown=new Marked({
  gfm:true,breaks:true,async:false,
  renderer:{
    html({text}){return escapeHTML(text);},
    image({text}){return escapeHTML(text);},
    link({href,tokens}){
      const label=this.parser.parseInline(tokens);
      if(!/^https?:\/\//i.test(href)||/[\u0000-\u0020]/.test(href)||!URL.canParse(href))return label;
      return `<a href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    }
  }
});

export function renderMarkdown(text){
  return markdown.parse(String(text??''));
}
