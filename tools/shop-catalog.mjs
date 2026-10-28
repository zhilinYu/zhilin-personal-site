// Existing UCloud shop contract, verified at 67d66745. Amounts are in CNY cents.
// The server remains authoritative; content editing cannot change a price.
export const SHOP_CATALOG = Object.freeze({
  'quant-risk': {name:'量化风控',amount:990},
  'trend-leader': {name:'趋势龙头',amount:990},
  'hot-money': {name:'游资弹性',amount:990},
  'countertrend': {name:'逆势抗跌',amount:990},
  'limit-up-pullback': {name:'涨停回吐',amount:990},
  'research-bundle': {name:'全套研究提示词',amount:3990},
  'ashare-five-strategies': {name:'自动匹配策略研究助手',amount:9900},
  'investment-agent-remote': {name:'远程协助搭建 AI 投研智能体',amount:9900},
  'one-on-one': {name:'一对一 AI 投研咨询',amount:19900},
  'workflow-building': {name:'AI 投研工作流定制定金',amount:19900},
});
export const displayPrice = amount => '¥' + (amount / 100).toFixed(1);
export function paymentSku(item) {
  if(item.type === 'service' && ['investment-agent-remote','one-on-one','workflow-building'].includes(item.id)) {
    if(item.sku && item.sku !== item.id) throw Error(`${item.id} 不可改绑其他商品`);
    if(item.price && item.price !== displayPrice(SHOP_CATALOG[item.id].amount)) throw Error(`${item.id} 公开价格与支付价格不一致`);
    return item.id;
  }
  const paidSkill = item.type === 'local-skill' && item.id === 'ashare-local' && item.sku === 'ashare-five-strategies';
  if(item.type !== 'paid-prompt' && !paidSkill) {
    if(item.sku) throw Error(`${item.id} 只有收费提示词可绑定支付商品`);
    return null;
  }
  const sku=item.sku || (Object.hasOwn(SHOP_CATALOG,item.id) ? item.id : null);
  if(!sku)return null; // New unmapped content retains the consultation flow.
  if(!Object.hasOwn(SHOP_CATALOG,sku))throw Error(`${item.id} 支付商品不存在，请核对既有支付协议`);
  if(['investment-agent-remote','one-on-one','workflow-building'].includes(sku))throw Error(`${item.id} 不可改绑服务商品`);
  if(sku==='ashare-five-strategies'&&!paidSkill)throw Error(`${item.id} 不可改绑其他既有商品`);
  if(Object.hasOwn(SHOP_CATALOG,item.id)&&sku!==item.id)throw Error(`${item.id} 不可改绑其他既有商品`);
  const expected=displayPrice(SHOP_CATALOG[sku].amount);
  if(item.price && item.price!==expected)throw Error(`${item.id} 公开价格与支付价格 ${expected} 不一致`);
  return sku;
}
