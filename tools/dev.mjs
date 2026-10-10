import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ROOT,buildSite} from './build.mjs';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.yml':'application/yaml; charset=utf-8','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.zip':'application/zip','.wasm':'application/wasm','.txt':'text/plain; charset=utf-8'};
export function createPreview(root=ROOT,status=()=>({ok:true})) {
 return http.createServer((req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  let name;try{name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(404);res.end();return;}
  if(name==='/__build/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(status()));return;}
  if(name==='/')name='/index.html';if(name==='/admin/')name='/admin/index.html';if(name==='/resume/')name='/resume/index.html';
  if(!(/^\/(?:index\.html|(?:assets|admin|resume)\/[^\0\\]+)$/.test(name))||name.split('/').some(x=>x==='..'||x==='.')||name.split('/').some(x=>x.startsWith('.'))){res.writeHead(404);res.end();return;}
  const target=path.join(root,name);
  try{
   if(!fs.realpathSync(target).startsWith(fs.realpathSync(root)+path.sep)||!fs.statSync(target).isFile())throw Error('path');
   res.setHeader('Content-Type',mime[path.extname(target)]||'application/octet-stream');
   if(target.endsWith('.zip'))res.setHeader('Content-Disposition','attachment');
   if(req.method==='HEAD'){res.end();return;}
   const stream=fs.createReadStream(target);stream.on('error',()=>res.destroy());stream.pipe(res);
  }catch{res.writeHead(404);res.end();}
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const port=Number(process.env.ZHI_SITE_PORT||8766),proxyPort=8081;
 let state={ok:true,error:''},timer;
 const rebuild=()=>{try{const {items}=buildSite(ROOT);state={ok:true,error:'',items:items.length};console.log(`预览已更新：${items.length} 条`);}catch(e){state={ok:false,error:e.message};console.error(`保留旧页面：${e.message}`);}};
 rebuild();
 const proxy=spawn(process.execPath,[path.join(ROOT,'node_modules/decap-server/dist/index.js')],{cwd:ROOT,env:{...process.env,PORT:String(proxyPort),BIND_HOST:'127.0.0.1',ORIGIN:`http://127.0.0.1:${port}`,LOG_LEVEL:'warn'},stdio:'inherit'});
 const server=createPreview(ROOT,()=>state);
 const watcher=fs.watch(path.join(ROOT,'content'),{recursive:true},()=>{clearTimeout(timer);timer=setTimeout(rebuild,350);});
 server.on('error',e=>{console.error(e.message);proxy.kill();watcher.close();process.exitCode=1;});
 proxy.on('exit',code=>{if(code){console.error('本地编辑服务未启动，检查 8081 端口或依赖。');server.close();watcher.close();process.exitCode=1;}});
 server.listen(port,'127.0.0.1',()=>console.log(`内容后台：http://127.0.0.1:${port}/admin/\n网站预览：http://127.0.0.1:${port}/`));
 const close=()=>{clearTimeout(timer);watcher.close();proxy.kill();server.close();};
 process.on('SIGINT',close);process.on('SIGTERM',close);
}
