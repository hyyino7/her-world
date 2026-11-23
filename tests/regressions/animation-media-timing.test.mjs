import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {animationMapURL} from '../fixtures/playback.mjs';

const {animationAssets}=await import(animationMapURL);
const read=file=>JSON.parse(readFileSync(file,'utf8'));
const catalog=read('src/desktop/assets/catalog.json');
const original=Object.values(read('vendor/dsh-pet/origin.json').assets);
const life=read('src/desktop/assets/life-animations.json').animations;
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

// Independent audit fixture: all 122 pinned WebM containers were read through
// their Info Duration/TimestampScale (not by the production build reader).
// The short sigh was also checked with the existing encoder's metadata-only -i.
// Hash checks below bind these values to those exact, unchanged media bytes.
const checkedShortDurations=new Map([
  ['sigh',4917],['吃饭·碗饭',5125],['吃饭团',5125],['期待开饭',5125],
]);
const checkedLifeIds=new Set(['life-drink','life-read','life-garden-till','life-garden-plant',
  'life-garden-water','life-garden-fertilize','life-garden-harvest','life-trade']);

test('all 122 published animation timings match independently checked immutable WebM containers',()=>{
  assert.equal(catalog.actions.length,122);
  assert.equal(Object.keys(animationAssets).length,122);
  const counts=new Map();
  for(const action of catalog.actions){
    const asset=animationAssets[action.id];
    assert.ok(asset,action.id);
    assert.equal(asset.file,action.file,action.id+' file pairing');
    assert.equal(asset.desktopClip,action.label,action.id+' label pairing');
    const pinned=checkedLifeIds.has(action.id)?life.find(row=>row.id===action.id):original.find(row=>row.file===action.file);
    assert.ok(pinned,'Pinned media provenance: '+action.id);
    const bytes=readFileSync(join('src/desktop/assets',action.file));
    assert.equal(sha256(bytes),pinned.sha256,action.id+' original media bytes');
    const expected=checkedLifeIds.has(action.id)?2000:checkedShortDurations.get(action.id)??10042;
    assert.equal(asset.durationMs,expected,action.id+' container Duration in milliseconds');
    if(checkedLifeIds.has(action.id))assert.equal(pinned.durationMs,expected,action.id+' Life manifest timing');
    counts.set(expected,(counts.get(expected)??0)+1);
  }
  assert.deepEqual(Object.fromEntries(counts),{2000:8,4917:1,5125:3,10042:110});
});
