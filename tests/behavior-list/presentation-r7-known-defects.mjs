import test from 'node:test';
import assert from 'node:assert/strict';
import {presentationFixture,readRpcResult} from './presentation-r7-fixture.mjs';

// 第六批 Console 上线前转绿：路由的撤销责任归入口。
const endpoint='desktopAppearance';
test('Console 卸载后实际请求应找不到 Connection 路由',async t=>{
  const f=await presentationFixture(t);
  await f.mount('console');
  const request=id=>f.request(endpoint,id,{});
  const before=await readRpcResult(await f.dispatch(request('before-unload')),'before-unload');
  assert.equal(before.ok,true,JSON.stringify(before));
  await f.unmount('console');
  const status=await f.dispatch(request('after-unload')).then(response=>response.status,error=>error.message);
  assert.equal(status,404,'卸载后的请求应在 Connection 路由层结束');
});

test('Console 重载后 Connection 对同一路由应只登记一次',async t=>{
  const f=await presentationFixture(t);
  await f.mount('console');
  assert.equal(f.rpcCount(endpoint),1);
  await f.unmount('console');
  await f.mount('console');
  assert.equal(f.rpcCount(endpoint),1,'重载重复登记旧路由');
  assert.equal((await readRpcResult(await f.dispatch(f.request(endpoint,'after-reload',{})),'after-reload')).ok,true);
});
