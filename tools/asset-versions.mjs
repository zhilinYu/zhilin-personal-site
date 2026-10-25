import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function assetFileForReference(root, documentPath, reference) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(reference)) return null;
  const match = reference.match(/^([^?#]*)(?:\?([^#]*))?(#.*)?$/);
  const pathname = match?.[1] || '';
  if (!/\.(?:css|js)$/i.test(pathname)) return null;

  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { throw new Error(`静态资源 URL 编码无效：${reference}`); }
  const relative = path.posix.normalize(decoded.startsWith('/')
    ? decoded.replace(/^\/+/, '')
    : path.posix.join(path.posix.dirname(documentPath.replaceAll(path.sep, '/')), decoded));
  if (!relative || relative === '..' || relative.startsWith('../')) throw new Error(`静态资源路径越界：${reference}`);
  if (relative === 'assets/checkout.js') return null;

  const rootReal = fs.realpathSync(root);
  const file = path.resolve(rootReal, ...relative.split('/'));
  if (!file.startsWith(rootReal + path.sep) || !fs.existsSync(file) || !fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) {
    throw new Error(`静态资源不存在或不是普通文件：${relative}`);
  }
  const fileReal = fs.realpathSync(file);
  if (!fileReal.startsWith(rootReal + path.sep)) throw new Error(`静态资源路径越界：${relative}`);
  return {file: fileReal, pathname, query: match?.[2] || '', fragment: match?.[3] || ''};
}

export function versionStaticAssets(html, root, documentPath) {
  return html.replace(/\b(src|href)=(['"])([^'"]+)\2/g, (attribute, name, quote, reference) => {
    const asset = assetFileForReference(root, documentPath, reference);
    if (!asset) return attribute;
    const version = crypto.createHash('sha256').update(fs.readFileSync(asset.file)).digest('hex');
    const query = new URLSearchParams(asset.query);
    query.set('v', version);
    return `${name}=${quote}${asset.pathname}?${query.toString()}${asset.fragment}${quote}`;
  });
}
