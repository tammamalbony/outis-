import { remark } from 'remark';
import { parse } from 'yaml';
import { z } from 'zod';
import type { AgentChatStart, Config, Feature } from './core';
const schema = z.object({repository:z.string().regex(/^[\w.-]+\/[\w.-]+$/),baseBranch:z.string().min(1).default('develop'),reasoningEffort:z.enum(['medium','high','extra-high']).default('high'),agentsPerTeam:z.literal(5).default(5),maxConcurrentTeams:z.number().int().min(1).max(20).default(1),executionMode:z.literal('event-driven').default('event-driven'),autoMerge:z.literal(false).default(false)}).strict();
function headingText(node:any):string{return (node.children??[]).map((child:any)=>child.value??headingText(child)).join('').trim();}
function headingOffset(node:any):number{return node.position?.start.offset??-1;}
function parseChatStarts(section:string,sectionOffset:number,nodes:any[]):AgentChatStart[]{
  const promptHeading=nodes.find(node=>node.type==='heading'&&node.depth===2&&/^agentsync chat starts$/i.test(headingText(node)));
  if(!promptHeading)return [];
  const start=promptHeading.position?.start.offset;
  if(start===undefined)throw new Error('AgentSync chat starts heading has no position.');
  const nextSection=nodes.find(node=>node.type==='heading'&&node.depth<=2&&headingOffset(node)>start);
  const end=nextSection?.position?.start.offset??sectionOffset+section.length;
  const chatHeadings=nodes.filter(node=>node.type==='heading'&&node.depth===3&&headingOffset(node)>start&&headingOffset(node)<end);
  const found=new Map<number,AgentChatStart>();
  for(let i=0;i<chatHeadings.length;i++){
    const heading=headingText(chatHeadings[i]);
    const match=/^A([0-5])\s*[—–-]\s*(.{1,80})$/.exec(heading);
    if(!match)throw new Error(`Invalid AgentSync chat heading: ${heading}`);
    const agentNumber=Number(match[1]);
    if(found.has(agentNumber))throw new Error(`Duplicate startup prompt for A${agentNumber}.`);
    const itemStart=chatHeadings[i].position?.start.offset;
    const itemEnd=chatHeadings[i+1]?.position?.start.offset??end;
    if(itemStart===undefined)throw new Error(`A${agentNumber} prompt heading has no position.`);
    const raw=section.slice(itemStart-sectionOffset,itemEnd-sectionOffset);
    const name=/\*\*Chat name:\*\*\s*`([^`]{2,80})`/.exec(raw)?.[1]?.trim();
    const prompt=/```(?:prompt|text)\s*\n([\s\S]*?)\n```/i.exec(raw)?.[1]?.trim();
    if(!name||! /^[A-Za-z0-9][A-Za-z0-9 ._-]{1,79}$/.test(name))throw new Error(`A${agentNumber} requires a valid unique Chat name.`);
    if(!prompt||prompt.length>20000)throw new Error(`A${agentNumber} requires a startup prompt of 1–20000 characters in a prompt fence.`);
    found.set(agentNumber,{agentNumber,role:match[2].trim(),chatName:name,prompt});
  }
  if(found.size!==6||[0,1,2,3,4,5].some(n=>!found.has(n)))throw new Error('AgentSync chat starts must define exactly one prompt and name for A0 through A5.');
  const names=[...found.values()].map(item=>item.chatName.toLowerCase());
  if(new Set(names).size!==names.length)throw new Error('AgentSync chat names must be unique within a feature.');
  return [...found.values()].sort((a,b)=>a.agentNumber-b.agentNumber);
}
export function parseRequirements(raw:string): {config:Config;features:Feature[]} {
  const text=raw.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
  const front=/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if(!front) throw new Error('Markdown must start with YAML frontmatter.');
  const config=schema.parse(parse(front[1]));
  const body=text.slice(front[0].length);const tree=remark().parse(body);
  const headings=tree.children.filter(n=>n.type==='heading'&&n.depth===1);
  if(!headings.length) throw new Error('Add at least one top-level # Feature heading.');
  const features=headings.map((h,i)=>{
    const start=h.position?.start.offset,end=headings[i+1]?.position?.start.offset??body.length;
    if(start===undefined)throw new Error('Heading has no position.');
    const heading=body.slice(start,h.position?.end.offset).split('\n')[0].replace(/^#\s+/,'').replace(/\s+#+\s*$/,'').trim();
    if(!/^Feature\b/i.test(heading)) throw new Error(`Expected a top-level Feature heading: ${heading}`);
    const section=body.slice(start,end);
    const nodes=tree.children.filter(node=>headingOffset(node)>=start&&headingOffset(node)<end);
    const chatStarts=parseChatStarts(section,start,nodes);
    const chatHeading=nodes.find(node=>node.type==='heading'&&node.depth===2&&/^agentsync chat starts$/i.test(headingText(node)));
    const markdownEnd=chatHeading?.position?.start.offset??end;
    return {title:heading,markdown:body.slice(start,markdownEnd).trim(),...(chatStarts.length?{chatStarts}:{})};
  });
  return {config,features};
}
