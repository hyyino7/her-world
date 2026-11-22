import { StatementSync } from 'node:sqlite';
import { runMigration, steps } from '../../scripts/migrate/runner.mjs';

const [installation, backup, walletExport, walletRollback, point] = process.argv.slice(2);
const kill = () => process.kill(process.pid, 'SIGKILL');

if (point === 'during-import') {
  const run = StatementSync.prototype.run;
  StatementSync.prototype.run = function (...values) {
    const result = run.apply(this, values);
    if (/^INSERT INTO console_wallet_requests\b/i.test(this.sourceSQL.trim())) kill();
    return result;
  };
}

const step = steps.at(-1);
const selected = point === 'after-resume-import' ? [...steps.slice(0, -1), {
  ...step,
  async apply(...args) {
    await step.apply(...args);
    kill();
  },
}] : steps;
const options = point === 'after-resume-import' ? {installation, resume:true}
  : {installation, backup, walletExport, walletRollback};
await runMigration(options, selected);
