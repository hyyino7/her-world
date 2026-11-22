import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {workspace} from './helpers.mjs';

const leaf='presentation-shared',source=`src/${leaf}/projection.ts`;
const consumers=['desktop','room','console'];
const importLeaf=`import {projection} from '../${leaf}/projection.js';`;

function fixture(t) {
  const work=workspace(t,{[source]:'export const projection = value => ({value});'});
  const path='arch/layers.json';
  const layers=JSON.parse(readFileSync(join(work.root,path),'utf8'));
  layers.modules[leaf]={layer:3,root:`src/${leaf}/`,sharedLeaf:true,services:[],reads:[],dependencies:[],
    publishes:[],subscribes:[],generated:[]};
  for(const consumer of consumers) {
    layers.modules[consumer].dependencies.push(leaf);
    work.write(`src/${consumer}/projection.ts`,importLeaf);
  }
  const save=()=>work.write(path,JSON.stringify(layers));
  save();
  return {...work,layers,save};
}

test('共用叶子只接受显式登记的 Desktop、Room、Console 实际入边',t=>{
  const work=fixture(t),result=work.scan();
  assert.deepEqual(result.rules,[]);
  assert.deepEqual(result.edges.filter(row=>row.rule==='R1'&&row.to===leaf).map(row=>row.from).sort(),[...consumers].sort());
  work.layers.modules.console.dependencies.pop();
  work.save();
  for(const module of ['channels','voice','living','core'])work.write(`src/${module}/projection.ts`,importLeaf);
  work.write(source,"export {x} from '../desktop/projection.js'; import '../living/projection.js';");
  assert.deepEqual(work.scan().rules.filter(row=>row.rule==='R1').map(row=>[row.from,row.to]),[
    ['channels',leaf],['console',leaf],['core',leaf],['living',leaf],[leaf,'desktop'],[leaf,'living'],['voice',leaf],
  ]);
  work.layers.modules.voice.dependencies.push(leaf);
  work.save();
  assert.throws(()=>work.scan(),/不合规的依赖声明：voice/);
});

test('共用叶子不能登记持久存储或执行已识别的持久写入',t=>{
  const work=fixture(t);
  for(const code of [
    "import {writeFileSync} from 'node:fs'; writeFileSync('.chatpet/data/emotion/state.json','{}');",
    "import {writeFileSync as persist} from 'node:fs'; export const save = path => persist(path,'{}');",
    "export const save = (store,kind) => store.put(kind,{});",
    "export const save = db => db.exec('CREATE TABLE fixture (id TEXT)');",
    "export const save = db => db.prepare('INSERT INTO fixture VALUES (?)').run('x');",
    "export const save = () => localStorage.setItem('fixture','x');",
  ]) {
    work.write(source,code);
    assert.throws(()=>work.scan(),/共用叶子不能持久写入/,code);
  }
  const path='arch/storage.json',storage=JSON.parse(readFileSync(join(work.root,path),'utf8'));
  for(const field of ['owner','containerOwner','writers']) {
    const [entry]=storage.entries;
    const modified={...entry,[field]:field==='writers'?[leaf]:leaf};
    work.write(path,JSON.stringify({...storage,entries:[modified,...storage.entries.slice(1)]}));
    assert.throws(()=>work.scan(),/共用叶子不能登记持久存储/);
  }
});
