/**
 * 命令分发（cli.md §3 / §9）：按 argShape 把位置参数 + flags 组装成实参并调用 SDK。
 * 自定义 `invoke` 的命令（高频别名）走自身逻辑，不经默认派生。
 */
import type { StockSDK } from '../sdk';
import { CliUsageError } from './errors';
import type { CommandSpec, InvokeContext, OptionSpec, PositionalSpec } from './types';

/** 把原始 flags 按 OptionSpec 转换类型 + 归一，组成 options 对象；未声明的透传。 */
/** 未声明 flag 的字段名映射：CLI 习惯的 --start/--end → SDK 的 startDate/endDate。 */
const FLAG_ALIAS: Record<string, string> = { start: 'startDate', end: 'endDate' };

export function buildOptions(
  spec: CommandSpec,
  rawOptions: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const declared = new Map<string, OptionSpec>();
  for (const opt of spec.options ?? []) declared.set(opt.flag, opt);

  for (const [key, raw] of Object.entries(rawOptions)) {
    const opt = declared.get(key);
    if (!opt) {
      if (raw === true) continue; // 未声明且无值的 flag：丢弃，避免脏 true 进 options
      out[FLAG_ALIAS[key] ?? key] = raw; // start/end 映射成 SDK 字段名
      continue;
    }
    out[opt.field ?? opt.flag] = convert(opt, raw);
  }

  for (const opt of spec.options ?? []) {
    const field = opt.field ?? opt.flag;
    if (out[field] === undefined && opt.default !== undefined) out[field] = opt.default;
  }
  return out;
}

function convert(opt: OptionSpec, raw: unknown): unknown {
  switch (opt.type) {
    case 'boolean':
      return raw === true || raw === 'true';
    case 'number':
      return Number(lastOf(raw));
    case 'number[]':
      return toNumberArray(raw);
    case 'enum':
    case 'string': {
      const s = lastOf(raw);
      let value: unknown = typeof s === 'boolean' ? s : String(s);
      if (opt.upper && typeof value === 'string') value = value.toUpperCase();
      if (opt.type === 'enum' && opt.enum && typeof value === 'string' && !opt.enum.includes(value)) {
        throw new CliUsageError(`--${opt.flag} 非法值「${value}」`, `可选: ${opt.enum.join(' / ')}`);
      }
      if (opt.map && typeof value === 'string' && value in opt.map) value = opt.map[value];
      return value;
    }
    default:
      return raw;
  }
}

function lastOf(raw: unknown): unknown {
  return Array.isArray(raw) ? raw[raw.length - 1] : raw;
}

function toNumberArray(raw: unknown): number[] {
  const text = Array.isArray(raw) ? raw.join(',') : String(raw);
  return text
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => !Number.isNaN(n));
}

function buildPositionalArgs(spec: CommandSpec, positional: string[]): unknown[] {
  const specs = spec.positional ?? [];
  const args: unknown[] = [];
  let i = 0;
  for (const p of specs) {
    if (p.variadic) {
      const rest = positional.slice(i);
      if (p.required && rest.length === 0) throw new CliUsageError(`缺少参数 <${p.name}>`);
      for (const v of rest) args.push(normalizePositional(p, v));
      return args;
    }
    const value = positional[i];
    if (value === undefined) {
      if (p.required) throw new CliUsageError(`缺少参数 <${p.name}>`);
      args.push(undefined);
    } else {
      args.push(normalizePositional(p, value));
    }
    i++;
  }
  return args;
}

function normalizePositional(p: PositionalSpec, value: string): string {
  let v = value;
  if (p.upper) v = v.toUpperCase();
  if (p.enum && !p.enum.includes(v)) {
    throw new CliUsageError(`<${p.name}> 非法值「${value}」`, `可选: ${p.enum.join(' / ')}`);
  }
  return v;
}

function invokeMethod(sdk: StockSDK, path: string[], args: unknown[]): Promise<unknown> {
  const target = path.reduce<unknown>((o, k) => {
    if (o == null || typeof o !== 'object') return undefined;
    return (o as Record<string, unknown>)[k];
  }, sdk);
  if (typeof target !== 'function') {
    throw new CliUsageError(`未知命令: ${path.join(' ')}`);
  }
  return Promise.resolve((target as (...a: unknown[]) => unknown)(...args));
}

/** 执行一条命令。 */
/** 待值 flag（非 boolean/number[]）在 argv 末尾无值时被 parser 置成 `true`，拦成「缺少值」用法错误。 */
function validateOptionValues(spec: CommandSpec, rawOptions: Record<string, unknown>): void {
  for (const opt of spec.options ?? []) {
    if (opt.type === 'boolean' || opt.type === 'number[]') continue;
    if (rawOptions[opt.flag] === true) {
      throw new CliUsageError(`--${opt.flag} 缺少值`);
    }
  }
}

/** 别名命令走自定义 invoke 会绕过 normalizePositional 的 enum 校验，分发前统一校验位置参数 enum。 */
function validatePositionalEnum(spec: CommandSpec, positional: string[]): void {
  const specs = spec.positional ?? [];
  for (let i = 0; i < specs.length; i++) {
    const p = specs[i];
    const v = positional[i];
    if (v === undefined || !p.enum) continue;
    const val = p.upper ? v.toUpperCase() : v;
    if (!p.enum.includes(val)) {
      throw new CliUsageError(`<${p.name}> 非法值「${v}」`, `可选: ${p.enum.join(' / ')}`);
    }
  }
}

/**
 * 别名命令走自定义 invoke 会绕过 buildOptions→convert 的 enum/类型校验与归一，
 * 分发前对「已声明的 options」按 flag 名统一过一遍 convert：
 * - enum 非法值抛 CliUsageError（修复 `kline 600519 --period xyz` 不报错）；
 * - 标量(enum/string/number)取末值，重复 flag 不再以数组透传给 SDK（修复 `--period daily --period weekly`）；
 * - 类型转换 + map 归一，使 invoke 读取到的 `ctx.options.*` 与命名空间路径一致。
 * 未声明的 flag 原样保留（如 indicators 的 wr/cci 等，由 invoke 自行处理）。
 */
function normalizeDeclaredOptions(
  spec: CommandSpec,
  rawOptions: Record<string, unknown>
): Record<string, unknown> {
  const declared = spec.options;
  if (!declared || declared.length === 0) return rawOptions;
  const out: Record<string, unknown> = { ...rawOptions };
  for (const opt of declared) {
    if (rawOptions[opt.flag] === undefined) continue;
    out[opt.flag] = convert(opt, rawOptions[opt.flag]);
  }
  return out;
}

export function dispatch(
  sdk: StockSDK,
  spec: CommandSpec,
  ctx: InvokeContext
): Promise<unknown> {
  validateOptionValues(spec, ctx.options);
  validatePositionalEnum(spec, ctx.positional);
  if (spec.invoke) {
    const options = normalizeDeclaredOptions(spec, ctx.options);
    return spec.invoke(sdk, options === ctx.options ? ctx : { ...ctx, options });
  }

  const options = buildOptions(spec, ctx.options);
  switch (spec.argShape) {
    case 'none':
      return invokeMethod(sdk, spec.path, []);
    case 'codes[]':
      requireNonEmpty(ctx.positional, spec);
      return invokeMethod(sdk, spec.path, [ctx.positional]);
    case 'codes+options':
      requireNonEmpty(ctx.positional, spec);
      return invokeMethod(sdk, spec.path, [ctx.positional, options]);
    case 'symbol+options': {
      const args = buildPositionalArgs(spec, ctx.positional);
      return invokeMethod(sdk, spec.path, [...args, options]);
    }
    case 'options':
      return invokeMethod(sdk, spec.path, [options]);
    case 'positional':
      return invokeMethod(sdk, spec.path, buildPositionalArgs(spec, ctx.positional));
    default:
      throw new CliUsageError(`不支持的命令形态: ${spec.argShape as string}`);
  }
}

function requireNonEmpty(positional: string[], spec: CommandSpec): void {
  if (positional.length === 0) {
    throw new CliUsageError(`命令 "${spec.path.join(' ')}" 需要至少一个代码参数`);
  }
}
