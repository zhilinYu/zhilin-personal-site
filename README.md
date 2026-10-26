# 志林个人网站

四主题个人主页展示提示词、Skills、小游戏、服务和简短个人介绍。文章、项目、Mac 工具的源码/内容继续保留在仓库，但不进入首页或前台搜索数据。隐藏区块的原完整模板保存在 `templates/archive/homepage-full.html`，不导出为公开网页。换肤、提示词详情和历史购买找回仍可用。微信 Native 支付沿用既有服务、商户协议和服务端价格。

## 开发与验证

需要 Node.js 22 或更新版本和 Python 3.9 或更新版本。

```sh
npm ci --ignore-scripts --no-audit --no-fund
python3 -m pip install --only-binary=:all: -r payment/requirements.txt
npm test
python3 -m unittest discover -s payment/tests -v
npm run build
```

`npm run dev` 启动本地网站与内容编辑服务：网站 `http://127.0.0.1:8766/`，后台 `/admin/`，编辑代理仅监听本机 8081。如果 Mac 临时目录的符号链接影响备份测试，可创建仓库内临时目录并运行 `TMPDIR="$PWD/.local-tests" python3 -m unittest discover -s payment/tests -v`。

## 本地支付模拟

```sh
npm run preview:payment
```

打开 `http://127.0.0.1:8777/`。页面和付款弹窗明确标注模拟；二维码无法付款，下载为测试占位 ZIP。模拟网关不读取商户密钥，测试订单和文件放在静态目录外的临时目录，退出后清理。仅模拟入口注册 `/__test__/state`，正式支付服务没有此路由。

本地自动化覆盖支付成功、失败、取消、重复点击和回调、恢复订单、关闭或返回后异步响应、退款后拒绝再次交付。测试使用替身，真实付款退款、真实通知和跨设备验收仍须另行授权完成。

## 源码和发布

- `content/`：后台编辑的公开 JSON，收费条目仅含介绍；`templates/`：页面与固定栏目。首页按提示词与 Skills 两类筛选和搜索，保留科技蓝、小清新、暖白纸感、石墨四套主题。
- `tools/build.mjs`：按当前内容生成根目录 `index.html`，资源索引只筛选提示词和 Skills，小游戏和服务单独展示；文章、项目和 Mac 工具的源文件保留。`tools/export.mjs`：导出 `deployment/site/`，生成包不提交 Git。静态资源继续使用内容哈希版本 URL。
- `payment/`、`deploy/`：沿用既有支付、私有交付和发布备份门禁；私有配置、订单库和其他收费商品 ZIP 均不进入 Git 或静态发布包。按原文件 SHA-256 命名的量化风控 ZIP 是用户提供并明确要求公开的静态附件，内容与来源保持原样。
- `.github/workflows/verify-site.yml`：分支和 PR 仅测试构建，不接触服务器或部署凭据。
- `.github/workflows/content-deploy.yml`：沿用已上线 CMS 的静态发布流程，只发布公开内容，不重启支付服务。
- `.github/workflows/deploy.yml`：保留既有 main 支付文件触发和手工发布入口；发布前通过既有备份门禁，上传新版导出包。只有支付运行文件或服务单元改动才更新并重启支付服务；测试和说明改动不触发重启。上传支付运行文件使用明确清单，不复制测试、模拟入口、订单或配置。

合并到 `main` 会按上述触发规则自动发布。两个生产流程沿用 `zhilin-production` 串行锁；混合更新可能分别运行，但均构建同一提交的静态包。

## 支付商品

量化风控原始 ZIP 已核验并以静态附件免费提供，不显示付费价格或购买入口；这是研究提示词与学习模板，不提供实时行情、已回测策略或收益保证，也不据此推定开源许可。旧 SKU 记录保留但不再前端销售，既有订单仍可从“我的购买”找回。趋势龙头、游资弹性、逆势抗跌、涨停回吐仍各 ¥9.9；旧版 ¥39.9 合集仍支持历史订单恢复。其他 SKU 价格、服务端和支付记录保持不变。构建会拒绝重复 SKU、改绑原商品或与既有服务端金额不一致的价格。

## 内容后台上线前提

CMS 已在既有生产站接入，可编辑文章、提示词和 Skills，默认草稿不公开。本次保留现有 OAuth 服务与固定账号校验、`public_repo` 范围、回调协议和受限配置，不创建凭证或扩大权限。

`deployment/` 下的 YAML 是接入示例，实际工作流位于 `.github/workflows/`。CMS 原有生产验收记录保留；本次仅做非交易检查，不重新授权账号或创建订单。真实支付验收仍待另行授权。

## 小游戏来源

游戏源码与试玩页继续保存在 `assets/games/`，首页保留 2048 和方块时间的试玩入口。此前实现的玩法参考与许可证说明见 [`assets/games/README.md`](assets/games/README.md)。
