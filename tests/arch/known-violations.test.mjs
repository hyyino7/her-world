import test from 'node:test';
import assert from 'node:assert/strict';
import {workspace} from './helpers.mjs';
import {report} from '../../scripts/arch/check.mjs';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

test('R1 覆盖四种扩展名、动态 import、createRequire 别名与 package imports',t=>{
  const result=workspace(t,{},'known-violations').scan();
  const found=result.rules.filter(r=>r.rule==='R1');
  assert.equal(found.length,10);
  for(const suffix of ['imports.ts','dynamic.mjs','require.cjs','static.js'])assert.ok(found.some(r=>r.file.endsWith(suffix)),suffix);
  for(const target of ['src/living/plan/plugin.js','src/room/plugin.js','src/desktop/plugin.js'])assert.ok(found.some(r=>r.target===target),target);
});
test('R2 覆盖 bind、解构、对象别名、scope、计算名、inject 和未知目标',t=>{
  const rows=workspace(t,{},'known-violations').scan().rules.filter(r=>r.rule==='R2'&&r.file.endsWith('/services.ts'));
  for(const [line,targets] of [[4,['petLife']],[6,['petBehavior']],[8,['petRoom']],[9,['petDesktop']],[10,['petChannels']],[12,['petBehavior','petEconomy']],[13,['?']],[14,['?']],[16,['petLife']],[17,['petEconomy']]]) {
    assert.deepEqual(rows.filter(r=>r.line===line).map(r=>r.target).sort(),targets.sort(),`services.ts:${line}`);
  }
});
test('R3 上层事件被拒绝，原生订阅已登记；未声明发布被拒绝',t=>{
  const rows=workspace(t,{},'known-violations').scan().rules.filter(r=>r.rule==='R3');
  assert.deepEqual(rows.map(r=>r.target).sort(),['?','?','pet/life.review','pet/not-declared']);
});
test('R1 未解析的模板依赖明示未知，内联类型导入和完整模板走同一解析器',t=>{
  const rows=workspace(t,{},'known-violations').scan().rules.filter(r=>r.rule==='R1'&&r.file.endsWith('/resolution.ts'));
  assert.deepEqual(rows.map(r=>[r.line,r.target,r.reason]),[
    [4,'?','无法静态判定本地依赖'],[13,'src/living/plan/plugin.js','依赖方向违规'],[18,'src/living/plan/plugin.js','依赖方向违规'],
  ]);
});
test('R2 模板和计算解构不再漏报，完整插值与常量计算名保留真实目标',t=>{
  const rows=workspace(t,{},'known-violations').scan().rules.filter(r=>r.rule==='R2'&&r.file.endsWith('/resolution.ts'));
  assert.deepEqual(rows.map(r=>[r.line,r.target]),[[2,'?'],[3,'?'],[7,'?'],[8,'?'],[9,'?'],[12,'petLife'],[16,'petLife']]);
  assert.ok(rows.filter(r=>r.target==='?').every(r=>r.reason.includes('无法静态判定')));
});
test('R3 未解析的模板订阅与发布都明示未知',t=>{
  const rows=workspace(t,{},'known-violations').scan().rules.filter(r=>r.rule==='R3'&&r.file.endsWith('/resolution.ts'));
  assert.deepEqual(rows.map(r=>[r.line,r.target,r.reason]),[[5,'?','无法静态判定事件'],[6,'?','无法静态判定事件']]);
});
test('完整模板、本地内联类型和合法计算解构不会误报',t=>{
  const work=workspace(t,{'src/core/resolved.ts':`type T=import('./local.js').X;
    const k='petCore'; const {[k]: core}=ctx;
    const event='agent/disposed'; ctx.on(\`${'${event}'}\`,()=>{});
    const name='petCore'; ctx.get(\`${'${name}'}\`);
    const file='./local.js'; import(\`${'${file}'}\`);`});
  assert.deepEqual(work.scan().rules,[]);
});
test('R4 直接写入、对象别名、解构别名和解构赋值都被抓到',t=>{
  const rows=workspace(t,{},'known-violations').scan().rules.filter(r=>r.rule==='R4');
  assert.deepEqual(rows.map(r=>r.line),[2,4,6,7]);
  assert.deepEqual(rows.map(r=>r.target),['host.native.lifeAdmission','host.native.roomAdmission','host.native.channelBoundary','host.native.lifeAdmission']);
});
test('R5 常量 kind 定位读写调用，区分拥有者和 Core 物理容器',t=>{
  const work=workspace(t,{},'known-violations');
  const path='arch/storage.json', storage=JSON.parse(readFileSync(join(work.root,path),'utf8'));
  Object.assign(storage.entries.find(entry=>entry.id==='economy-initialized'),{
    paths:['.chatpet/data/core/core.sqlite'],container:'.chatpet/data/core/core.sqlite#meta',containerOwner:'core',selector:{table:'meta',key:'economy.initialized:*'},
  });
  work.write(path,JSON.stringify(storage));
  const result=work.scan();
  const rows=result.writers;
  assert.deepEqual(rows.filter(r=>r.file.includes('channels/')).map(r=>[r.line,r.target,r.access,r.owner,r.containerOwner,r.violation]),[
    [4,'channel-received','读','channels','core',false],[5,'channel-received','写','channels','core',false],[6,'channel-usage','写','channels','core',false],
  ]);
  assert.deepEqual(rows.filter(r=>r.file.includes('desktop/')).map(r=>[r.line,r.access,r.owner,r.violation]),[[3,'读','desktop',false],[4,'写','desktop',false]]);
  assert.ok(rows.some(r=>r.target==='economy.initialized:*'&&r.line===3&&r.owner==='living'&&r.containerOwner==='core'&&r.violation));
  const output=[];report(result,s=>output.push(s));
  assert.ok(output.some(s=>s.includes('写入模块=channels 操作=写')&&s.includes('业务拥有者=channels')));
});
test('R8 联合、数组、switch、schema const/enum、子集和公开裸 string',t=>{
  const result=workspace(t,{},'known-violations').scan();
  for(const [file,line] of [['living/plan/vocabulary.ts',1],['living/plan/vocabulary.ts',2],['living/plan/vocabulary.ts',7],['room/vocabulary.ts',1],['room/vocabulary.ts',3],['room/vocabulary.ts',4]])assert.ok(result.vocabulary.some(r=>r.file==='src/'+file&&r.line===line),`${file}:${line}`);
  assert.equal(result.bare.length,4);
  assert.ok(result.vocabulary.some(r=>r.relation==='子集'));
  assert.equal(result.judgments.length,2);
});
test('干净样例 R1–R5、R8 全部零违规，合法原生服务与集合不误判',t=>{
  const result=workspace(t,{},'clean').scan();
  assert.deepEqual(result.rules,[]);assert.deepEqual(result.vocabulary,[]);assert.deepEqual(result.writers,[]);
});
test('生成文件跳过而生成源仍接受依赖和词表检查',t=>{
  const work=workspace(t,{'src/core/generated.js':"import '../living/plan/plugin.js';",'scripts/build/source.mjs':"import '../../src/living/plan/plugin.js'; const words=['a','b','c'];",'src/living/plan/words.ts':"const words=['a','b','c'];"});
  const path='arch/layers.json';
  const layers=JSON.parse(readFileSync(join(work.root,path),'utf8'));
  layers.modules.core.generated=[{file:'src/core/generated.js',sources:['scripts/build/source.mjs']}];
  work.write(path,JSON.stringify(layers));
  const result=work.scan();
  assert.deepEqual(result.skipped,['src/core/generated.js']);
  assert.ok(!result.rules.some(r=>r.file==='src/core/generated.js'));
  assert.ok(result.rules.some(r=>r.file==='scripts/build/source.mjs'&&r.rule==='R1'));
  assert.ok(result.vocabulary.some(r=>r.file==='scripts/build/source.mjs'));
});
test('R5 文件读写和 SQLite 建表都出报告，无法判断的路径明示未知',t=>{
  const work=workspace(t,{'src/living/plan/files.ts':`import {readFileSync,writeFileSync} from 'node:fs';
    export function write(root,db,dynamic) {
      writeFileSync(join(root,'.chatpet','data','emotion','state.json'),'{}');
      readFileSync(join(root,'.chatpet','SOUL.md'));
      writeFileSync(dynamic,'{}');
      db.exec('CREATE TABLE IF NOT EXISTS plans (id TEXT)');
    }`});
  const result=work.scan();
  assert.ok(result.writers.some(r=>r.access==='写'&&r.owner==='emotion'&&r.containerOwner==='emotion'&&r.violation===true));
  assert.ok(result.writers.some(r=>r.access==='读'&&r.owner==='core'&&r.container.endsWith('SOUL.md')));
  assert.ok(result.writers.some(r=>r.owner==='?'&&r.violation===null));
  assert.ok(result.writers.some(r=>r.target==='plans'&&r.access==='写'));
});

test('R5 不含 data/ 的通配声明只匹配自身路径，不能使其他文件归属不明确',t=>{
  const cases=[
    ['.chatpet/data/emotion/state.json','emotion-state','emotion','emotion',true],
    ['.chatpet/diary/entry.md','records','core','core',true],
    ['.chatpet/self.history/entry.md','records','core','core',true],
    ['profile:chatpet-channels/account.json','channels','channels','channels',true],
    ['profile:chatpet-voice/cache/clip.wav','voice','voice','voice',true],
    ['data/economy/economy.sqlite','economy','living','living',true],
    ['.chatpet/data/memory/data/memory.db','memory','memory','memory',true],
    ['unregistered.json',undefined,'?','?',null],
  ];
  const work=workspace(t,{'src/room/files.ts':`import {writeFileSync} from 'node:fs';
    export function write() {
      ${cases.map(([path])=>`writeFileSync(${JSON.stringify(path)},'fixture');`).join('\n')}
    }`});
  const rows=work.scan().writers;
  assert.equal(rows.length,cases.length);
  for(const [target,storageId,owner,containerOwner,violation] of cases) {
    const row=rows.find(r=>r.target===target);
    assert.ok(row,target);
    assert.deepEqual([row.storageId,row.owner,row.containerOwner,row.violation,row.access],
      [storageId,owner,containerOwner,violation,'写'],target);
  }
});
