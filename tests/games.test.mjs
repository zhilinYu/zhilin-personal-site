import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));

class Element {
  constructor(dataset = {}) { this.dataset=dataset; this.listeners={}; this.attributes={}; this.textContent=''; this.innerHTML=''; this.hidden=false; this.isConnected=true; }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  fire(type, event={}) { for (const callback of this.listeners[type] || []) callback({target:this,currentTarget:this,preventDefault(){this.prevented=true;},...event}); }
  setAttribute(name,value) { this.attributes[name]=String(value); }
  querySelector(selector) { return this.children?.[selector] || new Element(); }
  querySelectorAll(selector) { return selector==='[data-move]' ? this.moves || [] : []; }
}

function gameHarness(kind, randomValue=kind==='tetris'?.2:0) {
  const board=new Element(),score=new Element(),status=new Element(),lines=new Element(),next=new Element();
  const fullscreen=new Element(),howto=new Element(),howtoPanel=new Element(),restart=new Element(),pause=new Element();
  const moveButtons=kind==='2048'?['up','left','down','right'].map(move=>new Element({move})):
    ['left','rotate','right','down','drop'].map(move=>new Element({move}));
  const app=new Element({game:kind});
  app.children={
    '[data-board]':board,'[data-score]':score,'[data-status]':status,'[data-lines]':lines,'[data-next]':next,
    '[data-fullscreen]':fullscreen,'[data-howto]':howto,'[data-howto-panel]':howtoPanel,'[data-restart]':restart,'[data-pause]':pause,
  };
  app.moves=moveButtons;
  const documentListeners={};
  const document={fullscreenElement:null,hidden:false,documentElement:{},querySelector(selector){return selector==='.play-app'?app:null;},addEventListener(type,callback){(documentListeners[type] ||= []).push(callback);}};
  let timerId=0;const intervals=new Map();
  const math=Object.create(Math); math.random=()=>randomValue;
  const context={document,Math:math,setInterval(callback){const id=++timerId;intervals.set(id,callback);return id;},clearInterval(id){intervals.delete(id);},console};
  vm.runInNewContext(fs.readFileSync(path.join(project,'assets/games/games.js'),'utf8'),context);
  return {app,board,score,status,lines,next,moveButtons,documentListeners,restart,pause,document,intervals};
}

test('standalone game pages use only local assets and preserve the four theme choices',()=>{
  for(const [filename,kind] of [['2048.html','2048'],['tetris.html','tetris']]){
    const page=fs.readFileSync(path.join(project,'assets/games',filename),'utf8');
    assert.match(page,new RegExp(`data-game="${kind}"`));
    assert.match(page,/href="\.\.\/creative-space\.css"/);
    assert.match(page,/src="games\.js"/);
    assert.match(page,/value="tech"/);
    assert.match(page,/value="fresh"/);
    assert.match(page,/value="paper"/);
    assert.match(page,/value="graphite"/);
    assert.match(page,/href="\.\.\/\.\.\/index\.html"/);
  }
  const tetris=fs.readFileSync(path.join(project,'assets/games/tetris.html'),'utf8');
  assert.match(tetris,/data-pause/);
  assert.doesNotMatch(tetris,/暂停后可按重新开始继续/);
});

test('game theme selection persists and puts the selected theme on the return link',()=>{
  const source=fs.readFileSync(path.join(project,'assets/games/theme.js'),'utf8');
  function harness(search='',saved='fresh'){
    const listeners={},windowListeners={},storage=new Map([['zhilin-site-theme',saved]]);
    const select={value:'tech',listeners:{},addEventListener(type,callback){(this.listeners[type] ||= []).push(callback);}};
    const link={href:'/index.html',getAttribute(){return '/index.html';}};
    const root={dataset:{theme:'tech'},classList:{add(){},remove(){}},get offsetWidth(){return 1;}};
    const document={documentElement:root,addEventListener(type,callback){listeners[type]=callback;},querySelectorAll(selector){return selector==='[data-theme-select]'?[select]:selector==='[data-theme-handoff]'?[link]:[];}};
    const window={addEventListener(type,callback){windowListeners[type]=callback;},dispatchEvent(){}};
    const location=new URL(`https://zhilin.club/assets/games/2048.html${search}`);
    const context={document,window,location,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},URL,URLSearchParams,history:{replaceState(){}},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail;}},requestAnimationFrame:callback=>callback()};
    vm.runInNewContext(source,context);
    listeners.DOMContentLoaded();
    return {root,select,link,storage,windowListeners};
  }
  const game=harness();
  assert.equal(game.root.dataset.theme,'fresh');
  game.select.value='paper';game.select.listeners.change[0]();
  assert.equal(game.storage.get('zhilin-site-theme'),'paper');
  assert.equal(game.link.href,'/index.html?theme=paper');
  assert.equal(harness('?theme=graphite','tech').root.dataset.theme,'graphite','handoff query takes priority on game entry');
});

test('2048 initializes a board and direction-key input merges equal tiles',()=>{
  const game=gameHarness('2048');
  assert.equal((game.board.innerHTML.match(/class="tile/g)||[]).length,16);
  assert.equal((game.board.innerHTML.match(/data-value="2"/g)||[]).length,2);
  const event={key:'ArrowLeft',target:{matches:()=>false},preventDefault(){this.prevented=true;}};
  game.documentListeners.keydown[0](event);
  assert.match(game.board.innerHTML,/data-value="4"/);
  assert.equal(game.score.textContent,'4');
});

test('2048 arrow keys still control the board after a button is focused',()=>{
  const game=gameHarness('2048');
  const initial=game.board.innerHTML;
  game.restart.fire('click');
  let prevented=false;
  game.documentListeners.keydown[0]({key:'ArrowLeft',target:{matches:selector=>selector==='button'},preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  assert.notEqual(game.board.innerHTML,initial);
  assert.match(game.board.innerHTML,/data-value="4"/);
});

test('2048 leaves arrow keys available to focused form controls',()=>{
  const game=gameHarness('2048');
  const initial=game.board.innerHTML;let prevented=false;
  game.documentListeners.keydown[0]({key:'ArrowRight',target:{matches:selector=>selector==='select,input,textarea'},preventDefault(){prevented=true;}});
  assert.equal(prevented,false);
  assert.equal(game.board.innerHTML,initial);
});

test('block game initializes its 10 by 20 board and drop input advances play',()=>{
  const game=gameHarness('tetris');
  assert.equal((game.board.innerHTML.match(/class="tetris-cell/g)||[]).length,200);
  assert.ok(game.next.innerHTML.includes('filled'));
  game.moveButtons.find(button=>button.dataset.move==='drop').fire('click');
  assert.equal((game.board.innerHTML.match(/class="tetris-cell/g)||[]).length,200);
  assert.ok(Number(game.score.textContent)>0);
});

test('block preview centers the long piece and shows all four cells',()=>{
  const game=gameHarness('tetris',0);
  const filledIndices=[...game.next.innerHTML.matchAll(/<i class="filled"/g)].map(match=>[...game.next.innerHTML.slice(0,match.index).matchAll(/<i(?:\s|>)/g)].length);
  assert.deepEqual(filledIndices,[4,5,6,7]);
});

test('block game pauses, resumes, stops in background, and restart clears the board',()=>{
  const game=gameHarness('tetris');
  game.moveButtons.find(button=>button.dataset.move==='down').fire('click');
  assert.equal(game.intervals.size,1,'soft-drop tap must not create a duplicate gravity timer');
  game.moveButtons.find(button=>button.dataset.move==='drop').fire('click');
  assert.ok(Number(game.score.textContent)>0);
  assert.equal(game.intervals.size,1);

  game.pause.fire('click');
  assert.equal(game.intervals.size,0);
  assert.equal(game.pause.textContent,'继续');
  assert.equal(game.pause.attributes['aria-pressed'],'true');
  const pausedBoard=game.board.innerHTML;
  const focusedButton={matches:selector=>selector==='button'};
  game.documentListeners.keydown[0]({key:'ArrowLeft',target:focusedButton,preventDefault(){}});
  assert.equal(game.board.innerHTML,pausedBoard,'paused input must not move pieces');

  game.pause.fire('click');
  assert.equal(game.intervals.size,1);
  assert.equal(game.pause.textContent,'暂停');
  assert.equal(game.pause.attributes['aria-pressed'],'false');
  game.documentListeners.keydown[0]({key:'ArrowLeft',target:focusedButton,preventDefault(){}});
  assert.notEqual(game.board.innerHTML,pausedBoard,'keyboard movement must resume while the continue button remains focused');

  game.document.hidden=true;
  game.documentListeners.visibilitychange[0]();
  assert.equal(game.intervals.size,0,'background tab must stop gravity');
  assert.match(game.status.textContent,/切到后台/);
  game.document.hidden=false;
  game.documentListeners.visibilitychange[0]();
  assert.equal(game.intervals.size,0,'returning to foreground must not resume unexpectedly');
  game.pause.fire('click');
  assert.equal(game.intervals.size,1);

  game.restart.fire('click');
  assert.equal(game.score.textContent,'0');
  assert.equal(game.lines.textContent,'0');
  assert.equal((game.board.innerHTML.match(/class="tetris-cell filled/g)||[]).length,4);
  assert.equal(game.intervals.size,1);
  assert.equal(game.pause.textContent,'暂停');
  assert.equal(game.pause.attributes['aria-pressed'],'false');
});

test('block game ignores repeated hard-drop input and stops accepting moves after game over',()=>{
  const game=gameHarness('tetris');
  const dropEvent={key:' ',repeat:false,target:{matches:()=>false},preventDefault(){this.prevented=true;}};
  game.documentListeners.keydown[0](dropEvent);
  const afterFirstDrop=game.score.textContent;
  game.documentListeners.keydown[0]({...dropEvent,repeat:true});
  assert.equal(game.score.textContent,afterFirstDrop,'browser key repeat must not hard-drop multiple pieces');
  assert.equal(dropEvent.prevented,true);

  const drop=game.moveButtons.find(button=>button.dataset.move==='drop');
  for(let i=0;i<12;i++)drop.fire('click');
  assert.match(game.status.textContent,/游戏结束/);
  assert.equal(game.intervals.size,0);
  const endedBoard=game.board.innerHTML,endedScore=game.score.textContent;
  game.moveButtons.find(button=>button.dataset.move==='left').fire('click');
  game.documentListeners.keydown[0]({key:'ArrowRight',repeat:false,target:{matches:()=>false},preventDefault(){}});
  assert.equal(game.board.innerHTML,endedBoard);
  assert.equal(game.score.textContent,endedScore);
  game.restart.fire('click');
  assert.equal(game.score.textContent,'0');
  assert.equal(game.intervals.size,1);
});

test('block game arrow keys still control the board after restart focus and preserve Space button activation',()=>{
  const game=gameHarness('tetris');let prevented=false;
  const initial=game.board.innerHTML;
  game.restart.fire('click');
  const focusedButton={matches:selector=>selector==='button'};
  game.documentListeners.keydown[0]({key:'ArrowRight',repeat:false,target:focusedButton,preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  assert.notEqual(game.board.innerHTML,initial);
  let spacePrevented=false;
  game.documentListeners.keydown[0]({key:' ',repeat:false,target:focusedButton,preventDefault(){spacePrevented=true;}});
  assert.equal(spacePrevented,false,'Space remains available for the focused button native action');
});
