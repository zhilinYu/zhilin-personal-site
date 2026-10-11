import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT,buildSite} from './build.mjs';
export function exportSite(root=ROOT,out=path.join(ROOT,'deployment/site')) {
 root=path.resolve(root);out=path.resolve(out);const relative=path.relative(root,out);
 if(!relative||root.startsWith(out+path.sep)||(!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)&&relative!==path.join('deployment','site')))throw Error('发布目录不能覆盖源码');
 if(fs.existsSync(out)&&fs.lstatSync(out).isSymbolicLink())throw Error('发布目录不能是符号链接');
 buildSite(root);fs.mkdirSync(path.dirname(out),{recursive:true});const stage=fs.mkdtempSync(out+'.tmp-');
 try{
 for(const name of ['index.html','assets','admin','resume'])fs.cpSync(path.join(root,name),path.join(stage,name),{recursive:true,filter:source=>{
  if(fs.lstatSync(source).isSymbolicLink())throw Error('发布资源不能包含符号链接');
  if(fs.statSync(source).isDirectory())return true;
  if(source.includes(path.sep+'uploads'+path.sep)&&!['.zip','.png','.jpg','.jpeg','.webp','.gif'].includes(path.extname(source).toLowerCase()))throw Error('公开上传目录包含不允许发布的文件');
  return !source.endsWith('.map')&&!path.basename(source).startsWith('.');
 }});
 const configPath=path.join(stage,'admin/config.yml'),config=JSON.parse(fs.readFileSync(configPath,'utf8'));delete config.local_backend;fs.writeFileSync(configPath,JSON.stringify(config,null,2)+'\n');
 fs.chmodSync(stage,0o755);fs.rmSync(out,{recursive:true,force:true});fs.renameSync(stage,out);
 }finally{fs.rmSync(stage,{recursive:true,force:true});}
 return out;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log('静态发布包：'+exportSite());
