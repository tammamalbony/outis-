import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseConversationTab,openConversation,activeConversation} from '../src/conversation-tabs.ts';
const url='https://chatgpt.com/c/abc';
const tab={id:1,windowId:2,url,active:true};
function fake(tabs=[tab],changes={}){
 const calls=[];
 const port={list:async()=>{calls.push('list');return tabs;},get:async()=>{calls.push('get');return changes.get??tab;},activate:async()=>{calls.push('activate');return changes.activate??tab;},focusWindow:async()=>{calls.push('focus');},create:async(u)=>{calls.push(u);return {id:3,url:u};}};
 return {port,calls};
}
test('choose exact saved chat, prefer active, reject pending and incognito',()=>{
 assert.equal(chooseConversationTab([{...tab,id:8,active:false},{...tab,id:4,url:url+'/?x=1'},tab,{...tab,id:0,incognito:true},{...tab,id:0,pendingUrl:url},{...tab,id:0,url:url+'d'}],url).id,1);
 assert.equal(chooseConversationTab([{...tab,url:'https://evil.test/c/abc'}],url),undefined);
});
test('reuse a verified tab and focus its window',async()=>{
 const f=fake();assert.equal(await openConversation(f.port,url,true),'REUSED');assert.deepEqual(f.calls,['list','get','activate','focus','get']);
});
test('permission denial or no matching tab opens new without inspecting unrelated tabs',async()=>{
 const a=fake();assert.equal(await openConversation(a.port,url,false),'OPENED_NEW');assert.deepEqual(a.calls,[url]);
 const b=fake([]);assert.equal(await openConversation(b.port,url,true),'OPENED_NEW');assert.deepEqual(b.calls,['list',url]);
});
test('changed tab identity fails closed before activation or window focus',async()=>{
 const a=fake([tab],{get:{...tab,url:url+'d'}});await assert.rejects(openConversation(a.port,url,true),/changed/);assert.deepEqual(a.calls,['list','get']);
 const b=fake([tab],{activate:{...tab,url:url+'d'}});await assert.rejects(openConversation(b.port,url,true),/changed/);assert.deepEqual(b.calls,['list','get','activate']);
});
test('active registration only accepts loaded ordinary conversations',()=>{
 assert.equal(activeConversation({...tab,url:url+'/?x=1'}),url);
 for(const x of [undefined,{...tab,active:false},{...tab,incognito:true},{...tab,pendingUrl:url},{...tab,url:'https://chatgpt.com/'},{...tab,url:'https://evil.test/c/abc'}])assert.throws(()=>activeConversation(x));
});
