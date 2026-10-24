import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const sandbox = {module:{exports:{}}};
vm.runInNewContext(fs.readFileSync(path.join(project,'assets/navigation.js'),'utf8'), sandbox);
const {resolveHash} = sandbox.module.exports;
const tabs = ['prompts','skills','products','about','collaborate'];
const pageAnchors = ['top','library'];
const result = (hash) => JSON.parse(JSON.stringify(resolveHash(hash,tabs,pageAnchors)));

test('real home and library anchors remain scroll anchors',()=>{
  assert.deepEqual(result('#top'),{type:'anchor',id:'top',hash:'#top',replaceHash:false});
  assert.deepEqual(result('#library'),{type:'anchor',id:'library',hash:'#library',replaceHash:false});
});

test('tab hashes open their panels; removed article and unknown hashes fall back to prompts',()=>{
  assert.deepEqual(result('#skills'),{type:'tab',id:'skills',hash:'#skills',replaceHash:false});
  assert.deepEqual(result('#articles'),{type:'tab',id:'prompts',hash:'#prompts',replaceHash:true});
  assert.deepEqual(result('#workflow-retry-recovery-20261024'),{type:'tab',id:'prompts',hash:'#prompts',replaceHash:true});
  assert.deepEqual(result('#unknown-route'),{type:'tab',id:'prompts',hash:'#prompts',replaceHash:true});
});

test('resume link stays in the header on narrow layouts',()=>{
  const template=fs.readFileSync(path.join(project,'templates/index.html'),'utf8');
  const themes=fs.readFileSync(path.join(project,'assets/themes.css'),'utf8');
  assert.match(template,/<div class="header-links"><a href="resume\/index\.html"/);
  assert.doesNotMatch(themes,/\.header-links>a:first-child\s*\{\s*display\s*:\s*none/);
});

test('template registers actual page anchors and loads the tested resolver before skin.js',()=>{
  const template=fs.readFileSync(path.join(project,'templates/index.html'),'utf8');
  assert.match(template,/<section class="hero" id="top" data-page-anchor/);
  assert.match(template,/<section class="library" id="library" data-page-anchor>/);
  assert.match(template,/<script src="assets\/navigation\.js"><\/script><script src="assets\/skin\.js"><\/script>/);
  assert.doesNotMatch(template,/tab-articles|panel-articles|CMS:ARTICLES/);
});
