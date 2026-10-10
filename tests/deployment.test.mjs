import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
test('内容发布流程只上传静态包，不重启支付服务，保留备份门禁',()=>{
 const filename=path.join(root,'deployment/content-deploy.yml');assert.ok(fs.existsSync(filename),'内容发布流程必须存在');const text=fs.readFileSync(filename,'utf8');
 assert.match(text,/preflight_backup\.py/);assert.match(text,/zhilin-production/);assert.match(text,/npm ci/);assert.match(text,/tools\/export\.mjs/);assert.doesNotMatch(text,/systemctl|Deploy Payment Service|payment\/requirements/);
 const legacy=fs.readFileSync(path.join(root,'deployment/legacy-deploy.yml'),'utf8');assert.match(legacy,/paths-ignore:/);assert.match(legacy,/content\/\*\*/);
 assert.match(legacy,/tools\/export\.mjs/);assert.match(legacy,/source: "deployment\/site\/\*"/);assert.doesNotMatch(legacy,/source: "index\.html/);
});
test('发布包只有页面、后台、公开资源和简历，不含内容源或配置',async t=>{
 const filename=path.join(root,'tools/export.mjs');assert.ok(fs.existsSync(filename),'发布导出入口必须存在');const {exportSite}=await import(filename);
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'zhilin-export-'));t.after(()=>fs.rmSync(out,{recursive:true,force:true}));fs.writeFileSync(path.join(out,'.env'),'old');fs.mkdirSync(path.join(out,'content'));fs.writeFileSync(path.join(out,'content/old.json'),'{}');exportSite(root,out);
 assert.deepEqual(fs.readdirSync(out).sort(),['admin','assets','index.html','resume']);assert.ok(fs.existsSync(path.join(out,'admin/config.yml')));assert.equal(fs.existsSync(path.join(out,'content')),false);assert.equal(fs.existsSync(path.join(out,'.env')),false);
 assert.equal(JSON.parse(fs.readFileSync(path.join(out,'admin/config.yml'))).local_backend,undefined);
 assert.throws(()=>exportSite(root,path.join(root,'assets')),/源码/);
});
