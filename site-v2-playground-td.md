# site-v2 Playground 技术方案（TD）

> 状态：待评审，未编码。
> 关联文档：[v2-td.md](./v2-td.md)（SDK v2 架构）、[v2-docs-site.md](./v2-docs-site.md)（v2 文档站）。

## 1. 背景与目标

v1 文档站有一套成熟的 Playground（16 分类、市场过滤、参数表单、即时运行、URL 深链、SDK 运行时配置抽屉），是文档站体验的核心卖点。v2 站目前 `site-v2/playground/index.md` 只是「即将上线」占位页。

目标：在 v2 站实现同等体验的 Playground，且**不重蹈 v1 的维护陷阱**——v1 为每个方法手写了参数表单 + 代码示例 + run 调度函数（`website/.vitepress/theme/components/playground/methods/` 共 16 文件、约 1900 行），SDK 每加一个方法都要在文档站再手写一遍，两边天然漂移。

## 2. 现状盘点

### 2.1 v1 Playground 资产（可复用部分）

| 资产 | 规模 | v2 处置 |
|---|---|---|
| `Playground.vue` 壳层 UI | 1972 行 | **移植**：侧边栏/搜索/市场芯片/折叠持久化/参数表单/结果区/配置抽屉/URL 深链/快捷键，全部行为保留，换红盘主题 |
| `methods/*.ts` 手写方法目录 | ~1900 行 | **废弃**：由 spec 派生替代（见 §3） |
| `types.ts`（MethodSpec/ParamSpec） | 136 行 | **重做**：v2 表单字段类型从 spec 的 ParamSpec 映射而来 |
| `utils.ts`（默认日期等） | 174 行 | **移植**（小工具，直接搬） |
| `categories.ts`（分类/图标/颜色） | 50 行 | **重做**：v2 分类 = 命名空间，重写标签/图标映射 |

### 2.2 v2 SDK 的关键新资产：spec SSOT

v2 在 `src/spec/` 落了「一处定义、多端派生」的方法规格层：

- **`methods.ts`（1240 行，85 个方法、17 个命名空间）**：每个方法声明 `path`（如 `['quotes','cn']`）、`summary`、`argShape`（6 种调用形态）、`positional`（位置参数）、`params`（类型化参数：`string/number/boolean/enum/number[]`、枚举值、必填、默认值、文案）
- **`derive-cli.ts`** → 派生 CLI 命令清单
- **`derive-mcp.ts`** → 派生 MCP 工具（inputSchema + 按 argShape 自动组装 invoke）
- **`resolve.ts`** → 全库唯一的「点路径 → SDK 方法」walker（修过 this 绑定 bug，修复只落一处）

spec 是**纯数据 + 类型**，不依赖 Node API，可直接被浏览器侧 bundle。

命名空间方法分布（共 85）：options 11 / board 10 / quotes 8 / kline 7 / futures 6 / northbound 5 / fundFlow 5 / dragonTiger 5 / batch 5 / fund 4 / codes 4 / calendar 4 / marketEvent 3 / blockTrade 3 / reference 2 / margin 2 / search 1。

## 3. 核心设计决策：Playground 成为 spec 的第三个派生端

```
                    src/spec/methods.ts（SSOT，85 方法）
                   /            |              \
        derive-cli.ts    derive-mcp.ts    derive-playground.ts（新增）
              |                |                    |
        CLI manifest      MCP TOOLS         Playground 方法目录
                                       （分类/表单/调用/代码示例 全自动）
```

**对比 v1 方案：**

| 维度 | v1（手写目录） | v2（spec 派生） |
|---|---|---|
| 方法目录 | 手写 ~1900 行 | 派生器 ~150 行 + 薄 overlay ~200 行 |
| 参数表单 | 每方法手写 ParamSpec | `spec.params` 自动映射（enum→select、number→number input、boolean→checkbox） |
| 运行调度 | 每方法手写 run 函数 | 通用执行器：`resolveSdkMethod(sdk, path)` + argShape 组装（与 MCP `buildInvoke` 同构） |
| 代码示例 | 每方法手写模板 | 由 path + argShape + 当前参数值实时生成 |
| SDK 新增方法 | 文档站要再写一遍 | spec 加一条，CLI/MCP/Playground 三端同时获得 |
| 漂移风险 | 高（两份清单） | 趋零（contract 测试已覆盖 spec ↔ SDK 一致性） |

## 4. 模块设计

### 4.1 方法目录派生（`derive-playground.ts`）

输入 `MethodSpec`，输出 `PlaygroundMethod`：

```ts
interface PlaygroundMethod {
  id: string            // path.join('.')，唯一键，亦用于 URL 深链
  path: string[]        // 调用路径
  label: string         // 'quotes.cn'，侧边栏显示
  desc: string          // spec.summary
  category: string      // = path[0]（命名空间即分类，与 API 文档侧边栏同构）
  market: MarketKey[]   // 推断 + overlay 修正（见 4.4）
  fields: FormField[]   // 表单字段（codes/positional/params 依序展开）
  argShape: ArgShape    // 通用执行器用
}
```

字段映射规则（与 `derive-mcp.toInputSchema` 同构，复用其导出的 `jsonKeyOf/mcpEnumOf`）：

- `argShape` 含 `codes` → 生成一个 `codes` 文本框（逗号分隔，placeholder 示例 `sh600519,000001`）
- `positional[]` → 按序生成文本框 / select（有 enum 时）
- `params[]` → `enum`→select（取值经 `map` 映射）、`number`→number、`boolean`→checkbox、其余→text；`required` / `default` / `desc` 直接透传为表单的必填标记 / 默认值 / 提示文案

**市场标签推断**：`path` 末段含 `cn/hk/us` → 对应市场；`fund`/`futures`/`options`/`board` 命名空间 → 同名标签；`calendar`/`search`/`reference` → `all`；推断不准的（约 10 个）在 overlay 显式标注。

### 4.2 通用执行器

直接镜像 `derive-mcp.buildInvoke` 的 argShape 组装逻辑（六个 case），调用走 `resolveSdkMethod`。**不另写 walker**——这是 v2 反复修过 this 绑定的地方，必须复用唯一实现。

表单值 → 实参的转换在执行器内做：`codes` 文本框按逗号/空白切分成数组、number 转数、空串视为未填（不进 options 对象，让 SDK 默认值落地——与 MCP「default 仅展示、不注入实参」同一原则）。

### 4.3 代码示例生成器

由 `path + argShape + 当前表单值` 生成可复制运行的代码，随参数编辑实时更新（v1 是手写模板，常与真实调用脱节）：

```ts
// 生成产物示例（quotes.cn，codes=['sh600519','000001']，无 options）
import { StockSDK } from 'stock-sdk'

const sdk = new StockSDK()
const data = await sdk.quotes.cn(['sh600519', '000001'])
```

options 对象只包含用户改过（非默认空值）的字段，保持示例最小化。

### 4.4 Overlay 层（`playground/overrides.ts`，预估 ~200 行）

spec 缺少的「演示性信息」集中在一个薄覆盖层，按 `id` 索引：

1. **可运行默认值**：spec 的 `default` 是展示用，playground 需要每个方法开箱即跑的默认参数（如 codes 默认 `sh600519`、日期默认近 30 天——复用 v1 `utils.ts`）
2. **市场标签修正**：推断不准的方法显式标注
3. **特例 `kline.withIndicators`**：spec 中标记 `mcpCustom`（MCP 用嵌套 indicators 对象、CLI 用 14 个扁平 flag），playground 同样需要手写此一个方法的表单（指标多选 + 参数）与调用——**全站唯一手写特例**
4. **指标/信号 subpath**（`stock-sdk/indicators`、`/signals`）：不在 spec（它们是函数导入而非 sdk 实例方法）。Phase 1 由 `kline.withIndicators` 覆盖指标演示场景；独立的 indicators/signals 演示区列入 Phase 2 待定

### 4.5 壳层 UI（移植 v1 `Playground.vue`）

整体移植，保留全部交互行为：

- 侧边栏：分类分组（v2 = 17 个命名空间，分组标题/图标/颜色重写）+ 方法搜索（⌘K）+ 市场过滤芯片 + 折叠状态 localStorage 持久化
- 参数表单：从 `fields` 渲染；必填校验
- 结果区：JSON 渲染 + 大结果截断保护（>200 条只渲染前 200，全量挂 `window.__playgroundLastResult`）+ 复制 + 耗时/数量统计
- URL 深链：`#quotes.cn?codes=sh600519`（方法 id 取代 v1 的扁平方法名）
- SDK 运行时配置抽屉：timeout / retry / rateLimit / circuitBreaker，localStorage 持久化——v2 构造选项与 v1 兼容，照搬
- 快捷键：⌘K 搜索、⌘↵ 运行、Esc 关抽屉
- 主题：v1 的 `--pg-*` 局部变量表整体替换为红盘主题（主色 `#b91c1c`/`#f87171`、鎏金点缀、暖黑面板），与站内 LiveTicker 终端卡观感统一

### 4.6 SDK 加载与版本一致性

与 LiveTicker 同款双模式：

- **dev**：`import('stock-sdk-local')` → vite alias 指向本地 `src/`（已在 config.ts 配好），spec 与 SDK 同源，绝对一致
- **prod**：`import('https://unpkg.com/stock-sdk@<精确版本>/dist/index.js')`——**锁精确版本而非 @beta 浮动 tag**，版本号构建期读自 `package.json`（与 HeroMeta 的 sdkVersion 同源注入）

⚠️ **版本一致性约束**：playground 的方法目录来自构建时 bundle 的本地 spec，运行时 SDK 来自 npm。若 spec 描述了尚未发布的方法，线上点击会报「方法不存在」。对策：
1. CDN 锁精确版本 = 文档站构建时的 package.json 版本
2. **部署顺序约定：先 npm 发版，再部署文档站**（写进 v2-docs-site.md 的发布清单）
3. 执行器对 `resolveSdkMethod` 返回 undefined 给出友好报错（提示版本未发布，而非裸 TypeError）

### 4.7 i18n

- UI chrome（按钮/状态/提示/抽屉文案）：按 LiveTicker 模式用 `useData().lang` 切 zh/en 两套字符串（~30 条）
- 方法 `summary`/参数 `desc`：spec 里是中文，Phase 1 英文站照显中文（与 CLI/MCP 现状一致），不阻塞上线；spec 双语化属 SDK 侧改造，单独立项

## 5. 文件规划

```
site-v2/.vitepress/theme/
├── components/
│   ├── Playground.vue                 # 壳层（移植改造，~1800 行）
│   └── playground/
│       ├── derive.ts                  # spec → PlaygroundMethod 派生器（~150 行）
│       ├── runner.ts                  # 通用执行器（argShape 组装，~80 行）
│       ├── codegen.ts                 # 代码示例生成器（~80 行）
│       ├── overrides.ts               # 默认值/市场修正/withIndicators 特例（~200 行）
│       ├── categories.ts              # 命名空间 → 标签/图标/颜色（~60 行）
│       ├── types.ts                   # PlaygroundMethod/FormField（~60 行）
│       └── utils.ts                   # 默认日期等（v1 直搬，~170 行）
├── index.ts                           # enhanceApp 注册 <Playground/> 全局组件
site-v2/playground/index.md            # 占位文案 → <Playground/>（含 v1 同款页面级布局样式）
site-v2/en/playground/index.md         # 同上（en）
```

spec 的引用方式：`import { METHOD_SPECS } from '../../../../src/spec/methods'`（站内相对引用源码，构建期静态 bundle；不需要给 npm 包加 `stock-sdk/spec` 子路径导出——文档站与 SDK 同仓，这是同仓的天然红利）。

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| spec（构建期）与 npm SDK（运行时）版本漂移 | CDN 锁精确版本 + 先发版后部署 + 执行器友好报错（§4.6） |
| `kline.withIndicators` 表单复杂（14 指标 × 各自参数） | 唯一手写特例，Phase 1 可先提供常用 4 指标（ma/macd/boll/kdj）多选，其余 Phase 2 |
| spec 纯数据被 bundle 后体积 | 1240 行纯字面量，gzip 后预估 <10KB，可接受；超预期时改 `import()` 懒加载 |
| 浏览器 CORS | 数据源（腾讯/东财）与 v1 playground 相同且 v1 已线上验证可用；个别接口若受限，结果区如实报错即可 |
| 大批量接口（batch.cn 全市场数千条）卡渲染 | 移植 v1 的 MAX_RENDER_ITEMS 截断 + onProgress 进度上报（spec 的 batch 方法支持 onProgress） |

## 7. 实施步骤

1. **P1 骨架**：derive.ts + runner.ts + types.ts + categories.ts，先让 quotes/kline 两个命名空间在极简 UI 下跑通（验证派生与执行链路）
2. **P2 壳层移植**：Playground.vue 全功能移植 + 红盘主题 + URL 深链 + 配置抽屉
3. **P3 补全**：overrides.ts 默认值全覆盖 85 方法、withIndicators 特例、codegen、i18n、en 页
4. **P4 验证**：dev 模式全方法点击冒烟（85 个）、build + 真浏览器双主题/双语言验证、大结果截断验证
5. 占位页替换、`v2-docs-site.md` 增补「先发版后部署」约定

## 8. 待确认决策点

| # | 决策 | 推荐 | 备选 |
|---|---|---|---|
| 1 | 方法目录来源 | **spec 派生 + 薄 overlay**（§3） | 照搬 v1 手写目录（不推荐，双倍维护） |
| 2 | prod SDK 版本策略 | **锁精确版本**（构建期注入） | `@beta` 浮动（省心但漂移风险大） |
| 3 | 分类维度 | **命名空间 = 分类**（与 API 文档同构） | 沿用 v1 的 16 个业务分类（需手工映射表） |
| 4 | indicators/signals subpath 演示 | **Phase 2**（先由 withIndicators 覆盖） | Phase 1 一并做（拉长工期） |
| 5 | en 站方法描述 | **Phase 1 照显中文** | spec 双语化（SDK 侧改造，单独立项） |
