import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {approveR8Baseline} from '../../scripts/arch/approve-r8-baseline.mjs';
import {workspace,saveBaseline,check} from './helpers.mjs';

const plan='src/living/plan/words.ts';
const room='src/room/words.ts';
const legacy="export type State = 'a'|'b'|'c';";
const table=name=>`const ${name} = {a: true, b: false, c: true} as const; Object.hasOwn(${name}, 'a');`;
const correct=[
  {key:['R8',plan,'<module>','union',room,'<module>'],count:2},
  {key:['R8',room,'<module>','object table',plan,'<module>'],count:2},
];

function fixture(t) {
  const work=workspace(t,{[plan]:legacy});
  saveBaseline(work);
  work.write(room,table('First')+'\n'+table('Second'));
  const approvalPath=join(work.root,'approval.json');
  return {
    ...work,
    read:name=>readFileSync(join(work.root,`arch/baseline/${name}.json`),'utf8'),
    approve(additions) {
      work.write('approval.json',JSON.stringify({schemaVersion:1,additions}));
      return approveR8Baseline(work.root,approvalPath);
    },
  };
}

test('R8 核准逐键核对重数，漏批、超批、重复、重数错误和键漂移均拒写',t=>{
  const work=fixture(t),before=work.read('vocabulary');
  for(const additions of [correct.slice(1),[...correct,{key:['R8','src/room/extra.ts','<module>','union',plan,'<module>'],count:1}],
    [...correct,correct[0]],[{...correct[0],count:1},correct[1]],[{...correct[0],count:3},correct[1]]]) {
    assert.throws(()=>work.approve(additions),/批准清单/);
    assert.equal(work.read('vocabulary'),before);
  }
  work.write('src/core/drift.ts',"ctx.get('petLife');");
  assert.throws(()=>work.approve(correct),/漂移/);
  assert.equal(work.read('vocabulary'),before);
  work.write('src/core/drift.ts','');
  work.write(plan,legacy+" export type Status = 'x'|'y'|'z';");
  work.write(room,table('First')+'\n'+table('Second')+"\nexport type Status = 'x'|'y'|'z';");
  assert.throws(()=>work.approve(correct),/漂移/);
  assert.equal(work.read('vocabulary'),before);
});

test('R8 报告先展示差量，核准后常规棘轮才能收紧且会拦住新的重复',t=>{
  const work=fixture(t),rules=work.read('rules'),before=work.read('vocabulary');
  let result=check(work.root);
  assert.equal(result.status,0,result.stderr);
  assert.doesNotMatch(result.stdout,/扩面差量/);
  result=check(work.root,['--report']);
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/2 个规范键，4 条/);
  assert.match(result.stdout,/src\/room\/words\.ts:2:\d+ object table Second（Object\.hasOwn）/);
  assert.equal(work.read('vocabulary'),before);
  assert.equal(work.approve([...correct].reverse()),4);
  assert.equal(work.read('rules'),rules);
  assert.throws(()=>work.approve(correct),/已经录入/);
  assert.equal(check(work.root).status,0);
  work.write(room,table('First')+'\n'+table('Second')+'\n'+table('Third'));
  assert.equal(check(work.root).status,1);
  assert.match(check(work.root,['--write-baseline']).stderr,/只能删条目/);
  work.write(room,'');
  assert.equal(check(work.root,['--write-baseline']).status,0);
  assert.deepEqual(JSON.parse(work.read('vocabulary')),{schemaVersion:1,objectTables:true,entries:[]});
  work.write(room,table('First'));
  assert.equal(check(work.root).status,1);
});
