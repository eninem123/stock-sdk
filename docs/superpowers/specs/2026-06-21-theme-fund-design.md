# 主题基金接口设计文档

> **Date:** 2026-06-21
> **Status:** Approved
> **Related:** [Implementation Plan](./2026-06-21-theme-fund-implementation-plan.md)

## 概述

为 Stock SDK 添加主题基金（主题板块基金）功能，通过东方财富天天基金接口获取行业/概念主题列表及其对应的基金排行。

**API 命名空间:** `sdk.fund.theme.*`

## 需求范围

| 功能 | 说明 |
|------|------|
| 获取全部主题 | 返回行业 + 概念主题列表（代码、名称、各阶段收益率） |
| 获取热门主题 | 按指定排序字段返回排名靠前的主题 |
| 获取主题下基金 | 按主题代码筛选基金排行（支持分页、排序） |
| ~~主题 K 线~~ | 上游无此 API，客户端聚合计算量太大，不实现 |

## API 设计

### `getThemeList(options?)`

获取全部主题基金列表（行业 + 概念）。

```typescript
interface GetThemeListOptions {
  /** 排序字段：'ZDF'(日涨幅) | 'SYL_W'(近1周) | 'SYL_M'(近1月) | 'SYL_3M'(近3月) | 'SYL_6M'(近6月) | 'SYL_Y'(近1年) | 'SYL_3Y'(近3年) | 'SYL_5Y'(近5年)；默认 'ZDF' */
  sort?: 'ZDF' | 'SYL_W' | 'SYL_M' | 'SYL_3M' | 'SYL_6M' | 'SYL_Y' | 'SYL_3Y' | 'SYL_5Y';
  /** 排序方向：'desc' | 'asc'；默认 'desc' */
  order?: 'desc' | 'asc';
  /** 主题类型：'0'=行业 | '1'=概念 | '2'=全部；默认 '2' */
  category?: '0' | '1' | '2';
  /** 每页条数：默认 20，最大 50 */
  pageSize?: number;
  /** 页码：默认 1 */
  page?: number;
}

interface ThemeFund {
  /** 主题代码，如 'BK0438' */
  code: string;
  /** 主题名称，如 '食品饮料' */
  name: string;
  /** 日涨幅 (%) */
  dailyChange: number | null;
  /** 近1周收益率 (%) */
  weeklyReturn: number | null;
  /** 近1月收益率 (%) */
  monthlyReturn: number | null;
  /** 近3月收益率 (%) */
  quarterlyReturn: number | null;
  /** 近6月收益率 (%) */
  halfYearReturn: number | null;
  /** 近1年收益率 (%) */
  yearlyReturn: number | null;
  /** 近3年收益率 (%) */
  threeYearReturn: number | null;
  /** 近5年收益率 (%) */
  fiveYearReturn: number | null;
  /** 主题类型：'行业' | '概念' */
  type: '行业' | '概念';
}

interface ThemeFundListResult {
  items: ThemeFund[];
  totalPages: number;
  pageSize: number;
  currentPage: number;
}

/** 获取全部主题基金列表 */
getThemeList(options?: GetThemeListOptions): Promise<ThemeFundListResult>
```

### `getHotThemes(options?)`

获取热门主题（按指定排序字段返回排名）。

```typescript
interface GetHotThemesOptions {
  /** 排序字段，同 GetThemeListOptions.sort */
  sort?: 'ZDF' | 'SYL_W' | 'SYL_M' | 'SYL_3M' | 'SYL_6M' | 'SYL_Y' | 'SYL_3Y' | 'SYL_5Y';
  /** 排序方向 */
  order?: 'desc' | 'asc';
  /** 主题类型 */
  category?: '0' | '1' | '2';
  /** 返回条数：默认 20 */
  limit?: number;
}

/** 获取热门主题 */
getHotThemes(options?: GetHotThemesOptions): Promise<ThemeFund[]>
```

### `getThemeFunds(themeCode, options?)`

按主题代码获取基金排行。

```typescript
interface GetThemeFundsOptions {
  /** 排序字段：'SYL_Z'(近1周) | 'SYL_Y'(近1月) | 'SYL_3Y'(近3月) | 'SYL_1N'(近1年) | 'RZDF'(日涨幅)；默认 'SYL_1N' */
  sortColumn?: 'SYL_Z' | 'SYL_Y' | 'SYL_3Y' | 'SYL_1N' | 'RZDF';
  /** 排序方向 */
  sort?: 'desc' | 'asc';
  /** 页码：默认 1 */
  pageIndex?: number;
  /** 每页条数：默认 20，最大 30 */
  pageSize?: number;
  /** 基金类型筛选（可选） */
  fundType?: string;
}

interface ThemeFundItem {
  /** 基金代码 */
  code: string;
  /** 基金名称 */
  name: string;
  /** 基金类型 */
  fundType: string;
  /** 日涨幅 (%) */
  dailyChange: number | null;
  /** 近1周收益率 (%) */
  weeklyReturn: number | null;
  /** 近1月收益率 (%) */
  monthlyReturn: number | null;
  /** 近3月收益率 (%) */
  quarterlyReturn: number | null;
  /** 近1年收益率 (%) */
  yearlyReturn: number | null;
  /** 累计净值 */
  nav: number | null;
  /** 主题代码 */
  themeCode: string;
  /** 主题名称 */
  themeName: string;
}

interface ThemeFundItemList {
  items: ThemeFundItem[];
  total: number;
  pageIndex: number;
  pageSize: number;
}

/** 获取主题下基金列表 */
getThemeFunds(themeCode: string, options?: GetThemeFundsOptions): Promise<ThemeFundItemList>
```

## 数据源

| 接口 | URL | 说明 |
|------|-----|------|
| FundMNSubjectList | `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNSubjectList` | 获取全部主题 |
| FundThemeList | `https://fundmobapi.eastmoney.com/FundMNewApi/FundThemeList` | 获取热门主题 |
| FundMNRank | `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNRank` | 主题基金排行 |

**请求头要求:**
```
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36
```

**固定参数:**
- `plat=Android`
- `appType=ttjj`
- `product=EFund`
- `Version=1`
- `deviceid` 可传任意字符串（如 `'sdk-test'`）

## 架构

遵循现有三层架构：

```
sdk.fund.theme.*  ← SDK 门面（sdk.ts）
    ↓
FundService.theme.*  ← Service 层
    ↓
eastmoney.theme.*  ← Provider 层（fundTheme.ts）
    ↓
RequestClient  ← 请求治理（重试/限流/熔断）
```

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/types/fund.ts` | 修改 | 添加主题基金类型定义 |
| `src/providers/eastmoney/fundTheme.ts` | 创建 | Provider 层实现 |
| `src/providers/eastmoney/index.ts` | 修改 | 导出新模块 |
| `src/sdk/fundService.ts` | 修改 | 添加 `theme` 命名空间属性 |
| `src/sdk.ts` | 修改 | 添加 `fund.theme` 懒构建 |
| `src/index.ts` | 修改 | 导出新类型 |
| `test/unit/providers/eastmoney/fundTheme.test.ts` | 创建 | 单元测试（MSW mock） |
| `test/integration/sdk/theme.int.test.ts` | 创建 | 集成测试（真实请求） |
| `README.md` | 修改 | 更新特性列表和 API 表 |
| `website/api/fund.md` | 修改 | 添加主题基金 API 文档 |

## 测试策略

- **单元测试**: MSW mock 三个 API 的正常响应 + 边界情况（空结果、分页、错误）
- **集成测试**: 真实请求验证数据格式解析
- **环境测试**: 浏览器 + Node.js 双端验证

## 文档更新

- `website/api/fund.md` — 添加 `fund.theme` 章节
- `website/guide/fund.md` — 添加使用示例
- `README.md` — 更新特性列表
- `README_EN.md` — 同步英文文档
