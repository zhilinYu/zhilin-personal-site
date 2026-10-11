(async()=>{
 const hint=document.querySelector('#editor-hint'),message=hint.querySelector('span');
 try{
  const response=await fetch('config.yml',{cache:'no-store'});if(!response.ok)throw Error('后台配置加载失败');
  const config=await response.json(),local=['localhost','127.0.0.1'].includes(location.hostname);
  if(local){config.site_url=location.origin;config.display_url=location.origin;config.publish_mode='simple';}
  else delete config.local_backend;
  config.load_config_file=false;
  window.CMS.init({config});
  window.CMS.registerEventListener({name:'preSave',handler:({entry})=>{
   const data=entry.get('data');
   if(data.get('type')==='paid-prompt'&&(data.get('prompt')?.trim()||data.get('attachment')))throw Error('收费条目只能保存公开介绍，请清空全文和附件。');
   return data;
  }});
  message.textContent=local?'本地编辑：保存写入本机。开启“公开展示”后生成预览；正式 GitHub 草稿流程上线后启用。':'GitHub 内容管理：保存草稿后可预览，再点击发布。上线结果请查看发布任务。';
  if(local){
   const update=async()=>{try{const r=await fetch('/__build/status',{cache:'no-store'});if(!r.ok)return;const state=await r.json();hint.dataset.error=String(!state.ok);message.textContent=state.ok?'本地模式：预览正常。编辑后点击发布写入本机；未开启“公开展示”的内容保持隐藏。':'预览生成失败，旧页面已保留：'+state.error;}catch{message.textContent='本地服务已停止，重新启动后即可继续编辑。';}};
   await update();setInterval(update,2500);
  }
 }catch(error){hint.dataset.error='true';message.textContent='后台未能启动：'+error.message;}
})();
