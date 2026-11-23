import {ts,walk,member,unwrap,entry,normalize} from './ast.mjs';
import {moduleOf} from './rules.mjs';

function fileEntry(storage,target) {
  if(target==='?')return;
  const suffix=target.split('*/').at(-1).replace(/^\.\//,'');
  const matches=[];
  const locations=storage.entries.filter(r=>!r.selector).flatMap(row=>
    row.locations?row.locations.map(location=>({...row,...location})):[row]);
  for(const row of locations)for(const path of row.paths) {
    if(path.endsWith('/**')) {
      const prefix=path.slice(0,-3),dataIndex=prefix.indexOf('data/'),local=dataIndex<0?undefined:prefix.slice(dataIndex);
      if(suffix.startsWith(prefix+'/') || local&&(suffix.startsWith(local+'/')||suffix.includes('/'+local+'/')))
        matches.push({row,score:prefix.length});
    } else if(suffix===path||path.endsWith('/'+suffix))matches.push({row,score:10000+path.length});
  }
  const best=Math.max(...matches.map(m=>m.score));
  const rows=[...new Set(matches.filter(m=>m.score===best).map(m=>m.row))];
  return rows.length===1?rows[0]:undefined;
}

export function scanStorage(project,layers,storage) {
  const reports=[];
  for(const {file,source} of project.sources) {
    const writer=moduleOf(layers,file);if(!writer)continue;
    const sharedLeaf=layers.modules[writer].sharedLeaf;
    walk(source,node=>{
      if(!ts.isCallExpression(node))return;
      const op=member(node.expression),names=project.strings(node.arguments[0]);
      const callee=project.pathsOf(node.expression).map(p=>p.split('.').at(-1));
      const fileReads=['readFile','readFileSync','readdir','readdirSync'];
      const fileWrites=['writeFile','writeFileSync','appendFile','appendFileSync','mkdir','mkdirSync','rename','renameSync','copyFile','copyFileSync','unlink','unlinkSync'];
      if(sharedLeaf)fileWrites.push('createWriteStream','rm','rmSync','truncate','truncateSync');
      if(callee.some(p=>[...fileReads,...fileWrites].includes(p))) {
        const operation=callee.find(p=>[...fileReads,...fileWrites].includes(p));
        const access=fileReads.includes(operation)?'读':'写';
        const targets=names??['?'];
        for(const target of targets) {
          const row=fileEntry(storage,target);
          reports.push(entry('R5',file,node,target,{writer,access,container:row?.container??(target==='?'?normalize(node.arguments[0]):target),containerOwner:row?.containerOwner??'?',owner:row?.owner??'?',
            violation:row?writer!==row.owner||row.containerOwner!==row.owner:null,storageId:row?.id,reason:row?'按路径声明核对':'无法静态判定文件拥有者'}));
        }
      }
      if(op==='exec'&&names)for(const sql of names)for(const match of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`\[]?([\w-]+)/gi)) {
        const table=match[1];
        const declared=storage.entries.filter(r=>r.tables?.includes(table));
        const row=declared.find(r=>r.owner===writer)
          ??storage.entries.find(r=>r.selector?.table===table&&r.containerOwner===writer)
          ??(declared.length===1?declared[0]:undefined);
        // records 的表结构属于容器；其中各 kind 的业务归属在 store 调用处单独核对。
        const owner=row?(row.tables?row.owner:row.containerOwner):writer,containerOwner=row?.containerOwner??writer;
        reports.push(entry('R5',file,node,table,{writer,access:'写',container:row?row.container.split('#')[0]+'#'+table:`${writer}:sqlite#${table}`,
          containerOwner,owner,violation:writer!==owner||containerOwner!==owner,storageId:row?.tables?row.id:undefined,reason:'创建表'}));
      }
      if(sharedLeaf) {
        const receiver=unwrap(node.expression.expression);
        const sql=op==='exec'&&names?.some(value=>/\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|ALTER\s+TABLE|DROP\s+TABLE)\b/i.test(value));
        const statement=op==='run'&&receiver&&ts.isCallExpression(receiver)&&member(receiver.expression)==='prepare';
        const browser=['setItem','removeItem','clear'].includes(op)&&
          project.pathsOf(receiver).some(path=>path.split('.').at(-1)==='localStorage');
        if(sql||statement||browser)reports.push(entry('R5',file,node,sql||statement?'SQLite':'localStorage',
          {writer,access:'写',violation:true,reason:'第三层共用叶子不能持久写入'}));
      }
      const storeWrite=['put','setMeta','remove','delete'].includes(op);
      if(!['get','put','all','meta','setMeta','remove','delete'].includes(op)||!names&&!(sharedLeaf&&storeWrite))return;
      const paths=project.pathsOf(node.expression.expression);
      const isCoreStore=paths.some(p=>/\.runtime\.store$|^store$|\.store$|^metadata$/.test(p));
      if(!isCoreStore)return;
      for(const name of names??['?']) {
        const table=['meta','setMeta'].includes(op)?'meta':'records';
        const row=storage.entries.find(r=>r.selector?.table===table&&(table==='records'?r.selector.kind===name:r.selector.key&&(r.selector.key.endsWith('*')?name.startsWith(r.selector.key.slice(0,-1)):name===r.selector.key)));
        const owner=row?.owner??'core',containerOwner=row?.containerOwner??'core';
        const access=storeWrite?'写':'读';
        const inPlace=table==='records' && row?.disposition==='原位例外' && row.writers.includes(writer);
        const violation=writer!==owner||(!inPlace&&containerOwner!==owner);
        const reason=violation?'访问模块或物理容器不属于业务拥有者':inPlace?'原位例外':'一致';
        reports.push(entry('R5',file,node,name,{writer,access,container:row?.container??`.chatpet/data/core/core.sqlite#${table}`,containerOwner,owner,violation,storageId:row?.id??`core-${table}`,reason}));
      }
    });
  }
  const leafWrites=reports.filter(row=>row.access==='写'&&layers.modules[row.writer].sharedLeaf);
  if(leafWrites.length)throw Error('第三层共用叶子不能持久写入：\n'+
    leafWrites.map(row=>`${row.file}:${row.line} ${row.target}`).join('\n'));
  return reports;
}
