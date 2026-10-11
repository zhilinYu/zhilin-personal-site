#!/bin/zsh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  print '请先安装 Node.js 22 或更新版本，再重新打开。'
  read -r '?按回车关闭'
  exit 1
fi
if [[ ! -d node_modules ]]; then
  print '首次使用请按“后台使用说明.md”安装依赖。'
  read -r '?按回车关闭'
  exit 1
fi
print '后台：http://127.0.0.1:8766/admin/'
print '保持此窗口打开；按 Control+C 停止。'
npm run dev
