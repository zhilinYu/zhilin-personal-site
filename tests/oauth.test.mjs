import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
async function setup(t,override={}) {
 const filename=path.join(root,'deployment/oauth.mjs');assert.ok(fs.existsSync(filename),'独立授权服务必须存在');
 const {createOAuthServer}=await import(filename);let calls=0,clock=100000;
 const config={origin:'https://zhilin.club',clientId:'test-client',clientSecret:'test-secret',allowedLogin:'zhilinYu',repo:'zhilinYu/zhilin-personal-site',now:()=>clock,fetchImpl:async url=>{
  calls++;return {ok:true,json:async()=>url.includes('/access_token')?{access_token:'test-token'}:url.endsWith('/user')?{login:'zhilinYu'}:{permissions:{push:true}}};
 },...override};
 const server=createOAuthServer(config);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const base='http://127.0.0.1:'+server.address().port;
 const begin=async()=>{const r=await fetch(base+'/cms/auth?provider=github&site_id=evil.example',{redirect:'manual'});const url=new URL(r.headers.get('location'));return {response:r,state:url.searchParams.get('state'),cookie:r.headers.get('set-cookie').split(';')[0],url};};
 const callback=({state,cookie})=>fetch(base+'/cms/callback?code=test-code&state='+state,{headers:{cookie}});
 return {base,begin,callback,calls:()=>calls,setClock:v=>clock=v,createOAuthServer,config};
}
test('有效授权只将令牌发给固定站点，state 一次性使用',async t=>{
 const api=await setup(t);const auth=await api.begin();assert.equal(auth.response.status,302);
 assert.equal(auth.url.searchParams.get('scope'),'public_repo');
 assert.equal(auth.url.searchParams.get('redirect_uri'),'https://zhilin.club/cms/callback');assert.match(auth.response.headers.get('set-cookie'),/HttpOnly.*Secure.*SameSite=Lax/);
 const r=await api.callback(auth);assert.equal(r.status,200);const body=await r.text();assert.match(body,/authentication:github:success/);assert.match(body,/https:\/\/zhilin.club/);assert.doesNotMatch(body,/evil\.example|postMessage\([^)]*,\s*["']\*["']/);
 assert.ok(r.headers.get('content-security-policy').includes("default-src 'none'"));assert.equal(r.headers.get('cache-control'),'no-store');
 assert.equal((await api.callback(auth)).status,400);assert.equal(api.calls(),3);
});
test('无 state、错误浏览器会话和过期回调不交换令牌',async t=>{
 const api=await setup(t);const auth=await api.begin();assert.equal((await api.callback({...auth,state:'bad'})).status,400);assert.equal((await api.callback({...auth,cookie:'__Host-cms_session=other'})).status,400);
 api.setClock(100000+10*60*1000+1);assert.equal((await api.callback(auth)).status,400);assert.equal(api.calls(),0);
});
test('非指定账号和无仓库写权限不返回令牌',async t=>{
 for(const wrong of ['account','permission']) {
  const api=await setup(t,{fetchImpl:async url=>({ok:true,json:async()=>url.includes('/access_token')?{access_token:'private-token'}:url.endsWith('/user')?{login:wrong==='account'?'another-user':'zhilinYu'}:{permissions:{push:false}}})});
  const r=await api.callback(await api.begin());assert.equal(r.status,403);assert.doesNotMatch(await r.text(),/private-token/);
 }
});
test('第三方来源、错误 provider 和配置缺失被拒绝',async t=>{
 const api=await setup(t);assert.equal((await fetch(api.base+'/cms/auth',{headers:{origin:'https://evil.example'}})).status,403);
 assert.equal((await fetch(api.base+'/cms/auth?provider=gitlab')).status,400);
 assert.throws(()=>api.createOAuthServer({...api.config,clientSecret:''}),/配置/);
 assert.throws(()=>api.createOAuthServer({...api.config,origin:'https://evil.example/path'}),/来源/);
});
test('GitHub 故障不会泄露敏感参数或返回成功',async t=>{
 const api=await setup(t,{fetchImpl:async()=>{throw Error('test-secret private-token');}});const r=await api.callback(await api.begin());assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/test-secret|private-token/);
});
