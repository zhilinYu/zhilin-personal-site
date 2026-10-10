// Existing UCloud shop contract, verified at 67d66745. Amounts are in CNY cents.
// The server remains authoritative; content editing cannot change a price.
export const SHOP_CATALOG = Object.freeze({
  'quant-risk': {name:'量化风控',amount:990},
  'trend-leader': {name:'趋势龙头',amount:990},
  'hot-money': {name:'游资弹性',amount:990},
  'countertrend': {name:'逆势抗跌',amount:990},
  'limit-up-pullback': {name:'涨停回吐',amount:990},
  'research-bundle': {name:'全套研究提示词',amount:3990},
});
export const displayPrice = amount => '¥' + (amount / 100).toFixed(1);
export function paymentSku(item) {
  if(item.type !== 'paid-prompt') {
    if(item.sku) throw Error(`${item.id} 只有收费提示词可绑定支付商品`);
    return null;
  }
  const sku=item.sku || (Object.hasOwn(SHOP_CATALOG,item.id) ? item.id : null);
  if(!sku)return null; // New unmapped content retains the consultation flow.
  if(!Object.hasOwn(SHOP_CATALOG,sku))throw Error(`${item.id} 支付商品不存在，请核对既有支付协议`);
  if(Object.hasOwn(SHOP_CATALOG,item.id)&&sku!==item.id)throw Error(`${item.id} 不可改绑其他既有商品`);
  const expected=displayPrice(SHOP_CATALOG[sku].amount);
  if(item.price && item.price!==expected)throw Error(`${item.id} 公开价格与支付价格 ${expected} 不一致`);
  return sku;
}
