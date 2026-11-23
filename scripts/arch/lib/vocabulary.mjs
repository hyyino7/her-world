import {ts,walk,unwrap,key,member,entry} from './ast.mjs';

const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const subset=(a,b)=>a.every(v=>b.includes(v));

function assertedObject(initializer) {
  let declared=false;
  for(let node=initializer;node;) {
    if(ts.isObjectLiteralExpression(node))return declared?node:undefined;
    if(ts.isSatisfiesExpression(node)||ts.isAsExpression(node)&&node.type.getText()==='const')declared=true;
    if(!ts.isSatisfiesExpression(node)&&!ts.isAsExpression(node)&&!ts.isParenthesizedExpression(node))return;
    node=node.expression;
  }
}

function staticProperties(project,node,stack=new Set()) {
  node=unwrap(node);
  if(ts.isIdentifier(node))node=unwrap(project.staticConst(node)?.initializer);
  if(!node||!ts.isObjectLiteralExpression(node)||stack.has(node))return;
  const next=new Set(stack).add(node),properties=new Map();
  for(const property of node.properties) {
    if(ts.isSpreadAssignment(property)) {
      const spread=staticProperties(project,property.expression,next);
      if(!spread)return;
      for(const [name,value] of spread)properties.set(name,value);
      continue;
    }
    if(!ts.isPropertyAssignment(property))return;
    const name=ts.isComputedPropertyName(property.name)?property.name.expression:property.name;
    if(ts.isComputedPropertyName(property.name)&&!ts.isStringLiteralLike(name)&&!ts.isNumericLiteral(name))return;
    const value=key(name);
    if(value===undefined)return;
    properties.set(value,unwrap(property.initializer));
  }
  return properties;
}

function objectTableDefinitions(project) {
  const found=new Map(),files=new Map(project.sources.map(({file,source})=>[source,file]));
  function mark(node,path,reason) {
    if(!node)return;
    if(ts.isParenthesizedTypeNode(node))return mark(node.type,path,reason);
    if(ts.isIndexedAccessTypeNode(node)) {
      const index=ts.isLiteralTypeNode(node.indexType)&&ts.isStringLiteralLike(node.indexType.literal)?node.indexType.literal.text:undefined;
      return mark(node.objectType,[index,...path],reason);
    }
    if(ts.isTypeQueryNode(node))return mark(node.exprName,path,reason);
    node=unwrap(node);
    if(ts.isPropertyAccessExpression(node))return mark(node.expression,[node.name.text,...path],reason);
    if(ts.isElementAccessExpression(node)) {
      const index=ts.isStringLiteralLike(node.argumentExpression)?node.argumentExpression.text:undefined;
      return mark(node.expression,[index,...path],reason);
    }
    const decl=project.staticConst(node);
    const root=decl&&assertedObject(decl.initializer);
    if(!root)return;
    function collect(table,name,depth) {
      const properties=staticProperties(project,table);
      if(!properties)return;
      if(depth<path.length) {
        for(const [child,value] of properties)if((path[depth]===undefined||path[depth]===child)&&ts.isObjectLiteralExpression(value)) {
          collect(value,name+'.'+child,depth+1);
        }
        return;
      }
      if(properties.size<2||[...properties.values()].some(value=>!ts.isObjectLiteralExpression(value)&&
        value.kind!==ts.SyntaxKind.TrueKeyword&&value.kind!==ts.SyntaxKind.FalseKeyword))return;
      if(!found.has(table)) {
        const values=[...properties.keys()].sort();
        found.set(table,entry('R8',files.get(table.getSourceFile()),table,values.join('|'),
          {values,shape:'object table',table:name,keyUse:reason}));
      }
    }
    collect(root,decl.name.text,0);
  }
  for(const {source} of project.sources)walk(source,node=>{
    if(ts.isTypeOperatorNode(node)&&node.operator===ts.SyntaxKind.KeyOfKeyword)mark(node.type,[],'keyof');
    if(ts.isIndexedAccessTypeNode(node)&&ts.isUnionTypeNode(node.indexType)&&
      node.indexType.types.every(type=>ts.isLiteralTypeNode(type)&&ts.isStringLiteralLike(type.literal))) {
      mark(node.objectType,[],'索引访问类型');
    }
    if(ts.isElementAccessExpression(node)&&!ts.isStringLiteralLike(node.argumentExpression)&&!ts.isNumericLiteral(node.argumentExpression)) {
      mark(node.expression,[],'按键索引');
    }
    if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.InKeyword)mark(node.right,[],'in');
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&key(node.expression.expression)==='Object'&&
      !project.checker.getSymbolAtLocation(node.expression.expression)) {
      const method=node.expression.name.text;
      if(['keys','entries','hasOwn'].includes(method))mark(node.arguments[0],[],'Object.'+method);
    }
  });
  return [...found.values()];
}

export function scanVocabulary(project,{objectTables=false}={}) {
  const definitions=[],bare=[],judgments=[];
  for(const {file,source} of project.sources) {
    const seen=new Set();
    const collect=(node,values,shape,minimum=3)=>{
      if(!values || values.some(v=>typeof v!=='string'))return;
      values=[...new Set(values)].sort();if(values.length<minimum)return;
      const id=node.pos+':'+JSON.stringify(values);if(seen.has(id))return;seen.add(id);
      definitions.push(entry('R8',file,node,values.join('|'),{values,shape}));
    };
    walk(source,node=>{
      if(ts.isArrayLiteralExpression(node))collect(node,node.elements.map(e=>ts.isStringLiteralLike(e)?e.text:undefined),'array',member(node.parent)==='includes'||key(node.parent.name)==='enum'?2:3);
      if(ts.isUnionTypeNode(node))collect(node,node.types.map(t=>ts.isLiteralTypeNode(t)&&ts.isStringLiteralLike(t.literal)?t.literal.text:undefined),'union',2);
      if(ts.isSwitchStatement(node))collect(node,node.caseBlock.clauses.filter(ts.isCaseClause).map(c=>project.strings(c.expression)?.[0]),'switch',2);
      if(ts.isPropertyAssignment(node)&&['oneOf','anyOf'].includes(key(node.name))) {
        const array=unwrap(node.initializer),fields=new Map();
        if(ts.isArrayLiteralExpression(array))for(const branch of array.elements)walk(branch,child=>{
          if(!ts.isPropertyAssignment(child)||key(child.name)!=='const')return;
          const field=key(child.parent.parent?.name),value=project.strings(child.initializer)?.[0];
          if(field&&value)(fields.get(field)??(fields.set(field,[]),fields.get(field))).push(value);
        });
        for(const values of fields.values())collect(node,values,'schema const',2);
      }
      // feeling 的标签表也是一份定义，单独保留位置以便与文档份数核对。
      if(ts.isObjectLiteralExpression(node)&&node.properties.length>=3&&node.properties.every(p=>ts.isPropertyAssignment(p)&&ts.isStringLiteralLike(p.initializer)))collect(node,node.properties.map(p=>key(p.name)),'labels');
      if((ts.isPropertySignature(node)||ts.isPropertyDeclaration(node))&&['kind','action','status','type'].includes(key(node.name))&&node.type?.kind===ts.SyntaxKind.StringKeyword) {
        let exported=file.startsWith('src/contracts/');
        for(let p=node.parent;p&&!ts.isSourceFile(p);p=p.parent)if(p.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword))exported=true;
        if(exported)bare.push(entry('R8',file,node,key(node.name),{shape:'bare string'}));
      }
      const field=n=>{
        n=unwrap(n);if(!n)return;
        if(ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.expression.text==='String')return field(n.arguments[0]);
        return ['kind','action'].includes(member(n)??key(n))?member(n)??key(n):undefined;
      };
      let name;
      if(ts.isBinaryExpression(node)&&[ts.SyntaxKind.EqualsEqualsToken,ts.SyntaxKind.EqualsEqualsEqualsToken,ts.SyntaxKind.ExclamationEqualsToken,ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind)) {
        if(project.strings(node.right))name=field(node.left);
        if(project.strings(node.left))name??=field(node.right);
      }
      if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)) {
        const op=node.expression.name.text;
        if(op==='includes')name=field(node.arguments[0]);
        if(['startsWith','endsWith'].includes(op)&&project.strings(node.arguments[0]))name=field(node.expression.expression);
      }
      if(ts.isSwitchStatement(node))name=field(node.expression);
      if(name)judgments.push(entry('R8-count',file,node,name));
    });
  }
  // 每个定义单独入基线，目标中包含对方身份；不能用重复组总数抵消增删。
  const tables=objectTables?objectTableDefinitions(project):[];
  const legacyDefinitions=definitions.length;
  definitions.push(...tables);
  const duplicates=[],objectTableRelations=[];
  for(let i=0;i<definitions.length;i++)for(let j=i+1;j<definitions.length;j++) {
    const a=definitions[i],b=definitions[j];
    if(a.file===b.file||!(subset(a.values,b.values)||subset(b.values,a.values)))continue;
    const relation=same(a.values,b.values)?'重复':'子集';
    const rows=j>=legacyDefinitions?objectTableRelations:duplicates;
    for(const [item,other] of [[a,b],[b,a]]) {
      const details=rows===objectTableRelations?{column:other.column,shape:other.shape,table:other.table,keyUse:other.keyUse,values:other.values}:{};
      rows.push({...item,target:JSON.stringify({file:other.file,scope:other.scope}),relation,
        other:{file:other.file,scope:other.scope,line:other.line,...details}});
    }
  }
  return {reports:[...duplicates,...objectTableRelations,...bare],objectTableRelations,legacyReports:[...duplicates,...bare],definitions,bare,judgments};
}
