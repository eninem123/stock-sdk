# Changelog

本文件记录 stock-sdk 的版本变更。早于 v2.2.1 的历史变更见 [GitHub Releases](https://github.com/chengzuopeng/stock-sdk/releases)。

## [2.2.1] - 2026-07-03

### 新增

- **东方财富特殊指数支持**(基于 [#51](https://github.com/chengzuopeng/stock-sdk/pull/51) 重构,感谢 @wubh2012 报告问题并提交首版实现):
  - 中证指数家族按**码形**识别(`93xxxx` 如 `930955` 红利低波动100 / `932000` 中证2000 / `931071` 人工智能产业,`H`+5 位如 `H30533` 海外中国互联网50 / `H11136` 海外中国互联网),东财 secid 前缀 `2.`,经 `kline.cn` / `getHistoryKline` 直接可用;
  - 具名指数:`HSHCI`(恒生医疗保健指数,`124.`,经 `kline.hk` 使用)、`GDAXI`(德国 DAX,`100.`,暂无正式 K 线入口,可经 `kline.us('100.GDAXI')` raw-secid 直通,注意返回按美股模型标注 currency/时区);
  - 新增 `src/symbols/specialIndex.ts` 单一注册表,`normalizeSymbol` 分类为 `{market, exchange: 'CSI'|'HSI'|'DAX', assetType: 'index'}`,三轴语法确定;
  - 特殊指数 secid 形(`2.930955` / `2.H30533` / `124.HSHCI` / `100.GDAXI`)成为合法输入,`toEastmoneySecid` 产出可回读(emit → parse → emit 闭环);
  - `Exchange` 类型联合新增 `'CSI' | 'HSI' | 'DAX'` 字面量。

### 修复

- `getHistoryKline('930955' / '932000' / 'H30533')` 等中证指数此前被按「9 开头 → 沪市」推断拼出 `1.930955` 类 secid,上游静默返回空数组([#51](https://github.com/chengzuopeng/stock-sdk/pull/51) 报告的问题);按码形识别后整个家族(含未来新码如 `931071`)一次修复。

### 行为变更

- `normalizeSymbol` 对特殊指数码形为**语法确定**分类,矛盾断言一律抛 `InvalidSymbolError` 并给出改写指引(此前多为静默拼出必空 secid):
  - 矛盾 hint:`('930955', { exchange: 'SSE' })`、`('2.930955', { assetType: 'stock' })`、`('H30533', { assetType: 'futures' })`(此前会被误解析为 SHFE 合约);
  - 矛盾前缀/后缀:`sh930955`、`930955.SH`、`H30533.SH`、`hkHSHCI`、`HSHCI.HK`;`us` 前缀 / `.US` 后缀不受影响(纯字母码维持美股 ticker 断言语义,如 `usGDAXI` → `105.GDAXI`);
  - 显式 secid 前缀断言保持原语义:`1.930955`、`105.GDAXI` 原样输出,即使附带 `assetType: 'index'` 消歧 hint 也不会被注册表覆盖。
- `marketOf('HSHCI')` 由 `'US'` 变为 `'HK'`,`marketOf('GDAXI')` 由 `'US'` 变为 `'GLOBAL'`。
- `toTencentSymbol` 对特殊指数抛 `InvalidArgumentError`(腾讯无对应标的,此前拼出 `shH30533` / `hkHSHCI` 类必空查询);CLI `quote` 对特殊指数报错并提示改用 `kline`。
- `fundFlow.individual` 对特殊指数(含其 secid 形)统一抛 `InvalidArgumentError`(该接口无特殊指数数据,此前静默返回空数组);交易所宿主指数 secid(如 `1.000001`)不受影响。
- SDK `kline.withIndicators` / CLI `kline` 等自动路由入口对 `GLOBAL` 市场符号(`GDAXI`)给出明确报错与 raw-secid 指引(此前经美股路径静默返回空数组)。
- CLI `quote` 在 `--market` 强制跨市场时,批次中出现特殊指数码形(如 `931071` + `--market us`)会因确定性分类冲突整批报错(R3-7 既有语义在新码形上的扩展;自动识别与 `--market a` 不受影响)。

### 已知限制

- 交易所宿主指数(`000001` 上证指数、`000300` 沪深300 等)带 `assetType: 'index'` hint 时仍按纯码规则推断交易所,沪市 `000xxx` 指数会错推为 `0.` 前缀——待 index 感知的交易所推断修复,建议继续使用 `sh000001` 前缀写法或显式 secid;
- 中证家族按码形匹配(开放集):码形合法但实际不存在的代码(如 `H30533` 误写为 `H30553`)会通过解析、由上游返回空数据,而非本地解析错误;
- 与美股 ticker 或 A 股代码段拼写冲突的指数(如恒生 `HSI`、中证 `000985`)暂不能加入注册表,见 `src/symbols/specialIndex.ts` 准入规则说明。

[2.2.1]: https://github.com/chengzuopeng/stock-sdk/releases/tag/v2.2.1
