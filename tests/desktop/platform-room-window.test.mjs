import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import {CompanionPorts} from '../../dist/src/core/tables/companion-ports.js';
import {DEFAULT_COMPANION_SETTINGS} from '../../dist/src/core/companion-settings.js';
import {PetPlatform} from '../../dist/src/desktop/platform/plugin.js';

test('both desk pet Room entries use the current window registration',async t=>{
  const path=mkdtempSync(join(tmpdir(),'desktop-room-window-'));
  const target={id:'bound',path};
  const companionPorts=new CompanionPorts();
  const scope=new Context();
  const context={
    root:scope.root, fiber:scope.fiber, [Context.isolate]:scope[Context.isolate],
    logger:console,connection:{broadcast(){}},webServer:{},on:()=>()=>{},petDesktop:{},
    get(name){assert.notEqual(name,'petRoom');},
    petCore:{native:{companionPorts},workspace:{
      status:()=>({state:'ready',target}),companionSettings:()=>DEFAULT_COMPANION_SETTINGS,
      homeScope:()=>({workspaceId:target.id,path,storageId:target.id,bootId:'fixture',generation:1}),
      runtime:{identity:()=>({displayName:'测试伙伴',character:''})},
    }},
  };
  const platform=new PetPlatform(context);
  t.after(()=>{platform.close();rmSync(path,{recursive:true,force:true});});
  const request=(route,method='POST',body)=>platform.handle(
    new URL('http://localhost/chatpet-presentation/'+route),method,body,new AbortController().signal);
  const menu=()=>request('menu/click','POST',JSON.stringify({owner:'chatpet.room'}));
  const opens=[];
  const result={running:true,ready:true,workspaceId:target.id};
  const registration=companionPorts.registerRoomWindow(scope,async workspaceId=>{opens.push(workspaceId);return result;});
  assert.equal((await request('room-window','GET')).status,405);
  assert.deepEqual((await request('room-window')).obj,result);
  assert.deepEqual((await menu()).obj,{ok:true});
  assert.deepEqual(opens,[target.id,target.id]);
  const isolated = scope.isolate('petRoom');
  context[Context.isolate] = isolated[Context.isolate];
  await assert.rejects(request('room-window'),/房间模块未启用/);
  await assert.rejects(menu(),/房间模块未启用/);
  assert.deepEqual(opens,[target.id,target.id]);
  const isolatedOpens=[];
  const isolatedRegistration=companionPorts.registerRoomWindow(isolated,async workspaceId=>{
    isolatedOpens.push(workspaceId);return {...result,ready:false};
  });
  assert.deepEqual((await request('room-window')).obj,{...result,ready:false});
  assert.deepEqual((await menu()).obj,{ok:true});
  assert.deepEqual(isolatedOpens,[target.id,target.id]);
  assert.deepEqual(opens,[target.id,target.id]);
  context[Context.isolate] = scope[Context.isolate];
  await isolatedRegistration.revoke();
  await registration.revoke();
  await assert.rejects(request('room-window'),/房间模块未启用/);
  await assert.rejects(menu(),/房间模块未启用/);
  assert.deepEqual(opens,[target.id,target.id]);
});
