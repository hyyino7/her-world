import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,readFileSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {DesktopImages} from '../../dist/src/desktop/images.js';
const app='/Applications/DeepSeek Harness.app/Contents';
if(!process.versions.electron){const result=spawnSync(join(app,'MacOS/DeepSeek Harness'),[fileURLToPath(import.meta.url)],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'inherit'});process.exit(result.status??1);}
const require=createRequire(join(app,'Resources/app.asar/dsh/package.json'));
const {Context}=await import(require.resolve('@deepseek-ai/cordis'));
const {LocalAttachmentStore}=await import(require.resolve('@deepseek-ai/dsh-attachment-local'));
const root=realpathSync(mkdtempSync(join(tmpdir(),'pet-native-images-'))),ctx=new Context();
const repo=join(root,'repo');mkdirSync(repo);mkdirSync(join(repo,'.chatpet'));
let activeRepo=repo;
const fakeHost={workspace:{homeScope:()=>({workspaceId:'repo',storageId:'repo',path:activeRepo,bootId:'fixture',generation:0})}};
const image={mediaType:'image/png',data:readFileSync(new URL('../../src/desktop/assets/cute.png',import.meta.url)).toString('base64')};
try {
  await ctx.plugin(LocalAttachmentStore,{dshHome:join(root,'device-one')});
  const first=new DesktopImages(fakeHost,()=>ctx.attachments),content=await first.admit(image);
  assert.equal(content[0].type,'image');const bytes=await ctx.attachments.readImage(content[0].attachment);assert.ok(bytes.data.length);
  await ctx.fiber.dispose();
  cpSync(repo,join(root,'copied-repo'),{recursive:true});activeRepo=join(root,'copied-repo');
  const second=new Context();await second.plugin(LocalAttachmentStore,{dshHome:join(root,'device-two')});
  try {await new DesktopImages(fakeHost,()=>second.attachments).restore();const restored=await second.attachments.readImage(content[0].attachment);assert.deepEqual(restored.data,bytes.data);}
  finally {await second.fiber.dispose();}
  console.log(JSON.stringify({check:'native-image-admission-and-portable-restore',status:'passed',externalModels:0}));
} finally {await ctx.fiber.dispose();rmSync(root,{recursive:true,force:true});}
