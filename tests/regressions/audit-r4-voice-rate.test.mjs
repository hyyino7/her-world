import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createVoiceService} from '../../dist/src/voice/upstream/host/voice/speak.js';

for(const [rate,allowed] of [['-50%',true],['-51%',false],['-100%',false],['+100%',true],['+101%',false],['+999%',false],['+0%',true],['--1%',false]]) {
  test(`R4: native voice rate ${rate} ${allowed?'preserves':'rejects'} the signed range before synthesis`,async t=>{
    const root=mkdtempSync(join(tmpdir(),'voice-rate-code-'));let calls=0;
    t.after(()=>rmSync(root,{recursive:true,force:true}));
    const voice=createVoiceService({userRoot:root,synthesize:async input=>{calls++;assert.equal(input.rate,rate);await writeFile(input.target,Buffer.from('fixture audio'));}});
    const result=await voice.speak({text:'Disposable fixture',rate});
    assert.equal(result.ok,allowed);assert.equal(calls,allowed?1:0);
    if(!allowed)assert.equal(result.reason,'bad-request');
  });
}
