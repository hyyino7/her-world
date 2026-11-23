import {mkdtempSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJson} from './lib/ast.mjs';
import {compareBaseline} from './lib/ratchet.mjs';
import {scan} from './lib/scan.mjs';
import {groupVocabularyDelta} from './lib/vocabulary-delta.mjs';

export function approveR8Baseline(root,approvalPath) {
  const baselineDir=join(root,'arch/baseline');
  const vocabularyPath=join(baselineDir,'vocabulary.json');
  const vocabulary=readJson(vocabularyPath);
  if(vocabulary.objectTables===true)throw Error('R8 静态词表扩面已经录入');
  const approval=readJson(approvalPath);
  if(approval.schemaVersion!==1||!Array.isArray(approval.additions))throw Error('批准清单格式不正确');
  const approved=new Map();
  for(const {key,count} of approval.additions) {
    if(!Array.isArray(key)||key.length!==6||key[0]!=='R8'||key.some(part=>typeof part!=='string')||
      !Number.isSafeInteger(count)||count<1||approved.has(JSON.stringify(key)))throw Error('批准清单含无效或重复的规范键');
    approved.set(JSON.stringify(key),count);
  }

  const result=scan(root,{objectTables:true});
  const rules=compareBaseline(result.rules,readJson(join(baselineDir,'rules.json')).entries);
  const legacy=compareBaseline(result.legacyVocabulary,vocabulary.entries);
  if(!rules.ok||!legacy.ok)throw Error('R1–R4 或原 R8 基线存在条目漂移，拒绝录入');
  const delta=groupVocabularyDelta(result.objectTableRelations);
  if(delta.length!==approved.size||delta.some(({key,count})=>approved.get(JSON.stringify(key))!==count)) {
    throw Error('R8 扩面差量与批准清单不完全一致，拒绝录入');
  }

  const temporary=mkdtempSync(join(baselineDir,'.r8-approval-'));
  try {
    const candidate=join(temporary,'vocabulary.json');
    writeFileSync(candidate,JSON.stringify({...vocabulary,objectTables:true,entries:result.vocabulary},null,2)+'\n');
    renameSync(candidate,vocabularyPath);
  } finally {
    rmSync(temporary,{recursive:true,force:true});
  }
  return result.objectTableRelations.length;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [approvalPath,...extra]=process.argv.slice(2);
    if(!approvalPath||extra.length)throw Error('用法：node scripts/arch/approve-r8-baseline.mjs <批准清单.json>');
    const count=approveR8Baseline(resolve(import.meta.dirname,'../..'),resolve(approvalPath));
    console.log(`R8 静态词表扩面已录入 ${count} 条`);
  } catch(error) {
    console.error(error.message);
    process.exitCode=1;
  }
}
