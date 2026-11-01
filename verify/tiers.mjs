/**
 * 火候档位（7 级火焰）单测。
 *
 * client.js 是手写的 CJS 风格 bundle：顶层只有一句
 * `window.__ModuleLoader__.load({ id, factory })`，实现全在 factory 里。所以
 * 在 Node 里给一个 window 壳就能把模块「注册」下来，再给 factory 喂一个只有
 * hook 名字的 React 桩（本文件不渲染，只读 `__tbArt`），就能零依赖地验证艺术层：
 * 绝对速率阈值、16 帧动画的合法性与缓存，以及 per-tier CSS 是否都在。
 *
 * 运行：node verify/tiers.mjs（`npm test` 的一环）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DAY_MS = 86400000;
const TIER_NAMES = ['星火', '小火', '中火', '大火', '烈火', '火海', '爆燃'];
// 绝对阈值（token/s），档位 1..7 的下界；与产品规格一致：
// <100 星火 · 100-500 小火 · 500-2k 中火 · 2k-3k 大火 · 3k-9k 烈火 · 9k-50k 火海 · ≥50k 爆燃。
const TIER_MIN_RATE = [0, 100, 500, 2000, 3000, 9000, 50000];
const LAYERS = ['a', 'b', 'c', 'd', 'e'];

/** 浏览器最小面：模块初始化时若碰了 document/localStorage 也不会炸。 */
function browserShim() {
  const store = new Map();
  return {
    document: {
      addEventListener() {},
      removeEventListener() {},
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
      querySelector: () => null,
      body: { appendChild() {}, style: {} },
      documentElement: { style: {} },
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    matchMedia: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }),
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
  };
}

/**
 * 加载 client.js，返回它的 `__tbArt` 测试面。
 * preview.mjs 复用这个 loader，避免两处维护同一套 window/React 桩。
 */
export function loadArt(clientPath = join(ROOT, 'client.js')) {
  const src = readFileSync(clientPath, 'utf8');
  let captured = null;
  const win = {
    __ModuleLoader__: {
      load(mod) {
        captured = mod;
      },
    },
    innerWidth: 1440,
    innerHeight: 900,
    matchMedia: browserShim().matchMedia,
    addEventListener() {},
    removeEventListener() {},
  };

  const shim = browserShim();
  const saved = new Map();
  for (const [key, value] of Object.entries(shim)) {
    saved.set(key, Object.prototype.hasOwnProperty.call(globalThis, key) ? globalThis[key] : undefined);
    globalThis[key] = value;
  }

  try {
    new Function('window', src)(win);
    assert.ok(captured, 'client.js 顶层必须调用 window.__ModuleLoader__.load({ id, factory })');
    assert.equal(typeof captured.factory, 'function', 'ModuleLoader 模块必须带 factory(require)');

    const react = {
      createElement: () => null,
      useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
      useEffect: () => {},
      useMemo: (fn) => (typeof fn === 'function' ? fn() : undefined),
      useRef: (v) => ({ current: v === undefined ? null : v }),
    };
    const mod = captured.factory(() => react);
    assert.ok(mod, 'factory 必须返回插件导出对象');
    assert.ok(mod.__tbArt, 'factory 必须导出 __tbArt（档位艺术层的无头测试面）');
    return mod.__tbArt;
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// SVG path 解析：只为算「轮廓有多宽」这类相对量，不追求渲染精度。
// 支持 M/L/H/V/C/S/Q/T/A/Z（含相对指令），把控制点也算进 bbox——teardrop 的
// 控制点都在轮廓内或附近，用来比较档位之间的宽窄已经足够。
// ---------------------------------------------------------------------------
const ARITY = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7 };

/**
 * 严格的 path 语法体检：每条指令后面的数字个数必须是该指令参数个数（M/L 2、
 * C 6、S/Q 4、A 7…）的整数倍。少一个坐标浏览器不会报错，只会从出错处停止绘制
 * ——「火墙」整条 path 直接消失，肉眼看起来就是低档位一样没底火。
 * 返回 null 表示合法，否则返回一句人能直接拿去改代码的说明。
 */
export function pathError(d) {
  const text = String(d);
  if (!/^\s*[Mm]/.test(text)) return '必须以 M 开头';
  const tokens = text.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || [];
  let i = 0;
  let cmd = null;
  let args = 0;
  const flush = () => {
    if (!cmd || cmd === 'Z') return null;
    const arity = ARITY[cmd];
    if (!arity) return `不支持的指令 ${cmd}`;
    if (args === 0 || args % arity !== 0) return `${cmd} 指令有 ${args} 个数字，不是 ${arity} 的正整数倍`;
    return null;
  };
  while (i < tokens.length) {
    const token = tokens[i];
    if (/^[A-Za-z]$/.test(token)) {
      const fail = flush();
      if (fail) return fail;
      cmd = token.toUpperCase();
      args = 0;
      i += 1;
      continue;
    }
    if (!cmd || cmd === 'Z') return `数字 ${token} 出现在 ${cmd || '空'} 之后`;
    args += 1;
    i += 1;
  }
  return flush();
}

export function pathPoints(d) {
  const tokens = String(d).match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || [];
  const points = [];
  let i = 0;
  let cmd = null;
  let rel = false;
  let x = 0;
  let y = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (/^[A-Za-z]$/.test(token)) {
      cmd = token.toUpperCase();
      rel = token !== cmd;
      i += 1;
      continue;
    }
    const arity = cmd && ARITY[cmd];
    if (!arity) {
      i += 1;
      continue;
    }
    const args = [];
    while (args.length < arity && i < tokens.length && !/^[A-Za-z]$/.test(tokens[i])) {
      args.push(Number(tokens[i]));
      i += 1;
    }
    if (args.length < arity) break; // 残缺指令，后面的坐标不可信
    // 相对指令的每一对坐标都相对该指令起点的当前点。
    const baseX = x;
    const baseY = y;
    if (cmd === 'H') {
      x = rel ? x + args[0] : args[0];
      points.push([x, y]);
      continue;
    }
    if (cmd === 'V') {
      y = rel ? y + args[0] : args[0];
      points.push([x, y]);
      continue;
    }
    if (cmd === 'A') {
      x = rel ? x + args[5] : args[5];
      y = rel ? y + args[6] : args[6];
      points.push([x, y]);
      continue;
    }
    for (let k = 0; k < args.length; k += 2) {
      const px = rel ? baseX + args[k] : args[k];
      const py = rel ? baseY + args[k + 1] : args[k + 1];
      points.push([px, py]);
      if (k === args.length - 2) {
        x = px;
        y = py;
      }
    }
  }
  return points;
}

function frameBBox(frame) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const seg of frame) {
    for (const [px, py] of pathPoints(seg.d)) {
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
  }
  return {
    w: Number.isFinite(minX) ? maxX - minX : 0,
    h: Number.isFinite(minY) ? maxY - minY : 0,
    minX,
    maxX,
  };
}

const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * tolerance);

// ---------------------------------------------------------------------------
// 断言分组
// ---------------------------------------------------------------------------

function checkSurface(art) {
  for (const key of ['TIERS', 'FRAME_COUNT', 'RISE_MS', 'FALL_MS', 'framesFor', 'idleFrame', 'embersFor', 'tierOf', 'fmt', 'CSS']) {
    assert.ok(key in art, `__tbArt 缺少 ${key}`);
  }
  assert.ok(Array.isArray(art.TIERS), '__tbArt.TIERS 必须是数组');
  assert.equal(typeof art.framesFor, 'function');
  assert.equal(typeof art.tierOf, 'function');
  assert.equal(typeof art.CSS, 'string');
  assert.equal(art.FRAME_COUNT, 16, 'FRAME_COUNT 必须是 16（一圈动画帧数）');
}

function checkTierTable(art) {
  const tiers = art.TIERS;
  assert.equal(tiers.length, 7, '必须有 7 个档位');

  tiers.forEach((tier, i) => {
    const level = i + 1;
    const at = `TIERS[${i}]（${tier.name || '?'}）`;
    assert.equal(tier.level, level, `${at} 的 level 必须是从 1 起的连续序号`);
    assert.equal(tier.name, TIER_NAMES[i], `${at} 的 name 必须按 星火…爆燃 排列`);
    assert.equal(typeof tier.key, 'string', `${at} 需要稳定的 key（给 data-tier / 类名用）`);
    assert.match(tier.key, /^[a-z][a-z0-9_-]*$/, `${at} 的 key 应为小写标识符，收到 "${tier.key}"`);
    assert.equal(typeof tier.desc, 'string', `${at} 需要一句 fun copy`);
    assert.ok(tier.desc.trim().length >= 2, `${at} 的 desc 不能为空`);
    assert.equal(typeof tier.minRate, 'number', `${at} 的 minRate 必须是数字（token/s）`);
    assert.ok(Number.isFinite(tier.minRate), `${at} 的 minRate 不能是 NaN/Infinity`);
    assert.equal(tier.minRate, TIER_MIN_RATE[i],
      `${at} 的 minRate 应为 ${TIER_MIN_RATE[i]} token/s，收到 ${tier.minRate}`);
    if (i > 0) {
      assert.ok(tier.minRate > tiers[i - 1].minRate,
        `${tier.name} 的 minRate 必须严格大于 ${tiers[i - 1].name}（阈值要单调递增）`);
    }
    assert.equal(typeof tier.frameMs, 'number', `${at} 的 frameMs 必须是数字`);
    assert.ok(tier.frameMs >= 30 && tier.frameMs <= 400, `${at} 的 frameMs 应在 30..400ms，收到 ${tier.frameMs}`);
    // beat 是 CSS `animation-duration` 的毫秒值（呼吸感的周期），不是秒。
    assert.equal(typeof tier.beat, 'number', `${at} 的 beat 必须是数字（毫秒）`);
    assert.ok(Number.isInteger(tier.beat) && tier.beat > 0 && tier.beat <= 6000,
      `${at} 的 beat 应是 (0,6000] 的整毫秒数，收到 ${tier.beat}`);

    const palette = tier.palette;
    assert.ok(palette && typeof palette === 'object', `${at} 缺少 palette`);
    // glow2 是可选槽位（可以用 glow + 透明后缀现算），其余必须齐全。
    for (const slot of ['a', 'b', 'c', 'd', 'e', 'glow', 'edge']) {
      assert.equal(typeof palette[slot], 'string', `${at}.palette.${slot} 必须是 CSS 颜色字符串`);
      assert.match(palette[slot], /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i,
        `${at}.palette.${slot} 应是 #rgb/#rrggbb 形式，收到 "${palette[slot]}"`);
    }
    assert.equal(typeof tier.sparks, 'number', `${at}.sparks 必须是数字`);
    assert.ok(Number.isInteger(tier.sparks) && tier.sparks >= 0, `${at}.sparks 应是非负整数（余烬颗数）`);
  });

  assert.equal(new Set(tiers.map((t) => t.key)).size, 7, '7 个档位的 key 必须互不相同');
  // 颜色必须真的成阶梯：整组配色两两不同，光晕色至少 6 种（相邻两档允许共用
  // 同一个蓝，但绝不能 7 档一个色）。
  const paletteSignatures = tiers.map((t) => ['a', 'b', 'c', 'd', 'e', 'glow', 'edge']
    .map((k) => String(t.palette[k]).toLowerCase()).join('|'));
  assert.equal(new Set(paletteSignatures).size, 7, '7 个档位的 palette 必须两两不同');
  assert.ok(new Set(tiers.map((t) => t.palette.glow.toLowerCase())).size >= 6,
    '7 个档位至少要有 6 种不同的 palette.glow（蓝→青→靛→紫→品红→金的色阶）');
  // 余烬只应该出现在最大的火里，低档位加余烬会显得莫名其妙。
  for (let i = 1; i < tiers.length; i += 1) {
    assert.ok(tiers[i].sparks >= tiers[i - 1].sparks,
      `${tiers[i].name} 的余烬数不应少于 ${tiers[i - 1].name}`);
  }
  // 星火是「慢闪」，爆燃应该明显更快。
  assert.ok(tiers[0].frameMs > tiers[6].frameMs,
    `帧间隔应随档位变快：星火 ${tiers[0].frameMs}ms 应大于 爆燃 ${tiers[6].frameMs}ms`);
}

function checkTierOf(art) {
  const tierOf = art.tierOf;
  const levelOf = (rate) => {
    const lvl = tierOf(rate);
    assert.ok(Number.isInteger(lvl) && lvl >= 0 && lvl <= 7,
      `tierOf(${rate}) 必须返回 0..7 的整数，收到 ${lvl}`);
    return lvl;
  };

  // 熄灭与噪声底：0.01 token/s 以下算没在烧。
  assert.equal(levelOf(0), 0, '速率为 0 时是已熄灭');
  assert.equal(levelOf(-12), 0, '负速率按已熄灭处理');
  assert.equal(levelOf(0.01), 0, '速率 <= 0.01 token/s 时不应点亮');
  assert.equal(levelOf(0.02), 1, '只要超过噪声底就至少是星火');

  // 每档阈值：恰好在 minRate 上进档，差一点点还是上一档（星火下界是 0，无「上一档」）。
  art.TIERS.forEach((tier, i) => {
    if (i === 0) {
      // 星火的下界是 0（配合噪声底），所以「阈值」本身按熄灭算。
      assert.equal(tier.minRate, 0, '星火的 minRate 必须是 0');
      return;
    }
    assert.equal(tierOf(tier.minRate), tier.level, `速率 = ${tier.minRate} 时应是 ${tier.name}`);
    assert.equal(tierOf(tier.minRate - 0.01), tier.level - 1,
      `速率略小于 ${tier.minRate} 时应停在 ${art.TIERS[i - 1].name}`);
  });

  // 用户给的锚点：20k token/s 是火海，50k 起才是爆燃。
  assert.equal(levelOf(19999), 6, '20k token/s 应该是火海（6 档）');
  assert.equal(levelOf(50000), 7, '50k token/s 应该到爆燃（7 档）');
  assert.equal(levelOf(100000), 7, '更高只会停在爆燃，不再加档');

  // 单调不减：0 → 200k 扫一遍，档位不能回退或跳号。
  let previous = 0;
  for (let step = 0; step <= 2000; step += 1) {
    const rate = (step / 2000) * 200000;
    const level = levelOf(rate);
    assert.ok(level >= previous, `tierOf 必须随速率单调不减：${previous} -> ${level}（${rate} token/s）`);
    previous = level;
  }
  assert.equal(previous, 7, '200k token/s 必须是爆燃');

  // 病态输入不能把 NaN 泄漏到 UI。
  for (const rate of [NaN, undefined, null, 'abc', Infinity, -Infinity, {}]) {
    levelOf(rate);
  }
  assert.equal(levelOf(NaN), 0, 'NaN 速率按已熄灭处理');
  assert.equal(levelOf(Infinity), 7, 'Infinity 速率夹到爆燃');
}


/**
 * 总量单位阶梯 K -> M -> B：B 档在 1000M 处接管。近 30 天会到几十 B，之前
 * 没有 B 档时会显示成 "31012.01M" 这种四位数。
 */
function checkFormatting(art) {
  const fmt = art.fmt;
  assert.equal(typeof fmt, 'function', '__tbArt 需要导出 fmt');
  const cases = [
    [0, '0', '零值'],
    [421, '421', '小数值保持原样（图表刻度/tooltip 用）'],
    [12340, '12.3K', 'K 档只服务 <1M 的小数值'],
    [309720000, '309.72M', 'M 档两位小数'],
    [1e9, '1.00B', '1000M 起进 B 档'],
    [31012010000, '31.01B', '近 30 天真实量级'],
    [3.1012e10, '31.01B', '同上（科学计数法输入）'],
  ];
  for (const [value, want, why] of cases) {
    assert.equal(fmt(value), want, `fmt(${value}) 应为 "${want}"（${why}）`);
  }
  // 整条阶梯上不允许出现 4 位整数（"1000.00M"/"1000.0K" 这种）。
  for (let v = 1e6; v <= 1e11; v = Math.floor(v * 1.37) + 1) {
    const out = fmt(v);
    assert.match(out, /^\d+(?:\.\d+)?(?:K|M|B)?$/, `fmt(${v}) = "${out}" 格式不对`);
    assert.ok(parseFloat(out) < 1000, `fmt(${v}) = "${out}" 出现了 4 位整数`);
  }
}

function checkFrames(art) {
  // 每档都缓存：动画每帧 (70ms) 都会取一次，重新生成 16×N 条路径会明显掉帧。
  assert.equal(art.framesFor(3), art.framesFor(3), 'framesFor 必须按档位缓存（同一引用）');
  assert.notEqual(art.framesFor(3), art.framesFor(4), '不同档位不能共用同一份帧');

  const stats = [];
  for (let level = 1; level <= 7; level += 1) {
    const frames = art.framesFor(level);
    const at = `档位 ${level}（${art.TIERS[level - 1].name}）`;
    assert.ok(Array.isArray(frames), `${at} 的 framesFor 必须返回数组`);
    assert.equal(frames.length, art.FRAME_COUNT, `${at} 必须有 ${art.FRAME_COUNT} 帧`);

    let countMin = Infinity;
    let countMax = 0;
    let width = 0;
    let height = 0;
    const uniquePaths = new Set();
    frames.forEach((frame, frameIndex) => {
      const where = `${at} 第 ${frameIndex} 帧`;
      assert.ok(Array.isArray(frame), `${where} 必须是路径数组`);
      assert.ok(frame.length >= 3 && frame.length <= 16,
        `${where} 有 ${frame.length} 条路径，应在 3..16 之间`);
      countMin = Math.min(countMin, frame.length);
      countMax = Math.max(countMax, frame.length);

      for (const segment of frame) {
        assert.ok(segment && typeof segment === 'object', `${where} 的路径必须带 { layer, d }`);
        assert.ok(LAYERS.includes(segment.layer),
          `${where} 的 layer 是 "${segment.layer}"，只允许 a..e`);
        assert.equal(typeof segment.d, 'string', `${where} 的 d 必须是字符串`);
        assert.match(segment.d, /^M/, `${where} 的 d 必须以 M 开头（收到 ${String(segment.d).slice(0, 16)}…）`);
        assert.ok(!/NaN|undefined|null|Infinity/.test(segment.d),
          `${where} 的 d 里混进了非法值：${String(segment.d).slice(0, 48)}…`);
        const syntax = pathError(segment.d);
        assert.equal(syntax, null, `${where} 的 d 不是合法 SVG path（${syntax}）：${segment.d.slice(0, 90)}…`);
        const points = pathPoints(segment.d);
        assert.ok(points.length >= 3, `${where} 的 d 解析不出足够的坐标点`);
        assert.ok(points.every(([px, py]) => Number.isFinite(px) && Number.isFinite(py)),
          `${where} 的 d 含非有限坐标`);
        uniquePaths.add(segment.d);
      }

      const bbox = frameBBox(frame);
      width = Math.max(width, bbox.w);
      height = Math.max(height, bbox.h);
    });

    // 16 帧必须真的在动，否则动画是张静态图。
    assert.ok(uniquePaths.size >= 6,
      `${at} 只有 ${uniquePaths.size} 个不重复路径，动画看起来会是静止的`);
    // 火焰不能画到画布外面去（viewBox 0 0 64 96，允许一点 glow 溢出）。
    assert.ok(width > 6 && width <= 140, `${at} 轮廓宽度 ${width.toFixed(1)} 超出预期（应约 6..140）`);
    assert.ok(height > 12 && height <= 140, `${at} 轮廓高度 ${height.toFixed(1)} 超出预期（应约 20..140）`);

    stats.push({ level, countMin, countMax, width, height, uniquePaths: uniquePaths.size });
  }

  const first = stats[0];
  const last = stats[stats.length - 1];
  for (let i = 1; i < stats.length; i += 1) {
    const stat = stats[i];
    assert.ok(stat.countMax >= first.countMax,
      `档位 ${stat.level} 的路径数（${stat.countMax}）不应少于星火的（${first.countMax}）`);
    // 火要越烧越宽：至少不能比星火更窄。
    assert.ok(stat.width >= first.width - 0.5,
      `档位 ${stat.level} 的轮廓宽度（${stat.width.toFixed(1)}）不应比星火（${first.width.toFixed(1)}）更窄`);
  }
  // 爆燃是「整面火墙」，必须显著宽于星火，否则 7 档在 19px 上不可能分得出来。
  assert.ok(last.width >= first.width * 1.5,
    `爆燃的轮廓（${last.width.toFixed(1)}）应至少是星火（${first.width.toFixed(1)}）的 1.5 倍宽`);
  // 满宽火墙 + 五舌 + 余烬：路径数不能和星火一个量级。
  assert.ok(last.countMax >= 10,
    `爆燃每帧至少 10 条路径（火墙 + 多舌 + 余烬），收到最多 ${last.countMax} 条`);

  // 七档的首帧必须彼此不同——这是「档位真的换了形态」的最小证据。
  const signatures = art.TIERS.map((tier) => JSON.stringify(art.framesFor(tier.level)[0]));
  assert.equal(new Set(signatures).size, 7, '7 个档位的首帧路径必须互不相同（每一档要换形态）');
}


/**
 * 档位状态机与「熄灭态」：这两块以前没有任何测试，改坏 900ms→90ms 或把熄灭态
 * 缩成星火那一小撮，npm test 依旧是绿的。
 */
function checkStateMachine(art) {
  // 升快降慢：爆发要立刻点亮，回落要慢，否则速率一抖火焰就在档位间来回跳。
  assert.ok(Number.isFinite(art.RISE_MS) && Number.isFinite(art.FALL_MS),
    'RISE_MS / FALL_MS 必须是数字');
  assert.ok(art.RISE_MS >= 100 && art.RISE_MS <= 600,
    `RISE_MS 应在 100..600ms（收到 ${art.RISE_MS}）`);
  assert.ok(art.FALL_MS >= 600 && art.FALL_MS <= 1500,
    `FALL_MS 应在 600..1500ms（收到 ${art.FALL_MS}）`);
  assert.ok(art.FALL_MS > art.RISE_MS, '回落必须比上升慢');
  assert.ok(art.FALL_MS / art.RISE_MS >= 2, '回落至少要比上升慢 2 倍，才有「余温」的感觉');

  // 熄灭态是 dock 最常见的状态，必须是「一个熄灭的火焰图标」，不能是最小档的火苗。
  const idle = art.idleFrame();
  assert.ok(Array.isArray(idle), 'idleFrame 必须返回路径数组');
  assert.ok(idle.length >= 3 && idle.length <= 8, `熄灭帧应有 3..8 条路径，收到 ${idle.length}`);
  for (const segment of idle) {
    assert.ok(LAYERS.includes(segment.layer), `熄灭帧的 layer 是 "${segment.layer}"，只允许 a..e`);
    const fail = pathError(segment.d);
    assert.equal(fail, null, `熄灭帧的路径不合法：${fail}`);
  }
  const scale19 = 19 / 64; // 胶囊里火焰宽 19px 时的 viewBox → CSS px
  const idleBox = frameBBox(idle);
  assert.ok(idleBox.w * scale19 >= 8,
    `熄灭图标在 19px 胶囊里只宽 ${(idleBox.w * scale19).toFixed(1)}px（应 >= 8px，否则是抹糊的小点）`);
  assert.ok(idleBox.h * scale19 >= 16,
    `熄灭图标在 19px 胶囊里只高 ${(idleBox.h * scale19).toFixed(1)}px（应 >= 16px）`);
  const starBox = frameBBox(art.framesFor(1)[0]);
  assert.ok(idleBox.w > starBox.w && idleBox.h > starBox.h,
    '熄灭图标必须比星火（1 档）大：它是「熄灭的火焰图标」，不是「最小的火」');

  // 余烬属于档位艺术：颗数必须等于 TIERS.sparks，参数必须有限、尺寸不能是亚像素噪声。
  art.TIERS.forEach((tier) => {
    const embers = art.embersFor(tier.level);
    assert.ok(Array.isArray(embers), `${tier.name} 的 embersFor 必须返回数组`);
    assert.equal(embers.length, tier.sparks,
      `${tier.name} 的余烬数应等于 sparks=${tier.sparks}，收到 ${embers.length}`);
    for (const ember of embers) {
      for (const key of ['cx', 'drift', 'top', 'r']) {
        assert.ok(Number.isFinite(ember[key]), `${tier.name} 的余烬 ${key} 必须是有限数字`);
      }
      assert.ok(ember.cx >= 0 && ember.cx <= 64, `${tier.name} 的余烬 cx 越界：${ember.cx}`);
      assert.ok(ember.r >= 2 && ember.r <= 4.5,
        `${tier.name} 的余烬半径 ${ember.r} 应在 2..4.5（19px 下再小就是亚像素噪声）`);
    }
  });
  assert.equal(art.embersFor(1).length, 0, '星火不应该有余烬');
  assert.equal(art.embersFor(7).length, art.TIERS[6].sparks, '爆燃的余烬数应等于 sparks');
}

function checkCss(art) {
  const css = art.CSS;
  assert.ok(css.length > 1500, `CSS 太短（${css.length} 字节），像是没把整份样式塞进来`);

  for (const tier of art.TIERS) {
    const selector = new RegExp(`\\.tb-fire\\[data-tier=["']?${tier.level}["']?\\]`);
    assert.match(css, selector, `CSS 必须包含 .tb-fire[data-tier="${tier.level}"]`);
  }
  for (const layer of LAYERS) {
    assert.match(css, new RegExp(`\\.tb-fire-${layer}\\b`), `CSS 必须给 .tb-fire-${layer} 上色`);
  }
  assert.match(css, /\.tb-ladder/, 'CSS 必须包含火候进度条（.tb-ladder…）');
  assert.match(css, /prefers-reduced-motion\s*:\s*reduce/,
    'CSS 必须保留 prefers-reduced-motion 分支（静态帧 / 关动画）');
  // 老 UI 的样式不能被这次重构顺手删掉。
  for (const legacy of ['.tb-pill', '.tb-hero', '.tb-hero-num', '.tb-chip', '.tb-spark']) {
    assert.ok(css.includes(legacy), `CSS 缺少老 UI 的 ${legacy} 样式`);
  }
}

/** 跑完全部断言；preview.mjs 只复用 loadArt，不会调用它。 */
export function checkTiers(art) {
  checkSurface(art);
  checkTierTable(art);
  checkTierOf(art);
  checkFormatting(art);
  checkFrames(art);
  checkStateMachine(art);
  checkCss(art);
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  checkTiers(loadArt());
  console.log('token-burned tiers: PASS');
}
