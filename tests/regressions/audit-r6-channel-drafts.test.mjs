import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {defaults,editableMessagingFields} from '../../dist/src/channels/messaging-settings.js';
import {fixture as companionFixture,value} from '../behavior-list/fixture.mjs';

const source=readFileSync(new URL('../../src/console/client.js',import.meta.url),'utf8');
const parsed=ts.createSourceFile('client.js',source,ts.ScriptTarget.Latest,true);
let component,roleBlock,settingsPage;function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='ChannelsPage')component=node.getText(parsed);if(ts.isFunctionDeclaration(node)&&node.name?.text==='SettingsPage')settingsPage=node;if(ts.isIfStatement(node)&&node.expression.getText(parsed)==="active === 'role'")roleBlock=node.getText(parsed);ts.forEachChild(node,visit);}visit(parsed);assert.ok(component);assert.ok(roleBlock);assert.ok(settingsPage);
const saveMethod=settingsPage.body.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='save').getText(parsed);
const initial=()=>({bridge:{preferences:{enabled:false,outlets:[]}},messaging:{fields:editableMessagingFields(),config:{
  qq:{...defaults.qq,ownerSpeakerId:'old-qq'},
  wechat:{...defaults.wechat,ownerSpeakerId:'old-wx'}},qq:{state:'disabled'},wechat:{state:'disabled'}}});
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(client=component,liveRequest){
  const states=[],refs=[],effects=[];let stateCursor=0,refCursor=0,mounted=false,disposed=false,lateWrites=0,tree;
  const requests=[],pending=[];let server=initial();
  const h=(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity).filter(value=>value!==null&&value!==false&&value!==undefined)});
  const context=vm.createContext({AbortController,JSON,console,
    equal:(a,b)=>JSON.stringify(a)===JSON.stringify(b),h,Card:'Card',QQGroup:'QQGroup',Qzone:'Qzone',details:(name,...children)=>h('details',{name},...children),
    useState(value){const n=stateCursor++;if(!(n in states))states[n]=value;return [states[n],next=>{if(disposed)lateWrites++;states[n]=typeof next==='function'?next(states[n]):next;}];},
    useRef(value){const n=refCursor++;return refs[n]??={current:value};},React:{Fragment:'Fragment',useEffect(effect){if(!mounted)effects.push(effect);}},
  });
  const Page=vm.runInContext('('+client+')',context);
  const request=(operation,input,signal)=>{requests.push({operation,input:clone(input),signal});
    if(liveRequest)return liveRequest(operation,input,signal);
    if(operation==='channelStatus')return Promise.resolve(clone(server));
    return new Promise((resolve,reject)=>pending.push({operation,input:clone(input),signal,resolve,reject}));};
  function render(){stateCursor=0;refCursor=0;tree=Page({workspaceId:'workspace-A',request});if(!mounted){for(const effect of effects){const stop=effect();if(stop)cleanup.push(stop);}mounted=true;}return tree;}
  const cleanup=[];
  const walk=node=>typeof node==='object'?[node,...node.children.flatMap(walk)]:[];
  const text=node=>typeof node==='string'?node:node.children.map(text).join('');
  const section=name=>walk(tree).find(node=>node.type==='details'&&node.props.name===name);
  function button(label,part){const root=part?section(part):tree;assert.ok(root,part);const node=walk(root).find(node=>node.type==='button'&&text(node)===label);assert.ok(node,label);return node;}
  function control(part,label){const root=section(part);assert.ok(root,part);
    const field=walk(root).find(node=>node.type==='label'&&text(node)===label);assert.ok(field,label);
    const input=field.children.find(node=>typeof node==='object'&&['input','textarea','select'].includes(node.type));assert.ok(input);
    return input;}
  function edit(part,label,value){control(part,label).props.onChange({target:{value,checked:value}});render();}
  async function open(){render();await button('管理渠道').props.onClick();render();}
  function complete(){const item=pending.shift();assert.ok(item);
    if(item.operation==='messagingSettings')server.messaging.config={...server.messaging.config,...item.input.next};
    if(item.operation==='bridgeSettings')server.bridge.preferences=clone(item.input.next);
    item.resolve(clone(server));return item;}
  return {open,render,states,requests,pending,control,edit,button,complete,
    draft:()=>clone(states[1]),saved:()=>clone(states[0]),
    dispose(){for(const stop of cleanup)stop();disposed=true;},lateWrites:()=>lateWrites,
    setServer:value=>{server=clone(value);}};
}

test('生成的桌宠渠道设置从真实 Console 路由读取字段、校验并保存，重启后读回',async t=>{
  const desktop=readFileSync(new URL('../../src/desktop/platform/client.js',import.meta.url),'utf8');
  const client=desktop.slice(desktop.indexOf('function ChannelsPage('),desktop.indexOf('function CompanionArchive(')).trim();
  assert.equal(client,component);
  const host=await companionFixture(t,{console:true,channels:true,life:false,economy:false});
  const request=async(operation,input)=>value(await host.settings(operation,{...input,workspaceId:'world'}));
  const form=fixture(client,request);
  await form.open();
  const voiceRate='每分钟最多语音条数（0 不限制）',quiet='合并消息等待（毫秒）';
  assert.equal(form.control('QQ',voiceRate).props.type,'number');
  form.edit('QQ',voiceRate,'61');
  await form.button('保存QQ设置','QQ').props.onClick();
  assert.equal(form.saved().messaging.config.qq.voicePerMinute,2);
  form.edit('QQ',voiceRate,'3');
  form.edit('QQ',quiet,'250');
  form.control('QQ','群聊触发方式提到我或使用唤醒词所有群消息').props.onChange({target:{value:'all'}});
  form.render();
  form.edit('QQ','允许的私聊账号（每行一个）',' 123 \n');
  form.edit('QQ','QQ 语音收发',true);
  await form.button('保存QQ设置','QQ').props.onClick();
  form.edit('微信','媒体等待秒数','9');
  await form.button('保存微信设置','微信').props.onClick();
  await host.restart();
  const reopened=fixture(client,request);
  await reopened.open();
  const {qq,wechat}=reopened.saved().messaging.config;
  assert.deepEqual([qq.voicePerMinute,qq.batchQuietMs,qq.groupTrigger,qq.allowPrivate,qq.voiceEnabled,wechat.bufferSeconds],
    [3,250,'all',['123'],true,9]);
  assert.equal(reopened.control('QQ',quiet).props.value,250);
  assert.equal(reopened.control('微信','媒体等待秒数').props.value,9);
});

test('R6-05: saving QQ preserves unsaved WeChat and bridge sections',async()=>{
  const f=fixture();await f.open();f.edit('微信','主人的账号 ID','new-unsaved-wx');f.edit('本地程序和推送','允许本机受信程序给生活会话发消息',true);
  f.edit('QQ','主人的账号 ID','new-qq');const pending=f.button('保存QQ设置','QQ').props.onClick();f.complete();await pending;f.render();
  assert.equal(f.draft().wechat.ownerSpeakerId,'new-unsaved-wx');assert.equal(f.draft().bridge.enabled,true);assert.equal(f.draft().qq.ownerSpeakerId,'new-qq');
  assert.equal(f.saved().messaging.config.wechat.ownerSpeakerId,'old-wx');assert.equal(f.saved().messaging.config.qq.ownerSpeakerId,'new-qq');
});
test('R6-05: saving WeChat preserves the QQ draft and sends only its chosen patch',async()=>{
  const f=fixture();await f.open();f.edit('QQ','主人的账号 ID','new-unsaved-qq');f.edit('微信','主人的账号 ID','new-wx');
  const pending=f.button('保存微信设置','微信').props.onClick();assert.deepEqual(Object.keys(f.pending[0].input.next),['wechat']);f.complete();await pending;f.render();
  assert.equal(f.draft().qq.ownerSpeakerId,'new-unsaved-qq');assert.equal(f.draft().wechat.ownerSpeakerId,'new-wx');
});
test('R6-05: saving bridge preserves both messaging drafts',async()=>{
  const f=fixture();await f.open();f.edit('QQ','主人的账号 ID','draft-qq');f.edit('微信','主人的账号 ID','draft-wx');f.edit('本地程序和推送','允许本机受信程序给生活会话发消息',true);
  const pending=f.button('保存桥接设置','本地程序和推送').props.onClick();f.complete();await pending;f.render();
  assert.equal(f.draft().qq.ownerSpeakerId,'draft-qq');assert.equal(f.draft().wechat.ownerSpeakerId,'draft-wx');assert.equal(f.draft().bridge.enabled,true);
});
test('R6-05: edits made to the saving section and other sections while await is pending remain drafts',async()=>{
  const f=fixture();await f.open();f.edit('QQ','主人的账号 ID','sent-qq');const pending=f.button('保存QQ设置','QQ').props.onClick();
  f.edit('QQ','主人的账号 ID','typed-after-submit');f.edit('微信','主人的账号 ID','typed-while-qq-saving');f.complete();await pending;f.render();
  assert.equal(f.saved().messaging.config.qq.ownerSpeakerId,'sent-qq');assert.equal(f.draft().qq.ownerSpeakerId,'typed-after-submit');assert.equal(f.draft().wechat.ownerSpeakerId,'typed-while-qq-saving');
});
test('R6-05: failed save preserves all drafts and old saved CAS baseline',async()=>{
  const f=fixture();await f.open();f.edit('QQ','主人的账号 ID','qq-draft');f.edit('微信','主人的账号 ID','wx-draft');const before=f.saved();
  const pending=f.button('保存QQ设置','QQ').props.onClick();f.pending.shift().reject(Error('fixture refusal'));await pending;f.render();
  assert.equal(f.draft().qq.ownerSpeakerId,'qq-draft');assert.equal(f.draft().wechat.ownerSpeakerId,'wx-draft');assert.deepEqual(f.saved(),before);assert.equal(f.states[3],'fixture refusal');
});
test('R6-05: completed save does not update an unmounted workspace form',async()=>{
  const f=fixture();await f.open();f.edit('QQ','主人的账号 ID','qq-draft');const before=f.draft(),pending=f.button('保存QQ设置','QQ').props.onClick();
  f.dispose();f.complete();await pending;assert.equal(f.lateWrites(),0);assert.deepEqual(f.draft(),before);
});
test('R6-05: deliberate whole-page reload resets drafts with an explicit discard label',async()=>{
  const f=fixture();await f.open();f.edit('微信','主人的账号 ID','discarded-draft');
  const reload=f.button('重新读取渠道状态（放弃未保存修改）');await reload.props.onClick();f.render();assert.equal(f.draft().wechat.ownerSpeakerId,'old-wx');
});
test('R6-05: saved normalized lists acknowledge their section without altering another draft',async()=>{
  const f=fixture();await f.open();f.edit('QQ','允许的私聊账号（每行一个）',' 123 \n 456 \n');f.edit('微信','主人的账号 ID','wechat-draft');
  const pending=f.button('保存QQ设置','QQ').props.onClick();f.complete();await pending;f.render();
  assert.deepEqual(f.draft().qq.allowPrivate,['123','456']);assert.equal(f.draft().wechat.ownerSpeakerId,'wechat-draft');
});
test('R6-05: deliberate reload discards only edits made before its click, preserving later typing',async()=>{
  const f=fixture();await f.open();f.edit('微信','主人的账号 ID','before-reload');
  const pending=f.button('重新读取渠道状态（放弃未保存修改）').props.onClick();f.edit('微信','主人的账号 ID','typed-after-reload');await pending;f.render();
  assert.equal(f.saved().messaging.config.wechat.ownerSpeakerId,'old-wx');assert.equal(f.draft().wechat.ownerSpeakerId,'typed-after-reload');
});

for(const bound of [true,false])test(`R6-01: actual role/profile view forwards its captured ${bound?'bound':'explicitly unbound'} editor scope`,async()=>{
  const actions=[],calls=[],expectedScope={preferencesRevision:7,workspaceId:bound?'A':null,storageId:bound?'bank-A':null};
  const context=vm.createContext({
    active:'role',prefix:'test',ready:bound,boundId:bound?'A':null,workspaceId:bound?'A':null,identityDirty:true,profileDirty:true,
    snapshot:{editorScope:expectedScope,identity:{revision:3,displayName:'A'},profile:{revision:4}},draft:{identity:{displayName:'New A',character:'New role'},profile:'New user'},
    h:(type,props,...children)=>({type,props,children}),Card:'Card',React:{Fragment:'Fragment'},world:new Set(),document:{},
    fields:(...values)=>values,field:()=>null,editIdentity:()=>()=>{},editDocument:()=>()=>{},setDraft:()=>{},sourceAbsent:()=>null,
    FoundationEditor:'FoundationEditor',CompanionArchive:'CompanionArchive',request:()=>{throw Error('Unexpected child request');},
    saveButton:(operation,enabled,action)=>{actions.push({operation,enabled,action});return null;},
    save:async(operation,input)=>{calls.push({operation,input});},
  });
  vm.runInContext('(function(){'+roleBlock+'})()',context);
  await actions.find(item=>item.operation==='identity').action();
  assert.deepEqual(calls[0].input.expectedScope,expectedScope);assert.equal(calls[0].input.displayName,'New A');
  if(bound){await actions.find(item=>item.operation==='profile').action();assert.deepEqual(calls[1].input.expectedScope,expectedScope);assert.equal(calls[1].input.text,'New user');}
  else assert.equal(actions.find(item=>item.operation==='profile').enabled,false);
});
for(const switched of [false,true])test(`R6-01: conversation-settings acknowledgement ${switched?'cannot retag another workspace':'advances its own editor scope while retaining role drafts'}`,async()=>{
  const workspace={id:switched?'B':'A',path:switched?'/fixture/B':'/fixture/A'},editorScope={preferencesRevision:7,workspaceId:workspace.id,storageId:'bank-'+workspace.id};
  let snapshot={editorScope,preferences:{revision:7,workspace},identity:{revision:3,displayName:'Original',character:'Original'}},draft={identity:{displayName:'unsaved-role',character:'unsaved-role'},profile:'unsaved-profile'};
  const before=clone(snapshot),originalDraft=clone(draft),context=vm.createContext({
    busy:null,lifetime:{current:new AbortController()},stopDesktopWait(){throw Error('Unexpected desktop path');},
    request:async()=>({revision:8,workspace:{id:'A',path:'/fixture/A'},conversation:{maxSteps:3}}),
    setBusy(){},setError(){},setNotice(){},setSnapshot:update=>{snapshot=update(snapshot);},setDraft:update=>{draft=update(draft);},
  });
  vm.runInContext(saveMethod,context);
  await context.save('preferences',{expectedRevision:7,workspaceId:'A'},'conversation');
  if(switched)assert.deepEqual(snapshot,before);
  else{assert.equal(snapshot.preferences.revision,8);assert.equal(snapshot.editorScope.preferencesRevision,8);assert.equal(snapshot.editorScope.storageId,'bank-A');}
  assert.deepEqual(draft,originalDraft);
});
