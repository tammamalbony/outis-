import {conversationUrl} from './core.ts';

export function bridgeMatchPatterns(chatUrls:readonly string[]):string[]{
  const patterns=[...new Set(chatUrls.map(raw=>{
    const url=conversationUrl(raw);
    return `https://chatgpt.com${new URL(url).pathname}*`;
  }))].sort();
  if(patterns.length===0)throw new Error('Register at least one AgentSync ChatGPT conversation before enabling the bridge.');
  if(patterns.length>100)throw new Error('The A0 bridge is limited to 100 registered chats at a time.');
  return patterns;
}
