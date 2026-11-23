import { constants, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual as equal } from 'node:util';
import { DEFAULT_COMPANION_SETTINGS, type CompanionSettings } from '../../core/companion-settings.js';

type Json = Record<string, unknown>;
export interface PresentationConfigPaths { userFile: string; legacyUserFile?: string; defaultFile: string; petDir?: string }
export interface PresentationConflict { field: string; legacy: unknown; current: unknown }
export interface PresentationMigrationReceipt {
  schema: 1;
  status: 'complete' | 'conflicts';
  configFile: string;
  backup: string | null;
  originalHash: string;
  legacyHash: string;
  configHash: string;
  changes: {field:string;legacy:unknown;previous:unknown}[];
  conflicts: PresentationConflict[];
  preserved: string[];
  bodyId: string;
  pending?: boolean;
  beforeHash?: string;
}
export interface PresentationResolution { field: string; choice: 'legacy' | 'current' }
const require=createRequire(import.meta.url),root=dirname(require.resolve('her-world/package.json'));
const upstream=require(join(root,'vendor/dsh-pet/platform/runtime.mjs')) as {
  readJsonc(path:string):unknown;
  topFieldValid(key:string,value:unknown):boolean;
};
const object=(value:unknown):value is Json=>Boolean(value && typeof value==='object' && !Array.isArray(value));
const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const receiptName='presentation-migration.json',backupName='presentation-before-unification.jsonc';
const forbidden=new Set(['__proto__','prototype','constructor']);
const fieldOf=(path:string[])=>path.map(part=>encodeURIComponent(part).replaceAll('.','%2E')).join('.');
const pathOf=(field:string)=>field.split('.').map(part=>decodeURIComponent(part));
function privateDirectory(directory:string) {
  mkdirSync(directory,{recursive:true,mode:0o700});
  const stat=lstatSync(directory);
  if(!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(directory)!==resolve(directory))throw Error('Presentation migration directory must be local');
}
function local(directory:string,path:string) {
  if(dirname(resolve(path))!==resolve(directory))throw Error('Presentation configuration must stay in its owning directory');
  return resolve(path);
}
function bytes(path:string):Buffer|undefined {
  if(!existsSync(path))return;
  const stat=lstatSync(path);
  if(!stat.isFile() || stat.isSymbolicLink() || stat.nlink!==1 || stat.size>4_194_304)throw Error('Unexpected presentation configuration file; original retained');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{return readFileSync(fd);}finally{closeSync(fd);}
}
function atomic(path:string,body:string,expectedHash?:string) {
  if(expectedHash!==undefined && digest(bytes(path) ?? 'absent')!==expectedHash)throw Error('Presentation configuration changed; refresh before saving');
  const temp=path+'.'+randomUUID()+'.tmp',fd=openSync(temp,'wx',0o600);
  try{writeFileSync(fd,body);fsyncSync(fd);}finally{closeSync(fd);}
  try{renameSync(temp,path);}finally{if(existsSync(temp))unlinkSync(temp);}
}
function parse(path:string):Json {
  if(typeof upstream.readJsonc!=='function' || typeof upstream.topFieldValid!=='function')throw Error('Rebuild the pinned Pet configuration adapters before migrating');
  const value=upstream.readJsonc(path);
  if(!object(value))throw Error('Presentation JSONC could not be parsed; original retained');
  return structuredClone(value);
}
function paths(directory:string,input?:Partial<PresentationConfigPaths>):PresentationConfigPaths {
  return {userFile:local(directory,input?.userFile ?? join(directory,'main-config.jsonc')),
    legacyUserFile:local(directory,input?.legacyUserFile ?? join(directory,'main-config.json')),
    defaultFile:input?.defaultFile ?? join(root,'vendor/dsh-pet/platform/assets/config.jsonc'),petDir:input?.petDir};
}
function get(document:Json,path:string[]):unknown {
  let value:unknown=document;
  for(let index=0;index<path.length;index++){
    const part=path[index];
    if(part==='pets'){
      const id=path[++index];if(!object(value)||!Array.isArray(value.pets))return;
      value=value.pets.find(row=>object(row)&&row.id===id);continue;
    }
    if(!object(value)||!Object.hasOwn(value,part))return;
    value=value[part];
  }
  return value;
}
function set(document:Json,path:string[],value:unknown) {
  if(path.some(key=>forbidden.has(key)))throw Error('Invalid presentation migration field');
  let target=document;
  for(let index=0;index<path.length-1;index++){
    const part=path[index];
    if(part==='pets'){
      const id=path[++index];if(!Array.isArray(target.pets))target.pets=[];
      let pet=(target.pets as unknown[]).find(row=>object(row)&&row.id===id);
      if(!pet){pet={id,name:id};(target.pets as unknown[]).push(pet);}
      if(!object(pet))throw Error('Invalid primary presentation body');target=pet;continue;
    }
    if(target[part]!==undefined&&!object(target[part]))throw Error('Presentation configuration contains a conflicting section');
    if(!object(target[part]))target[part]={};target=target[part] as Json;
  }
  target[path.at(-1)!]=structuredClone(value);
}
function receiptFile(directory:string) {return join(directory,receiptName);}
function readReceipt(directory:string):PresentationMigrationReceipt|undefined {
  const raw=bytes(receiptFile(directory));if(!raw)return;
  const value=JSON.parse(raw.toString('utf8')) as PresentationMigrationReceipt;
  if(value.schema!==1 || !['complete','conflicts'].includes(value.status) || !Array.isArray(value.changes) || !Array.isArray(value.conflicts) || typeof value.configFile!=='string')throw Error('Presentation migration receipt is invalid; retained for repair');
  local(directory,value.configFile);if(value.backup)local(directory,value.backup);
  return value;
}
function saveReceipt(directory:string,receipt:PresentationMigrationReceipt) {atomic(receiptFile(directory),JSON.stringify(receipt,null,2)+'\n');}
function refreshReceipt(directory:string,receipt:PresentationMigrationReceipt) {
  const currentHash=digest(bytes(receipt.configFile) ?? 'absent');
  if(receipt.pending){
    if(currentHash===receipt.beforeHash){
      const document=existsSync(receipt.configFile)?parse(receipt.configFile):receipt.backup?parse(receipt.backup):{};
      for(const change of receipt.changes)set(document,pathOf(change.field),change.legacy);
      const body=JSON.stringify(document,null,2)+'\n';
      if(digest(body)!==receipt.configHash)throw Error('Presentation migration recovery differs; original files retained');
      atomic(receipt.configFile,body,currentHash);
    }else if(currentHash!==receipt.configHash)throw Error('Presentation configuration changed during migration; original files retained');
    delete receipt.pending;delete receipt.beforeHash;saveReceipt(directory,receipt);return receipt;
  }
  if(currentHash!==receipt.configHash){
    const document=parse(receipt.configFile);
    receipt.conflicts=receipt.conflicts.flatMap(conflict=>{
      const current=get(document,pathOf(conflict.field));
      return equal(current,conflict.legacy)?[]:[{...conflict,current:current ?? null}];
    });
    receipt.configHash=currentHash;receipt.status=receipt.conflicts.length?'conflicts':'complete';saveReceipt(directory,receipt);
  }
  return receipt;
}
interface Candidate {path:string[];value:unknown;legacyDefault:unknown;platformDefault:unknown;knownDefault?:unknown}
/** One-time, field-level reconciliation. Unknown fields and pet packs never pass through the upstream whitelist writer. */
export function migratePresentation(directory:string,prefs:CompanionSettings,input?:Partial<PresentationConfigPaths>):PresentationMigrationReceipt {
  privateDirectory(directory);
  const existing=readReceipt(directory);if(existing)return structuredClone(refreshReceipt(directory,existing));
  const config=paths(directory,input),originalFile=existsSync(config.userFile)?config.userFile:config.legacyUserFile&&existsSync(config.legacyUserFile)?config.legacyUserFile:undefined;
  const original=originalFile?bytes(originalFile):undefined,document=originalFile?parse(originalFile):{};
  const defaults=parse(config.defaultFile),defaultPet=Array.isArray(defaults.pets)&&object(defaults.pets[0])?defaults.pets[0]:{};
  if(document.pets!==undefined && (!Array.isArray(document.pets)||document.pets.some(row=>!object(row))))throw Error('Invalid presentation bodies; original retained');
  const pets=Array.isArray(document.pets)?document.pets as Json[]:[];
  const primary=pets.find(pet=>pet.id==='main') ?? pets[0];
  if(primary && (typeof primary.id!=='string'||!primary.id||forbidden.has(primary.id)))throw Error('Primary presentation body identity requires explicit repair');
  const bodyId=primary?String(primary.id):'main',p=(key:string)=>['pets',bodyId,key];
  const candidates:Candidate[]=[];
  const add=(path:string[],value:unknown,legacyDefault:unknown,platformDefault:unknown,knownDefault?:unknown)=>{
    if (pets.length === 0) return;
    if(value!==undefined)candidates.push({path,value,legacyDefault,platformDefault,knownDefault});
  };
  for(const [legacy,target] of [['desktopSize','size'],['desktopFixed','fixedEnabled'],['desktopWorkStatusEnabled','workStatusEnabled'],['desktopWhisperEnabled','whisperEnabled'],['desktopBalanceEnabled','balanceEnabled']] as const)
    add(p(target),prefs[legacy],DEFAULT_COMPANION_SETTINGS[legacy],defaultPet[target],target==='size'?232:['whisperEnabled','balanceEnabled'].includes(target)?false:undefined);
  for(const [legacy,target] of [['desktopTrayEnabled','trayEnabled'],['desktopClickSound','clickSoundEnabled'],['desktopConfineToScreen','confineToScreen'],['desktopWhisperImageEnabled','whisperImageEnabled']] as const)
    add([target],prefs[legacy],DEFAULT_COMPANION_SETTINGS[legacy],defaults[target]);
  for(const [legacy,target,multiplier] of [['desktopWhisperMinutes','whisper',60],['desktopSleepTalkSeconds','sleepTalk',1],['desktopBalanceMinutes','balance',60]] as const)
    add(['eventsRefreshSec',target],prefs[legacy]*multiplier,DEFAULT_COMPANION_SETTINGS[legacy]*multiplier,object(defaults.eventsRefreshSec)?defaults.eventsRefreshSec[target]:undefined);
  const appearanceDefaults=JSON.parse(readFileSync(join(root,'src/desktop/assets/interaction.json'),'utf8')) as Json;
  const catalog=JSON.parse(readFileSync(join(root,'src/desktop/assets/catalog.json'),'utf8')) as {actions:{id:string;label:string}[]};
  const labels=new Map(catalog.actions.map(asset=>[asset.id,asset.label]));
  const translate=(value:unknown):unknown=>typeof value==='string'?labels.get(value) ?? value:Array.isArray(value)?value.map(translate):object(value)?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,['id','label','description'].includes(key)?item:translate(item)])):value;
  const visit=(value:unknown,oldDefault:unknown,path:string[],platformDefault:unknown)=>{
    if(equal(value,oldDefault))return;
    if(object(value)){
      if(!object(oldDefault))throw Error('Unknown legacy appearance section; original retained');
      for(const [key,child] of Object.entries(value)){
        if(!Object.hasOwn(oldDefault,key)||forbidden.has(key))throw Error('Unknown legacy appearance field; original retained');
        visit(child,oldDefault[key],[...path,key],object(platformDefault)?platformDefault[key]:undefined);
      }
    }else {
      const syntheticPosition:Json={corner:'bottom-right',marginX:50,marginY:70};
      const knownDefault=path[0]==='pets'&&path[2]==='position'?syntheticPosition[path[3]]:undefined;
      add(path,path[0]==='animations'?translate(value):value,path[0]==='animations'?translate(oldDefault):oldDefault,platformDefault,knownDefault);
    }
  };
  for(const [key,value] of Object.entries(prefs.desktopAppearance ?? {})){
    if(!Object.hasOwn(appearanceDefaults,key))throw Error('Unknown legacy appearance field; original retained');
    visit(value,appearanceDefaults[key],key==='position'?p('position'):[key],key==='position'?defaultPet.position:defaults[key]);
  }
  const receipt:PresentationMigrationReceipt={schema:1,status:'complete',configFile:config.userFile,backup:original?join(directory,backupName):null,
    originalHash:digest(original ?? 'absent'),legacyHash:digest(JSON.stringify(prefs)),configHash:'',changes:[],conflicts:[],bodyId,
    preserved:['desktopReplyBubble','desktopBubbleSeconds']};
  for(const candidate of candidates){
    const current=get(document,candidate.path),legacyChanged=!equal(candidate.value,candidate.legacyDefault),field=fieldOf(candidate.path);
    if(equal(current,candidate.value))continue;
    // Equality with a shipped default does not prove that the owner never saved
    // that value. Explicit existing fields require a concrete conflict choice.
    if(current===undefined){
      if(candidate.path[0]!=='pets' && candidate.path.length>1 && document[candidate.path[0]]===undefined && object(defaults[candidate.path[0]])){
        document[candidate.path[0]]=structuredClone(defaults[candidate.path[0]]);
        receipt.changes.push({field:fieldOf([candidate.path[0]]),legacy:structuredClone(defaults[candidate.path[0]]),previous:null});
      }
      set(document,candidate.path,candidate.value);receipt.changes.push({field,legacy:candidate.value,previous:current ?? null});
    }else if(legacyChanged)receipt.conflicts.push({field,legacy:candidate.value,current});
  }
  // Check the complete migrated shared sections with the original schema facilities before any configuration write.
  for(const key of new Set(candidates.map(candidate=>candidate.path[0]).filter(key=>key!=='pets'))){
    const value=document[key];if(value!==undefined&&!upstream.topFieldValid(key,value))throw Error('Migrated presentation section is invalid: '+key);
  }
  const body=JSON.stringify(document,null,2)+'\n',beforeHash=digest(bytes(config.userFile) ?? 'absent');
  receipt.status=receipt.conflicts.length?'conflicts':'complete';receipt.configHash=digest(body);
  if(receipt.backup){
    const prior=bytes(receipt.backup);
    if(prior && digest(prior)!==receipt.originalHash)throw Error('Existing presentation migration backup differs; original retained');
    if(!prior){const fd=openSync(receipt.backup,'wx',0o400);try{writeFileSync(fd,original!);fsyncSync(fd);}finally{closeSync(fd);}}
  }
  receipt.pending=true;receipt.beforeHash=beforeHash;saveReceipt(directory,receipt);
  atomic(config.userFile,body,beforeHash);
  delete receipt.pending;delete receipt.beforeHash;saveReceipt(directory,receipt);
  return structuredClone(receipt);
}
/** Resolve only named recorded conflicts, preserving every other current field and the immutable original backup. */
export function resolvePresentationMigration(directory:string,choices:readonly PresentationResolution[],_paths?:Partial<PresentationConfigPaths>,expectedHash?:string):PresentationMigrationReceipt {
  privateDirectory(directory);
  const stored=readReceipt(directory);if(!stored)throw Error('Run presentation migration before resolving conflicts');
  if(expectedHash && digest(bytes(stored.configFile) ?? 'absent')!==expectedHash)throw Error('Presentation configuration changed; refresh before choosing');
  const receipt=refreshReceipt(directory,stored),before=bytes(receipt.configFile),hash=digest(before ?? 'absent'),document=parse(receipt.configFile);
  const selected=new Set<string>();
  for(const choice of choices){
    if(selected.has(choice.field)||!['legacy','current'].includes(choice.choice))throw Error('Invalid migration conflict choice');
    selected.add(choice.field);
    const conflict=receipt.conflicts.find(row=>row.field===choice.field);if(!conflict)throw Error('Presentation conflict changed; refresh before choosing');
    if(choice.choice==='legacy')set(document,pathOf(choice.field),conflict.legacy);
  }
  for(const key of new Set(choices.map(choice=>pathOf(choice.field)[0]).filter(key=>key!=='pets'))){
    if(!upstream.topFieldValid(key,document[key]))throw Error('Selected presentation section is invalid: '+key);
  }
  const body=JSON.stringify(document,null,2)+'\n';atomic(receipt.configFile,body,hash);
  receipt.conflicts=receipt.conflicts.filter(conflict=>!selected.has(conflict.field));receipt.configHash=digest(body);
  receipt.status=receipt.conflicts.length?'conflicts':'complete';saveReceipt(directory,receipt);return structuredClone(receipt);
}
