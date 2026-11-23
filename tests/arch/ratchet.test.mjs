import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {workspace,saveBaseline,check} from './helpers.mjs';
import {scan} from '../../scripts/arch/lib/scan.mjs';

const old="export function old(ctx) { ctx.get('petLife'); }";
const create=t=>{const work=workspace(t,{'src/core/example.ts':old});saveBaseline(work);return work;};
test('未改变的旧违规通过，report 也做棘轮比较',t=>{
  const work=create(t),result=check(work.root,['--','--report']);
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/R2 src\/core\/example.ts:1/);
});
test('直接新增违规失败',t=>{
  const work=create(t);work.write('src/core/example.ts',old+"\nexport function added(ctx) {ctx.get('petBehavior');}");
  assert.equal(check(work.root).status,1);
});
test('删除旧违规并在另一个函数加相同服务仍失败',t=>{
  const work=create(t);work.write('src/core/example.ts',"export function other(ctx) {ctx.get('petLife');}");
  const result=check(work.root);assert.equal(result.status,1);assert.match(result.stdout,/新增 1；消失 1/);
});
test('同一函数多出相同表达式仍失败',t=>{
  const work=create(t);work.write('src/core/example.ts',"export function old(ctx) {ctx.get('petLife');ctx.get('petLife');}");
  assert.equal(check(work.root).status,1);
});
test('旧条目消失时必须同提交收紧，再次检查通过',t=>{
  const work=create(t);work.write('src/core/example.ts','export const fixed = true;');
  assert.equal(check(work.root).status,1);
  assert.equal(check(work.root,['--write-baseline']).status,0);
  assert.equal(check(work.root).status,0);
  assert.equal(JSON.parse(readFileSync(join(work.root,'arch/baseline/rules.json'),'utf8')).entries.length,0);
});
test('--write-baseline 拒绝新增且不部分改写其他基线',t=>{
  const work=create(t),path=join(work.root,'arch/baseline/rules.json'),before=readFileSync(path,'utf8');
  work.write('src/core/example.ts',old+"\nexport function added(ctx) {ctx.get('petBehavior');}");
  const result=check(work.root,['--write-baseline']);assert.equal(result.status,1);assert.match(result.stderr,/只能删条目/);
  assert.equal(readFileSync(path,'utf8'),before);
});
test('基线缺失不能重新初始化以放行旧违规',t=>{
  const work=workspace(t,{'src/core/example.ts':old});assert.equal(check(work.root,['--write-baseline']).status,1);
});
test('移动行号、注释、格式和引号风格不改变身份',t=>{
  const work=create(t);work.write('src/core/example.ts','\n\nexport function old(ctx) { /* move */ ctx . get ( "petLife" ) ; }');
  assert.equal(check(work.root).status,0);
});
test('R8 新增重复定义不能用同总数抵消',t=>{
  const work=workspace(t,{'src/core/a.ts':"const words=['a','b','c'];",'src/living/plan/b.ts':"const words=['a','b','c'];"});
  saveBaseline(work);work.write('src/living/plan/b.ts','');work.write('src/room/c.ts',"const words=['a','b','c'];");
  assert.equal(check(work.root).status,1);
});
test('R8 已有重复集合改取值、增加状态或改标签文案保持身份',t=>{
  const work=workspace(t,{
    'src/core/a.ts':"type State='a'|'b'|'c'; const labels={x:'甲',y:'乙',z:'丙'};",
    'src/living/plan/b.ts':"type State='a'|'b'|'c'|'d'; const labels={x:'甲',y:'乙',z:'丙'};",
  });
  const before=saveBaseline(work);
  assert.ok(before.vocabulary.length>0);
  work.write('src/core/a.ts',"type State='a'|'b'|'c'|'e'; const labels={x:'新文案',y:'乙',z:'丙'};");
  work.write('src/living/plan/b.ts',"type State='a'|'b'|'c'|'d'|'e'; const labels={x:'甲',y:'乙',z:'丙'};");
  const result=check(work.root);
  assert.equal(result.status,0,result.stderr);
});
test('R8 完全重复的集合单方加值变为子集仍通过且不改基线',t=>{
  const work=workspace(t,{
    'src/core/a.ts':"type State='active'|'idle'|'sleeping';",
    'src/living/plan/b.ts':"const labels={active:'活动',idle:'空闲',sleeping:'睡眠'};",
  });
  const before=saveBaseline(work);
  assert.equal(before.vocabulary.length,2);
  assert.ok(before.vocabulary.every(item=>item.relation==='重复'));
  const path=join(work.root,'arch/baseline/vocabulary.json'),baseline=readFileSync(path,'utf8');
  assert.equal(check(work.root).status,0);
  work.write('src/core/a.ts',"type State='active'|'idle'|'sleeping'|'paused';");
  const after=work.scan().vocabulary;
  assert.equal(after.length,2);
  assert.ok(after.every(item=>item.relation==='子集'));
  const result=check(work.root);
  assert.equal(result.status,0,result.stderr);
  assert.equal(readFileSync(path,'utf8'),baseline);
});
test('R8 新增一对重复或同一函数内增加一份重复仍阻断',t=>{
  const work=workspace(t,{
    'src/core/a.ts':"export function words(){return ['a','b','c'];}",
    'src/living/plan/b.ts':"export function words(){return ['a','b','c'];}",
  });
  saveBaseline(work);
  work.write('src/room/c.ts',"export function words(){return ['a','b','c'];}");
  assert.equal(check(work.root).status,1);
  work.write('src/room/c.ts','');
  work.write('src/core/a.ts',"export function words(){const extra=['a','b','c'];return ['a','b','c'];}");
  assert.equal(check(work.root).status,1);
});

test('R8 对象表沿用现行报告和棘轮，按重数拦截新增并允许收紧',t=>{
  const room='src/room/words.ts';
  const table=name=>`const ${name} = {a: true, b: false, c: true} as const; Object.hasOwn(${name}, 'a');\n`;
  const before=table('First')+table('Second');
  const work=workspace(t,{'src/living/plan/words.ts':"export type State = 'a'|'b'|'c';",[room]:before});
  saveBaseline(work);
  const file='arch/baseline/vocabulary.json';
  const baseline={schemaVersion:1,objectTables:true,entries:scan(work.root,{objectTables:true}).vocabulary};
  assert.equal(baseline.entries.length,4);
  const baselineJson=JSON.stringify(baseline);
  work.write(file,baselineJson);
  const read=()=>readFileSync(join(work.root,file),'utf8');
  const detail=check(work.root,['--report']);
  assert.equal(detail.status,0,detail.stderr);
  assert.match(detail.stdout,/R8：4 条重复关系/);
  assert.match(detail.stdout,/R8 定义 src\/room\/words\.ts:2 object table/);

  work.write(room,before+table('Third'));
  const added=check(work.root);
  assert.equal(added.status,1);
  assert.match(added.stdout,/新增 2；消失 0/);
  assert.match(check(work.root,['--write-baseline']).stderr,/只能删条目/);
  assert.equal(read(),baselineJson);

  work.write(room,'');
  const tightened=check(work.root,['--write-baseline']);
  assert.equal(tightened.status,0,tightened.stderr);
  assert.deepEqual(JSON.parse(read()),{schemaVersion:1,objectTables:true,entries:[]});
  assert.equal(check(work.root).status,0);
  work.write(room,table('First'));
  assert.equal(check(work.root).status,1);
});
