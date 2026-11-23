#!/usr/bin/env node
import { requireMigration, diagnostic } from './errors.mjs';
import { migrationStatus, planWalletAttestation, runMigration } from './runner.mjs';
import { sealWalletRollback, verifyWalletRollback } from './wallet-rollback.mjs';

const args = process.argv.slice(2), command = args.shift();
const ownerFlag = '--owner-attests-no-pending';
const commands = {
  plan:['--installation','--wallet-rollback',ownerFlag],
  status:['--installation','--wallet-rollback',ownerFlag],
  run:['--installation','--backup','--resume','--wallet-export','--wallet-rollback',ownerFlag],
  'seal-wallet-rollback':['--installation','--backup','--wallet-export','--output',ownerFlag],
  'verify-wallet-rollback':['--installation','--wallet-export','--wallet-rollback'],
};
try {
  requireMigration(Object.hasOwn(commands,command), 'usage');
  const options = {};
  while (args.length) {
    const name = args.shift();
    requireMigration(commands[command].includes(name) && !(name in options), 'usage');
    options[name] = name === '--resume' || name === ownerFlag ? true : args.shift();
    requireMigration(options[name] && !String(options[name]).startsWith('--'), 'usage');
  }
  const {['--installation']:installation, ['--backup']:backup, ['--resume']:resume,
    ['--wallet-export']:walletExport, ['--wallet-rollback']:walletRollback, ['--output']:output,
    [ownerFlag]:ownerAttestsNoPending} = options;
  requireMigration(installation, 'usage');
  requireMigration(!resume || !backup && !walletExport && !walletRollback && !ownerAttestsNoPending,'usage');
  requireMigration(!ownerAttestsNoPending || !walletExport,'wallet-attestation-conflict');
  const walletOptions = {installation,walletExport,walletRollback,ownerAttestsNoPending};
  let result;
  switch (command) {
    case 'run':
      result = await runMigration({...walletOptions,backup,resume}); break;
    case 'seal-wallet-rollback':
      requireMigration(backup && (walletExport || ownerAttestsNoPending) && output,'usage');
      result = sealWalletRollback({installation,backup,walletExport,output,ownerAttestsNoPending}); break;
    case 'verify-wallet-rollback':
      requireMigration(walletRollback,'usage');
      verifyWalletRollback(walletOptions);
      result = {verified:true}; break;
    default:
      requireMigration(!walletRollback || ownerAttestsNoPending,'usage');
      if (command === 'plan') {
        requireMigration(!ownerAttestsNoPending || walletRollback,'usage');
        result = ownerAttestsNoPending ? planWalletAttestation(walletOptions) : migrationStatus(installation,undefined,{plan:true});
        result.steps = result.steps.filter(step => step.state === 'pending');
      } else result = migrationStatus(installation,undefined,{ownerAttestsNoPending,walletRollback});
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(diagnostic(error));
  process.exitCode = 1;
}
