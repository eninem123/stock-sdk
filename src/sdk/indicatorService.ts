import { addIndicators, estimateIndicatorLookback, type IndicatorOptions, type KlineWithIndicators } from '../indicators';

/**
 * 全量 refetch 后切片的 lookback 下限(根)。
 * estimateIndicatorLookback 的 requiredBars 是"窗口期能算出值"的下限,
 * 不足以让递归型指标(KDJ/RSI/ATR/DMI)的平滑状态收敛到 round(2) 之下;
 * 500 根下 Wilder-14 的状态差衰减至 ~2e-16,对 2 位小数输出即逐值一致。
 */
const RECURSIVE_WARMUP = 500;

/** 'YYYY-MM-DD' 加 n 个自然日(UTC 日历加法,正确处理跨月/跨年) */
function addNaturalDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
import type { AnyHistoryKline } from '../types';
import type { KlineService } from './klineService';
import type { QuoteService } from './quoteService';
import { marketOf } from '../symbols';

export type MarketType = 'A' | 'HK' | 'US';

/**
 * `getKlineWithIndicators` 的请求参数
 */
export interface KlineWithIndicatorsOptions {
  /**
   * 市场类型
   * - 不传时由 SDK 根据 `symbol` 自动识别
   * - A 股 / 港股 / 美股 => 'A' / 'HK' / 'US'
   */
  market?: MarketType;
  /** K 线周期，默认 `'daily'` */
  period?: 'daily' | 'weekly' | 'monthly';
  /** 复权方式：`''` 不复权 / `'qfq'` 前复权 / `'hfq'` 后复权 */
  adjust?: '' | 'qfq' | 'hfq';
  /**
   * 起始日期（`YYYYMMDD` 或 `YYYY-MM-DD`）
   * - SDK 会根据指标依赖自动向前多取若干 bar，以保证首日指标有效
   */
  startDate?: string;
  /** 结束日期（`YYYYMMDD` 或 `YYYY-MM-DD`） */
  endDate?: string;
  /**
   * 指标配置
   * - 仅传入 key（如 `{ ma: [5, 10] }`）即可启用对应指标
   * - 完整选项参见 `IndicatorOptions`
   */
  indicators?: IndicatorOptions;
}

export class IndicatorService {
  constructor(
    private readonly klineService: Pick<
      KlineService,
      'getHistoryKline' | 'getHKHistoryKline' | 'getUSHistoryKline'
    >,
    private readonly quoteService: Pick<QuoteService, 'getTradingCalendar'>
  ) {}

  private detectMarket(symbol: string): MarketType {
    // F42: 市场解析收编到 symbols/marketOf(与 CLI detectMarketTag 共享实现);
    // 解析失败(undefined)兜底 'A' 的决策保留在本调用方。
    const market = marketOf(symbol);
    return market === 'HK' ? 'HK' : market === 'US' ? 'US' : 'A';
  }

  private calcActualStartDate(
    startDate: string,
    tradingDays: number,
    ratio: number = 1.5
  ): string {
    // 兼容 'YYYY-MM-DD' 与 'YYYYMMDD' 两种入参：先归一成紧凑格式再 slice
    const compact = this.toCompactDate(startDate);
    const naturalDays = Math.ceil(tradingDays * ratio);
    const date = new Date(
      parseInt(compact.slice(0, 4)),
      parseInt(compact.slice(4, 6)) - 1,
      parseInt(compact.slice(6, 8))
    );
    date.setDate(date.getDate() - naturalDays);

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}${month}${day}`;
  }

  private calcActualStartDateByCalendar(
    startDate: string,
    tradingDays: number,
    calendar: string[]
  ): string | undefined {
    if (!calendar || calendar.length === 0) {
      return undefined;
    }

    const normalized = this.normalizeDate(startDate);
    let startIndex = calendar.findIndex((date) => date >= normalized);
    if (startIndex === -1) {
      startIndex = calendar.length - 1;
    }
    const targetIndex = Math.max(0, startIndex - tradingDays);
    return this.toCompactDate(calendar[targetIndex]);
  }

  private normalizeDate(dateStr: string): string {
    if (dateStr.includes('-')) {
      return dateStr;
    }
    if (dateStr.length === 8) {
      return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
    }
    return dateStr;
  }

  private toCompactDate(dateStr: string): string {
    return dateStr.replace(/-/g, '');
  }

  async getKlineWithIndicators(
    symbol: string,
    options: KlineWithIndicatorsOptions = {}
  ): Promise<KlineWithIndicators<AnyHistoryKline>[]> {
    const { startDate, endDate, indicators = {} } = options;
    const market = options.market ?? this.detectMarket(symbol);
    const { requiredBars } = estimateIndicatorLookback(indicators);
    const ratioMap = { A: 1.5, HK: 1.46, US: 1.45 };
    let actualStartDate: string | undefined;

    if (startDate) {
      if (market === 'A') {
        try {
          const calendar = await this.quoteService.getTradingCalendar();
          actualStartDate =
            this.calcActualStartDateByCalendar(startDate, requiredBars, calendar) ??
            this.calcActualStartDate(startDate, requiredBars, ratioMap[market]);
        } catch {
          actualStartDate = this.calcActualStartDate(
            startDate,
            requiredBars,
            ratioMap[market]
          );
        }
      } else {
        actualStartDate = this.calcActualStartDate(
          startDate,
          requiredBars,
          ratioMap[market]
        );
      }
    }

    const klineOptions = {
      period: options.period,
      adjust: options.adjust,
      startDate: actualStartDate,
      // provider 透传到东方财富的 beg/end 仅接受 YYYYMMDD，
      // 这里统一归一化，避免 'YYYY-MM-DD' 入参导致 HK/US 返回 0 条
      endDate: options.endDate ? this.toCompactDate(options.endDate) : undefined,
    };

    let allKlines: AnyHistoryKline[];
    switch (market) {
      case 'HK':
        allKlines = await this.klineService.getHKHistoryKline(symbol, klineOptions);
        break;
      case 'US':
        allKlines = await this.klineService.getUSHistoryKline(symbol, klineOptions);
        break;
      default:
        allKlines = await this.klineService.getHistoryKline(symbol, klineOptions);
    }

    // F35:短上市标的双请求短路。
    // 原逻辑只要 `allKlines.length < requiredBars` 就无条件全量 refetch,但若首次
    // 返回的第一根 K 线日期已明显【晚于】请求的 actualStartDate,说明上游在
    // actualStartDate 之前本就没有更多历史(标的上市晚),refetch 只会拿回
    // 完全相同的数据 —— 每次调用白白双倍上游流量。
    // 终审修复:HK/US ratio 路径的 actualStartDate 可能落在周末/假日,首根落在
    // 其后几天属正常(并非"无更早数据"),严格 > 判定会把"被 beg 截断"误判成
    // "上市晚"而漏 refetch —— 放宽为 7 个自然日容差;超过 7 天才认定上市晚。
    // 日期统一归一成 'YYYY-MM-DD' 后按字符串比较。
    const mayHaveEarlierData =
      allKlines.length === 0 ||
      actualStartDate === undefined ||
      this.normalizeDate(allKlines[0].date) <=
        addNaturalDays(this.normalizeDate(actualStartDate), 7);

    let refetchedFullHistory = false;
    if (startDate && allKlines.length < requiredBars && mayHaveEarlierData) {
      refetchedFullHistory = true;
      switch (market) {
        case 'HK':
          allKlines = await this.klineService.getHKHistoryKline(symbol, {
            ...klineOptions,
            startDate: undefined,
          });
          break;
        case 'US':
          allKlines = await this.klineService.getUSHistoryKline(symbol, {
            ...klineOptions,
            startDate: undefined,
          });
          break;
        default:
          allKlines = await this.klineService.getHistoryKline(symbol, {
            ...klineOptions,
            startDate: undefined,
          });
      }
    }

    // F37:先裁剪后算指标(仅全量 refetch 后)。
    // 原逻辑对全量历史先 addIndicators 算完全部指标,再逐 bar `new Date()` 过滤,
    // 窄窗口查询时 >99% 的计算结果直接被丢弃(refetch 全量历史时尤甚)。
    //
    // 终审修复(Review Finding 1):切片只对【全量 refetch】后的历史做 ——
    // 常规路径 fetched 本就从 actualStartDate 起(≈ 窗口 + lookback),切片是
    // 近似 no-op 的"优化",却会在 ratio 超额 1-2 根时削掉递归型指标
    // (KDJ/RSI/ATR/DMI 的平滑状态)的暖机历史,产生 round(2) 可见的数值漂移
    // (实测 |Δd| 最大 9.4)。不切片即与旧实现逐值一致。
    // refetch 路径保留切片的性能收益,但 lookback 下限提到 RECURSIVE_WARMUP:
    // Wilder-14 的状态差衰减 (13/14)^486 ≈ 2e-16、KDJ(1/3 平滑)更快,
    // 2 位舍入下与全量计算逐值一致;OBV 是全量累计型(基数取决于序列起点),
    // 启用时跳过切片以保持与旧实现(全量计算)一致。
    // 最终过滤统一为归一化日期字符串比较(ISO 字典序即时间序),
    // 消除逐 bar 的 new Date() 分配。
    if (startDate) {
      const startNorm = this.normalizeDate(startDate);
      const endNorm = endDate ? this.normalizeDate(endDate) : undefined;

      const windowStartIdx = allKlines.findIndex(
        (kline) => this.normalizeDate(kline.date) >= startNorm
      );
      if (windowStartIdx === -1) {
        // 所有 K 线都早于 startDate → 窗口为空,任何指标计算都会被丢弃,直接短路
        return [];
      }

      let toCompute = allKlines;
      if (refetchedFullHistory && !indicators.obv) {
        // refetch 触发条件含 length < requiredBars,requiredBars > 0 即必有指标,
        // 故此分支总需要暖机 lookback
        const lookback = Math.max(requiredBars, RECURSIVE_WARMUP);
        toCompute = allKlines.slice(Math.max(0, windowStartIdx - lookback));
      }
      return addIndicators(toCompute, indicators).filter((item) => {
        const date = this.normalizeDate(item.date);
        return date >= startNorm && (endNorm === undefined || date <= endNorm);
      });
    }

    return addIndicators(allKlines, indicators);
  }
}
