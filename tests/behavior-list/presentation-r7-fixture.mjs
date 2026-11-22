import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {digest} from '../../dist/src/core/storage.js';
import {channelsPlugin,consolePlugin,desktopPlugin,platformPlugin,roomPlugin,voicePlugin} from '../../dist/tests/behavior-list/entries.js';
import {cordisFixture} from './entries-lifecycle.test.mjs';

const plugins={desktop:desktopPlugin,platform:platformPlugin,room:roomPlugin,channels:channelsPlugin,voice:voicePlugin,console:consolePlugin};
export const peripherals=Object.keys(plugins);

export async function presentationFixture(t,options) {
  const f=await cordisFixture(t,options);
  const active=new Map(),webRoutes=new Set(),rpcRoutes=new Set();
  const register=routes=>route=>{
    routes.add(route);
    return ()=>routes.delete(route);
  };
  t.mock.method(f.ctx.webServer,'register',register(webRoutes));
  await f.ctx.plugin(scope=>{
    scope.provide('connection',{
      browserPeer:{principal:{kind:'owner'},signal:new AbortController().signal},
      fetch:{register:register(rpcRoutes)},
      broadcast() {},
    });
  });
  const endpointPath=endpoint=>'/api/chatpetSettings/'+endpoint;
  const request=(endpoint,requestId,input,signal)=>new Request('http://fixture.invalid'+endpointPath(endpoint),{
    method:'POST',headers:{'content-type':'application/json'},signal,
    body:JSON.stringify({type:'client-request',rpcId:'transport-'+requestId,method:'chatpetSettings/'+endpoint,payload:{requestId,input}}),
  });
  async function dispatch(request) {
    const path=new URL(request.url).pathname;
    const routes=[...rpcRoutes].filter(route=>route.path===path&&route.methods.includes(request.method));
    if(!routes.length)return new Response(null,{status:404});
    assert.equal(routes.length,1,`Connection 路由应唯一：${path}`);
    return routes[0].fetch(request);
  }
  return Object.assign(f,{
    webRoutes,rpcRoutes,
    rpcCount:endpoint=>[...rpcRoutes].filter(route=>route.path===endpointPath(endpoint)).length,
    request,dispatch,
    async mount(key) { active.set(key,await f.ctx.plugin(plugins[key])); },
    async unmount(key) {
      await active.get(key).dispose();
      active.delete(key);
    },
    async roomAction(id,text,signal) {
      const response=await dispatch(request('roomAction',id,{workspaceId:f.id,data:{action:'talk',text}},signal));
      return readRpcResult(response,id);
    },
    persistedRoom(id,text) {
      const ownerId=digest([f.id,f.core.workspace.storageId(),'roomAction',id]);
      const home=JSON.parse(readFileSync(join(f.directory,'home.json'),'utf8'));
      return {ownerId,receipt:home.interactionReceipts?.[digest(ownerId)],
        notes:(home.visitors?.notes??[]).filter(note=>note.text===text)};
    },
  });
}

export async function readRpcResult(response,id) {
  assert.equal(response.status,200);
  const {type,rpcId,result}=await response.json();
  assert.equal(type,'server-response');
  assert.equal(rpcId,'transport-'+id);
  return result;
}
