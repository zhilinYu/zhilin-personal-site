import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const project = fileURLToPath(new URL('../', import.meta.url));
const sandbox = {module:{exports:{}}};
vm.runInNewContext(fs.readFileSync(path.join(project,'assets/navigation.js'),'utf8'), sandbox);
const {resolveHash} = sandbox.module.exports;
const pageAnchors = ['top','hero','start','play','latest','library','mac-tools','projects','services','about','contact'];
const result = (hash) => JSON.parse(JSON.stringify(resolveHash(hash,pageAnchors)));

test('valid page anchors, including home and the library, remain unchanged',()=>{
  for(const anchor of pageAnchors){
    assert.deepEqual(result(`#${anchor}`),{type:'anchor',id:anchor,hash:`#${anchor}`,replaceHash:false});
  }
});

test('removed article slugs and unknown hashes fall back to the resource index',()=>{
  for(const hash of ['#articles','#workflow-retry-recovery-20261024','#unknown-route']){
    assert.deepEqual(result(hash),{type:'fallback',id:'library',hash:'#library',replaceHash:true});
  }
});

test('creative-space layout offers real game pages before the searchable resource library',()=>{
  const template=fs.readFileSync(path.join(project,'templates/index.html'),'utf8');
  assert.ok(template.indexOf('id="play"') < template.indexOf('id="latest"'));
  assert.ok(template.indexOf('id="latest"') < template.indexOf('id="library"'));
  assert.match(template,/<a class="game-card game-2048" href="assets\/games\/2048\.html">/);
  assert.match(template,/<a class="game-card game-tetris" href="assets\/games\/tetris\.html">/);
  assert.match(template,/<section class="services-section" id="services" data-page-anchor/);
  assert.match(template,/<div class="site-shell" id="top" data-page-anchor>/);
  assert.doesNotMatch(template,/tab-articles|panel-articles|CMS:ARTICLES|#articles/);
});

test('homepage keeps the short biography without exposing a full-resume entry',()=>{
  const template=fs.readFileSync(path.join(project,'templates/index.html'),'utf8');
  assert.match(template,/我是志林，独立 AI 顾问，专注 AI 应用开发、实用工具和工作流。/);
  assert.doesNotMatch(template,/resume\/index\.html|查看完整简历/);
});

test('homepage honors a theme passed back from a game when localStorage is unavailable',()=>{
  const template=fs.readFileSync(path.join(project,'templates/index.html'),'utf8');
  const bootstrap=template.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(bootstrap);
  const document={documentElement:{dataset:{theme:'tech'}}};
  vm.runInNewContext(bootstrap,{document,location:{search:'?theme=paper'},URLSearchParams,localStorage:{getItem(){throw new Error('blocked');}}});
  assert.equal(document.documentElement.dataset.theme,'paper');
});

test('homepage theme changes replace a stale game query and survive refresh',()=>{
  const template=fs.readFileSync(path.join(project,'templates/index.html'),'utf8');
  const bootstrap=template.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const skin=fs.readFileSync(path.join(project,'assets/skin.js'),'utf8');
  let currentUrl=new URL('https://zhilin.club/index.html?source=game&theme=paper#about');
  const stored=new Map([['zhilin-site-theme','paper']]);

  function loadHome(){
    const select={value:'tech',listeners:{},addEventListener(type,callback){(this.listeners[type] ||= []).push(callback);}};
    const root={dataset:{theme:'tech'}};
    const meta={content:''};
    const document={
      documentElement:root,
      getElementById(id){return id==='site-data'?{textContent:'[]'}:null;},
      querySelector(selector){return selector==='meta[name="theme-color"]'?meta:null;},
      querySelectorAll(selector){return selector==='[data-page-anchor]'?[{id:'about'}]:selector==='[data-theme-select]'?[select]:[];},
      addEventListener(){}
    };
    const location={get href(){return currentUrl.href;},get pathname(){return currentUrl.pathname;},get search(){return currentUrl.search;},get hash(){return currentUrl.hash;}};
    const history={replaceState(_state,_title,url){currentUrl=new URL(url,currentUrl);}};
    const window={ZhilinNavigation:{resolveHash(hash,anchors){const id=String(hash||'').replace(/^#/,'');return anchors.includes(id)?{type:'anchor',id,hash:`#${id}`,replaceHash:false}:{type:'fallback',id:'library',hash:'#library',replaceHash:!!id};}}};
    const context={document,window,location,history,URL,URLSearchParams,localStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)},matchMedia:()=>({matches:true}),addEventListener(){}};
    vm.runInNewContext(bootstrap,context);
    vm.runInNewContext(skin,context);
    return {root,select};
  }

  const home=loadHome();
  assert.equal(home.root.dataset.theme,'paper');
  home.select.value='fresh';
  home.select.listeners.change[0]();
  assert.equal(home.root.dataset.theme,'fresh');
  assert.equal(currentUrl.searchParams.get('theme'),'fresh');
  assert.equal(currentUrl.searchParams.get('source'),'game');
  assert.equal(currentUrl.hash,'#about');
  assert.equal(loadHome().root.dataset.theme,'fresh');
});

test('standalone games have an explicit return-home link and shared theme handoff',()=>{
  for(const filename of ['2048.html','tetris.html']){
    const page=fs.readFileSync(path.join(project,'assets/games',filename),'utf8');
    assert.match(page,/<a href="\.\.\/\.\.\/index\.html" data-theme-handoff>← 返回首页<\/a>/);
  }
  const theme=fs.readFileSync(path.join(project,'assets/games/theme.js'),'utf8');
  assert.match(theme,/zhilin-site-theme/);
  assert.match(theme,/data-theme-handoff/);
  assert.match(theme,/searchParams\.set\("theme", value\)/);
});
