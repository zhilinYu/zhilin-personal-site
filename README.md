# 志林个人网站

薄荷蓝猫新版首页，保留提示词、Skills、产品、文章、合作、简历和 Decap CMS 内容编辑。微信 Native 支付沿用既有服务、商户协议和服务端价格。

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

- `content/`：后台编辑的公开 JSON，收费条目仅含介绍；`templates/`：页面与固定栏目。
- `tools/build.mjs`：生成根目录 `index.html`；`tools/export.mjs`：导出 `deployment/site/`，只含页面、公开资源、后台与简历。生成包不提交 Git。
- `payment/`、`deploy/`：沿用既有支付、私有交付和发布备份门禁；私有配置、订单库、商品 ZIP 均不进入 Git 或静态发布包。
- `.github/workflows/verify-site.yml`：分支和 PR 仅测试构建，不接触服务器或部署凭据。
- `.github/workflows/content-deploy.yml`：沿用已上线 CMS 的静态发布流程，只发布公开内容，不重启支付服务。
- `.github/workflows/deploy.yml`：保留既有 main 支付文件触发和手工发布入口；发布前通过既有备份门禁，上传新版导出包。只有支付运行文件或服务单元改动才更新并重启支付服务；测试和说明改动不触发重启。上传支付运行文件使用明确清单，不复制测试、模拟入口、订单或配置。

合并到 `main` 会按上述触发规则自动发布。两个生产流程沿用 `zhilin-production` 串行锁；混合更新可能分别运行，但均构建同一提交的静态包。

## 支付商品

量化风控、趋势龙头、游资弹性、逆势抗跌、涨停回吐五款各 ¥9.9。旧版 ¥39.9 合集仍支持历史订单恢复，新版未新增合集购买入口。构建会拒绝重复 SKU、改绑原商品或与既有服务端金额不一致的价格。付款后在同一浏览器的“我的购买”重新领取，清除浏览器数据后按订单号联系售后。

## 内容后台上线前提

CMS 已在既有生产站接入，可编辑文章、提示词和 Skills，默认草稿不公开。本次保留现有 OAuth 服务与固定账号校验、`public_repo` 范围、回调协议和受限配置，不创建凭证或扩大权限。

`deployment/` 下的 YAML 是接入示例，实际工作流位于 `.github/workflows/`。CMS 原有生产验收记录保留；本次仅做非交易检查，不重新授权账号或创建订单。真实支付验收仍待另行授权。
