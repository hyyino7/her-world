import {resolve,join} from 'node:path';
import {existsSync} from 'node:fs';
import {filesUnder,readJson,project} from './ast.mjs';
import {scanRules,allowed} from './rules.mjs';
import {scanStorage} from './storage.mjs';
import {scanVocabulary} from './vocabulary.mjs';

export function scan(root,{objectTables=false}={}) {
  root=resolve(root);
  const layers=readJson(join(root,'arch/layers.json')),storage=readJson(join(root,'arch/storage.json'));
  const modules=Object.entries(layers.modules),services=new Set();
  for(const [id,m] of modules) {
    if(![1,2,3].includes(m.layer))throw Error(`无效层：${id}`);
    if(m.sharedLeaf&&(m.layer!==3||[m.services,m.dependencies,m.reads,m.publishes,m.subscribes].some(rows=>rows.length))) {
      throw Error(`第三层共用叶子不能依赖其他模块或提供运行时登记：${id}`);
    }
    for(const s of m.services){if(services.has(s))throw Error(`重复服务：${s}`);services.add(s);}
    for(const to of m.dependencies) {
      const other=layers.modules[to];
      const permittedLeaf=other?.sharedLeaf&&m.layer===3&&['desktop','room','console'].includes(id);
      if(!other||to!==id&&(other.layer>m.layer||m.layer===3&&other.layer===3&&!permittedLeaf)) {
        throw Error(`不合规的依赖声明：${id} → ${to}`);
      }
    }
  }
  for(const [id,m] of modules)for(const service of m.reads) {
    const owner=modules.find(([,other])=>other.services.includes(service))?.[0];
    if(!owner||!allowed(layers,id,owner))throw Error(`不合规的服务读取声明：${id} → ${service}`);
  }
  for(const row of storage.entries)for(const id of [row.owner,row.containerOwner,...row.writers]) {
    if(!layers.modules[id])throw Error(`存储模块 ID 不存在：${id}`);
    if(layers.modules[id].sharedLeaf)throw Error(`第三层共用叶子不能登记持久存储：${id} → ${row.id}`);
  }
  const generated=modules.flatMap(([,m])=>m.generated),skipped=generated.map(g=>g.file).sort();
  const paths=new Set(filesUnder(join(root,'src')).filter(p=>!skipped.includes(p.slice(root.length+1))));
  const skippedVendorSources=new Set();
  for(const generatedFile of generated)for(const source of generatedFile.sources) {
    if(source.startsWith('vendor/')){skippedVendorSources.add(source);continue;}
    if(!existsSync(join(root,source)))throw Error(`生成源不存在：${source}`);
    if(/\.(ts|js|mjs|cjs)$/.test(source))paths.add(join(root,source));
  }
  const ast=project(root,[...paths].sort());
  const rules=scanRules(ast,layers,readJson(join(root,'package.json')).imports??{});
  const vocabulary=scanVocabulary(ast,{objectTables}),writers=scanStorage(ast,layers,storage);
  return {
    rules:rules.reports,edges:rules.edges,moduleIds:modules.map(([id])=>id),
    vocabulary:vocabulary.reports,legacyVocabulary:vocabulary.legacyReports,objectTableRelations:vocabulary.objectTableRelations,
    definitions:vocabulary.definitions,bare:vocabulary.bare,judgments:vocabulary.judgments,
    writers,skipped,skippedVendorSources:[...skippedVendorSources].sort(),
  };
}
