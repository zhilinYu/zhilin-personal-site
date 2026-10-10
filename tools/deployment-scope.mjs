import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function requiresPaymentDeployment(paths) {
  return paths.some(name => name.startsWith('payment/') || name.startsWith('deploy/'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [before, head] = process.argv.slice(2);
  if (![before, head].every(value => /^[0-9a-f]{40}$/.test(value || ''))) {
    throw Error('部署范围需要完整提交 SHA');
  }
  const initialPush = /^0{40}$/.test(before);
  const paths = initialPush ? [] : execFileSync('git', ['diff', '--name-only', '-z', before, head], {encoding: 'utf8'}).split('\0').filter(Boolean);
  console.log('payment=' + (initialPush || requiresPaymentDeployment(paths)));
}
