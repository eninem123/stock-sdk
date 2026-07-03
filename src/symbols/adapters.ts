/**
 * Provider 符号适配器：NormalizedSymbol → 各数据源原生格式（纯函数）
 *
 * 仅覆盖股票/指数/基金/板块这类有明确 secid 体系的资产；期货/期权的 secid
 * 体系不同（且由各自 provider 内联处理），这里对它们显式抛错而非静默兜底，
 * 避免把海外期货误拼成美股 secid（105.xxx）这类隐蔽错误。
 */
import type { NormalizedSymbol } from './types';
import { InvalidArgumentError } from '../core/errors';
import { lookupSpecialIndex } from './specialIndex';

/**
 * 交易所 → 东财 secid 数字市场前缀（仅股票类）。
 * F41: 导出供 providers 复用（tencent/batch 的美股代码列表按前缀过滤），
 * 不再在各处重复声明 NASDAQ/NYSE/AMEX → 105/106/107 映射。
 */
export const EXCHANGE_TO_SECID_PREFIX: Record<string, string> = {
  SSE: '1',
  SZSE: '0',
  BSE: '0',
  HKEX: '116',
  NASDAQ: '105',
  NYSE: '106',
  AMEX: '107',
  US: '105',
};

/** 交易所 → 腾讯前缀（A 股） */
const EXCHANGE_TO_TENCENT_PREFIX: Record<string, string> = {
  SSE: 'sh',
  SZSE: 'sz',
  BSE: 'bj',
};

/**
 * → 腾讯行情格式：sh600519 / sz000001 / bj920819 / hk00700 / usAAPL
 */
export function toTencentSymbol(ns: NormalizedSymbol): string {
  if (
    ns.assetType === 'board' ||
    ns.assetType === 'futures' ||
    ns.assetType === 'option'
  ) {
    throw new InvalidArgumentError(
      `Tencent quote symbol does not support assetType '${ns.assetType}'`,
      { assetType: ns.assetType, code: ns.code }
    );
  }
  switch (ns.market) {
    case 'CN': {
      const prefix = EXCHANGE_TO_TENCENT_PREFIX[ns.exchange];
      if (!prefix) {
        throw new InvalidArgumentError(
          `Cannot map to Tencent symbol: unsupported CN exchange '${ns.exchange}'`,
          { exchange: ns.exchange, code: ns.code }
        );
      }
      return `${prefix}${ns.code}`;
    }
    case 'HK':
      // 腾讯港股码恒为数字(补零到 5 位);HSHCI 等字母指数码腾讯无对应标的,
      // 拼 'hkHSHCI' 是必然空结果的垃圾查询 → fail-fast
      if (!/^\d+$/.test(ns.code)) {
        throw new InvalidArgumentError(
          `Cannot map to Tencent symbol: HK code '${ns.code}' is not numeric`,
          { market: ns.market, code: ns.code }
        );
      }
      return `hk${ns.code.padStart(5, '0')}`;
    case 'US':
      return `us${ns.code}`;
    default:
      throw new InvalidArgumentError(
        `Cannot map to Tencent symbol: unsupported market '${ns.market}'`,
        { market: ns.market, code: ns.code }
      );
  }
}

/**
 * → 东财 secid：1.600519 / 0.000001 / 116.00700 / 105.AAPL / 90.BK0475（板块）
 */
export function toEastmoneySecid(ns: NormalizedSymbol): string {
  if (ns.assetType === 'board') {
    return `90.${ns.code}`;
  }
  if (ns.assetType === 'futures' || ns.assetType === 'option') {
    throw new InvalidArgumentError(
      `Eastmoney secid for assetType '${ns.assetType}' uses a separate scheme; ` +
        `use the dedicated futures/options provider instead of toEastmoneySecid`,
      { assetType: ns.assetType, exchange: ns.exchange, code: ns.code }
    );
  }
  // 特殊指数按分类驱动:assetType==='index' 且 exchange 与注册表一致才走注册表
  // 路由 —— exchange 一致性保证只有 normalize 按注册表分类出的符号(CSI/HSI/DAX)
  // 命中;'105.GDAXI'/'1.930955' 即使带 assetType:'index' 消歧 hint,其 NASDAQ/SSE
  // 分类也不满足一致性,显式 secid 前缀断言保持原语义,真实同名 ticker 不会被劫持。
  // 须先于 HK 早返回:HSHCI 分类为 HK/HSI,走 '124.' 而非港股通用 '116.'。
  // 注册表未命中的普通指数('000300'+{assetType:'index'})维持现状走交易所前缀
  // —— 注意对沪市宿主的 000xxx 指数该 fall-through 已知错宿主(东财实为 '1.',
  // 见 fundFlow getMarketFundFlow 的 1.000001),待 index 感知的交易所推断修复;
  // CSI/HSI/DAX 等特殊 exchange 若未命中注册表,由下方 prefix 缺失 fail-fast。
  if (ns.assetType === 'index') {
    const specialIdx = lookupSpecialIndex(ns.code);
    if (specialIdx && specialIdx.exchange === ns.exchange) {
      return `${specialIdx.secidPrefix}.${specialIdx.code}`;
    }
  }
  if (ns.market === 'HK') {
    return `116.${ns.code.padStart(5, '0')}`;
  }
  const prefix = EXCHANGE_TO_SECID_PREFIX[ns.exchange];
  if (!prefix) {
    throw new InvalidArgumentError(
      `Cannot map to Eastmoney secid: unsupported exchange '${ns.exchange}' (market=${ns.market})`,
      { exchange: ns.exchange, market: ns.market, code: ns.code }
    );
  }
  return `${prefix}.${ns.code}`;
}

/** → 纯代码（去前缀） */
export function toPlainCode(ns: NormalizedSymbol): string {
  return ns.code;
}
