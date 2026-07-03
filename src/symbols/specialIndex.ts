/**
 * 特殊指数注册表:东财 secid 前缀不走交易所推断的指数族(单一事实来源)。
 *
 * normalizeSymbol 的分类、toEastmoneySecid 的拼接、secid 回读三处共用本表,
 * 新增特殊指数只改本文件(normalize 的 EXCHANGE_MARKET 经
 * SPECIAL_INDEX_EXCHANGE_MARKET 派生,无需手工同步):
 *  - 中证指数(CSI)是开放家族,按码形匹配而非枚举 —— 93xxxx(930955 红利
 *    低波动100 / 932000 中证2000 / 931071 人工智能产业等)与 H+5 位
 *    (H30533 海外中国互联网50 / H11136 海外中国互联网等),东财市场前缀 '2';
 *  - 具名指数走枚举(HSHCI 恒生医疗保健指数 → '124',GDAXI 德国 DAX → '100')。
 *
 * 码形无碰撞依据:93 段未被任何 A 股交易所占用(沪 B 为 900xxx,北交所为
 * 92/4/8 开头,见 infer.ts),H+5 位既非 A 股纯数字形,也不满足美股纯字母
 * ticker 形([A-Za-z][A-Za-z.\-]*),更非国内期货合约形(品种字母 + yymm)。
 *
 * 准入规则:lookup 按码形/字面做无上下文匹配,且 normalize 侧视为语法确定
 * (矛盾 hint 一律抛错),因此只能收录与其它命名空间零碰撞的拼写 ——
 * 与美股 ticker 空间重叠的纯字母指数(HSI/HSCEI 等)、与 A 股代码段重叠的
 * 指数(000985 中证全指 vs 深市股票)不可直接加入,需先为 lookup 增加
 * hint 感知的消歧参数(可向后兼容地追加可选参数)。
 *
 * 家族内不存在的码(如 H30533 手误成 H30553)按码形仍会通过解析,表现为
 * 上游返回空结果而非本地解析错误 —— 与其它码族(如 600520)行为一致;
 * 本地枚举校验会误拒真实存在的中证指数,故不做。
 */
import type { Exchange, Market } from './types';

export interface SpecialIndexInfo {
  market: Market;
  exchange: Exchange;
  /** 东财 secid 数字市场前缀 */
  secidPrefix: string;
  /** 规范化(大写)后的指数代码,调用方应以此为准而非原始输入 */
  code: string;
}

/** 中证指数家族(开放集,按码形匹配) */
const CSI_INFO: Omit<SpecialIndexInfo, 'code'> = {
  market: 'CN',
  exchange: 'CSI',
  secidPrefix: '2',
};
const CSI_PATTERNS = [/^93\d{4}$/, /^H\d{5}$/];

const NAMED_INDICES: Record<string, Omit<SpecialIndexInfo, 'code'>> = {
  /** 恒生医疗保健指数(Hang Seng Healthcare Index) */
  HSHCI: { market: 'HK', exchange: 'HSI', secidPrefix: '124' },
  /** 德国 DAX 指数 */
  GDAXI: { market: 'GLOBAL', exchange: 'DAX', secidPrefix: '100' },
};

/** 特殊指数 exchange → market 对(normalize 的 EXCHANGE_MARKET 由此 spread,单源) */
export const SPECIAL_INDEX_EXCHANGE_MARKET: ReadonlyArray<readonly [Exchange, Market]> = [
  [CSI_INFO.exchange, CSI_INFO.market],
  ...Object.values(NAMED_INDICES).map((i) => [i.exchange, i.market] as const),
];

/**
 * 按代码(大小写不敏感)查特殊指数;未命中返回 undefined。
 * 内部统一大写后匹配,返回值携带规范化 code。
 */
export function lookupSpecialIndex(code: string): SpecialIndexInfo | undefined {
  const upper = code.toUpperCase();
  if (CSI_PATTERNS.some((re) => re.test(upper))) {
    return { ...CSI_INFO, code: upper };
  }
  // 键全大写,不会命中 Object.prototype 继承属性(constructor 等均非全大写)
  const named = NAMED_INDICES[upper];
  return named ? { ...named, code: upper } : undefined;
}
