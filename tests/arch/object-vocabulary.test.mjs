import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {repository,workspace} from './helpers.mjs';
import {scan} from '../../scripts/arch/lib/scan.mjs';

test('R8 从真实声明提取领域、展开后的领域子表及计划和阅读词表',t=>{
  const contents=Object.fromEntries(['behavior','interaction'].map(name=>{
    const file=`src/contracts/${name}.ts`;
    return [file,readFileSync(join(repository,file),'utf8')];
  }));
  const work=workspace(t,{...contents,'src/room/copy.ts':`
    export const manual = {body: false, economy: {enabled: true}} satisfies Record<string, unknown>;
    export function find(key: keyof typeof manual) { return manual[key]; }
    export type Trade = 'buy' | 'sell' | 'consume';
  `});
  const result=scan(work.root,{objectTables:true});
  const tables=new Map(result.definitions.filter(row=>row.shape==='object table').map(row=>[row.table,row.values]));
  assert.deepEqual(tables.get('FACT_DOMAINS'),['body','economy']);
  assert.deepEqual(tables.get('BODY_ACTIONS'),['command','feed','lamp','pet','play','poke','sleep','talk','wake','water']);
  assert.deepEqual(tables.get('FACT_DOMAINS.body'),[...tables.get('BODY_ACTIONS'),'go','heal','place','sick','visit'].sort());
  assert.deepEqual(tables.get('FACT_DOMAINS.economy'),['item-gift','money-grant','purchase','reading-import','sale']);
  assert.deepEqual(tables.get('PLAN_KINDS'),['body','economy','garden','hold','move','read','room']);
  assert.deepEqual(tables.get('PLAN_ECONOMY_OPERATIONS'),['buy','consume','sell']);
  assert.deepEqual(tables.get('READING_STATES'),['confirmed','offered','unread']);
  assert.ok([...tables.keys()].every(name=>!name.startsWith('PLAN_KINDS.')));
  const rows=result.objectTableRelations;
  assert.ok(rows.some(row=>row.table==='FACT_DOMAINS'&&row.other.table==='manual'&&row.relation==='重复'));
  assert.ok(rows.some(row=>row.table==='manual'&&row.other.table==='PLAN_KINDS'&&row.relation==='子集'));
  assert.ok(rows.some(row=>row.shape==='union'&&row.other.table==='PLAN_ECONOMY_OPERATIONS'));
  assert.ok(rows.every(row=>row.file!==row.other.file));
  assert.deepEqual(result.legacyVocabulary,work.scan().vocabulary);
});

test('R8 只收键被使用的静态声明，缺失或不唯一的展开整表拒绝',t=>{
  const work=workspace(t,{
    'src/contracts/base.ts':`const base = {a: true, b: false}; export {base as flags};`,
    'src/contracts/ambiguous.ts':`export const base = {a: true};`,
    'src/contracts/ambiguous.js':`export const base = {b: true};`,
    'src/contracts/example.ts':`
      import {flags as named} from './base.js';
      import {base as ambiguous} from './ambiguous.js';
      import {flags as absent} from './missing.js';
      import {flags as external} from 'external';
      declare const dynamic: string;
      const local = {c: true, b: {value: 1}};
      const valid = {...named, ...local, ['d']: false} as const; Object.entries(valid);
      const byIndex = {go: false, stay: {enabled: true}} satisfies Record<string, unknown>;
      export const lookup = byIndex[dynamic as keyof typeof byIndex];
      const withChild = {a: {up: true, down: false}, b: {left: true, right: false}} as const;
      export type Vertical = keyof (typeof withChild)['a'];
      const byType = {first: true, second: false} as const;
      export type Choice = (typeof byType)['first'|'second'];
      const empty = {} as const; Object.keys(empty);
      const single = {x: true} as const; Object.keys(single);
      const plain = {a: true, b: true}; Object.keys(plain);
      const config = {a: true, b: false} as const; config.a;
      const calculated = {a: true, b: true, [dynamic]: true} as const; Object.keys(calculated);
      const lookupSpread = {a: true, b: true, ...makeFlags()} as const; Object.keys(lookupSpread);
      const cycle = {a: true, b: true, ...cycle} as const; Object.keys(cycle);
      const duplicateFile = {a: true, b: true, ...ambiguous} as const; Object.keys(duplicateFile);
      const unresolved = {a: true, b: true, ...absent} as const; Object.keys(unresolved);
      const packageSpread = {a: true, b: true, ...external} as const; Object.keys(packageSpread);
      const alias = valid satisfies Record<string, unknown>; Object.hasOwn(alias, dynamic);
      const list = ['a','b','c'] as const; Object.keys(list);
      const derived = Object.keys(valid); Object.keys(derived);
      const shadowed = {first: true, second: false} as const;
      function check(shadowed: object) { return Object.keys(shadowed); }
      function fakeObject(Object: any) { Object.keys(shadowed); }
    `,
  });
  const result=scan(work.root,{objectTables:true});
  assert.deepEqual(new Map(result.definitions.filter(row=>row.shape==='object table').map(row=>[row.table,row.values])),
    new Map([['valid',['a','b','c','d']],['byIndex',['go','stay']],['withChild.a',['down','up']],['byType',['first','second']]]));
  assert.ok(result.definitions.some(row=>row.shape==='array'));
});
