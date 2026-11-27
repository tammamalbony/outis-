/** Remove known ChatGPT copy transport artifacts without changing JSON strings. */
export function normalizeCopiedJson(raw:string):string{
  let output='',inString=false,escaped=false;
  for(let i=0;i<raw.length;){
    const char=raw[i];
    if(inString){
      output+=char;
      if(escaped)escaped=false;
      else if(char==='\\')escaped=true;
      else if(char==='"')inString=false;
      i++;continue;
    }
    if(char==='"'){output+=char;inString=true;i++;continue;}
    const entity=raw.slice(i).match(/^(?:&#x20;|&#32;|&nbsp;)/i)?.[0];
    if(entity){output+=' ';i+=entity.length;continue;}
    if(char==='\\'){
      let end=i;while(raw[end]==='\\')end++;
      let next=end;while(raw[next]===' '||raw[next]==='\t'||raw[next]==='\r')next++;
      if(raw[next]==='\n'){output+=raw.slice(end,next)+'\n';i=next+1;continue;}
      const followingEntity=raw.slice(next).match(/^(?:&#x20;|&#32;|&nbsp;)/i)?.[0];
      if(followingEntity){output+=raw.slice(end,next)+' ';i=next+followingEntity.length;continue;}
    }
    output+=char;i++;
  }
  let cleaned=output.trim();
  cleaned=cleaned.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  return cleaned;
}

export function prettyPrintCopiedJson(raw:string):string{
  return JSON.stringify(JSON.parse(normalizeCopiedJson(raw)),null,2);
}
