import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const safeJSON=x=>JSON.stringify(x).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
export function createOAuthServer({origin,clientId,clientSecret,allowedLogin,repo,fetchImpl=fetch,now=Date.now}) {
 let site;try{site=new URL(origin);}catch{throw Error('授权来源配置无效');}
 if(site.protocol!=='https:'||site.origin!==origin||site.username||site.password)throw Error('授权来源必须是精确的 HTTPS 来源');
 if(!clientId||!clientSecret||!allowedLogin||!/^[-a-zA-Z0-9]+\/[-a-zA-Z0-9_.]+$/.test(repo||''))throw Error('授权配置不完整');
 const states=new Map(),ttl=10*60*1000,callback=origin+'/cms/callback';
 const json=async(url,options={})=>{const response=await fetchImpl(url,{...options,signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('GitHub 请求失败');return response.json();};
 return http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  const nonce=crypto.randomBytes(18).toString('base64');res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'`);
  const fail=(status,message)=>{res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8'});res.end(message);};
  if(req.method!=='GET'){fail(405,'不支持的请求');return;}
  const url=new URL(req.url,origin);
  if(req.headers.origin&&req.headers.origin!==origin){fail(403,'授权来源不允许');return;}
  for(const [id,value] of states)if(now()-value.created>ttl)states.delete(id);
  if(url.pathname==='/cms/health'){res.setHeader('Content-Type','application/json');res.end('{"ok":true}');return;}
  if(url.pathname==='/cms/auth') {
   if(url.searchParams.get('provider')&&!['github'].includes(url.searchParams.get('provider'))){fail(400,'仅支持 GitHub 登录');return;}
   if(states.size>=500){fail(429,'授权请求过多，请稍后重试');return;}
   const state=crypto.randomBytes(32).toString('hex'),session=crypto.randomBytes(32).toString('hex');
   states.set(state,{session,created:now()});res.setHeader('Set-Cookie',`__Host-cms_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
   const authorize=new URL('https://github.com/login/oauth/authorize');for(const [k,v] of Object.entries({client_id:clientId,redirect_uri:callback,state,scope:'repo'}))authorize.searchParams.set(k,v);
   res.writeHead(302,{Location:authorize.toString()});res.end();return;
  }
  if(url.pathname!=='/cms/callback'){fail(404,'未找到');return;}
  const state=url.searchParams.get('state'),saved=states.get(state),session=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('__Host-cms_session='))?.slice('__Host-cms_session='.length);
  const code=url.searchParams.get('code');
  if(!saved||saved.session!==session||!code||code.length>512){fail(400,'登录已过期或校验失败，请重新登录');return;}
  states.delete(state);res.setHeader('Set-Cookie','__Host-cms_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  try{
   const result=await json('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({client_id:clientId,client_secret:clientSecret,code,redirect_uri:callback})});
   if(typeof result.access_token!=='string'||!result.access_token){fail(403,'GitHub 未授予访问权限');return;}
   const headers={Authorization:'Bearer '+result.access_token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'zhilin-content-admin'};
   const user=await json('https://api.github.com/user',{headers});
   if(user.login?.toLowerCase()!==allowedLogin.toLowerCase()){fail(403,'此账号不能管理本站内容');return;}
   const repository=await json('https://api.github.com/repos/'+repo,{headers});if(!repository.permissions?.push){fail(403,'此账号没有内容仓库的写入权限');return;}
   const payload='authentication:github:success:'+JSON.stringify({token:result.access_token,provider:'github'});
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
   res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>GitHub 登录完成</title><p>登录完成，正在返回内容后台。可以关闭此窗口。</p><script nonce="${nonce}">const origin=${safeJSON(origin)};const payload=${safeJSON(payload)};function receive(event){if(event.origin!==origin||event.source!==window.opener||event.data!=='authorizing:github')return;window.removeEventListener('message',receive);window.opener.postMessage(payload,origin);window.close();}window.addEventListener('message',receive);if(window.opener)window.opener.postMessage('authorizing:github',origin);setTimeout(()=>window.removeEventListener('message',receive),30000);</script></html>`);
  }catch{fail(503,'GitHub 授权暂时不可用，请稍后重新登录');}
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try{const server=createOAuthServer({origin:process.env.CMS_ORIGIN,clientId:process.env.CMS_CLIENT_ID,clientSecret:process.env.CMS_CLIENT_SECRET,allowedLogin:process.env.CMS_ALLOWED_LOGIN,repo:process.env.CMS_REPO});server.listen(Number(process.env.CMS_PORT||9102),'127.0.0.1',()=>console.log('内容授权服务已启动，仅监听本机。'));}
 catch{console.error('内容授权配置无效，服务未启动。');process.exitCode=1;}
}
