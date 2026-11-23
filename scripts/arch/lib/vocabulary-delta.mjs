import {identity} from './ratchet.mjs';

export function groupVocabularyDelta(rows) {
  const groups=new Map();
  for(const row of rows) {
    const identityKey=identity(row);
    if(!groups.has(identityKey))groups.set(identityKey,[]);
    groups.get(identityKey).push(row);
  }
  return [...groups.keys()].sort().map(key=>({key:JSON.parse(key),count:groups.get(key).length,rows:groups.get(key)}));
}

export function vocabularyDeltaLines(rows) {
  const delta=groupVocabularyDelta(rows);
  const endpoint=item=>`${item.file}:${item.line}:${item.column} ${item.shape}${item.table?` ${item.table}（${item.keyUse}）`:''}`;
  const reason=row=>row.relation==='重复'?'跨文件键集合相同':
    row.values.length<row.other.values.length?'本端键是对端键的子集':'对端键是本端键的子集';
  return [
    `R8 静态词表扩面差量：${delta.length} 个规范键，${rows.length} 条（含重数；双向分别计数）。`,
    ...delta.flatMap(({key,count,rows})=>[
      `- \`${JSON.stringify(key)}\` × ${count}`,
      ...rows.map(row=>`  - \`${endpoint(row)}\` ↔ \`${endpoint(row.other)}\`。原因：${reason(row)}，本端键 \`${row.values.join(', ')}\`，对端键 \`${row.other.values.join(', ')}\`。`),
    ]),
  ];
}
