// Decode only the top-level public reply field, never other model output fields.
export function readReplyPrefix(content){
  const text=content.trimStart().replace(/^```(?:json)?\s*/i,'');
  if(text[0]!=='{')return '';
  let depth=1,key=null,expectKey=true;
  for(let i=1;i<text.length;i++){
    const char=text[i];
    if(char==='"'){
      let raw='',closed=false,j=i+1;
      for(;j<text.length;j++){
        const c=text[j];
        if(c==='"'){closed=true;break;}
        if(c==='\\'){
          if(j+1>=text.length)break;
          if(text[j+1]==='u'){
            if(j+5>=text.length)break;
            const hex=text.slice(j+2,j+6);
            if(!/^[0-9a-f]{4}$/i.test(hex))return '';
            raw+=text.slice(j,j+6);j+=5;
          }else{
            if(!/["\\/bfnrt]/.test(text[j+1]))return '';
            raw+=text.slice(j,j+2);j++;
          }
        }else{
          if(c.charCodeAt(0)<32)return '';
          raw+=c;
        }
      }
      let value;
      try{value=JSON.parse('"'+raw+'"');}catch{return '';}
      if(depth===1&&!expectKey&&key==='reply'){
        // Avoid displaying half a Unicode surrogate while the next chunk is pending.
        return value.slice(0,6000).replace(/[\uD800-\uDBFF]$/,'');
      }
      if(!closed)return '';
      if(depth===1&&expectKey){key=value;expectKey=false;}
      i=j;
    }else if(char==='{'||char==='[')depth++;
    else if(char==='}'||char===']')depth--;
    else if(char===','&&depth===1){key=null;expectKey=true;}
    if(depth<1)return '';
  }
  return '';
}
