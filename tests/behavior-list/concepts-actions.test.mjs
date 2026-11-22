import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture, value} from './fixture.mjs';

test('照料在设置、Life、Body 和 World 保留准入及错误顺序', async t => {
  const f = await fixture(t, {console:true});
  const actions = ['feed','water','play','pet','sleep','wake'];
  const rpcError = {ok:false,error:{code:'INVALID_ARGUMENT',message:'设置值无效，请检查填写内容。',details:{},effect:'none',retry:'never'}};
  for (const action of actions) {
    const input = {workspaceId:'world',action};
    assert.equal(value(await f.settings('lifeAction', input, 'settings-'+action)).fact.type, action);
    assert.equal((await f.life.act('world', action, 'life-'+action)).fact.type, action);
    assert.equal((await f.body.act('world', action, 'body-'+action)).fact.type, action);
    const requestId = 'world-'+action;
    assert.equal(typeof value(await f.body.worldCommands.care({...input,requestId})).changed, 'boolean');
    const fact = (await f.body.pendingFacts('world')).find(row => row.requestId === requestId);
    assert.equal(fact?.type, action);
  }
  for (const action of ['poke','lamp','',0]) {
    assert.deepEqual(await f.settings('lifeAction', {workspaceId:'world',action}), rpcError);
    await assert.rejects(f.life.act('wrong-binding', action), {message:'未知的生活动作'});
    await assert.rejects(f.body.act('wrong-binding', action), {message:'未知的身体动作'});
    assert.deepEqual(await f.body.worldCommands.care({workspaceId:'world',requestId:'rejected',action}),
      {ok:false,error:{operationId:'rejected',code:'INVALID_ARGUMENT',message:'未知的身体动作',effect:'none',retry:'never'}});
  }
  assert.equal((await f.settings('lifeAction', {workspaceId:'wrong-binding',action:'poke'})).error.code, 'STALE_BINDING');
  const stale = await f.body.worldCommands.care({workspaceId:'wrong-binding',requestId:'wrong-world',action:'poke'});
  assert.deepEqual(stale, {ok:false,error:{operationId:'wrong-world',code:'STALE_BINDING',
    message:'生活工作区已切换或组件已停止',effect:'none',retry:'refresh'}});
  assert.equal((await f.body.pendingFacts('world')).length, 24);
});

test('角色房间动作固定工具枚举、留言截断与角色操作拒绝', async t => {
  const f = await fixture(t, {room:true,policy:true});
  const active = await f.begin();
  const actions = ['command','pet','poke','feed','water','play','talk','sleep','wake','lamp'];
  assert.deepEqual(f.toolSchema(active,'room_action').parameters.properties.action.enum, actions);
  const text = '甲'.repeat(120);
  const fields = {command:{room:'living',spot:'tv'},talk:{text:'  '+text+'乙  '},lamp:{on:true}};
  for (const action of actions) {
    const result = await f.tool(active, 'room_action', {action,...fields[action]});
    assert.equal(result.changed, true, action);
    assert.equal(result.event.type, action);
    if (action === 'talk') assert.equal(result.event.text, '你自己的留言已保存：'+text);
  }
  await assert.rejects(f.tool(active, 'room_action', {action:'visit'}), {
    code:'INVALID_ARGS',message:'invalid arguments: "action" must be one of '+JSON.stringify(actions),
  });
  await assert.rejects(f.body.roomAction('world', {action:'visit'}, '大肥鱼'), {message:'角色不能执行这项房间操作'});
  await f.end(active);
});

test('主人 Room RPC 保留十五个动作、事实类型及请求重试', async t => {
  const f = await fixture(t, {room:true,console:true});
  const roomState = async () => value(await f.settings('roomState', {workspaceId:'world',data:{}}));
  const actions = [
    ['visit'],['pet'],['poke'],['feed'],['water'],['play'],['talk',{text:'合成留言'}],
    ['sleep'],['wake'],['lamp',{on:false}],['command',{room:'kitchen',spot:'fridge'}],
    ['go',{pos:[-1,1]}],['place',{pos:[1,6]}],['sick'],['heal'],
  ];
  for (const [action, fields] of actions) {
    const input = {workspaceId:'world',data:{action,...fields}};
    if (action === 'lamp') assert.equal((await roomState()).room.lamp, true);
    const result = value(await f.settings('roomAction', input, action));
    assert.equal(result.fact.type, action);
    assert.equal(result.fact.result.status, 'completed', action);
    assert.equal(result.fact.actor.kind, 'owner');
    assert.equal(result.fact.actor.channel, 'room');
    if (action === 'lamp') assert.equal((await roomState()).room.lamp, fields.on);
    if (action === 'command') {
      const {her} = await roomState();
      assert.ok(her.etaMs > 0, '命令创建前往目标房间的路线');
      t.mock.timers.tick(Math.ceil(her.etaMs));
      const {her: arrived} = await roomState();
      assert.deepEqual([arrived.room,arrived.spot], [fields.room,fields.spot]);
    }
    // go 的屋外坐标会吸附到公开路线终点；place 直接更新当前位置。
    if (action === 'go') assert.deepEqual((await roomState()).her.route.at(-1), [-.65,3]);
    if (action === 'place') assert.deepEqual((await roomState()).her.pos, fields.pos);
    if (action === 'talk') {
      const notes = async () => (await roomState()).room.notes.filter(note => note.text === fields.text);
      assert.equal((await notes()).length, 1, '首次提交保存一条留言');
      assert.deepEqual(value(await f.settings('roomAction', input, action)).fact, result.fact);
      assert.equal((await notes()).length, 1, '同请求重试保留一条留言');
      await f.restart();
      assert.deepEqual(value(await f.settings('roomAction', input, action)).fact, result.fact);
      assert.equal((await notes()).length, 1, '重启后同请求重试保留一条留言');
    }
  }
  const facts = await f.body.pendingFacts('world');
  assert.deepEqual(facts.map(fact => fact.type).sort(), actions.map(([action]) => action).sort());
});
