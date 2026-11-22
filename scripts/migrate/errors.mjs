// Public diagnostics contain only fixed codes and instructions, never causes.
const messages = {
  'dsh-running':'DSH 停写检查未通过；退出全部 DSH 进程后重试。',
  'writer-running':'Core、Economy 或 Memory 停写检查未通过；关闭写入者后重试。',
  'lock-held':'迁移或恢复占用迁移锁；等运行中的操作结束。若进程号已被复用，确认没有迁移或恢复后再手动删除旧锁。',
  'lock-invalid':'迁移锁无效或已变化；确认没有迁移进程后检查迁移锁。',
  'receipt-invalid':'安装回执缺失、损坏或尚未完成安装。',
  'binding-changed':'身份或存储绑定检查未通过；核对隔离安装与工作区绑定。',
  'symlink-or-hardlink':'发现软链接、硬链接或非普通数据文件；检查文件类型。',
  'manifest-mismatch':'存储版本清单损坏或与预期不一致；核对后再迁移。',
  'journal-exists':'已有迁移日志；先用 status 查看。上轮未完成时用 --resume，已完成且没有新步骤时无需再跑。',
  'journal-invalid':'迁移日志损坏或与当前操作不一致；检查日志并使用原备份恢复。',
  'journal-step-mismatch':'日志中的步骤和版本契约与当前代码不一致；使用匹配原迁移的源码。',
  'migration-inconsistent':'已完成迁移的目标或版本清单后来缺失；检查上轮的已验证备份。',
  'home-identity-invalid':'共享 home 数据或 Core 库无效；核对合成副本或经验证的备份。',
  'home-identity-conflict':'Core 与旧生活文件的共享 home 身份冲突；需要人工核对迁移前备份。',
  'economy-database-missing':'已采用的钱包库缺失；请从已验证的备份恢复。',
  'economy-database-invalid':'钱包库无效或 schema 不完整；核对已验证的备份。',
  'economy-marker-multiple':'Core 有多条钱包采用标记；核对绑定并保留迁移前备份。',
  'economy-marker-invalid':'钱包采用标记无效；核对已验证的备份。',
  'economy-marker-binding-mismatch':'钱包采用标记或库属于另一绑定；核对隔离安装与工作区绑定。',
  'wallet-export-missing':'缺少私有的钱包待确认导出；核对该轮授权来源及原导出。',
  'wallet-export-invalid':'钱包待确认导出内容、绑定或原值摘要不符；核对该轮原件。',
  'wallet-source-missing':'缺少钱包浏览器来源；核对授权来源清单。',
  'wallet-source-unreadable':'钱包浏览器来源不可读；保持停写，核对授权来源。',
  'wallet-source-conflict':'钱包浏览器来源或同号内容冲突；保留现场核对。',
  'wallet-freeze-unverified':'无法确认浏览器来源持续停写；停止操作并复核旧页面和在途请求。',
  'wallet-rollback-invalid':'旧包回退备份锚定不符；核对旧安装、备份和本轮原导出。',
  'wallet-import-invalid':'钱包导入目标或原号证明不符；核对原导出及迁移备份。',
  'wallet-not-adopted':'尚未采用钱包的副本存在待确认请求；核对原来源和钱包采用证据。',
  'resume-journal-missing':'续做日志缺失；使用迁移前的原备份恢复。',
  'backup-invalid':'备份创建或校验未通过；检查原备份并使用已验证的迁移前备份恢复。',
  usage:'命令参数无效；核对命令、安装回执参数及备份或续做选项。',
  unknown:'发生未分类错误；停止迁移并检查隔离环境，必要时使用原备份恢复。',
};
export class MigrationError extends Error {
  constructor(code) { super(messages[code] ?? messages.unknown); this.code = Object.hasOwn(messages,code) ? code : 'unknown'; }
}
export function requireMigration(condition, code) { if (!condition) throw new MigrationError(code); }
export function checked(code, operation) {
  try { return operation(); }
  catch (error) { if (error instanceof MigrationError) throw error; throw new MigrationError(code); }
}
export function diagnostic(error) {
  const safe = error instanceof MigrationError ? error : new MigrationError('unknown');
  return JSON.stringify({code:safe.code, message:messages[safe.code]});
}
