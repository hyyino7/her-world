import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { VoiceTable } from '../../src/core/tables/voice.js';
import type { VoiceProvider } from '../../src/contracts/voice.js';
import { Room } from '../../src/room/plugin.js';
import { roomAsset } from '../../src/room/assets.js';

test('Room serves original Pet speech controls with a finite authenticated voice transport',async()=>{
  const html=await roomAsset(new Request('http://localhost/chatpet-room/index.html'));
  assert.equal(html.status,200);const content=await html.text();
  assert.ok(content.includes('./shared-core.js'));assert.ok(content.includes('./voice-client.js'));
  const transport=await roomAsset(new Request('http://localhost/chatpet-room/native-room.js'));
  assert.equal(transport.status,200);
  const adapter = await import('data:text/javascript,' + encodeURIComponent(await transport.text()));
  assert.equal(adapter.roomVoicePath,'/api/room/voice');
  assert.deepEqual([...adapter.roomVoiceOperations],['hear','speak','voices']);
  const voice=await roomAsset(new Request('http://localhost/chatpet-room/voice-client.js'));
  assert.equal(voice.status,200);const script=await voice.text();
  assert.ok(script.includes('createHearControl'));assert.ok(script.includes('speakText'));
  assert.equal((await roomAsset(new Request('http://localhost/chatpet-room/shared-core.js'))).status,200);
});

test('Room voice delegates hear/speak to the shared service and never admits its own chat turn',async t=>{
  const root=mkdtempSync(join(tmpdir(),'room-voice-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const audio=join(root,'voice.mp3');writeFileSync(audio,'audio fixture');
  let workspace='a', called=0, complete!:()=>void;
  const service:VoiceProvider={availability:()=>({speak:true,hear:true}),async handle(input) {
    called++;assert.equal(input.method,'POST');assert.equal(input.signal?.aborted,false);
    if(input.rest==='voice/hear')return {kind:'json',status:200,obj:{ok:true,text:'spoken text'}};
    await new Promise<void>(resolve=>{complete=resolve;});
    return {kind:'file',file:audio,contentType:'audio/mpeg'};
  }};
  const scope=new Context(),voiceTable=new VoiceTable();
  t.after(voiceTable.register(scope,service).revoke);
  const context={on:()=>()=>{},get:()=>undefined,root:scope,[Context.isolate]:scope[Context.isolate],
    petCore:{workspace:{status:()=>({state:'ready',target:{id:workspace,path:root}}),storageId:()=>workspace,
      homeScope:()=>({workspaceId:workspace,path:root,storageId:workspace,bootId:'fixture',generation:0})},native:{voiceTable}},
  } as unknown as Context;
  const room=new Room(context),signal=new AbortController().signal;
  assert.deepEqual(await room.request('a','roomVoice',{operation:'hear',payload:{audio:'AQI='}},'hear',signal),{ok:true,text:'spoken text'});
  const pending=room.request('a','roomVoice',{operation:'speak',payload:{text:'reply'}},'speak',signal);
  await new Promise(resolve=>setImmediate(resolve));workspace='b';complete();
  await assert.rejects(pending,/工作区或身体组件已切换/);assert.equal(called,2);
  assert.equal(readFileSync(audio,'utf8'),'audio fixture');
});
