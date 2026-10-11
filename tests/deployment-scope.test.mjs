import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {requiresPaymentDeployment} from '../tools/deployment-scope.mjs';

test('内容和前端支付更新不重启后端，后端和部署变更仍更新服务', () => {
  assert.equal(requiresPaymentDeployment(['content/prompts/quant-risk.json', 'assets/checkout.js', 'admin/config.yml', 'tools/build.mjs']), false);
  assert.equal(requiresPaymentDeployment(['payment/app.py']), true);
  assert.equal(requiresPaymentDeployment(['deploy/zhilin-shop.service']), true);
  assert.equal(requiresPaymentDeployment(['content/articles/new.json', 'payment/requirements.txt']), true);
  assert.equal(requiresPaymentDeployment(['payment/tests/test_integration.py', 'payment/README.md', 'deploy/preflight_backup.py']), false);
});

test('分支与 PR 校验无生产发布操作，正式发布只在 main 并使用新版导出包', () => {
  const verify = fs.readFileSync(new URL('../.github/workflows/verify-site.yml', import.meta.url), 'utf8');
  assert.match(verify, /branches: \['codex\/\*\*'\]/);
  assert.doesNotMatch(verify, /secrets\.|appleboy\/|systemctl|workflow_dispatch|\/usr\/share\/nginx/);
  const deploy = fs.readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.match(deploy, /on:\n  push:\n    branches: \[main\]\n    paths:/);
  assert.doesNotMatch(deploy, /pull_request:/);
  assert.match(deploy, /source: "deployment\/site\/\*"/);
  assert.match(deploy, /strip_components: 2/);
  assert.equal((deploy.match(/if: steps\.changes\.outputs\.payment == 'true'/g) || []).length, 2);
  assert.ok(deploy.indexOf('Back up and verify current deployment') < deploy.indexOf('Deploy Payment Service'));
  assert.match(deploy, /source: "payment\/app\.py,payment\/wsgi\.py,payment\/package_products\.py,payment\/requirements\.txt,deploy\/zhilin-shop\.service"/);
  assert.doesNotMatch(deploy, /source: "payment,|source: ".*tools\/preview-payment/);
});
