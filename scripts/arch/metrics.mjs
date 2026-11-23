import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readJson } from './lib/ast.mjs';
import { summarizeJudgments, summarizeRules } from './lib/counts.mjs';
import { scan } from './lib/scan.mjs';

const lineLimit = 1500;
const codeExtensions = new Set(['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.py', '.sh', '.html', '.css']);
const productDoc = 'docs/product.md';
const manualItems = [[6, '修复批次占比'], [7, '典型修改基线']];

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

function tableCells(line) {
  return line.trim().replace(/^\||(?<!\\)\|$/gu, '').split(/(?<!\\)\|/u).map(cell => cell.trim());
}

function readManualMetrics(root) {
  let text;
  try {
    text = readFileSync(join(root, productDoc), 'utf8');
  } catch (error) {
    throw Error(`读取 ${productDoc} 失败（${error.code ?? error.message}）`);
  }
  const lines = text.split(/\r?\n/u);
  const start = lines.findIndex(line => line.trim() === '### G5 手工度量');
  if (start === -1) throw Error(`${productDoc} 缺少「G5 手工度量」章节`);
  const section = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,3}\s/u.test(line)) break;
    section.push(line);
  }
  const header = section.findIndex(line => line.trimStart().startsWith('|'));
  if (header === -1) throw Error(`${productDoc} 缺少 G5 度量表`);
  const columns = tableCells(section[header]);
  const separator = tableCells(section[header + 1] ?? '');
  if (separator.length !== columns.length || !separator.every(cell => /^:?-{3,}:?$/u.test(cell))) {
    throw Error(`${productDoc} 的 G5 度量表缺少有效表头分隔行`);
  }
  if (columns.length < 3 || columns.at(-1) !== '口径') {
    throw Error(`${productDoc} 的 G5 度量表无法定位「口径」前的最新记录列`);
  }
  const rows = [];
  for (const line of section.slice(header + 2)) {
    if (!line.trimStart().startsWith('|')) break;
    rows.push(tableCells(line));
  }
  return manualItems.map(([number, label]) => {
    const item = `第 ${number} 项「${label}」`;
    const row = rows.find(row => row[0] === `${number}. ${label}`);
    if (!row) throw Error(`${productDoc} 的 G5 度量表缺少${item}`);
    if (row.length !== columns.length) throw Error(`${productDoc} 的 G5 度量表${item}列数与表头不符`);
    const record = row.at(-2);
    if (!record) throw Error(`${productDoc} 的 G5 度量表${item}的最新记录为空`);
    return { label, status: '人工', source: `${productDoc}#g5-手工度量`, record };
  });
}

function collectMetrics(root) {
  const manual = readManualMetrics(root);
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
    manual,
  };
}

function printMetrics({ violations, r8, handwrittenFiles, moduleDependencies, manual }) {
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
  for (const { label, status, record } of manual) console.log(`${label}：${status}，${record}`);
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
