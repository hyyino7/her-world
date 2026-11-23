import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readJson } from './lib/ast.mjs';
import { summarizeJudgments, summarizeRules } from './lib/counts.mjs';
import { scan } from './lib/scan.mjs';

const lineLimit = 1500;
const codeExtensions = new Set(['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.py', '.sh', '.html', '.css']);

function longHandwrittenFiles(root, skipped) {
  const tracked = execFileSync('git', ['ls-files', '--deduplicate', '-z', '--', 'src/', 'scripts/', 'tests/'], {
    cwd: root, encoding: 'utf8',
  }).split('\0');
  const generated = new Set(skipped);
  const files = [];
  for (const file of tracked) {
    if (generated.has(file) || !codeExtensions.has(extname(file))) continue;
    const path = join(root, file);
    if (!lstatSync(path, { throwIfNoEntry: false })?.isFile()) continue;
    const rows = readFileSync(path, 'utf8').split(/\r\n|[\r\n]/u);
    const lines = rows.length - Number(rows.at(-1) === '');
    if (lines > lineLimit) files.push({ file, lines });
  }
  return { limit: lineLimit, count: files.length, files };
}

function collectMetrics(root) {
  const baseline = readJson(join(root, 'arch/baseline/vocabulary.json'));
  const result = scan(root, {objectTables: baseline.objectTables === true});
  const rules = Object.fromEntries(summarizeRules(result).map(({ rule, entries, callSites, violationEdges }) => [
    rule, { targets: entries.length, callSites, violationEdges },
  ]));
  const modules = new Set(result.moduleIds);
  const edges = new Set(result.edges
    .filter(({ from, to }) => from !== to && modules.has(from) && modules.has(to))
    .map(({ from, to }) => JSON.stringify([from, to])));

  return {
    violations: { ...rules, total: result.rules.length },
    r8: {
      baselineEntries: baseline.entries.length,
      currentEntries: result.vocabulary.length,
      duplicateRelations: result.vocabulary.length - result.bare.length,
      bareFields: result.bare.length,
      judgments: summarizeJudgments(result.judgments),
    },
    handwrittenFiles: longHandwrittenFiles(root, result.skipped),
    moduleDependencies: { count: edges.size },
  };
}

function printMetrics({ violations, r8, handwrittenFiles, moduleDependencies }) {
  const { total, ...rules } = violations;
  for (const [rule, { targets, callSites, violationEdges }] of Object.entries(rules)) {
    console.log(`${rule}：${targets} 条违规目标；${callSites} 个调用点；${violationEdges} 条违规依赖边`);
  }
  console.log(`R1–R4 合计：${total} 条违规目标`);
  console.log(`R8：基线 ${r8.baselineEntries} 条，当前 ${r8.currentEntries} 条（重复/子集关系 ${r8.duplicateRelations} 条，裸 string 字段 ${r8.bareFields} 个）`);
  for (const [target, { runtime, scanned }] of Object.entries(r8.judgments)) {
    const label = target === 'total' ? 'kind/action 合计' : target;
    console.log(`R8 ${label} 字符串判断：运行源码 ${runtime.points} 点/${runtime.files} 文件；扫描范围 ${scanned.points} 点/${scanned.files} 文件`);
  }
  console.log(`手写超过 ${handwrittenFiles.limit} 行的文件：${handwrittenFiles.count} 个`);
  for (const { file, lines } of handwrittenFiles.files) console.log(`  ${file}（${lines} 行）`);
  console.log(`模块间依赖：${moduleDependencies.count} 条`);
}

try {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter(arg => arg !== '--'),
    options: { json: { type: 'boolean' }, root: { type: 'string' } },
  });
  const metrics = collectMetrics(values.root === undefined ? resolve(import.meta.dirname, '../..') : resolve(values.root));
  if (values.json) console.log(JSON.stringify(metrics, null, 2));
  else printMetrics(metrics);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
