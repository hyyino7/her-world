import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {workspace,repository} from './helpers.mjs';
import {scan} from '../../scripts/arch/lib/scan.mjs';

test('R5 从真实近期账本建表代码报告 Emotion 写入 Memory 容器',t=>{
  const work=workspace(t,{'src/emotion/recent.ts':readFileSync(join(repository,'src/emotion/recent.ts'),'utf8')});
  const rows=work.scan().writers.filter(r=>r.target==='recent');
  assert.equal(rows.length,2);
  for(const row of rows)assert.deepEqual(
    [row.storageId,row.writer,row.container,row.containerOwner,row.owner,row.violation],
    ['emotion-recent','emotion','.chatpet/data/memory/recent-interactions.sqlite#recent','memory','emotion',true]);
});

test('R5 精确文件优先于 Memory 目录通配，其他记忆文件仍属于 Memory',t=>{
  const work=workspace(t,{'src/emotion/files.ts':`import {readFileSync,writeFileSync} from 'node:fs';
    readFileSync('.chatpet/data/memory/recent-interactions.sqlite');
    writeFileSync('.chatpet/data/memory/data/memory.db','synthetic');`});
  const rows=work.scan().writers;
  assert.deepEqual(rows.map(r=>[r.storageId,r.containerOwner,r.owner,r.violation]),
    [['emotion-recent','memory','emotion',true],['memory','memory','memory',true]]);
});

test('R5 对新旧身体、记录、相册及设备连接位置分别报告真实容器',t=>{
  const paths=['.chatpet/data/behavior/home.json','.chatpet/data/life/home.json',
    '.chatpet/diary/2026-01-01.md','.chatpet/data/life/diary/2026-01-01.md',
    '.chatpet/data/life/photos/album.sqlite','profile:chatpet-channels/account.json',
    '.chatpet/data/life/activity/2026-01-01.jsonl'];
  const rows=workspace(t,{'src/living/body/files.ts':`import {writeFileSync} from 'node:fs';
    ${paths.map(path=>`writeFileSync(${JSON.stringify(path)},'synthetic');`).join('\n')}`}).scan().writers;
  assert.deepEqual(rows.map(r=>[r.container,r.containerOwner,r.owner]),[
    ['.chatpet/data/behavior/home.json','living','living'],
    ['.chatpet/data/life/home.json','living','living'],
    ['.chatpet/diary/**','core','core'],
    ['.chatpet/data/life/diary/**','living','core'],
    ['.chatpet/data/life/photos/album.sqlite','living','core'],
    ['profile:chatpet-channels/**','channels','channels'],
    ['.chatpet/data/life/activity/**','living','living'],
  ]);
});

test('R5 真实 Economy 建表使用已登记数据库，Core records 建表不归属 Channels kind',t=>{
  const rows=workspace(t,Object.fromEntries(['living/economy/store.ts','core/storage.ts'].map(file=>
    ['src/'+file,readFileSync(join(repository,'src',file),'utf8')]))).scan().writers.filter(r=>r.reason==='创建表');
  assert.equal(rows.length,13);
  for(const row of rows) {
    const directory=row.file.includes('/economy/')?'economy':'core';
    const owner=directory==='economy'?'living':'core';
    assert.equal(row.container,`.chatpet/data/${directory}/${directory}.sqlite#${row.target}`);
    assert.equal(row.owner,owner);assert.equal(row.containerOwner,owner);assert.equal(row.violation,false);
  }
});

test('R5 仅放行仍登记在 Core 原位的记录及获批模块',t=>{
  const storage=JSON.parse(readFileSync(join(repository,'arch/storage.json'),'utf8'));
  const fixtures={
    'src/channels/receipts.ts':['channel-reach','channel-received','channel-usage','channel-usage-event','life-outlet-delivery','memory-batch'],
    'src/desktop/receipts.ts':['desktop-session','channel-reach'],
  };
  const work=workspace(t,Object.fromEntries(Object.entries(fixtures).map(([file,kinds])=>[file,
    kinds.map(kind=>`store.get('${kind}', 'fixture'); store.put('${kind}', 'fixture', {});`).join('\n'),
  ])));
  const violations=rows=>rows.filter(row=>row.violation).map(row=>[row.writer,row.target,row.access]);
  const unapproved=[['channels','memory-batch','读'],['channels','memory-batch','写'],
    ['desktop','channel-reach','读'],['desktop','channel-reach','写']];
  const rows=work.scan().writers;
  assert.equal(rows.length,16);
  assert.deepEqual(violations(rows),unapproved);

  const entry=storage.entries.find(row=>row.selector?.kind==='channel-reach');
  const revoked=[['channels','channel-reach','读'],['channels','channel-reach','写'],...unapproved];
  entry.writers=[];
  work.write('arch/storage.json',JSON.stringify(storage));
  assert.deepEqual(violations(work.scan().writers),revoked);
  entry.writers=['channels'];
  entry.disposition='不变';
  work.write('arch/storage.json',JSON.stringify(storage));
  assert.deepEqual(violations(work.scan().writers),revoked);
  storage.entries=storage.entries.filter(row=>row!==entry);
  work.write('arch/storage.json',JSON.stringify(storage));
  assert.deepEqual(violations(work.scan().writers),revoked);
});

test('存储登记逐 kind 对上真实 store.put 写入模块，旧情绪只读来源不冒充当前写入',()=>{
  const storage=JSON.parse(readFileSync(join(repository,'arch/storage.json'),'utf8'));
  const rows=scan(repository).writers.filter(r=>r.access==='写'&&/\bput\s*\(/.test(r.expression));
  for(const row of rows)assert.ok(storage.entries.some(r=>r.selector?.kind===row.target),`${row.file}:${row.line} ${row.target}`);
  for(const row of storage.entries.filter(r=>r.selector?.kind)) {
    const writers=[...new Set(rows.filter(r=>r.target===row.selector.kind).map(r=>r.writer))].sort();
    assert.deepEqual(writers,[...row.writers].sort(),row.id);
  }
});

test('钱包采用证据和库内标记均由 Living 持有，运行时不再读写 Core 旧键',()=>{
  const storage=JSON.parse(readFileSync(join(repository,'arch/storage.json'),'utf8'));
  const adoption=storage.entries.find(row=>row.id==='economy-adoption');
  const marker=storage.entries.find(row=>row.id==='economy-initialized');
  assert.equal(adoption.container,'.chatpet/data/living/economy-adoption.json');
  assert.deepEqual(adoption.paths,[adoption.container]);
  assert.equal(adoption.selector,undefined);
  assert.equal(marker.container,'.chatpet/data/economy/economy.sqlite#meta');
  assert.deepEqual(marker.selector,{table:'meta',key:'economy.initialized'});
  for(const row of [adoption,marker])assert.deepEqual([row.owner,row.containerOwner,row.writers],['living','living',['living']]);
  const old=scan(repository).writers.filter(row=>row.file.startsWith('src/living/')
    && row.container.endsWith('/core.sqlite#meta') && row.target.startsWith('economy.initialized:'));
  assert.deepEqual(old,[]);
});
