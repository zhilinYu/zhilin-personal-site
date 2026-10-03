# 个人主页 · Oil UI 改版

日期：2026-10-03。目标：以独立 AI 应用顾问为主体，提供清楚的项目合作入口、服务方案、真实经历与研究工具商店。

## 设计方向

沿用已确定的 MiMo 浅色科技参考：暖白、墨绿、浅玉玻璃与银色金属，居中标题、克制导航、横向主视觉随滚动展开。新素材表达“业务输入汇为可交付的 AI 产品”；没有使用小米品牌资产。

- 首屏主要动作：讨论项目；次动作：浏览服务。
- 页面：首屏、三款服务、项目经历、六款商品、合作步骤、联系。
- 系统中文字体；暖白 #f7f7f2、墨绿 #182923、次级文字 #64736b。
- 首访入场 520ms；按钮按下 80ms / 松开 180ms；弹窗与遮罩进入 280ms。
- 大图以固定容器内裁切展开，反向滚动收回；尊重 reduced-motion。
- 不放照片；商品平铺；五款各 ¥9.9、合集 ¥39.9。
- 原购买 SKU、支付 DOM ID、checkout.js、后端与部署契约保持不变。
- 项目职责来自现有简历，不新增客户评价或任职身份。

## 素材

`assets/visuals/hero-ai-systems-v3.webp`：内置 imagegen 生成，1672×941，约 67KB。概念品牌图，不是实际客户产品照片。既有三张服务图复用；商品封面为可编辑 HTML。

生成提示词：

> Use case: stylized-concept. Asset type: panoramic premium website hero image for a Chinese independent AI application consultant and engineering studio. Create a high-end architectural 3D still life that visually expresses disconnected business inputs becoming one coherent engineered AI product. A single beautifully machined silver aluminium open cube or rectangular frame encloses several perfectly aligned translucent pale jade glass computational layers. Three fine flexible frosted glass conduits enter the assembly from the left, merge through the layers, and a clean broad white translucent ribbon leaves to the right. Precise industrial design, meticulously rounded machined edges, physically believable refraction and brushed metal, not science fiction. Central sculpture large enough to read in a mobile crop, resting on a seamless warm ivory #f7f7f2 studio background. Wide 16:9 composition, one coherent object in the center with generous negative space on all four sides, slight elevated three-quarter view, soft large daylight from upper left, subtle grounded shadows, restrained graphite, silver and soft sage palette. Extraordinary material quality like a premium computing product campaign, elegant and quiet. All information, typography, buttons, and labels will be real editable HTML outside the image. NO text, NO letters including AI, NO numbers, NO logo, NO watermark, NO screens, NO fake interface, NO people, NO plants, NO unrelated props, NO purple, NO glowing neon, NO starfields. The image is a conceptual brand artwork, not a photograph of an actual client product.

## 评审与修正

独立视觉评审初稿 **8.2/10**。三个主要差距与处理：

1. 手机商品购买信息出现过晚 → 减少区块留白，封面高 150px，390px 视口首款完整购买操作底部约 699px。
2. 五款封面重复上升条形 → 删除装饰，展示每款实际研究重点；文件格式集中说明。
3. 项目经历分量低于服务图 → 强化标题与具体职责，内容取自现有简历。

减法：删除大图标语、图下重复能力条、商品封面的英文编号、五处重复文件格式。弹窗遮罩与面板同步进入。

剩余差距：尚未加入可公开的真实项目截图，经历依靠职责文字呈现。修正后由主 Agent 对比检查，没有再次评分。

## 验证记录

- JS 语法、Git diff、静态资产、锚点、重复 ID、六 SKU 与支付脚本不变检查通过。
- 实际查看 1440、768、390、320px；各视口无页面横向溢出或文字裁切。
- 200% 采用 720px CSS 视口与 DPR2 的等效重排，未使用原生浏览器菜单缩放。
- 首访、按钮反馈、弹窗与滚动扩展均保留三帧；检查正反滚动及 reduced-motion。
- 手机菜单、锚点、我的购买、Escape 关闭并返回焦点通过。
- 本次是 UI 发布，未进行真实付款、支付回调、下载和退款验收。
- 本地设计说明、截图、动效证据位于 `.local/oil-ui/`；该目录不提交，公开代码不含订单或密钥。
