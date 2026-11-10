import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
const SRC = existsSync(new URL('../extension/manifest.json', import.meta.url))
  ? '../extension' : '../acomfpnllcpggnclcogaiceicgljnbac/1.8.1_0';
let serial = 0;

function mockChrome() {
  const areas = {local: new Map(), session: new Map(), sync: new Map()};
  const listeners={};
  const listen=(name)=>({addListener(fn){listeners[name]=fn}});
  const storageArea=(name)=>({
    async get(keys) {
      const output={};const m=areas[name];
      for(const key of (Array.isArray(keys)?keys:(typeof keys==='string'?[keys]:Object.keys(keys??{})))) {
        if(m.has(key)) output[key]=m.get(key);
      }
      return output;
    },
    async set(values){for(const [k,v] of Object.entries(values))areas[name].set(k,v);},
    async remove(keys){for(const k of (Array.isArray(keys)?keys:[keys]))areas[name].delete(k);},
  });
  const calls={chromeToken:0, webAuth:0, windows:[],menu:[], notifications:[], api:[], requests:[]};
  const extensionId='acomfpnllcpggnclcogaiceicgljnbac';
  let badge='';
  let authTokenResponse=null;
  let webAuthHandler=async({url})=>{const p=new URL(url).searchParams;return `https://${extensionId}.chromiumapp.org/oauth2#access_token=web-T&expires_in=3600&token_type=Bearer&state=${p.get('state')}`};
  const chrome={
    runtime:{id:extensionId,onInstalled:listen('onInstalled'),onStartup:listen('onStartup'),onMessage:listen('onMessage'),getURL:path=>`chrome-extension://${extensionId}/${path}`,getManifest:()=>({version:'1.8.1.1'})},
    storage:{local:storageArea('local'),sync:storageArea('sync'),session:storageArea('session'),onChanged:listen('storageChanged')},
    identity:{ getRedirectURL: path=>`https://${extensionId}.chromiumapp.org/${path}`,
      async getAuthToken(){calls.chromeToken++;return authTokenResponse ? {token:authTokenResponse} : {};},
      async launchWebAuthFlow(req){calls.webAuth++;return webAuthHandler(req);},
      async removeCachedAuthToken(){},async clearAllCachedAuthTokens(){}},
    action:{onClicked:listen('actionClicked'),async setBadgeBackgroundColor(){},async setBadgeText({text}){badge=text},async getBadgeText(){return badge},async setTitle(){},async setIcon(){}},
    contextMenus:{onClicked:listen('menuClicked'),removeAll(cb){cb()},create(req){calls.menu.push(req)}},
    notifications:{onClicked:listen('notificationClicked'),async create(note){calls.notifications.push(note);return 'note-1'},async clear(){}},
    windows:{onRemoved:listen('windowRemoved'),async create(args){calls.windows.push(args);return {id:calls.windows.length}}},
    tabs:{async create(){}},
  };
  return {chrome, areas, calls, listeners, setToken(t){authTokenResponse=t},setWebAuth(handler){webAuthHandler=handler}};
}
function freshModule(name){return import(`${SRC}/${name}?run=${++serial}`)}
async function waitFor(check,timeoutMs=2000){for(let i=0;i<timeoutMs/5;i++){if(check())return;await delay(5)}throw new Error('Condition not reached in time');}

// All checks are offline: Google endpoints are replaced by mocked fetch responses.
test('edited task requires title and validates dates/details without silent truncation',async()=>{
  const {chrome}=mockChrome();globalThis.chrome=chrome;
  const tasks=await freshModule('tasks.js');
  assert.deepEqual(tasks.buildEditedTask({title:'  My item  ',notes:'Read notes',date:'2026-11-10'}),{title:'My item',notes:'Read notes',status:'needsAction',due:'2026-11-10T00:00:00.000Z'});
  assert.deepEqual(tasks.buildEditedTask({title:'One',notes:'',date:''}),{title:'One',notes:'',status:'needsAction'});
  assert.throws(()=>tasks.buildEditedTask({title:'',notes:'',date:''}),/title/);
  assert.throws(()=>tasks.buildEditedTask({title:'My item',notes:'',date:'2026-02-30'}),/date/);
  assert.throws(()=>tasks.buildEditedTask({title:'X'.repeat(1025),notes:'',date:''}),/long/);
});

test('option checkbox persists; default is unchanged direct mode',async()=>{
  const m=mockChrome();globalThis.chrome=m.chrome;
  const settings=await freshModule('settings.js');
  assert.equal((await settings.readSettings()).reviewBeforeSend,false);
  await settings.saveReviewBeforeSend(true);
  assert.equal((await settings.readSettings()).reviewBeforeSend,true);
});

test('web account stays pinned after expiry, without Chrome fallback',async()=>{
  const m=mockChrome();globalThis.chrome=m.chrome;
  m.areas.local.set('authMode','web');m.areas.session.set('webToken',{value:'expired',expiresAt:Date.now()-1000});m.setToken('some-other-browser-account');
  const auth=await freshModule('auth.js');
  await assert.rejects(auth.getToken(false),/Choose a Google account/);
  assert.equal(m.calls.chromeToken,0);
  const t=await auth.getToken(true);
  assert.equal(t.value,'web-T');assert.equal(t.source,'web');assert.equal(m.calls.webAuth,1);
  assert.equal(m.calls.chromeToken,0);
});

test('OAuth callback rejects invalid state and wrong redirect',async()=>{
  const m=mockChrome();globalThis.chrome=m.chrome;
  const auth=await freshModule('auth.js');
  m.setWebAuth(async()=>`https://${m.chrome.runtime.id}.chromiumapp.org/oauth2#access_token=evil&state=incorrect`);
  await assert.rejects(auth.getToken(true),/state verification failed/);
  assert.equal(m.areas.session.has('webToken'),false);
  m.setWebAuth(async({url})=>`https://attacker.invalid/oauth2#access_token=evil&state=${new URL(url).searchParams.get('state')}`);
  await assert.rejects(auth.getToken(true),/redirect did not match/);
});

test('interactive request escalates after simultaneous silent authentication failure',async()=>{
  const m=mockChrome();globalThis.chrome=m.chrome;
  const auth=await freshModule('auth.js');
  const silent=auth.getToken(false).catch(error=>error);
  const interactive=auth.getToken(true);
  assert.ok((await silent) instanceof Error);
  assert.equal((await interactive).value,'web-T');
  assert.equal(m.calls.webAuth,1);
});

test('sign out clears account pin/list and never claims remote revocation verified',async()=>{
  const m=mockChrome();globalThis.chrome=m.chrome;
  m.areas.local.set('authMode','web');m.areas.local.set('accountAnchor','abc');m.areas.session.set('webToken',{value:'sensitive',expiresAt:Date.now()+3600000});m.areas.sync.set('tasklist','123');
  globalThis.fetch=async(url,init)=>{assert.equal(url,'https://oauth2.googleapis.com/revoke');assert.equal(init.mode,'no-cors');assert.equal(init.body.get('token'),'sensitive');return {status:400,ok:false,type:'opaque'};};
  const auth=await freshModule('auth.js');const result=await auth.signOut();
  assert.deepEqual(result,{localSignedOut:true,revocationAttempted:true,revocationVerified:false});
  assert.equal(m.areas.local.has('accountAnchor'),false);assert.equal(m.areas.sync.has('tasklist'),false);assert.equal(m.areas.session.has('webToken'),false);assert.equal(m.areas.local.get('chooseAccount'),true);
});

test('wrong account anchor blocks writing even when the token is valid',async()=>{
  const m=mockChrome();globalThis.chrome=m.chrome;m.areas.local.set('accountAnchor','known-list');
  globalThis.fetch=async(url)=>{m.calls.api.push(url);return {ok:true,status:200,json:async()=>({items:[{id:'other-account-list',title:'New default'}]})}};
  const tasks=await freshModule('tasks.js');
  await assert.rejects(tasks.resolveTaskList('different-google-account',''),/Google account changed/);
  assert.ok(!m.calls.api.some(x=>x.includes('/tasks?')));
});

test('task list pagination keeps pinned list check and chosen list selection',async()=>{
  const m=mockChrome();globalThis.chrome=m.chrome;
  m.areas.local.set('accountAnchor','first');
  globalThis.fetch=async(url)=>({ok:true,status:200,json:async()=>url.includes('pageToken=next')?{items:[{id:'chosen',title:'second'}]}:{items:[{id:'first',title:'first'}],nextPageToken:'next'}});
  const tasks=await freshModule('tasks.js');
  assert.equal(await tasks.resolveTaskList('T','chosen'),'chosen');
});

test('review mode captures drafts without Google write; submitted task uses edited fields',async()=>{
  const m=mockChrome();globalThis.chrome=m.chrome;
  m.areas.local.set('authMode','web');m.areas.session.set('webToken',{value:'web-T',expiresAt:Date.now()+3600000});m.areas.sync.set('reviewBeforeSend',true);
  const posts=[];
  globalThis.fetch=async(url,init={})=>{
    if(init.method==='POST')posts.push(JSON.parse(init.body));
    if(url.includes('users/@me/lists'))return {ok:true,status:200,json:async()=>({items:[{id:'list-a',title:'My Tasks'}]})};
    return {ok:true,status:200,json:async()=>({id:'new-task'})};
  };
  await freshModule('background.js');
  m.listeners.onInstalled();
  m.listeners.menuClicked({menuItemId:'send-page',pageUrl:'https://example.com/path?secret=x',selectionText:'original quote'}, {url:'https://example.com/path',title:'Original title'});
  await waitFor(()=>m.calls.windows.length===1);
  assert.equal(posts.length,0);
  const url=m.calls.windows[0].url;
  assert.ok(url.includes('editor.html?draft='));assert.ok(!url.includes('example.com'));
  const draftId=new URL(url).searchParams.get('draft');
  assert.equal(m.areas.session.get(`draft:${draftId}`).item.selection,'original quote');
  const message={type:'submitReviewedTask',draftId,task:{title:'My edited title',date:'2026-11-12',notes:'Only these notes'}};
  const result=await new Promise(resolve=>{
    const keepOpen=m.listeners.onMessage(message,{id:m.chrome.runtime.id,url},resolve);
    assert.equal(keepOpen,true);
  });
  assert.deepEqual(result,{ok:true});
  assert.deepEqual(posts,[{title:'My edited title',notes:'Only these notes',status:'needsAction',due:'2026-11-12T00:00:00.000Z'}]);
  assert.equal(m.areas.session.has(`draft:${draftId}`),false);
});

test('review handler rejects messages not coming from this extension editor',async()=>{
  const m=mockChrome();globalThis.chrome=m.chrome;
  await freshModule('background.js');
  const result=await new Promise(resolve=>m.listeners.onMessage({type:'submitReviewedTask',draftId:'123'},{id:'untrusted',url:'https://evil.example'},resolve));
  assert.equal(result.ok,false);
});

test('unchecked review mode sends directly without opening a window',async()=>{
  const m=mockChrome();globalThis.chrome=m.chrome;
  m.areas.local.set('authMode','web');m.areas.session.set('webToken',{value:'web-T',expiresAt:Date.now()+3600000});
  let posted=0;
  globalThis.fetch=async(url,init={})=>{
    if(init.method==='POST')posted++;
    return {ok:true,status:200,json:async()=>url.includes('users/@me/lists')?{items:[{id:'list-a'}]}:{id:'task'}};
  };
  await freshModule('background.js');
  m.listeners.actionClicked({url:'https://example.org',title:'Example'});
  await waitFor(()=>posted===1);
  assert.equal(m.calls.windows.length,0);
});

test('submitted draft cannot be submitted concurrently twice',async()=>{
  const m=mockChrome();globalThis.chrome=m.chrome;
  m.areas.local.set('authMode','web');m.areas.session.set('webToken',{value:'web-T',expiresAt:Date.now()+3600000});
  const draftId='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  m.areas.session.set('draft:'+draftId,{item:{url:'https://example.com'},createdAt:Date.now(),dueDays:null});
  let posted=0;
  globalThis.fetch=async(url,init={})=>{
    if(init.method==='POST'){posted++;await delay(80)}
    return {ok:true,status:200,json:async()=>url.includes('users/@me/lists')?{items:[{id:'list-a'}]}:{id:'task'}};
  };
  await freshModule('background.js');
  const url=m.chrome.runtime.getURL('editor.html?draft='+draftId);
  const send=()=>new Promise(resolve=>m.listeners.onMessage({type:'submitReviewedTask',draftId,task:{title:'One',notes:'Two',date:''}},{id:m.chrome.runtime.id,url},resolve));
  const [first,second]=await Promise.all([send(),send()]);
  assert.equal(first.ok,true);assert.equal(second.ok,false);assert.equal(posted,1);
});

test('closing editor window discards captured task data',async()=>{
  const m=mockChrome();globalThis.chrome=m.chrome;
  m.areas.sync.set('reviewBeforeSend',true);
  await freshModule('background.js');
  m.listeners.actionClicked({url:'https://example.com/private?token=abc',title:'Private'});
  await waitFor(()=>m.areas.session.has('draftWindow:1'));
  const id=m.areas.session.get('draftWindow:1');
  assert.ok(m.areas.session.has('draft:'+id));
  m.listeners.windowRemoved(1);
  await waitFor(()=>!m.areas.session.has('draft:'+id));
  assert.equal(m.areas.session.has('draftWindow:1'),false);
});

test('accidental immediate duplicate click is ignored and private title never appears in OS notification',async()=>{
  const m=mockChrome();globalThis.chrome=m.chrome;
  m.areas.local.set('authMode','web');m.areas.session.set('webToken',{value:'web-T',expiresAt:Date.now()+3600000});
  let posted=0;
  globalThis.fetch=async(url,init={})=>{
    if(init.method==='POST')posted++;
    return {ok:true,status:200,json:async()=>url.includes('users/@me/lists')?{items:[{id:'list-a'}]}:{id:'task'}};
  };
  await freshModule('background.js');
  const tab={url:'https://private.example/?token=private',title:'Private meeting details'};
  m.listeners.actionClicked(tab);m.listeners.actionClicked(tab);
  await waitFor(()=>posted===1);
  await waitFor(()=>m.calls.notifications.length===1);
  assert.equal(posted,1);
  assert.equal(m.calls.notifications[0].message,'Task created successfully.');
  assert.ok(!m.calls.notifications[0].message.includes('Private'));
});
