(() => {
  if (globalThis.__agentsyncPageStatusInstalled || location.origin !== 'https://chatgpt.com') return;
  globalThis.__agentsyncPageStatusInstalled = true;

  const icons = {
    url:'M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72M14 11a5 5 0 0 0-7.07 0l-3 3A5 5 0 0 0 11 21.07l1.72-1.72',
    new:'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5ZM12 8v8M8 12h8',
    arrow:'M4 12h15M13 6l6 6-6 6',
    voice:'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8',
    stop:'M7 7h10v10H7z',
    loading:'M20 7v5h-5M4 17v-5h5M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2',
    ready:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM8 12l2.5 2.5L16 9',
    composer:'M4 5h16v14H4zM8 9h8M8 13h8M8 17h4',
    mode:'M4 7h16M4 12h16M4 17h16M8 5v4M15 10v4M10 15v4',
    effort:'M4 19h16M7 19v-5M12 19V9M17 19V4',
    button:'M5 3v18l5-5 4 6 3-2-4-6h7L5 3Z',
    message:'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5ZM9 12h.01M12 12h.01M15 12h.01'
  };
  const root=document.createElement('aside');
  root.id='agentsync-page-status';
  root.setAttribute('aria-label','AgentSync ChatGPT status');
  const shadow=root.attachShadow({mode:'open'});
  const style=document.createElement('style');
  style.textContent=`:host{all:initial;position:fixed;z-index:2147483646;right:8px;top:50%;transform:translateY(-50%);font:12px/1.35 system-ui,sans-serif;color:#f5f5f5}*{box-sizing:border-box}.rail{display:grid;gap:4px;width:38px;max-height:82vh;overflow:auto;padding:5px;border:1px solid #48494d;border-radius:13px;background:rgba(27,28,31,.96);box-shadow:0 6px 24px #0008;backdrop-filter:blur(8px);transition:width .18s ease}.rail:hover,.rail:focus-within{width:220px}.item{display:flex;align-items:center;gap:9px;width:26px;min-height:28px;padding:4px;border:1px solid #44464a;border-radius:8px;background:#252629;color:#a4a6aa;white-space:nowrap;overflow:hidden;cursor:help;transition:width .18s ease,transform .18s ease,background-color .18s ease}.rail:hover .item,.rail:focus-within .item{width:100%;padding:5px 8px}.item svg{width:18px;height:18px;flex:0 0 18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;transition:transform .2s ease}.item span{display:none;font-weight:650}.rail:hover .item span,.rail:focus-within .item span{display:block}.item:hover svg,.item:focus-visible svg{transform:scale(1.12) rotate(-4deg)}.item[data-state=good]{color:#00d99b;border-color:#087958;background:#073629}.item[data-state=bad]{color:#ff526b;border-color:#823141;background:#3b1e26}.item[data-state=unknown]{color:#999da5}.item[data-icon=loading][data-state=bad] svg{animation:spin 1.3s linear infinite}.item:focus-visible{outline:2px solid #fff;outline-offset:1px}.item[data-action=true]{cursor:pointer}.item[disabled]{cursor:default}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}`;
  const rail=document.createElement('div');rail.className='rail';
  shadow.append(style,rail);document.documentElement.append(root);

  const visible=element=>Boolean(element&&(element.offsetWidth||element.offsetHeight||element.getClientRects().length));
  const buttons=()=>[...document.querySelectorAll('button')].filter(visible);
  const label=button=>`${button.getAttribute('aria-label')||''} ${button.getAttribute('title')||''} ${button.getAttribute('data-testid')||''} ${button.innerText||button.textContent||''}`;
  const composer=()=>document.querySelector('[data-testid="prompt-textarea"]')||document.querySelector('textarea[placeholder]')||document.querySelector('[contenteditable="true"][role="textbox"]');
  const textOf=input=>input instanceof HTMLTextAreaElement||input instanceof HTMLInputElement?input.value:(input?.innerText||input?.textContent||'');
  const userMessages=()=>[...new Set(document.querySelectorAll('[data-message-author-role="user"], [data-user-message-bubble="true"]'))];
  const lastReply=()=>[...new Set(document.querySelectorAll('[data-message-author-role="assistant"],[data-dil-response]'))].at(-1);
  const mode=()=>{const group=document.querySelector('[role="group"][aria-label="Composer mode"]');const selected=group&&[...group.querySelectorAll('button')].find(button=>button.getAttribute('aria-pressed')==='true');return selected?.innerText?.trim()||'Unknown';};
  const effort=()=>{const slider=[...document.querySelectorAll('[role="slider"][aria-valuenow]')].find(visible);if(slider)return ['Low','Medium','High'][Number(slider.getAttribute('aria-valuenow'))]||'Unknown';const text=[...document.querySelectorAll('[role="status"]')].filter(visible).map(node=>node.innerText||'').join(' ');return text.match(/\b(low|medium|high)\b/i)?.[1]?.toLowerCase().replace(/^./,x=>x.toUpperCase())||'Unknown';};
  let copiedMessage='',copiedResponse='';
  function snapshot(){
    const input=composer(),composerVisible=visible(input),text=composerVisible?textOf(input).trim():'';
    const voice=buttons().find(button=>/^start voice(?: mode)?$/i.test(button.getAttribute('aria-label')||'')||button.getAttribute('data-composer-voice-start')==='true'||[...button.querySelectorAll('svg use')].some(use=>(use.getAttribute('href')||use.getAttributeNS('http://www.w3.org/1999/xlink','href')||'').includes('#codex-icon-voice-regular-20')));
    const arrow=buttons().find(button=>!button.disabled&&(button.getAttribute('data-testid')==='send-button'||/send(?:\s+(?:prompt|message))?/i.test(label(button))||[...button.querySelectorAll('svg path')].some(path=>/M9\.33467 16\.6663V4\.93978/.test(path.getAttribute('d')||''))));
    const stop=buttons().find(button=>/stop generating|stop streaming|cancel response/i.test(label(button))||/stop-button/i.test(button.getAttribute('data-testid')||'')||[...button.querySelectorAll('svg path')].some(path=>/M4\.5 5\.75/.test(path.getAttribute('d')||'')));
    const conversation=/^\/c\/[A-Za-z0-9-]+\/?$/.test(location.pathname),pageLoaded=document.readyState==='complete';
    const users=userMessages(),reply=lastReply(),userText=(users.at(-1)?.innerText||users.at(-1)?.textContent||'').trim(),replyText=(reply?.innerText||reply?.textContent||'').trim();
    const modeValue=mode(),effortValue=effort(),enabled=button=>Boolean(button&&!button.disabled&&button.getAttribute('aria-disabled')!=='true');
    return [
      {id:'url',name:'Chat URL',value:conversation?'Conversation URL detected':'New chat URL',state:'good',detail:location.href,copy:location.href},
      {id:'new',name:'Open new chat',value:'Click to start a fresh chat',state:'good',detail:'Open ChatGPT home in this tab.',action:'new'},
      {id:'arrow',name:'Send arrow',value:arrow?`Visible · ${enabled(arrow)?'enabled':'disabled'}`:'Not visible',state:arrow?'good':'bad',detail:arrow?'A draft is ready in the composer.':'The send arrow is not visible.'},
      {id:'voice',name:'Voice control',value:voice?`Visible · ${enabled(voice)?'enabled':'disabled'}`:'Not visible',state:voice?'good':'bad',detail:voice?'The empty-composer voice control is visible.':'Voice control is not visible.'},
      {id:'stop',name:'Stop control',value:stop?`Visible · ${enabled(stop)?'enabled':'disabled'}`:'Not visible',state:stop?'bad':'good',detail:stop?'ChatGPT is generating a response.':'No stop control is visible.'},
      {id:'loading',name:pageLoaded?'Page loaded':'Page loading',value:pageLoaded?'Loaded':'Loading',state:pageLoaded?'good':'bad',detail:pageLoaded?'ChatGPT page loaded.':'ChatGPT page is loading.'},
      {id:'ready',name:'Page ready',value:pageLoaded&&composerVisible?'Ready · composer detected':'Waiting for composer',state:pageLoaded&&composerVisible?'good':'bad',detail:`Loaded: ${pageLoaded?'yes':'no'} · composer: ${composerVisible?'visible':'not visible'}`},
      {id:'composer',name:'Composer',value:!composerVisible?'Not detected':text?`${text.length} characters`:'Empty',state:composerVisible?'good':'unknown',detail:text||'Composer is empty.'},
      {id:'mode',name:'Mode',value:`${modeValue} · click to switch`,state:modeValue==='Unknown'?'unknown':'good',detail:'Click to switch Chat and Work modes.',action:'mode'},
      {id:'effort',name:'Effort',value:`${effortValue} · click to cycle`,state:effortValue==='Unknown'?'unknown':'good',detail:'Click to cycle Low, Medium, and High effort.',action:'effort'},
      {id:'button',name:'Action button',value:arrow&&enabled(arrow)?'Send enabled':stop&&enabled(stop)?'Stop enabled':voice&&enabled(voice)?'Voice enabled':'No enabled action',state:arrow&&enabled(arrow)||voice&&enabled(voice)?'good':stop&&enabled(stop)?'bad':'unknown',detail:'Composer primary action state.'},
      {id:'message',name:'Last sent message',value:userText?userText.split(/\r?\n/).find(Boolean).slice(0,100):'Not detected',state:userText?'good':'unknown',detail:userText||'No user message detected.',copy:userText},
      {id:'response',name:'Last response',value:replyText?replyText.split(/\r?\n/).find(Boolean).slice(0,100):'Not detected',state:replyText?'good':'unknown',detail:replyText||'No assistant response detected.',copy:replyText}
    ];
  }
  function paint(){
    const rows=snapshot();rail.replaceChildren();
    for(const row of rows){
      const button=document.createElement('button');button.type='button';button.className='item';button.dataset.state=row.state;button.dataset.icon=row.id;button.dataset.action=String(Boolean(row.action));button.title=`${row.name}: ${row.detail}`;button.setAttribute('aria-label',button.title);
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
      const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',icons[row.id]||icons.message);svg.append(path);
      const text=document.createElement('span');text.textContent=`${row.name}: ${row.value}`;button.append(svg,text);
      if(row.action==='new')button.addEventListener('click',()=>{location.assign('https://chatgpt.com/');});
      else if(row.action==='mode')button.addEventListener('click',()=>{const group=document.querySelector('[role="group"][aria-label="Composer mode"]');const target=[...group?.querySelectorAll('button')||[]].find(item=>(item.innerText||'').trim()===(mode()==='Chat'?'Work':'Chat'));target?.click();});
      else if(row.action==='effort')button.addEventListener('click',()=>{const model=buttons().find(item=>/select chatgpt model/i.test(label(item)));model?.click();setTimeout(()=>{const slider=[...document.querySelectorAll('[role="slider"][aria-valuenow]')].find(visible);if(slider){const value=Number(slider.getAttribute('aria-valuenow'));slider.focus();slider.dispatchEvent(new KeyboardEvent('keydown',{key:value>=2?'ArrowLeft':'ArrowRight',bubbles:true,cancelable:true}));slider.dispatchEvent(new KeyboardEvent('keyup',{key:value>=2?'ArrowLeft':'ArrowRight',bubbles:true,cancelable:true}));setTimeout(()=>model?.click(),250);}},250);});
      else if(row.copy)button.addEventListener('click',()=>{void navigator.clipboard?.writeText(row.copy);});
      else button.disabled=true;
      rail.append(button);
    }
  }
  let timer;const schedule=()=>{clearTimeout(timer);timer=setTimeout(paint,120);};
  new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label','aria-pressed','aria-valuenow','disabled','data-testid']});
  window.addEventListener('popstate',schedule);window.addEventListener('hashchange',schedule);setInterval(paint,1200);paint();
})();
