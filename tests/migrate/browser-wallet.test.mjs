import test from 'node:test';
import assert from 'node:assert/strict';
import fs, {existsSync, mkdtempSync, readFileSync, realpathSync, rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {exportWalletSources, readWalletExport, reconcileWalletSources} from '../../scripts/migrate/browser-wallet.mjs';
import {atomicWrite, hash, json} from '../../scripts/migrate/io.mjs';

const fixedBinding = {storageId:'synthetic-storage',companionId:'synthetic-companion',workspaceId:'world',
  repoHash:hash('synthetic-repo'),profileHash:hash('synthetic-profile'),scopeId:'synthetic-scope',ownerActorId:'synthetic-owner'};
const first = JSON.stringify({endpoint:'economyAction',requestId:'original-1',input:{workspaceId:'world',action:{kind:'grant',amount:7}}});
const second = JSON.stringify({endpoint:'economyAction',requestId:'original-2',input:{workspaceId:'world',
  action:{kind:'importReading',title:'Synthetic reading',content:'A synthetic private passage.',source:{kind:'owner-import',name:'synthetic.md'}}}});
const script = fileURLToPath(import.meta.url);

function setup(root, suppliedRound) {
  const file = join(root,'wallet-export.json'), state = join(root,'browser-state.json');
  const round = suppliedRound ?? randomUUID();
  const sources = ['browser-a','browser-b','browser-empty'].map(name => ({profile:join(root,name),
    origin:'http://127.0.0.1:32100',key:'chatpet:economy:pending:world'}));
  const key = source => source.profile;
  const read = source => json(state).slots[key(source)]?.raw;
  const save = document => atomicWrite(state,JSON.stringify(document));
  const lockFile = join(root,'browser.lock.sqlite');
  function acquire() {
    const db = new DatabaseSync(lockFile);
    try { db.exec('BEGIN IMMEDIATE'); }
    catch (error) { db.close(); throw error; }
    let leased = true;
    return {
      assertFrozen() { const {frozen,drained} = json(state); return leased && frozen && drained; },
      read,
      compareAndSet(source,expected,next) {
        const document = json(state), slot = document.slots[key(source)];
        if (!leased || slot.raw !== expected) return false;
        slot.raw = next; slot.writes++; save(document);
        return true;
      },
      release() { leased = false; db.close(); },
    };
  }
  function oldTabWrites(source,raw) {
    const document = json(state);
    if (document.frozen) return false;
    document.slots[key(source)].raw = raw;
    save(document);
    return true;
  }
  if (!existsSync(state)) save({frozen:true,drained:true,slots:Object.fromEntries(sources.map((source,index) =>
    [key(source),{raw:[first,second,null][index],writes:0}]))});
  const complete = {clear:join(root,'import-verified'),restore:join(root,'rollback-verified')};
  const verify = ({wallet,mode}) => existsSync(complete[mode]) && readFileSync(complete[mode],'utf8') === wallet.digest;
  return {
    file, round, sources, state, read, save, oldTabWrites, complete,
    capture: (override = {}) => exportWalletSources({file,binding:fixedBinding,round,sources,acquire,...override}),
    reconcile: (mode,override = {}) => reconcileWalletSources({file,journal:join(root,mode+'.json'),
      binding:fixedBinding,sources,acquire,mode,verify,...override}),
  };
}

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(),'browser-wallet-')));
  t.after(() => rmSync(root,{recursive:true,force:true}));
  return {root,...setup(root)};
}

if (process.argv[1] === script && process.argv[2] === '--crash') {
  const [, , , root, round, phase] = process.argv;
  const f = setup(root,round);
  const rename = fs.renameSync;
  fs.renameSync = (from,to) => {
    if (phase === 'export' && to === f.file) process.kill(process.pid,'SIGKILL');
    rename(from,to);
    if (phase !== 'export' && to === f.state) process.kill(process.pid,'SIGKILL');
  };
  syncBuiltinESMExports();
  if (phase === 'export') await f.capture();
  else await f.reconcile(phase);
} else {
  test('合成浏览器在原值导出中断后可重新导出，同号规范内容只导一笔', async t => {
    const f = fixture(t);
    const duplicate = '{"input":{"action":{"amount":7,"kind":"grant"},"workspaceId":"world"},"requestId":"original-1","endpoint":"economyAction"}';
    const document = json(f.state);
    document.slots[f.sources[1].profile].raw = duplicate;
    f.save(document);
    const crash = spawnSync(process.execPath,[script,'--crash',f.root,f.round,'export'],{encoding:'utf8'});
    assert.equal(crash.signal,'SIGKILL',crash.stderr);
    assert.equal(existsSync(f.file),false);
    assert.deepEqual(f.sources.map(f.read),[first,duplicate,null]);
    const wallet = await f.capture();
    assert.deepEqual(wallet.entries.map(row=>row.requestId),['original-1']);
    assert.equal(wallet.sources.length,3);
    assert.notEqual(wallet.sources[0].rawDigest,wallet.sources[1].rawDigest);
    assert.equal(wallet.sources[2].raw,null);
    assert.equal((await f.capture()).digest,wallet.digest);
    assert.equal(fs.statSync(f.file).mode & 0o777,0o600);
    assert.throws(()=>readWalletExport(f.file,{...fixedBinding,profileHash:hash('another-profile')}),{code:'binding-changed'});
  });

  test('合成浏览器部分清源和回插即使未记完成，也按同轮意图续做', async t => {
    const f = fixture(t), wallet = await f.capture();
    for (const [phase,partial,finished] of [
      ['clear',[null,second,null],[null,null,null]],
      ['restore',[first,null,null],[first,second,null]],
    ]) {
      await assert.rejects(f.reconcile(phase),{code:phase === 'clear' ? 'wallet-import-invalid' : 'wallet-rollback-invalid'});
      atomicWrite(f.complete[phase],wallet.digest);
      const crash = spawnSync(process.execPath,[script,'--crash',f.root,f.round,phase],{encoding:'utf8'});
      assert.equal(crash.signal,'SIGKILL',crash.stderr);
      assert.deepEqual(f.sources.map(f.read),partial);
      assert.deepEqual(Object.values(json(join(f.root,phase+'.json')).rows),['intent']);
      assert.equal((await f.reconcile(phase)).complete,true);
      assert.deepEqual(f.sources.map(f.read),finished);
      assert.equal((await f.reconcile(phase)).complete,true);
    }
    assert.deepEqual(Object.values(json(f.state).slots).map(row=>row.writes),[2,2,0]);
    assert.equal(readWalletExport(f.file,fixedBinding).digest,wallet.digest);
  });

  test('缺来源、不可读、异载荷、旧标签竞写和未经证实的排空都拒绝清源或导出', async t => {
    const f = fixture(t);
    await assert.rejects(f.capture({sources:[]}),{code:'wallet-source-missing'});
    await assert.rejects(f.capture({sources:[{...f.sources[0],profile:join(f.root,'unknown')}]}),{code:'wallet-source-unreadable'});
    const original = json(f.state);
    f.save({...original,frozen:false,drained:false});
    assert.equal(f.oldTabWrites(f.sources[0],first),true);
    await assert.rejects(f.capture(),{code:'wallet-freeze-unverified'});
    f.save({...original,drained:false});
    assert.equal(f.oldTabWrites(f.sources[0],second),false);
    await assert.rejects(f.capture(),{code:'wallet-freeze-unverified'});
    f.save(original);
    const wallet = await f.capture();
    atomicWrite(f.complete.clear,wallet.digest);
    await assert.rejects(f.reconcile('clear',{sources:f.sources.slice(0,2)}),{code:'wallet-source-conflict'});
    const changed = json(f.state);
    changed.slots[f.sources[1].profile].raw = null;
    f.save(changed);
    await assert.rejects(f.reconcile('clear'),{code:'wallet-source-conflict'});
    assert.equal(f.read(f.sources[0]),first);
    changed.slots[f.sources[1].profile].raw = first.replace('"amount":7','"amount":9');
    f.save(changed);
    await assert.rejects(f.capture(),{code:'wallet-source-conflict'});
  });

  test('导出前发现已经读过的来源被改写，保留源且不发布导出', async t => {
    const f = fixture(t);
    const acquire = () => ({assertFrozen:() => true, read(source) {
      if (source.profile === f.sources[1].profile) {
        const document = json(f.state);
        document.slots[f.sources[0].profile].raw = second;
        f.save(document);
      }
      return f.read(source);
    }});
    await assert.rejects(f.capture({acquire}),{code:'wallet-source-conflict'});
    assert.equal(existsSync(f.file),false);
    assert.equal(f.read(f.sources[0]),second);
  });

  test('操作意图落盘后冻结失效，续做不能把外部删键当成本轮完成', async t => {
    const f = fixture(t), wallet = await f.capture();
    atomicWrite(f.complete.clear,wallet.digest);
    const journal = join(f.root,'clear.json');
    const acquire = () => ({assertFrozen:() => !existsSync(journal), read:f.read,
      compareAndSet:() => assert.fail('冻结失效后仍删除浏览器键')});
    await assert.rejects(f.reconcile('clear',{acquire}),{code:'wallet-freeze-unverified'});
    const changed = json(f.state);
    changed.slots[f.sources[0].profile].raw = null;
    f.save(changed);
    await assert.rejects(f.reconcile('clear'),{code:'wallet-source-conflict'});
    assert.equal(f.read(f.sources[1]),second);
  });
}
