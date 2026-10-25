import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {exportSite} from '../tools/export.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function makeFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhilin-assets-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const write = (relative, content) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), {recursive:true});
    fs.writeFileSync(file, content);
  };
  for (const dir of ['templates','content/articles','content/prompts','content/skills','assets/games','assets/uploads','admin','resume','资源']) {
    fs.mkdirSync(path.join(root, dir), {recursive:true});
  }
  write('templates/index.html', `<!doctype html>
<link rel="stylesheet" href="assets/creative-space.css">
<link rel="stylesheet" href="assets/themes.css">
<script src="assets/checkout.js"></script>
<script src="assets/navigation.js"></script>
<script src="assets/skin.js"></script>
<!-- CMS:UPDATE_DATE --><!-- CMS:RESOURCE_COUNT --><!-- CMS:PROMPT_COUNT --><!-- CMS:SKILL_COUNT --><!-- CMS:PATHS --><!-- CMS:LATEST --><!-- CMS:RESOURCE_FILTERS --><!-- CMS:RESOURCE_CARDS --><!-- CMS:PROJECTS --><!-- CMS:SERVICES -->
<script id="site-data" type="application/json"><!-- CMS:DATA --></script>
<script id="shop-catalog" type="application/json"><!-- CMS:SHOP --></script>`);
  write('templates/fixed-catalog.json', '[]');
  write('templates/art.json', '{}');
  write('content/prompts/example.json', JSON.stringify({id:'example',title:'Prompt',desc:'Test resource',tag:'提示词',type:'open-prompt',group:'community',enabled:true,order:1}));
  write('admin/config.yml', JSON.stringify({local_backend:true}));
  write('admin/index.html', '<!doctype html>');
  write('resume/index.html', '<!doctype html>');
  for (const name of ['creative-space.css','themes.css','checkout.js','navigation.js','skin.js','games/games.css','games/games.js','games/theme.js']) {
    write(`assets/${name}`, `/* ${name} */\n`);
  }
  for (const name of ['2048.html','tetris.html']) {
    write(`assets/games/${name}`, `<!doctype html>
<link rel="stylesheet" href="../creative-space.css">
<link rel="stylesheet" href="games.css">
<script src="theme.js"></script>
<script src="games.js"></script>
<a href="../../index.html" data-theme-handoff>← 返回首页</a>`);
  }
  return root;
}

function versionedReferences(html) {
  return [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)].map((match) => match[1]);
}

function assertLocalAssetsAreVersioned(html, outputRoot, documentPath) {
  const documentUrl = new URL(documentPath, 'https://site.test/');
  for (const reference of versionedReferences(html)) {
    const url = new URL(reference, documentUrl);
    if (url.origin !== 'https://site.test' || !/\.(?:css|js)$/i.test(url.pathname)) continue;
    const assetPath = path.join(outputRoot, decodeURIComponent(url.pathname.replace(/^\/+/, '')));
    assert.ok(fs.statSync(assetPath).isFile(), `${reference} must resolve inside the exported site`);
    if (url.pathname === '/assets/checkout.js') {
      assert.equal(url.searchParams.has('v'), false, 'checkout stays outside the creative-space cache fix');
      continue;
    }
    assert.equal(url.searchParams.get('v'), digest(assetPath), `${reference} must carry the current asset content hash`);
  }
}

test('build and export version homepage and game assets by content hash', (t) => {
  const root = makeFixture(t);
  const out = path.join(root, 'deployment/site');
  exportSite(root, out);

  const home = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assertLocalAssetsAreVersioned(home, out, 'index.html');
  const homeSharedCss = new URL(versionedReferences(home).find((url) => url.includes('creative-space.css')), 'https://site.test/').searchParams.get('v');
  assert.ok(homeSharedCss, 'homepage shared stylesheet must have a content hash');

  for (const pageName of ['2048.html','tetris.html']) {
    const relative = `assets/games/${pageName}`;
    const page = fs.readFileSync(path.join(out, relative), 'utf8');
    assertLocalAssetsAreVersioned(page, out, relative);
    const gameSharedCss = new URL(versionedReferences(page).find((url) => url.includes('creative-space.css')), new URL(relative, 'https://site.test/')).searchParams.get('v');
    assert.equal(gameSharedCss, homeSharedCss, 'the same shared stylesheet must use one content hash across home and games');
  }
});

test('re-export changes asset URLs when the referenced script content changes', (t) => {
  const root = makeFixture(t);
  const out = path.join(root, 'deployment/site');
  exportSite(root, out);
  const homeBefore = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  const before = new URL(versionedReferences(homeBefore).find((url) => url.includes('skin.js')), 'https://site.test/').searchParams.get('v');

  fs.appendFileSync(path.join(root, 'assets/skin.js'), 'window.skinHotfix = true;\n');
  exportSite(root, out);
  const homeAfter = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  const after = new URL(versionedReferences(homeAfter).find((url) => url.includes('skin.js')), 'https://site.test/').searchParams.get('v');

  assert.notEqual(after, before, 'changed script content must not reuse the previous asset URL');
  assertLocalAssetsAreVersioned(homeAfter, out, 'index.html');
});
