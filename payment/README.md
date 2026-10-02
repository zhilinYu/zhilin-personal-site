# 官网微信 Native 支付

独立 Flask 服务，监听 `127.0.0.1:9101`。现有静态站点通过 Nginx
`/api/shop/` 转发访问。只有支付配置及六个私有交付包均存在时才开放购买。

## 配置

使用 `.env.example` 的字段准备 `/etc/zhilin-shop/shop.env`，权限应为
`root:zhilin-shop 0640`。商户私钥、公钥与证书存放在该目录，不放进网站目录，
不进入 Git。APIv3 密钥沿用现有商户配置，不通过本项目重置。

`WX_PLATFORM_PUBLIC_KEY_ID` 必须对应 `WX_PLATFORM_PUBLIC_KEY_PATH`；
`WX_CERT_PATH` 与 `WX_PRIVATE_KEY_PATH` 必须匹配。
`WX_APP_ID` 应使用商户平台已经关联、具备相应权限的 AppID。

商品金额由服务器定义：单款 990 分、五款合集 3990 分，客户端不能传价格。
调用微信 API 的响应及回调均以官方公钥验签。收到支付通知后核对商户、
AppID、订单号、金额、币种、交易类型和交易号。

## 私有交付包

```sh
python3 payment/package_products.py \
  --source '/Users/apple/Documents/股票大师/AI选股提示词' \
  --destination .local/products
```

上传到 `/var/lib/zhilin-shop/products`。每个单品包含同内容的 Markdown/TXT，
合集包含全部五款。此目录必须在 Nginx 静态目录之外。

## 部署

1. 将 `payment/` 放到 `/opt/zhilin-shop/payment`，创建独立虚拟环境并安装
   `requirements.txt`；不要使用其他产品的运行环境。
2. 创建专用系统账号 `zhilin-shop`，配置文件和私钥仅向该账号开放读取。
3. 安装 `deploy/zhilin-shop.service`，准备环境文件和交付包。
4. 将 `deploy/zhilin-shop.nginx.conf` 中的 location 加入既有 HTTPS server。
5. 保持 `SHOP_ENABLED=0`，启动服务，验证接口可用及购买按钮保持关闭。
6. 配置完整后将 `SHOP_ENABLED=1`，重启本服务，验证真实 Native 下单和通知。

首次部署需要手工准备服务账号、虚拟环境、私有配置、商品包和 Nginx 代理。
之后 GitHub Actions 会先运行支付测试，再更新并重启这个独立服务，最后更新静态页面。
密钥、订单库和商品包均不通过 GitHub Actions 上传，不受日常代码部署影响。

## 订单与重新领取

浏览器用随机 256 位令牌保存购买记录，同一令牌创建订单保持幂等；
服务端只存令牌摘要。订单、二维码和下载接口均须携带令牌。
回调重复到达不会重复改变权益。前端每 5 秒查单，页面关闭后可从同一
浏览器的“我的购买”恢复。换设备或清除浏览器数据后需凭订单号联系售后。

每次下载前重新查单；未付款或已退款时不交付。退款可在微信商户平台进行，
本版不提供公开退款接口。已下载的文件无法远程撤回。

## 验证

```sh
python3 -m unittest discover -s payment/tests -v
node --check assets/checkout.js
node --test tests/checkout.test.cjs
```

Python 测试使用隔离测试网关，Node 测试使用隔离 DOM/网络替身验证异步状态，
均不接触真实资金。Node 回归覆盖过期订单恢复、乱序查询和关闭后下载提示；
它不能替代真实浏览器与微信支付验收。上线验收还需要完成真实付款、
验签通知、重新领取和退款后无法再次下载的闭环。
