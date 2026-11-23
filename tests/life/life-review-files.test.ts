import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,linkSync,unlinkSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import type {PetCoreHost} from '../../src/core/index.js';
import {assertLifeReviewFile,type LifeReviewFileAccess} from '../../src/living/plan/review-files.js';

function fixture(t:TestContext) {
  const root=mkdtempSync(join(tmpdir(),'life-review-files-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const records=join(root,'.chatpet'),life=join(records,'data/life');
  for(const directory of [join(records,'diary'),join(records,'self.history'),join(records,'data/core'),join(life,'activity'),join(life,'conversations')])mkdirSync(directory,{recursive:true});
  for(const name of ['self.md','diary/2026-11-12.md','diary/2026-11-13.md','self.history/2026-11-12.md'])writeFileSync(join(records,name),'fixture');
  for(const kind of ['activity','conversations'])writeFileSync(join(life,kind,'2026-11-12.jsonl'),'{}\n');
  writeFileSync(join(life,'life.json'),'{}');
  let target={id:'workspace',path:root};
  const host={workspace:{status:()=>({state:'ready',target}),storageId:()=> 'storage'}} as unknown as PetCoreHost;
  const access:LifeReviewFileAccess={workspaceId:target.id,root,storageId:'storage',sessionId:'home',guest:false,reviewDay:'2026-11-12',
    writing:{id:target.id,directory:records,timeZone:'UTC',sessionIds:['home'],isHome:id=>id==='home'}};
  return{root,records,life,host,access,rebind:()=>{target={id:'other',path:join(root,'other')};}};
}
const today=new Date('2026-11-13T05:00:00Z');

test('review reads its existing materials and Core records but writes only self and open diary days',t=>{
  const f=fixture(t);
  for(const name of ['diary','self.history']) {
    assert.doesNotThrow(()=>assertLifeReviewFile(f.host,f.access,'read',join(f.records,name),today));
    assert.throws(()=>assertLifeReviewFile(f.host,f.access,'write',join(f.records,name),today));
  }
  for(const name of ['self.md','diary/2026-11-12.md','diary/2026-11-13.md','self.history/2026-11-12.md'])
    assert.doesNotThrow(()=>assertLifeReviewFile(f.host,f.access,'read',join(f.records,name),today));
  for(const kind of ['activity','conversations'])assert.doesNotThrow(()=>assertLifeReviewFile(f.host,f.access,'read',join(f.life,kind,'2026-11-12.jsonl'),today));
  for(const name of ['self.md','diary/2026-11-13.md'])assert.doesNotThrow(()=>assertLifeReviewFile(f.host,f.access,'write',join(f.records,name),today));
  assert.throws(()=>assertLifeReviewFile(f.host,f.access,'write',join(f.records,'diary/2026-11-12.md'),today),/历史日记已经存在/);
  unlinkSync(join(f.records,'diary/2026-11-12.md'));
  assert.doesNotThrow(()=>assertLifeReviewFile(f.host,f.access,'write',join(f.records,'diary/2026-11-12.md'),today));
  for(const file of [join(f.life,'life.json'),join(f.life,'home.json'),join(f.records,'data/core/core.sqlite'),join(f.records,'data/economy/economy.sqlite'),join(f.records,'USER.md'),join(f.root,'outside.txt')])
    for(const tool of ['read','write'])assert.throws(()=>assertLifeReviewFile(f.host,f.access,tool,file,today));
  for(const name of ['self.history/2026-11-12.md','diary/2026-11-11.md'])assert.throws(()=>assertLifeReviewFile(f.host,f.access,'write',join(f.records,name),today));
  assert.throws(()=>assertLifeReviewFile(f.host,{...f.access,reviewDay:'2026-11-99'},'write',join(f.records,'self.md'),today));
});

test('review rejects traversal, symlinks, hard links, guests and stale workspace bindings',t=>{
  const f=fixture(t),self=join(f.records,'self.md');
  assert.throws(()=>assertLifeReviewFile(f.host,f.access,'write',resolve(f.records,'diary/../../escape.md'),today));
  unlinkSync(self);symlinkSync(join(f.life,'life.json'),self);assert.throws(()=>assertLifeReviewFile(f.host,f.access,'write',self,today));
  unlinkSync(self);linkSync(join(f.life,'life.json'),self);assert.throws(()=>assertLifeReviewFile(f.host,f.access,'write',self,today));
  renameSync(join(f.records,'diary'),join(f.records,'old-diary'));
  symlinkSync(join(f.records,'old-diary'),join(f.records,'diary'));
  assert.throws(()=>assertLifeReviewFile(f.host,f.access,'read',join(f.records,'diary'),today));
  assert.throws(()=>assertLifeReviewFile(f.host,{...f.access,guest:true},'read',join(f.life,'activity/2026-11-12.jsonl'),today));
  f.rebind();assert.throws(()=>assertLifeReviewFile(f.host,f.access,'read',join(f.life,'activity/2026-11-12.jsonl'),today));
});

test('review authorizes the current self file while historical Life files stay out of reach',t=>{
  const f=fixture(t), retired=join(f.life,'self.md');
  writeFileSync(retired,'Historical fixture');
  assert.doesNotThrow(()=>assertLifeReviewFile(f.host,f.access,'write',join(f.records,'self.md'),today));
  for(const tool of ['read','write'])
    assert.throws(()=>assertLifeReviewFile(f.host,f.access,tool,retired,today));
});
