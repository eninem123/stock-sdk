# 主题基金接口实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Stock SDK 添加主题基金功能，通过东方财富天天基金接口获取行业/概念主题列表及其对应的基金排行。

**Architecture:** 遵循现有三层架构：provider 层（`eastmoney/fundTheme.ts`）→ service 层（`fundService.ts` 新增 `theme` 命名空间）→ SDK 门面（`sdk.ts` 新增 `fund.theme`）。数据源为 `fundmobapi.eastmoney.com`。

**Tech Stack:** TypeScript 5.x, Vitest 4.x, MSW, RequestClient

---

## File Structure

```
src/types/fund.ts              # 添加 ThemeFund, ThemeFundItem 等类型
src/providers/eastmoney/fundTheme.ts   # 新建：三个 API 的 request + parse
src/providers/eastmoney/index.ts       # 修改：导出 fundTheme 函数
src/sdk/fundService.ts         # 修改：添加 theme 命名空间属性
src/sdk.ts                     # 修改：fund 命名空间添加 theme 子命名空间
src/index.ts                   # 修改：导出新类型
test/unit/providers/eastmoney/fundTheme.test.ts  # 新建：MSW mock 测试
test/integration/sdk/theme.int.test.ts           # 新建：真实请求测试
README.md                      # 修改：更新特性列表
README_EN.md                   # 修改：同步英文
website/api/fund.md            # 修改：添加 API 文档
website/guide/fund.md          # 修改：添加使用示例
```

---

### Task 1: 定义类型

**Files:** `src/types/fund.ts`

- [ ] **Step 1: 添加主题基金相关类型到 src/types/fund.ts**

在 `src/types/fund.ts` 末尾添加以下类型：

```typescript
// ============================================================
// 主题基金（Theme Fund）
// ============================================================

/** 主题基金排序字段（对应 FundMNSubjectList / FundThemeList 的 RankItems） */
export type ThemeFundSort =
  | 'ZDF'    // 日涨幅
  | 'SYL_W'  // 近1周
  | 'SYL_M'  // 近1月
  | 'SYL_3M' // 近3月
  | 'SYL_6M' // 近6月
  | 'SYL_Y'  // 近1年
  | 'SYL_3Y' // 近3年
  | 'SYL_5Y'; // 近5年

/** 主题基金排序方向 */
export type ThemeFundOrder = 'desc' | 'asc';

/** 主题基金类型筛选 */
export type ThemeCategory = '0' | '1' | '2'; // 0=行业, 1=概念, 2=全部

/** 获取主题列表选项 */
export interface GetThemeListOptions {
  sort?: ThemeFundSort;
  order?: ThemeFundOrder;
  category?: ThemeCategory;
  pageSize?: number;
  page?: number;
}

/** 获取热门主题选项 */
export interface GetHotThemesOptions {
  sort?: ThemeFundSort;
  order?: ThemeFundOrder;
  category?: ThemeCategory;
  limit?: number;
}

/** 主题基金排行排序字段（对应 FundMNRank 的 SortColumn） */
export type ThemeFundRankSort =
  | 'SYL_Z'   // 近1周
  | 'SYL_Y'   // 近1月
  | 'SYL_3Y'  // 近3月
  | 'SYL_1N'  // 近1年
  | 'RZDF';   // 日涨幅

/** 获取主题下基金选项 */
export interface GetThemeFundsOptions {
  sortColumn?: ThemeFundRankSort;
  sort?: ThemeFundOrder;
  pageIndex?: number;
  pageSize?: number;
  fundType?: string;
}

/** 主题基金条目（主题列表） */
export interface ThemeFund {
  code: string;
  name: string;
  dailyChange: number | null;
  weeklyReturn: number | null;
  monthlyReturn: number | null;
  quarterlyReturn: number | null;
  halfYearReturn: number | null;
  yearlyReturn: number | null;
  threeYearReturn: number | null;
  fiveYearReturn: number | null;
  type: '行业' | '概念';
}

/** 主题基金列表结果 */
export interface ThemeFundListResult {
  items: ThemeFund[];
  totalPages: number;
  pageSize: number;
  currentPage: number;
}

/** 热门主题结果（直接返回数组） */
export type HotThemesResult = ThemeFund[];

/** 主题下基金条目 */
export interface ThemeFundItem {
  code: string;
  name: string;
  fundType: string;
  dailyChange: number | null;
  weeklyReturn: number | null;
  monthlyReturn: number | null;
  quarterlyReturn: number | null;
  yearlyReturn: number | null;
  nav: number | null;
  themeCode: string;
  themeName: string;
}

/** 主题下基金列表结果 */
export interface ThemeFundItemList {
  items: ThemeFundItem[];
  total: number;
  pageIndex: number;
  pageSize: number;
}
```

- [ ] **Step 2: 在 src/types/index.ts 导出新类型**

确保 `src/types/index.ts` 已经 `export * from './fund';`（已存在，无需修改）。

- [ ] **Step 3: 验证类型导出**

```bash
yarn typecheck
```

预期：类型检查通过。

---

### Task 2: Provider 层实现

**Files:** 
- Create: `src/providers/eastmoney/fundTheme.ts`
- Modify: `src/providers/eastmoney/index.ts`

- [ ] **Step 1: 创建 src/providers/eastmoney/fundTheme.ts**

```typescript
/**
 * 东方财富 - 主题基金
 *
 * 数据源：https://fundmobapi.eastmoney.com/FundMNewApi/
 */
import { SdkError } from '../../core/errors';
import { toFiniteNumberOrNull } from '../../core/parser';
import type { RequestClient } from '../../core/request';
import type {
  GetThemeListOptions,
  GetHotThemesOptions,
  GetThemeFundsOptions,
  ThemeFund,
  ThemeFundListResult,
  HotThemesResult,
  ThemeFundItem,
  ThemeFundItemList,
} from '../../types';

const FUND_THEME_BASE_URL = 'https://fundmobapi.eastmoney.com/FundMNewApi';

/** 固定请求参数 */
const COMMON_PARAMS = {
  plat: 'Android',
  appType: 'ttjj',
  product: 'EFund',
  Version: '1',
  deviceid: 'stock-sdk',
} as const;

/**
 * 获取全部主题基金列表
 *
 * @param client RequestClient
 * @param options 查询选项
 */
export async function getThemeList(
  client: RequestClient,
  options: GetThemeListOptions = {}
): Promise<ThemeFundListResult> {
  const sort = options.sort ?? 'ZDF';
  const order = options.order ?? 'desc';
  const category = options.category ?? '2';
  const pageSize = options.pageSize ?? 20;
  const page = options.page ?? 1;

  const params = new URLSearchParams({
    ...COMMON_PARAMS,
    RankItems: sort,
    RankVectors: order,
    category,
    pageSize: String(pageSize),
    page: String(page),
  });

  const url = `${FUND_THEME_BASE_URL}/FundMNSubjectList?${params.toString()}`;

  const payload = await client.post<{
    Data?: Array<{
      code: string;
      name: string;
      ZDF?: string;
      SYL_W?: string;
      SYL_M?: string;
      SYL_3M?: string;
      SYL_6M?: string;
      SYL_Y?: string;
      SYL_3Y?: string;
      SYL_5Y?: string;
      isIndustry?: 0 | 1;
    }>;
    pageinfo?: {
      totalPages: number;
      pageSize: number;
      page: number;
    };
  }>(url, {
    provider: 'eastmoney',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  const data = payload.Data ?? [];
  const info = payload.pageinfo ?? { totalPages: 0, pageSize, page };

  const items: ThemeFund[] = data.map((item) => ({
    code: item.code ?? '',
    name: item.name ?? '',
    dailyChange: toFiniteNumberOrNull(item.ZDF),
    weeklyReturn: toFiniteNumberOrNull(item.SYL_W),
    monthlyReturn: toFiniteNumberOrNull(item.SYL_M),
    quarterlyReturn: toFiniteNumberOrNull(item.SYL_3M),
    halfYearReturn: toFiniteNumberOrNull(item.SYL_6M),
    yearlyReturn: toFiniteNumberOrNull(item.SYL_Y),
    threeYearReturn: toFiniteNumberOrNull(item.SYL_3Y),
    fiveYearReturn: toFiniteNumberOrNull(item.SYL_5Y),
    type: item.isIndustry === 1 ? '行业' : item.isIndustry === 0 ? '概念' : '行业',
  }));

  return {
    items,
    totalPages: info.totalPages ?? 0,
    pageSize: info.pageSize ?? pageSize,
    currentPage: info.page ?? page,
  };
}

/**
 * 获取热门主题
 *
 * @param client RequestClient
 * @param options 查询选项
 */
export async function getHotThemes(
  client: RequestClient,
  options: GetHotThemesOptions = {}
): Promise<HotThemesResult> {
  const sort = options.sort ?? 'ZDF';
  const order = options.order ?? 'desc';
  const category = options.category ?? '2';
  const limit = options.limit ?? 20;

  const params = new URLSearchParams({
    ...COMMON_PARAMS,
    RankItems: sort,
    RankVectors: order,
    category,
    limit: String(limit),
  });

  const url = `${FUND_THEME_BASE_URL}/FundThemeList?${params.toString()}`;

  const payload = await client.post<{
    Data?: Array<{
      code: string;
      name: string;
      ZDF?: string;
      SYL_W?: string;
      SYL_M?: string;
      SYL_3M?: string;
      SYL_6M?: string;
      SYL_Y?: string;
      SYL_3Y?: string;
      SYL_5Y?: string;
      isIndustry?: 0 | 1;
    }>;
  }>(url, {
    provider: 'eastmoney',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  const data = payload.Data ?? [];

  return data.map((item) => ({
    code: item.code ?? '',
    name: item.name ?? '',
    dailyChange: toFiniteNumberOrNull(item.ZDF),
    weeklyReturn: toFiniteNumberOrNull(item.SYL_W),
    monthlyReturn: toFiniteNumberOrNull(item.SYL_M),
    quarterlyReturn: toFiniteNumberOrNull(item.SYL_3M),
    halfYearReturn: toFiniteNumberOrNull(item.SYL_6M),
    yearlyReturn: toFiniteNumberOrNull(item.SYL_Y),
    threeYearReturn: toFiniteNumberOrNull(item.SYL_3Y),
    fiveYearReturn: toFiniteNumberOrNull(item.SYL_5Y),
    type: item.isIndustry === 1 ? '行业' : item.isIndustry === 0 ? '概念' : '行业',
  }));
}

/**
 * 获取主题下基金列表
 *
 * @param client RequestClient
 * @param themeCode 主题代码，如 'BK0438'
 * @param options 查询选项
 */
export async function getThemeFunds(
  client: RequestClient,
  themeCode: string,
  options: GetThemeFundsOptions = {}
): Promise<ThemeFundItemList> {
  const sortColumn = options.sortColumn ?? 'SYL_1N';
  const sort = options.sort ?? 'desc';
  const pageIndex = options.pageIndex ?? 1;
  const pageSize = options.pageSize ?? 20;
  const fundType = options.fundType ?? '';

  const params = new URLSearchParams({
    ...COMMON_PARAMS,
    TOPICAL: themeCode,
    SortColumn: sortColumn,
    Sort: sort,
    pageIndex: String(pageIndex),
    pageSize: String(pageSize),
    FundType: fundType,
  });

  const url = `${FUND_THEME_BASE_URL}/FundMNRank?${params.toString()}`;

  const payload = await client.post<{
    Data?: Array<{
      fscode: string;
      abname: string;
      ftype: string;
      ZDF?: string;
      SYL_Z?: string;
      SYL_Y?: string;
      SYL_3Y?: string;
      SYL_1N?: string;
      dwjz?: string;
    }>;
    fundinfo?: {
      total: number;
      pagesize: number;
      pageindex: number;
    };
  }>(url, {
    provider: 'eastmoney',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  const data = payload.Data ?? [];
  const fundInfo = payload.fundinfo ?? { total: 0, pagesize: pageSize, pageindex: pageIndex };

  const items: ThemeFundItem[] = data.map((item) => ({
    code: item.fscode ?? '',
    name: item.abname ?? '',
    fundType: item.ftype ?? '',
    dailyChange: toFiniteNumberOrNull(item.ZDF),
    weeklyReturn: toFiniteNumberOrNull(item.SYL_Z),
    monthlyReturn: toFiniteNumberOrNull(item.SYL_Y),
    quarterlyReturn: toFiniteNumberOrNull(item.SYL_3Y),
    yearlyReturn: toFiniteNumberOrNull(item.SYL_1N),
    nav: toFiniteNumberOrNull(item.dwjz),
    themeCode: themeCode,
    themeName: '', // 上游不返回主题名称，调用方需自行维护映射
  }));

  return {
    items,
    total: fundInfo.total ?? 0,
    pageIndex: fundInfo.pageindex ?? pageIndex,
    pageSize: fundInfo.pagesize ?? pageSize,
  };
}
```

- [ ] **Step 2: 在 src/providers/eastmoney/index.ts 导出新函数**

在 `src/providers/eastmoney/index.ts` 末尾（`margin` 导出之后）添加：

```typescript
// 主题基金
export {
  getThemeList,
  getHotThemes,
  getThemeFunds,
  type GetThemeListOptions,
  type GetHotThemesOptions,
  type GetThemeFundsOptions,
} from './fundTheme';
```

- [ ] **Step 3: 验证构建**

```bash
yarn build
```

预期：构建成功。

---

### Task 3: Service 层实现

**Files:** `src/sdk/fundService.ts`

- [ ] **Step 1: 修改 fundService.ts 添加 theme 命名空间**

在 `src/sdk/fundService.ts` 中添加：

```typescript
// 文件开头导入
import { eastmoney } from '../providers';
// 添加新类型导入
import type {
  // ... 原有导入
  GetThemeListOptions,
  GetHotThemesOptions,
  GetThemeFundsOptions,
  ThemeFundListResult,
  HotThemesResult,
  ThemeFundItemList,
} from '../types';

// 文件末尾添加 theme 命名空间
class FundThemeService {
  constructor(private readonly client: RequestClient) {}

  /** 获取全部主题基金列表 */
  getThemeList(options?: GetThemeListOptions): Promise<ThemeFundListResult> {
    return eastmoney.getThemeList(this.client, options);
  }

  /** 获取热门主题 */
  getHotThemes(options?: GetHotThemesOptions): Promise<HotThemesResult> {
    return eastmoney.getHotThemes(this.client, options);
  }

  /** 获取主题下基金列表 */
  getThemeFunds(
    themeCode: string,
    options?: GetThemeFundsOptions
  ): Promise<ThemeFundItemList> {
    return eastmoney.getThemeFunds(this.client, themeCode, options);
  }
}

// 修改 FundService 类，添加 theme 属性
export class FundService extends BaseService {
  // ... 原有 constructor 和方法

  /** 主题基金子命名空间 */
  readonly theme = new FundThemeService(this.client);
}
```

完整修改后的 `src/sdk/fundService.ts`:

```typescript
/**
 * 公募基金扩展数据 Service
 *
 * 与现有腾讯系 `getFundQuotes`（实时行情）并列，专门承载东方财富侧的
 * 基金深度数据（分红 / 历史净值 / 估值 / 排名等）。
 */
import { eastmoney } from '../providers';
import type {
  FundDividendListOptions,
  FundDividendListResult,
  FundEstimate,
  FundNavHistory,
  FundRankHistory,
  GetThemeListOptions,
  GetHotThemesOptions,
  GetThemeFundsOptions,
  ThemeFundListResult,
  HotThemesResult,
  ThemeFundItemList,
} from '../types';
import type { RequestClient } from '../core';
import { BaseService } from './baseService';

export class FundService extends BaseService {
  constructor(client: RequestClient) {
    super(client);
  }

  /** 获取基金分红明细（全市场，按年份分页） */
  getFundDividendList(
    options?: FundDividendListOptions
  ): Promise<FundDividendListResult> {
    return eastmoney.getFundDividendList(this.client, options);
  }

  /** 获取基金历史净值（单位 + 累计，全历史一次返回） */
  getFundNavHistory(code: string): Promise<FundNavHistory> {
    return eastmoney.getFundNavHistory(this.client, code);
  }

  /** 获取基金当日实时估值（含 T-1 单位净值 + 盘中估算） */
  getFundEstimate(code: string): Promise<FundEstimate> {
    return eastmoney.getFundEstimate(this.client, code);
  }

  /** 获取基金同类排名走势（每日近三月排名 + 百分位） */
  getFundRankHistory(code: string): Promise<FundRankHistory> {
    return eastmoney.getFundRankHistory(this.client, code);
  }

  /** 主题基金子命名空间 */
  readonly theme = new (class FundThemeService {
    constructor(private readonly client: RequestClient) {}

    /** 获取全部主题基金列表 */
    getThemeList(options?: GetThemeListOptions): Promise<ThemeFundListResult> {
      return eastmoney.getThemeList(this.client, options);
    }

    /** 获取热门主题 */
    getHotThemes(options?: GetHotThemesOptions): Promise<HotThemesResult> {
      return eastmoney.getHotThemes(this.client, options);
    }

    /** 获取主题下基金列表 */
    getThemeFunds(
      themeCode: string,
      options?: GetThemeFundsOptions
    ): Promise<ThemeFundItemList> {
      return eastmoney.getThemeFunds(this.client, themeCode, options);
    }
  })(this.client);
}
```

- [ ] **Step 2: 验证构建**

```bash
yarn build
```

预期：构建成功。

---

### Task 4: SDK 门面集成

**Files:** `src/sdk.ts`

- [ ] **Step 1: 修改 sdk.ts 的 fund 命名空间**

在 `src/sdk.ts` 的 `get fund()` getter 中，添加 `theme` 子命名空间：

```typescript
  /** 公募基金扩展 */
  get fund() {
    return this.memoNs('fund', () => {
      const f = this.fundService;
      return {
        dividendList: f.getFundDividendList.bind(f),
        navHistory: f.getFundNavHistory.bind(f),
        estimate: f.getFundEstimate.bind(f),
        rankHistory: f.getFundRankHistory.bind(f),
        theme: f.theme,
      };
    });
  }
```

- [ ] **Step 2: 验证构建**

```bash
yarn build
```

预期：构建成功。

---

### Task 5: 单元测试

**Files:** 
- Create: `test/unit/providers/eastmoney/fundTheme.test.ts`
- Modify: `test/unit/providers/eastmoney/index.ts`（如有）

- [ ] **Step 1: 创建 MSW mock handlers**

```typescript
/**
 * Unit tests for eastmoney theme fund provider
 */
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { RequestClient } from '../../../../src/core/request';
import {
  getThemeList,
  getHotThemes,
  getThemeFunds,
} from '../../../../src/providers/eastmoney/fundTheme';

const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const client = new RequestClient();

describe('eastmoney/fundTheme', () => {
  describe('getThemeList', () => {
    it('should return theme list with default parameters', async () => {
      server.use(
        http.post(
          'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNSubjectList',
          async () => {
            return HttpResponse.json({
              Data: [
                {
                  code: 'BK0438',
                  name: '食品饮料',
                  ZDF: '1.23',
                  SYL_W: '2.45',
                  SYL_M: '3.67',
                  SYL_3M: '5.89',
                  SYL_6M: '8.12',
                  SYL_Y: '15.34',
                  SYL_3Y: '45.67',
                  SYL_5Y: '89.01',
                  isIndustry: 1,
                },
                {
                  code: 'BK0474',
                  name: '保险Ⅱ',
                  ZDF: '-0.56',
                  SYL_W: '1.23',
                  SYL_M: '2.34',
                  SYL_3M: '3.45',
                  SYL_6M: '4.56',
                  SYL_Y: '6.78',
                  SYL_3Y: '12.34',
                  SYL_5Y: '23.45',
                  isIndustry: 1,
                },
              ],
              pageinfo: {
                totalPages: 3,
                pageSize: 20,
                page: 1,
              },
            });
          }
        )
      );

      const result = await getThemeList(client);

      expect(result.items).toHaveLength(2);
      expect(result.items[0].code).toBe('BK0438');
      expect(result.items[0].name).toBe('食品饮料');
      expect(result.items[0].dailyChange).toBe(1.23);
      expect(result.items[0].type).toBe('行业');
      expect(result.totalPages).toBe(3);
    });

    it('should respect custom sort and order parameters', async () => {
      server.use(
        http.post(
          'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNSubjectList',
          async ({ request }) => {
            const url = new URL(request.url);
            expect(url.searchParams.get('RankItems')).toBe('SYL_Y');
            expect(url.searchParams.get('RankVectors')).toBe('asc');
            expect(url.searchParams.get('category')).toBe('0');

            return HttpResponse.json({ Data: [], pageinfo: { totalPages: 1, pageSize: 20, page: 1 } });
          }
        )
      );

      await getThemeList(client, {
        sort: 'SYL_Y',
        order: 'asc',
        category: '0',
      });
    });

    it('should handle empty data gracefully', async () => {
      server.use(
        http.post(
          'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNSubjectList',
          () => HttpResponse.json({ Data: [], pageinfo: { totalPages: 0, pageSize: 0, page: 1 } })
        )
      );

      const result = await getThemeList(client);

      expect(result.items).toHaveLength(0);
      expect(result.totalPages).toBe(0);
    });
  });

  describe('getHotThemes', () => {
    it('should return hot themes array', async () => {
      server.use(
        http.post(
          'https://fundmobapi.eastmoney.com/FundMNewApi/FundThemeList',
          () =>
            HttpResponse.json({
              Data: [
                {
                  code: 'BK0438',
                  name: '食品饮料',
                  ZDF: '1.23',
                  SYL_W: '2.45',
                  SYL_M: '3.67',
                  SYL_3M: '5.89',
                  SYL_6M: '8.12',
                  SYL_Y: '15.34',
                  SYL_3Y: '45.67',
                  SYL_5Y: '89.01',
                  isIndustry: 1,
                },
              ],
            })
        )
      );

      const result = await getHotThemes(client);

      expect(Array.isArray(result)).toBe(true);
      expect(result[0].code).toBe('BK0438');
      expect(result[0].name).toBe('食品饮料');
    });

    it('should handle empty response', async () => {
      server.use(
        http.post(
          'https://fundmobapi.eastmoney.com/FundMNewApi/FundThemeList',
          () => HttpResponse.json({ Data: [] })
        )
      );

      const result = await getHotThemes(client);

      expect(result).toHaveLength(0);
    });
  });

  describe('getThemeFunds', () => {
    it('should return funds filtered by theme code', async () => {
      server.use(
        http.post(
          'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNRank',
          () =>
            HttpResponse.json({
              Data: [
                {
                  fscode: '000001',
                  abname: '测试基金A',
                  ftype: '股票型',
                  ZDF: '2.34',
                  SYL_Z: '5.67',
                  SYL_Y: '8.90',
                  SYL_3Y: '15.23',
                  SYL_1N: '25.67',
                  dwjz: '1.2345',
                },
              ],
              fundinfo: {
                total: 150,
                pagesize: 20,
                pageindex: 1,
              },
            })
        )
      );

      const result = await getThemeFunds(client, 'BK0438');

      expect(result.items).toHaveLength(1);
      expect(result.items[0].code).toBe('000001');
      expect(result.items[0].name).toBe('测试基金A');
      expect(result.items[0].dailyChange).toBe(2.34);
      expect(result.items[0].themeCode).toBe('BK0438');
      expect(result.total).toBe(150);
    });

    it('should respect pagination parameters', async () => {
      server.use(
        http.post(
          'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNRank',
          async ({ request }) => {
            const url = new URL(request.url);
            expect(url.searchParams.get('pageIndex')).toBe('2');
            expect(url.searchParams.get('pageSize')).toBe('30');

            return HttpResponse.json({ Data: [], fundinfo: { total: 0, pagesize: 30, pageindex: 2 } });
          }
        )
      );

      await getThemeFunds(client, 'BK0438', { pageIndex: 2, pageSize: 30 });
    });

    it('should handle empty data gracefully', async () => {
      server.use(
        http.post(
          'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNRank',
          () => HttpResponse.json({ Data: [], fundinfo: { total: 0, pagesize: 0, pageindex: 1 } })
        )
      );

      const result = await getThemeFunds(client, 'BK0438');

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });
});
```

- [ ] **Step 2: 运行单元测试**

```bash
yarn test test/unit/providers/eastmoney/fundTheme.test.ts
```

预期：所有测试通过。

---

### Task 6: 集成测试

**Files:** Create: `test/integration/sdk/theme.int.test.ts`

- [ ] **Step 1: 创建集成测试**

```typescript
/**
 * Integration tests for theme fund API (real network requests)
 */
import { describe, it, expect, vi } from 'vitest';
import { StockSDK } from '../../../src';

const sdk = new StockSDK();

describe.skipIf(!process.env.RUN_INTEGRATION)(
  'theme fund integration',
  () => {
    it('should fetch theme list successfully', async () => {
      const result = await sdk.fund.theme.getThemeList({ pageSize: 5 });

      expect(result.items).toBeDefined();
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items[0].code).toMatch(/^BK\d{4}$/);
      expect(result.items[0].name).toBeDefined();
      expect(result.items[0].type).toMatch(/^行业|概念$/);
    });

    it('should fetch hot themes successfully', async () => {
      const result = await sdk.fund.theme.getHotThemes({ limit: 10 });

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].code).toMatch(/^BK\d{4}$/);
    });

    it('should fetch funds by theme code', async () => {
      // 先用 getThemeList 获取一个主题代码
      const themes = await sdk.fund.theme.getThemeList({ pageSize: 1 });
      if (themes.items.length === 0) {
        throw new Error('No themes available for integration test');
      }

      const themeCode = themes.items[0].code;
      const result = await sdk.fund.theme.getThemeFunds(themeCode, {
        pageSize: 5,
      });

      expect(result.items).toBeDefined();
      expect(result.total).toBeGreaterThan(0);
      expect(result.items[0].code).toMatch(/^\d{6}$/);
      expect(result.items[0].name).toBeDefined();
      expect(result.items[0].themeCode).toBe(themeCode);
    });

    it('should handle invalid theme code gracefully', async () => {
      await expect(
        sdk.fund.theme.getThemeFunds('INVALID_CODE')
      ).rejects.toThrow();
    });
  },
  30000
);
```

- [ ] **Step 2: 运行集成测试**

```bash
RUN_INTEGRATION=1 yarn test test/integration/sdk/theme.int.test.ts
```

预期：所有测试通过（需网络可达）。

---

### Task 7: 更新文档

**Files:** 
- Modify: `README.md`
- Modify: `README_EN.md`
- Modify: `website/api/fund.md`
- Modify: `website/guide/fund.md`

- [ ] **Step 1: 更新 README.md**

在 README.md 的 "特性" 列表中添加：

```markdown
- ✅ **基金深度数据**：历史净值、实时估值、同类排名走势、基金/ETF 分红送配、**主题基金**
```

在 "API 概览（命名空间）" 表格的 `sdk.fund` 行添加 `.theme`：

```markdown
| `sdk.fund` | `.dividendList` / `.navHistory` / `.estimate` / `.rankHistory` / `.theme` |
```

- [ ] **Step 2: 更新 README_EN.md**

同步英文文档的对应变更。

- [ ] **Step 3: 更新 website/api/fund.md**

在 `website/api/fund.md` 中添加 `fund.theme` 章节，包含三个方法的完整 API 文档。

- [ ] **Step 4: 更新 website/guide/fund.md**

添加主题基金使用示例：

```typescript
import { StockSDK } from 'stock-sdk';

const sdk = new StockSDK();

// 获取全部主题列表
const themes = await sdk.fund.theme.getThemeList({
  sort: 'SYL_Y',
  order: 'desc',
  category: '0', // 仅行业
  pageSize: 20,
});
console.log(themes.items);

// 获取热门主题
const hotThemes = await sdk.fund.theme.getHotThemes({ limit: 10 });
console.log(hotThemes);

// 获取某主题下的基金排行
const funds = await sdk.fund.theme.getThemeFunds('BK0438', {
  sortColumn: 'SYL_1N',
  pageSize: 20,
});
console.log(funds.items);
```

---

### Task 8: 最终验证

- [ ] **Step 1: 完整构建**

```bash
yarn build
```

预期：构建成功，无错误。

- [ ] **Step 2: 完整测试**

```bash
yarn test
yarn test:integration:smoke
```

预期：所有测试通过。

- [ ] **Step 3: 类型检查**

```bash
yarn typecheck
```

预期：类型检查通过。

- [ ] **Step 4: Git 提交**

```bash
git add -A
git commit -m "feat: add theme fund API (sdk.fund.theme)"
```
