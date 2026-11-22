import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {setImmediate} from 'node:timers/promises';
import {fixture, value} from './fixture.mjs';
import {panelNodes, renderEconomyPanel} from './economy-panel.mjs';

test('设置页保存种子和堆肥价格，排除只读价格并按原号查证遗失回包', async t => {
  const f = await fixture(t, {console:true, policy:true});
  f.workspace.status = async () => 'ok';
  const read = () => f.settings('economyView',{workspaceId:'world'}).then(value);
  const before = await read();
  const seed = before.catalog.find(item => item.kind === 'seed');
  const harvest = before.catalog.find(item => item.kind === 'harvest' && item.cropId === seed.cropId);
  const compost = before.catalog.find(item => item.kind === 'compost');
  const writes = [], checks = [];
  let viewRead;
  const page = renderEconomyPanel(async (endpoint,input,_signal,requestId) => {
    if (endpoint === 'economyView') {
      viewRead = read();
      const view = await viewRead;
      // 在合成视图放入只读字段，验证商品编辑提交时按可写键筛选。
      const readOnly = [harvest.id,'fixed-price'];
      for (const id of readOnly) {
        view.configuration.itemPrices[id] = {purchasePrice:null,sellPrice:999};
        view.configuration.catalogEnabled[id] = false;
      }
      return view;
    }
    if (endpoint === 'economyPending') return value(await f.settings(endpoint,input));
    if (endpoint === 'economyCheck') {
      const result = value(await f.settings(endpoint,input));
      checks.push({requestId:input.requestId,...result});
      return result;
    }
    writes.push({input:JSON.parse(JSON.stringify(input)),requestId});
    const result = value(await f.settings(endpoint,input,requestId));
    if (writes.length === 1) throw Error('模拟保存已完成但回包丢失');
    return result;
  });
  page.render();
  t.after(page.mount());
  await viewRead;
  await setImmediate();
  function itemRow(item) {
    const [section] = panelNodes(page.render(), node => node.type === 'details' && node.props.label === '商品价格与上架');
    const [row] = panelNodes(section, node => node.type === 'div' && node.props?.key === item.id);
    return row;
  }
  function changePrice(item, price) {
    const [field] = panelNodes(itemRow(item), node => node.type === 'field');
    field.props.onChange(price);
  }
  function click(label) {
    const [button] = panelNodes(page.render(), node => node.type === 'button' && node.children[0] === label);
    assert.equal(button.props.disabled,false);
    return button.props.onClick();
  }
  changePrice(seed,'13');
  changePrice(compost,'17');
  const [enabled] = panelNodes(itemRow(compost), node => node.type === 'input' && node.props.type === 'checkbox');
  enabled.props.onChange({target:{checked:false}});
  await click('保存经济配置');
  assert.equal(writes.length,1);
  assert.deepEqual(checks,[{requestId:writes[0].requestId,state:'committed'}]);
  assert.deepEqual(panelNodes(page.render(),node=>node.type==='button' && node.children[0]==='重试原操作'),[]);
  const {itemPrices,catalogEnabled} = writes[0].input.next;
  assert.deepEqual(Object.keys(itemPrices).sort(),[seed.id,compost.id].sort());
  assert.deepEqual(catalogEnabled,{[compost.id]:false});

  const after = await read();
  assert.equal(after.configuration.crops[seed.cropId].seedCost,13);
  assert.equal(after.configuration.compostCost,17);
  assert.equal(after.catalog.find(({id}) => id === compost.id).enabled,false);
  assert.equal(after.catalog.find(({id}) => id === harvest.id).sellPrice,harvest.sellPrice);
  assert.equal(after.configuration.revision,before.configuration.revision+1);
  assert.equal(after.ledger.filter(row => row.requestId === writes[0].requestId).length,1);
  using db = new DatabaseSync(join(f.repo,'.chatpet/data/economy/economy.sqlite'),{readOnly:true});
  const saved = JSON.parse(db.prepare("SELECT value FROM meta WHERE key='configuration'").get().value);
  assert.equal(Object.hasOwn(saved.itemPrices,harvest.id),false);
  const receipt = JSON.parse(db.prepare('SELECT result FROM requests WHERE id=?').get(writes[0].requestId).result);
  assert.equal(Object.hasOwn(receipt,'writableKeys'),false);

  const action = value(await f.settings('economyAction',{workspaceId:'world',action:{kind:'grant',amount:1}}));
  assert.equal(Object.hasOwn(action,'writableKeys'),false);
  const active = await f.begin();
  for (const view of ['full','overview']) {
    const state = await f.tool(active,'pet_economy_state',{view});
    assert.equal(Object.hasOwn(state,'writableKeys'),false);
  }
  await f.end(active);
});
