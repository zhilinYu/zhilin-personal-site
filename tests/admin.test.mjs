import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
test('后台三类集合使用真实 JSON 文件，公开上传有限制',()=>{
  const filename=path.join(root,'admin/config.yml');assert.ok(fs.existsSync(filename),'后台配置必须存在');
  const config=JSON.parse(fs.readFileSync(filename));assert.deepEqual(config.collections.map(x=>x.name),['articles','prompts','skills','settings']);
  const settings=config.collections.pop();assert.deepEqual(settings.files.map(x=>x.file),['content/settings/market.json']);assert.equal(settings.delete,false);
  assert.equal(config.backend.name,'github');assert.equal(config.backend.repo,'zhilinYu/zhilin-personal-site');assert.equal(config.publish_mode,'editorial_workflow');
  assert.equal(config.backend.auth_scope,'public_repo');
  for(const collection of config.collections){assert.equal(collection.format,'json');assert.equal(collection.identifier_field,'id');assert.equal(collection.folder,'content/'+collection.name);assert.ok(collection.fields.some(x=>x.name==='enabled'&&x.default===false));}
  const skill=config.collections[2];assert.equal(skill.fields.find(x=>x.name==='attachment').media_library.config.max_file_size,10*1024*1024);
  assert.equal(skill.fields.find(x=>x.name==='image').media_library.config.max_file_size,2*1024*1024);
});
test('本地预览只开放发布文件，拒绝目录越界和源码目录',async t=>{
  const file=path.join(root,'tools/dev.mjs');assert.ok(fs.existsSync(file),'本地编辑入口必须存在');
  const {createPreview}=await import(file);const server=createPreview(root);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const base='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(base+'/')).status,200);assert.equal((await fetch(base+'/admin/')).status,200);
  for(const url of ['/content/articles/article-0.json','/.env','/node_modules/markdown-it/package.json','/templates/index.html','/assets/..%2f..%2fpackage.json'])assert.equal((await fetch(base+url)).status,404,url);
  assert.equal((await fetch(base+'/',{method:'POST',body:'bad'})).status,405);
});

test('付费 Skill 后台只列出已授权商品并提示所有公开字段和私有交付',async()=>{
  const config=JSON.parse(fs.readFileSync(path.join(root,'admin/config.yml')));
  const fields=config.collections.find(c=>c.name==='skills').fields;
  const byName=name=>fields.find(f=>f.name===name);
  assert.deepEqual(byName('sku').options.map(o=>o.value),['ashare-five-strategies']);
  assert.equal(byName('sku').required,false);assert.equal(byName('price').required,false);
  assert.ok(new RegExp(byName('price').pattern[0]).test('¥99.0'));
  assert.equal(new RegExp(byName('price').pattern[0]).test('¥9.9'),false);
  assert.match(byName('sku').hint,/私有/);assert.match(byName('attachment').hint,/公开仓库/);
  assert.match(byName('body').hint,/公开展示/);assert.match(byName('desc').hint,/公开展示/);
  const {validateItem}=await import('../tools/build.mjs');
  const skill={id:'ashare-local',title:'研究助手',type:'local-skill',group:'local',enabled:true,sku:'ashare-five-strategies',price:'¥99.0'};
  assert.throws(()=>validateItem(root,{...skill,attachment:'assets/uploads/paid.zip'},'skills'),/付费内容/);
  assert.throws(()=>validateItem(root,{...skill,price:'¥9.9'},'skills'),/不一致/);
});
