// Test-only barrier after the restore acquires the real interprocess lock.
import {existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

const exec = DatabaseSync.prototype.exec, gate = process.env.MIGRATE_TEST_RESTORE_GATE;
DatabaseSync.prototype.exec = function(sql) {
  const result = exec.call(this,sql);
  if (sql === 'BEGIN IMMEDIATE') {
    process.send({held:true});
    const deadline = Date.now() + 10000, sleep = new Int32Array(new SharedArrayBuffer(4));
    while (!existsSync(gate)) {
      if (Date.now() > deadline) throw Error('Test lock barrier timeout');
      Atomics.wait(sleep,0,0,10);
    }
  }
  return result;
};
