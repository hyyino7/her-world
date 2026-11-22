#!/usr/bin/env node
import { requireMigration, diagnostic } from './errors.mjs';
import { migrationStatus, runMigration } from './runner.mjs';
import { sealWalletRollback, verifyWalletRollback } from './wallet-rollback.mjs';

const args = process.argv.slice(2), command = args.shift();
const commands = {
  plan:['--installation'],
  status:['--installation'],
  run:['--installation','--backup','--resume','--wallet-export','--wallet-rollback'],
  'seal-wallet-rollback':['--installation','--backup','--wallet-export','--output'],
  'verify-wallet-rollback':['--installation','--wallet-export','--wallet-rollback'],
};
try {
  requireMigration(Object.hasOwn(commands,command), 'usage');
  const options = {};
  while (args.length) {
    const name = args.shift();
    requireMigration(commands[command].includes(name) && !(name in options), 'usage');
    options[name] = name === '--resume' ? true : args.shift();
    requireMigration(options[name] && !String(options[name]).startsWith('--'), 'usage');
  }
  const {['--installation']:installation, ['--backup']:backup, ['--resume']:resume,
    ['--wallet-export']:walletExport, ['--wallet-rollback']:walletRollback, ['--output']:output} = options;
  requireMigration(installation, 'usage');
  requireMigration(!resume || !backup && !walletExport && !walletRollback, 'usage');
  let result;
  switch (command) {
    case 'run':
      result = await runMigration({installation,backup,resume,walletExport,walletRollback}); break;
    case 'seal-wallet-rollback':
      requireMigration(backup && walletExport && output,'usage');
      result = sealWalletRollback({installation,backup,walletExport,output}); break;
    case 'verify-wallet-rollback':
      requireMigration(walletExport && walletRollback,'usage');
      verifyWalletRollback({installation,walletExport,walletRollback});
      result = {verified:true}; break;
    default:
      result = migrationStatus(installation,undefined,{plan:command === 'plan'});
      if (command === 'plan') result.steps = result.steps.filter(step => step.state === 'pending');
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(diagnostic(error));
  process.exitCode = 1;
}
