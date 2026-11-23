import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {existsSync} from 'node:fs';
import {readJson} from './lib/ast.mjs';
import {scan} from './lib/scan.mjs';
import {summarizeJudgments,summarizeRules} from './lib/counts.mjs';
import {updateBaselines} from './lib/ratchet.mjs';
import {baselineMove} from './lib/move.mjs';

export function report(result,log=console.log) {
  for(const {rule,entries,callSites,violationEdges,dependencyEdges} of summarizeRules(result)) {
    log(`${rule}：${entries.length} 条违规目标；${callSites} 个调用点；${violationEdges} 条违规依赖边；${dependencyEdges} 条依赖边（全图）`);
    for(const r of entries)log(`${rule} ${r.file}:${r.line} ${r.scope} → ${r.target} [${r.reason}] ${r.expression}`);
  }
  log('R5 写入报告（只报告，不阻断；读写均列出）');
  for(const r of result.writers)log(`R5 ${r.file}:${r.line} ${r.violation===null?'无法静态判定':r.violation?'违规':'一致'} 写入模块=${r.writer} 操作=${r.access} 物理容器=${r.container} 业务拥有者=${r.owner} 目标=${r.target}`);
  log(`R8：${result.vocabulary.length} 条重复关系/裸字符串；${result.definitions.length} 个词表定义`);
  for(const r of result.vocabulary)log(`R8 ${r.file}:${r.line} ${r.shape==='bare string'?'裸 string '+r.target:r.relation+' ['+r.values.join(', ')+'] ↔ '+r.other.file+':'+r.other.line}`);
  log('R8 全部定义位置（含子集、schema、标签表）');
  for(const r of result.definitions)log(`R8 定义 ${r.file}:${r.line} ${r.shape} [${r.values.join(', ')}]`);
  const {kind,action}=summarizeJudgments(result.judgments);
  for(const [name,{runtime,scanned}] of Object.entries({kind,action})) {
    log(`R8 ${name} 字符串判断：运行源码 ${runtime.points} 点/${runtime.files} 文件；扫描范围 ${scanned.points} 点/${scanned.files} 文件`);
  }
  log(`跳过生成文件（${result.skipped.length}；自有生成源已扫描）：${result.skipped.join(', ')}`);
  log(`跳过 vendor 生成源（${result.skippedVendorSources.length}）：${result.skippedVendorSources.join(', ')}`);
}
export function main(args=process.argv.slice(2),root=resolve(import.meta.dirname,'../..')) {
  const flags=args.filter(arg=>arg!=='--');
  const write=flags.includes('--write-baseline');
  const moveIndex=flags.indexOf('--move');
  let movePath;
  if(moveIndex!==-1) {
    movePath=flags[moveIndex+1];
    if(!write)throw Error('--move 必须与 --write-baseline 一起使用');
    if(!movePath||movePath.startsWith('--'))throw Error('--move 需要对照文件路径');
    flags.splice(moveIndex,2);
  }
  if(flags.some(arg=>!['--report','--write-baseline'].includes(arg)))throw Error('只支持 --report、--write-baseline 和 --move <对照文件>');
  const rewrite=movePath?baselineMove(resolve(root,movePath)):undefined;
  const vocabularyFile=join(root,'arch/baseline/vocabulary.json');
  const objectTables=existsSync(vocabularyFile)&&readJson(vocabularyFile).objectTables===true;
  const result=scan(root,{objectTables});
  if(flags.includes('--report'))report(result);
  const outcomes=updateBaselines([
    {file:join(root,'arch/baseline/rules.json'),items:result.rules},
    {file:vocabularyFile,items:objectTables?result.vocabulary:result.legacyVocabulary,metadata:objectTables?{objectTables}:undefined},
  ],write,rewrite);
  for(const r of outcomes) {
    console.log(`${r.file}：当前 ${r.items.length}；新增 ${r.added.length}；消失 ${r.removed.length}`);
    if(r.added.length)console.error('新增违规：',JSON.stringify(r.added));
    if(r.removed.length&&!write)console.error('旧违规已消失；请在同一提交用 --write-baseline 收紧基线：',JSON.stringify(r.removed));
  }
  const ok=write||outcomes.every(r=>r.ok);
  console.log(ok?'架构检查通过':'架构检查失败');
  return ok?0:1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {process.exitCode=main();}catch(error){console.error(error.message);process.exitCode=1;}
}
