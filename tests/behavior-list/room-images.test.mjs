import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readdirSync,realpathSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

const packageRoot = process.env.CHATPET_ROOM_PACKAGE;
const moduleUrl = name => packageRoot ? pathToFileURL(join(packageRoot,'dist/src',name)) : new URL('../../dist/src/'+name,import.meta.url);
const {DesktopImages} = await import(moduleUrl('desktop/images.js'));
const {RoomImages,televisionImage} = await import(moduleUrl('room/images.js'));

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(),'her-world-images-')));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const paths = {a:join(root,'a'),b:join(root,'b')};
  mkdirSync(paths.a);
  mkdirSync(paths.b);
  let workspace = 'a', generation = 1;
  const host = {workspace:{homeScope:()=>({
    workspaceId:workspace,storageId:workspace,path:paths[workspace],bootId:'images-fixture',generation,
  })}};
  return {host, paths, bind(id) {workspace=id;generation++;},
    directory: (owner,id='a') => join(paths[id],'.chatpet/data',owner,'images')};
}

function attachments() {
  const objects = new Map();
  return {objects,async admitPromptContent([image]) {
    const ref = createHash('sha256').update(image.data).digest('hex');
    objects.set(ref,image);
    return [{type:'image',attachment:{id:ref,mediaType:image.mediaType}}];
  }};
}

const image = bytes => ({data:Buffer.alloc(bytes).toString('base64'),mediaType:'image/png'});

test('Room 与桌宠图片分目录准入，重建附件后可从原副本恢复',async t=>{
  const f = fixture(t), first = attachments();
  for (const [owner,Images] of [['desktop',DesktopImages],['room',RoomImages]]) {
    const images = new Images(f.host,()=>first), original = image(owner==='desktop'?3:6);
    const content = await images.admit(original);
    assert.deepEqual(await images.admit(original),content);
    const names = readdirSync(f.directory(owner));
    assert.equal(names.length,1);
    assert.match(names[0],/^[a-f0-9]{64}\.json$/);

    const fresh = attachments();
    await new Images(f.host,()=>fresh).restore();
    assert.deepEqual(fresh.objects.get(content[0].attachment.id),{type:'image',...original});
    assert.equal(fresh.objects.size,1);
  }
});

test('Room 与桌宠拒绝空图、越界及取消，保留各自大小上限',async t=>{
  const f = fixture(t), native = attachments();
  const desktop = new DesktopImages(f.host,()=>native), room = new RoomImages(f.host,()=>native);
  await new RoomImages(f.host,()=>undefined).restore();  // 新设备、空目录，无原生附件服务也可打开
  assert.deepEqual(readdirSync(f.directory('room')),[]);
  await assert.rejects(desktop.admit(image(0)),/无效或过大/);
  const stop = AbortSignal.abort();
  await assert.rejects(room.admit(image(1),()=>stop.throwIfAborted()),{name:'AbortError'});
  assert.equal(native.objects.size,0);
  assert.equal(existsSync(f.directory('desktop')),false);

  const desktopBytes = (1024*1024/4)*3;
  await desktop.admit(image(desktopBytes));
  await assert.rejects(desktop.admit(image(desktopBytes+1)),/无效或过大/);
  const roomBytes = 2.5*1024*1024;
  const dataUrl = value => 'data:'+value.mediaType+';base64,'+value.data;
  await room.admit(televisionImage(dataUrl(image(roomBytes))));
  assert.throws(()=>televisionImage(dataUrl(image(roomBytes+1))),/截图格式无效/);
  await assert.rejects(room.admit(image(roomBytes+3)),/无效或过大/);
  for (const owner of ['room','desktop']) assert.equal(readdirSync(f.directory(owner)).length,1);
});

test('Room 图片准入返回时复核绑定代次，原 A 的结果不会写入新 A',async t=>{
  const f = fixture(t), entered = Promise.withResolvers(), release = Promise.withResolvers(), native = attachments();
  const room = new RoomImages(f.host,()=>({async admitPromptContent(content) {
    entered.resolve();
    await release.promise;
    return native.admitPromptContent(content);
  }}));
  const stale = assert.rejects(room.admit(image(1)),/工作区已切换/);
  try {
    await entered.promise;
    f.bind('b');
    await new RoomImages(f.host,()=>native).admit(image(2));
    f.bind('a');
  } finally {release.resolve();}
  await stale;
  assert.deepEqual(readdirSync(f.directory('room')),[]);
  assert.equal(readdirSync(f.directory('room','b')).length,1);
  await room.admit(image(3));
  assert.equal(readdirSync(f.directory('room')).length,1);
});

test('Room 图片拒绝越过目录所有者的符号链接',async t=>{
  const f = fixture(t), native = attachments();
  const desktop = new DesktopImages(f.host,()=>native);
  await desktop.restore();
  mkdirSync(join(f.paths.a,'.chatpet/data/room'));
  symlinkSync(f.directory('desktop'),f.directory('room'),'dir');
  await assert.rejects(new RoomImages(f.host,()=>native).admit(image(1)),/路径无效/);
  assert.deepEqual(readdirSync(f.directory('desktop')),[]);
  assert.equal(native.objects.size,0);
});
