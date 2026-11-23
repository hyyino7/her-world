// Public diagnostics contain only fixed codes and instructions, never causes.
const messages = {
  'writer-running':'Core、Economy 或 Memory 停写检查未通过；关闭写入者后重试。',
  'receipt-invalid':'安装回执缺失、损坏或尚未完成安装。',
  'binding-changed':'身份或存储绑定检查未通过；核对隔离安装与工作区绑定。',
  'symlink-or-hardlink':'发现软链接、硬链接或非普通数据文件；检查文件类型。',
  usage:'命令参数无效；请传入 --installation 和安装回执路径。',
  unknown:'盘点遇到未分类错误；请检查隔离环境。',
};
export class InventoryError extends Error {
  constructor(code) { super(messages[code] ?? messages.unknown); this.code = Object.hasOwn(messages,code) ? code : 'unknown'; }
}
export function requireInventory(condition, code) { if (!condition) throw new InventoryError(code); }
export function checked(code, operation) {
  try { return operation(); }
  catch (error) { if (error instanceof InventoryError) throw error; throw new InventoryError(code); }
}
export function diagnostic(error) {
  const safe = error instanceof InventoryError ? error : new InventoryError('unknown');
  return JSON.stringify({code:safe.code, message:messages[safe.code]});
}
