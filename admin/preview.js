(()=>{
 const h=window.h;
 const Preview=({entry,widgetFor,getAsset})=>{
  const data=entry.get('data'),image=data.get('image'),asset=image?getAsset(image):null;
  return h('article',{className:'cms-preview'},
   h('small',{},data.get('tag')||'预览'),h('h1',{},data.get('title')||'未填写标题'),h('p',{className:'summary'},data.get('desc')),
   asset?h('img',{src:asset.toString(),alt:''}):null,
   h('div',{className:'markdown-body'},widgetFor('body')),
   data.get('prompt')?h('pre',{},data.get('prompt')):null,
   data.get('attachment')?h('p',{},'公开 Skill ZIP：'+data.get('attachment')):null,
   h('footer',{},[data.get('source'),data.get('license'),data.get('version')].filter(Boolean).join(' · ')),
   h('p',{className:'visibility'},data.get('enabled')?'发布后公开展示':'隐藏草稿：不会出现在前台'));
 };
 for(const name of ['articles','prompts','skills'])window.CMS.registerPreviewTemplate(name,Preview);
 window.CMS.registerPreviewStyle('/assets/skin.css');
 window.CMS.registerPreviewStyle('.cms-preview{padding:28px;font-family:system-ui;background:#f2faf6;color:#1d3a30;line-height:1.8}.cms-preview h1{font-size:28px;line-height:1.4}.cms-preview img{max-width:100%;max-height:320px;border-radius:20px}.cms-preview .summary,.cms-preview footer{color:#607c70}.cms-preview pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;background:#e7f3ed;border-radius:12px}.cms-preview .visibility{font-size:12px}',{raw:true});
})();
