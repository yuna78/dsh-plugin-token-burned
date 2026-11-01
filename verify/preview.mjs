/**
 * 火候档位「联系表」预览（手动运行：npm run preview）。
 *
 * 目标：不打开浏览器、不靠截图工具，就能用**真实**的 client.js 艺术层
 * （`__tbArt.CSS` / `framesFor()` / `TIERS`）离线排出一张图，用来判断 7 档火焰
 * 在真实尺寸（pill 19px、hero 34px）下是否真的分得出来。所以页面里用的都是
 * 线上那套 class（.tb-pill / .tb-fire / .tb-hero / .tb-ladder / .tb-chip …），
 * CSS 直接来自 art.CSS，只额外叠一层「冻结动画」以保证截图确定。
 *
 * 流程：生成 HTML → headless Chrome 先 dump-dom 量出页面真实高度 → 再用测出的
 * 高度截一张整页图（headless=new 的 --screenshot 只抓视口，不量高度会截断）。
 *
 * 依赖：只用 node: 内置模块 + 本机的 Chrome。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadArt, pathError, pathPoints, ROOT } from './tiers.mjs';

const CHROME = process.env.TB_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT_DIR = '/tmp/tb-preview';
const DOCS_PNG = join(ROOT, 'docs', 'preview-tiers.png');
const DOCS_WEBP = join(ROOT, 'docs', 'preview-tiers.webp');
const WIDTH = 1400; // CSS 像素宽度；2x 截图后是 2800px
const SCALE = 2;
const MIN_PNG_BYTES = 30 * 1024;
// 与 client.js 的 MIN_EMBER_WIDTH 保持一致：火焰宽度 <24px（也就是 pill 里的 19px）
// 一律不画余烬，否则会变成 1px 噪点。预览必须复刻这条，不然联系表会骗人。
const MIN_EMBER_WIDTH = 24;
const MIN_WEBP_BYTES = 20 * 1024;
const WEBP_QUALITY = '90'; // README 用的轻量副本；和 PNG 同一批像素，只是有损压缩
// 每次 Chrome 启动都用全新的一次性 profile。所有启动共用一个目录时，上一次 Chrome
// 会留下 SingletonLock，紧接着再跑一次 preview 就会挂在 “File exists”（实测踩过）。
const PROFILE_ROOT = mkdtempSync(join(tmpdir(), 'tb-preview-chrome-'));
let profileSeq = 0;

// ---------------------------------------------------------------------------
// mock 数据：档位现在是**绝对实时速率**（token/s），和今天/近 30 天/个人基线都无关。
// 所以每档直接给一个落在自己区间中段的代表速率（60 / 300 / 1,200 / 2,500 / 6,000 /
// 20,000 / 80,000），截图上的 Lv.N 由 client.js 的 tierOf(rate) 现算并自检——阈值改了
// 但这张表没跟上时，脚本会直接失败而不是画一张错的图。
// ---------------------------------------------------------------------------
// 「现在」钉死在今天 09:44：只影响「今日已过秒数 → 今日均值」这一个展示值（卡内 chip），
// 保证同一份 mock 在任何时刻截图都算出同一个 chip。
const MOCK_NOW = (() => {
  const d = new Date();
  d.setHours(9, 44, 0, 0);
  return d.getTime();
})();

const MOCK = {
  today: 4492000,
  // 今天已经过去的秒数：注意用真实时间差，不是钟面差（跨 DST 的一天可能 25 小时）。
  elapsedSeconds: (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return (MOCK_NOW - d.getTime()) / 1000;
  })(),
  // 每档一个代表速率（落在该档区间中段，避开边界值）。
  rate: { 1: 60, 2: 300, 3: 1200, 4: 2500, 5: 6000, 6: 20000, 7: 80000 },
};

const round1 = (n) => Math.round(n * 10) / 10;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 与 client.js 里同名函数逐字对齐，这样截图上的数字就是线上会显示的数字。
function fmt(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return String(Math.round(v));
}
function fmtRate(n) {
  const v = Number(n) || 0;
  if (v < 0.01) return '0';
  if (v >= 1e3) return Math.round(v).toLocaleString('en-US');
  if (v >= 100) return String(Math.round(v));
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

// client.js 的余烬位置是 makeRng(tier*977+i*131) 生成的；这里复制同一套序列，
// 好让截图里的「余烬」和线上位置一致（截图时是静态点，线上是上升动画）。
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 静态余烬：位置/半径直接来自 client.js 导出的 embersFor(level)，取上升途中的中点。 */
function emberMarkup(art, level) {
  return art.embersFor(level).map((e) => {
    const cx = Number(e.cx) + Number(e.drift) * 0.5;
    const cy = (92 + Number(e.top)) / 2;
    return `<circle class="tb-ember" cx="${round1(cx)}" cy="${round1(cy)}" r="${round1(e.r)}" style="opacity:.85"/>`;
  }).join('');
}

function sparklineMarkup(data, small) {
  const values = Array.isArray(data) && data.length > 1 ? data : [0, 0];
  const max = Math.max(1, ...values);
  const n = values.length;
  const pts = values.map((v, i) => {
    const x = (i / (n - 1)) * 100;
    const y = 30 - Math.max(0, Math.min(1, (Number(v) || 0) / max)) * 26;
    return round1(x) + ' ' + round1(y);
  });
  const line = 'M' + pts.join('L');
  return `<svg class="tb-spark${small ? ' tb-spark-sm' : ''}" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">`
    + `<path class="tb-spark-area" d="${line}L100 32L0 32Z"/><path class="tb-spark-line" d="${line}"/></svg>`;
}

/**
 * 档位在当前渲染尺寸下的真实轮廓（px）：对所有帧取包络，再按 width/64 缩放。
 * 19px 的 pill 里两档只差 1–2px，光看截图容易吵起来，用数字说话。
 */
function pathBox(frames, px) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const frame of frames) {
    for (const seg of frame) {
      for (const [x, y] of pathPoints(seg.d)) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const scale = px / 64; // viewBox 64×96，宽恒为高/1.5，两轴同比缩放
  return { w: (maxX - minX) * scale, h: (maxY - minY) * scale };
}

function fireBox(art, level, px) {
  return pathBox(art.framesFor(level), px);
}

function sizeLabel(art, level, px) {
  const box = fireBox(art, level, px);
  return `${box.w.toFixed(1)}×${box.h.toFixed(1)}px`;
}

function idleSizeLabel(art, px) {
  const box = pathBox([art.idleFrame()], px);
  return `${box.w.toFixed(1)}×${box.h.toFixed(1)}px`;
}

/**
 * 画一帧。余烬条件与 client.js 的 Fire 组件一致：燃烧中 且 火焰宽度 ≥24px。
 * 所以 19px pill 永远没有余烬，34px hero 才有（3× 放大按 57px 算，也有）。
 */
function frameSvg(art, level, frame, px, withEmbers) {
  const height = Math.round(px * 1.5);
  const paths = frame.map((seg) => `<path class="tb-fire-${seg.layer}" d="${esc(seg.d)}"/>`).join('');
  const embers = withEmbers && level > 0 && px >= MIN_EMBER_WIDTH ? emberMarkup(art, level) : '';
  return `<svg viewBox="0 0 64 96" width="${px}" height="${height}" focusable="false" aria-hidden="true">`
    + paths + embers + '</svg>';
}

function fireSvg(art, level, frameIndex, px, withEmbers) {
  const frames = art.framesFor(level);
  return frameSvg(art, level, frames[frameIndex % frames.length], px, withEmbers);
}

function fireSpan(art, level, px, opts = {}) {
  const height = Math.round(px * 1.5);
  const size = `width:${px}px;height:${height}px`;
  if (opts.idle) {
    // 熄火态：data-burning="off" data-tier="0" + idleFrame()（3 层 a/c/e、无抖动、无余烬）。
    // 变灰交给线上 CSS：`.tb-fire[data-burning="off"]{opacity:.5;filter:grayscale(.6)}`。
    return `<span class="tb-fire" data-burning="off" data-tier="0" style="${size}"`
      + ` title="已熄灭 · 暂无新增燃烧">${frameSvg(art, 0, art.idleFrame(), px, false)}</span>`;
  }
  const frame = opts.frame || 0;
  return `<span class="tb-fire" data-burning="on" data-tier="${level}" style="${size}">`
    + fireSvg(art, level, frame, px, opts.embers !== false) + '</span>';
}

/**
 * 熄火 pill：真实 48px pill，`.tb-hot` 显示「已熄灭」，速率 0。
 * 迷你曲线的形状用「前面有过活动、最近安静下来」——今日 4.49M 但当前 0 token/s 是
 * 真实场景（agent 刚空闲），画成一条平线反而像数据没加载。
 */
function offPillMarkup(art) {
  const idleHistory = historyFor(MOCK.today / 24 / 3600, 1)
    .map((v, i, arr) => (i > arr.length * 0.72 ? v * 0.07 : v));
  return '<button class="tb-pill" type="button" data-burning="off" data-tier="0"'
    + ' title="已熄灭 · 暂无新增燃烧" aria-label="展开 Token 燃烧指数：已熄灭，0 token/s">'
    + fireSpan(art, 0, 19, { idle: true })
    + '<span class="tb-hot">已熄灭</span>'
    + '<span class="tb-rate"><b>0</b><span class="tb-unit">token/s</span></span>'
    + sparklineMarkup(idleHistory, true)
    + '<span class="tb-sep"></span>'
    + `<span class="tb-group"><span class="tb-gk">今日</span><span class="tb-gv">${fmt(MOCK.today)}</span></span>`
    + '</button>';
}

/** 今日均值：只用来算卡内「相对今日每秒平均」chip，不再参与定档。 */
const mockDailyAvg = () => MOCK.today / MOCK.elapsedSeconds;

/**
 * 该档的绝对区间文案（左闭右开）。按 client.js 的 TIERS[i].minRate 现算，不写死：
 * 阈值一改，表里的区间跟着变，而且 buildSheet 里会用 tierOf() 反过来验一遍。
 */
function rangeLabel(art, tier) {
  const index = art.TIERS.findIndex((t) => t.level === tier.level);
  const next = art.TIERS[index + 1];
  if (!next) return `≥${fmtRate(tier.minRate)}`;
  if (index === 0) return `<${fmtRate(next.minRate)}`;
  return `${fmtRate(tier.minRate)}–${fmtRate(next.minRate)}`;
}

function historyFor(target, level) {
  const n = 40;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const k = i / (n - 1);
    const ramp = 0.22 + 0.78 * Math.pow(k, 1.35);
    const wiggle = 1 + 0.07 * Math.sin(i * 1.7 + level) + 0.035 * Math.sin(i * 0.61 + level * 2);
    out.push(Math.max(0.01, target * ramp * wiggle));
  }
  return out;
}

function trendFor(ratio) {
  const deltaPct = Math.round((ratio - 1) * 100);
  if (ratio >= 10) return '× ' + (ratio >= 100 ? String(Math.round(ratio)) : ratio.toFixed(1));
  return (deltaPct >= 0 ? '▲ ' : '▼ ') + Math.abs(deltaPct) + '%';
}

function pillMarkup(art, tier, rate) {
  return `<button class="tb-pill" type="button" data-burning="on" data-tier="${tier.level}"`
    + ` title="火候 ${tier.level}/7 · ${esc(tier.name)} · ${esc(tier.desc)}">`
    + fireSpan(art, tier.level, 19, { embers: false })
    + `<span class="tb-hot">${esc(tier.name)}</span>`
    + `<span class="tb-rate"><b>${fmtRate(rate)}</b><span class="tb-unit">token/s</span></span>`
    + sparklineMarkup(historyFor(rate, tier.level), true)
    + '<span class="tb-sep"></span>'
    + `<span class="tb-group"><span class="tb-gk">今日</span><span class="tb-gv">${fmt(MOCK.today)}</span></span>`
    + '</button>';
}

function ladderMarkup(art, level) {
  const bars = art.TIERS.map((t) => `<i class="tb-ladder-bar" data-level="${t.level}"`
    + ` data-on="${t.level <= level ? 'on' : 'off'}" title="${esc(t.name)} · ${esc(t.desc)}"></i>`).join('');
  return '<div class="tb-ladder" role="img" aria-label="火候进度条">'
    + '<span class="tb-ladder-k">火候</span>'
    + `<div class="tb-ladder-bars">${bars}</div>`
    + `<span class="tb-ladder-v">${level}/7</span>`
    + '</div>';
}

/** 展开卡：head + hero + 火候条，尺寸/字号都是线上真值（卡宽 420）。 */
function cardMarkup(art, tier, rate) {
  // 和 client.js 一样：chip 显示的是「相对今日每秒平均」的偏离，不是档位倍率。
  const trend = trendFor(rate / mockDailyAvg());
  return `<section class="tb-card" data-tier="${tier.level}">`
    + '<div class="tb-head">'
    + fireSpan(art, tier.level, 17, { embers: false })
    + '<div class="tb-title">Token 燃烧指数</div>'
    + `<span class="tb-sub tb-tier-name" data-tier="${tier.level}">Lv.${tier.level} ${esc(tier.name)}</span>`
    + '<span class="tb-sub">LIVE</span>'
    + '<button class="tb-btn" type="button">×</button>'
    + '</div>'
    + '<div class="tb-body">'
    + '<div class="tb-hero">'
    + fireSpan(art, tier.level, 34)
    + '<div class="tb-hero-main">'
    + `<div class="tb-hero-num">${fmtRate(rate)}<span>token/s</span></div>`
    + '<div class="tb-hero-meta">'
    + `<span class="tb-chip" title="相对今日每秒平均">${trend}</span>`
    + `<span class="tb-hero-note">${esc(tier.desc)}</span>`
    + '</div></div>'
    + sparklineMarkup(historyFor(rate, tier.level), false)
    + '</div>'
    + ladderMarkup(art, tier.level)
    + '</div>'
    + '</section>';
}

// ---------------------------------------------------------------------------
// 页面骨架：只放布局用的 .sh-* 样式，所有 .tb-* 都来自 art.CSS。
// ---------------------------------------------------------------------------
const sheetCss = (width) => `
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{width:${width}px;background:#070f1c;color:#e7eefc;
    font:13px/1.5 Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
    -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
  .sh-sheet{padding:24px 30px 26px}
  .sh-eyebrow{font-size:9.5px;font-weight:800;letter-spacing:.22em;text-transform:uppercase;color:#5d7ba0}
  .sh-h1{margin:7px 0 8px;font-size:26px;line-height:1.15;font-weight:850;letter-spacing:-.02em;color:#f2f7ff}
  .sh-h1 em{font-style:normal;color:#8ad9ff}
  .sh-lede{margin:0;font-size:12.5px;line-height:1.65;color:#9cb0cc;max-width:1180px}
  .sh-lede b{color:#dceafd;font-weight:800}
  .sh-lede code,.sh-meta code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#8ad9ff;background:#66e3ff12;border:1px solid #66e3ff24;border-radius:5px;padding:1px 5px}
  .sh-meta{margin-top:9px;font:10.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#5b7391}
  .sh-h2{display:flex;align-items:baseline;justify-content:space-between;gap:16px;
    margin:24px 0 6px;padding-top:14px;border-top:1px solid #ffffff12;
    font-size:15px;font-weight:850;letter-spacing:-.01em;color:#e6f0ff}
  .sh-h2 em{font-style:normal;font-size:10.5px;font-weight:600;color:#6d87a6;letter-spacing:0}
  .sh-note{margin:0 0 12px;font-size:10.5px;color:#7791af;line-height:1.6}
  .sh-note b{color:#a9c1de}
  .sh-strip{display:flex;align-items:flex-start;gap:16px;margin-bottom:12px}
  .sh-strip-label{flex:0 0 86px;font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#5f7ca0;padding-top:6px;line-height:1.5}
  .sh-strip-row{display:flex;flex-wrap:wrap;align-items:flex-end;gap:14px 18px;min-width:0}
  .sh-strip .sh-cap{width:92px;font-size:9px}
  .sh-offhint{font:9px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;color:#7189a8;border-left:2px solid #2a3d57;padding:2px 0 2px 10px;margin-bottom:6px}
  .sh-offhint b{color:#9fb6d4;font-weight:600}
  .sh-strip-label em{font-style:normal;color:#4c6484}
  .sh-fig{margin:0;display:flex;flex-direction:column;align-items:center;gap:5px;width:64px}
  .sh-cap{font-size:9.5px;line-height:1.3;color:#8ba3c2;text-align:center;white-space:nowrap}
  .sh-cap b{display:block;font-size:10.5px;font-weight:800;color:#e2edfc}
  .sh-pillrow{gap:12px}
  .sh-tierrow{display:grid;grid-template-columns:262px minmax(0,1fr) 208px;gap:16px;align-items:start;
    padding:12px 0 14px;border-top:1px solid #ffffff0d}
  .sh-tierlabel{min-width:0}
  .sh-badge{display:flex;align-items:center;gap:8px}
  .sh-lv{flex:0 0 auto;font:800 9.5px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;
    color:#0a1425;background:#7dd3fc;border-radius:4px;padding:3px 5px}
  .sh-name{font-size:17px;font-weight:850;letter-spacing:.01em;color:#f3f8ff}
  .sh-desc{margin-top:3px;font-size:11.5px;color:#a4b8d4}
  .sh-kv{margin-top:5px;font:10px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#7690ae}
  .sh-kv b{color:#cfe0f5;font-weight:700}
  .sh-frames{display:flex;gap:5px;align-items:flex-end;justify-content:space-between;padding:8px 10px 6px;background:#0a1526;
    border:1px solid #ffffff0b;border-radius:10px;min-width:0}
  .sh-frame{margin:0;display:flex;flex-direction:column;align-items:center;gap:3px}
  .sh-fi{font:8px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:#4f6787}
  .sh-sizes{display:flex;gap:14px;align-items:flex-end;justify-content:flex-end}
  .sh-cards{display:grid;grid-template-columns:repeat(3,420px);gap:18px;align-items:start}
  .sh-cards .tb-card{animation:none}
  .sh-cards>:nth-child(7){grid-column:2/3;justify-self:center}
  .sh-palette-lede{display:flex;flex-wrap:wrap;gap:14px;margin:0 0 8px;font:10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:#7e97b5}
  .sh-palette-lede span{display:inline-flex;align-items:center;gap:5px}
  .sh-swatch{display:inline-block;width:11px;height:11px;border-radius:3px;border:1px solid #ffffff1c;vertical-align:-1px}
  table.sh-table{width:100%;border-collapse:collapse;font-size:10.5px}
  .sh-table th{text-align:left;font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;
    color:#5f7ca0;padding:0 10px 6px 0;border-bottom:1px solid #ffffff12;white-space:nowrap}
  .sh-table td{padding:7px 10px 7px 0;border-bottom:1px solid #ffffff08;color:#b8cbe4;vertical-align:middle;white-space:nowrap}
  .sh-table td.num{font:10.5px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:#d5e6fa}
  .sh-table td .sh-swatches{display:flex;gap:3px;align-items:center}
  .sh-table tr td:first-child{color:#eaf3ff;font-weight:700}
  .sh-natrow{display:flex;flex-direction:column;align-items:flex-start;gap:5px;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #ffffff0a}
  .sh-natcap{font:9.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#7189a8;padding-left:2px}
  .sh-natcap b{color:#cfe0f5;font-family:Inter,ui-sans-serif,system-ui,sans-serif;font-size:10.5px}
  .sh-foot{margin-top:20px;padding-top:11px;border-top:1px solid #ffffff12;
    display:flex;justify-content:space-between;gap:20px;font-size:10px;color:#5c7594}

  /* 截图确定性：真实 CSS 里的呼吸/脉冲/入场动画会让每次截图的帧位不同。
     这里只在预览页把它冻住，形状、颜色、滤镜仍是 art.CSS 原样。 */
  [data-token-burn] *,[data-token-burn]{animation:none!important;transition:none!important}
`;

const HEIGHT_PROBE = `<script>
  addEventListener('load', function () {
    // 只取内容高度：viewport 比页面高时 documentElement.scrollHeight 会被
    // 视口撑大，截出来下方就是一片空白。
    var sheet = document.querySelector('.sh-sheet');
    var rect = sheet.getBoundingClientRect();
    var h = Math.ceil(rect.top + rect.height + (window.scrollY || 0));
    document.documentElement.setAttribute('data-sheet-height', String(h));
  });
</script>`;

function page({ art, body, title, width }) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${sheetCss(width)}</style>
<style>${art.CSS}</style>
</head>
<body><div class="sh-sheet" data-token-burn>${body}</div>${HEIGHT_PROBE}</body></html>`;
}

function sectionHeader(num, title, note) {
  return `<h2 class="sh-h2"><span>${num} ${title}</span>${note ? `<em>${note}</em>` : ''}</h2>`;
}

function headerMarkup(art, compact) {
  if (compact) {
    return `<header>
      <div class="sh-eyebrow">dsh-plugin-token-burned · verify/preview.mjs</div>
      <h1 class="sh-h1">1:1 真实视图 · <em>7 档火候</em></h1>
      <p class="sh-lede">阈值是绝对速率（token/s）：&lt;100 · 100-500 · 500-2k · 2k-3k · 3k-9k · 9k-50k · ≥50k。
        下面是每条 pill 的 1:1 截图，DPR2 不缩小。</p>
    </header>`;
  }
  return `<header>
    <div class="sh-eyebrow">dsh-plugin-token-burned · verify/preview.mjs · offline contact sheet</div>
    <h1 class="sh-h1">Token 燃烧指数 · <em>7 档火候</em>联系表</h1>
    <p class="sh-lede">用 <code>client.js</code> 里真实的 <code>__tbArt</code> 离线渲染：7 档 × 16 帧程序化 SVG，配上线上同一套
      <code>.tb-pill</code> / <code>.tb-hero</code> / <code>.tb-ladder</code> class 与 <code>art.CSS</code>，
      重点看 <b>19px（pill 内）</b>与 <b>34px（展开卡 hero 内）</b>这两个真实尺寸下七档是否还能区分。
      阈值：<b>绝对实时速率（token/s）</b>，&lt;100 · 100-500 · 500-2k · 2k-3k · 3k-9k · 9k-50k · ≥50k；mock 速率取各档中段值。
      今日 <b>${fmt(MOCK.today)}</b> · 今日均值 <b>${fmtRate(mockDailyAvg())} token/s</b>（只用于卡内「相对今日均值」chip，不参与定档）。</p>
    <div class="sh-meta">art.CSS ${(art.CSS.length / 1024).toFixed(1)}KB · TIERS ${art.TIERS.length} · FRAME_COUNT ${art.FRAME_COUNT} · framesFor()/idleFrame()/embersFor() 与 CSS 均直接读自 client.js · RISE ${art.RISE_MS}ms / FALL ${art.FALL_MS}ms · 静态第 0 帧为默认展示帧</div>
  </header>`;
}

function sectionRealSize(art, rates) {
  const fires19 = art.TIERS.map((t) => `<figure class="sh-fig">${fireSpan(art, t.level, 19, { embers: false })}`
    + `<figcaption class="sh-cap"><b>${esc(t.name)}</b>${sizeLabel(art, t.level, 19)}</figcaption></figure>`).join('');
  const fires34 = art.TIERS.map((t) => `<figure class="sh-fig">${fireSpan(art, t.level, 34)}`
    + `<figcaption class="sh-cap"><b>${esc(t.name)}</b>${sizeLabel(art, t.level, 34)}</figcaption></figure>`).join('');
  const pills = art.TIERS.map((t) => pillMarkup(art, t, rates[t.level])).join('');
  const idleFires = [19, 34].map((px) => `<figure class="sh-fig">${fireSpan(art, 0, px, { idle: true })}`
    + `<figcaption class="sh-cap"><b>已熄灭 ${px}px</b>${idleSizeLabel(art, px)}</figcaption></figure>`).join('')
    + '<div class="sh-offhint"><b>data-burning="off" · data-tier="0"</b><br>'
    + 'idleFrame() · 3 层 a/c/e · 无抖动<br>'
    + '无余烬（未燃烧，且 19px &lt; 24px）<br>'
    + '变灰由 .tb-fire[data-burning="off"] 负责</div>';
  return `<section>
    ${sectionHeader('①', '实尺寸对照', '19px = pill 内火焰 · 34px = 展开卡 hero 内火焰 · 下方为真实 48px pill')}
    <p class="sh-note">这一行是验收标准：用户 99% 的时间只看到 <b>19px</b>。若两档在这一行看起来一样，就等于没做这一档。</p>
    <div class="sh-strip"><div class="sh-strip-label">19px<br>pill<br><em>轮廓</em></div><div class="sh-strip-row">${fires19}</div></div>
    <div class="sh-strip"><div class="sh-strip-label">34px<br>hero<br><em>轮廓</em></div><div class="sh-strip-row">${fires34}</div></div>
    <div class="sh-strip"><div class="sh-strip-label">熄火<br>off<br><em>轮廓</em></div><div class="sh-strip-row">${idleFires}</div></div>
    <div class="sh-strip"><div class="sh-strip-label">pill<br>1:1</div><div class="sh-strip-row sh-pillrow">${pills}</div></div>
    <div class="sh-strip"><div class="sh-strip-label">pill<br>熄火<br>1:1</div><div class="sh-strip-row sh-pillrow">${offPillMarkup(art)}</div></div>
  </section>`;
}

function sectionFrames(art, rates) {
  const rows = art.TIERS.map((t) => {
    const frames = art.framesFor(t.level);
    const frameFigs = frames.map((_, i) => `<figure class="sh-frame">`
      + `<span>${fireSpan(art, t.level, 44, { frame: i, embers: false })}</span>`
      + `<figcaption class="sh-fi">${i}</figcaption></figure>`).join('');
    const sizes = [[19, 'pill 19'], [34, 'hero 34'], [57, '3× 放大']].map(([px, label]) => `<figure class="sh-fig">`
      + `${fireSpan(art, t.level, px)}<figcaption class="sh-cap">${label}</figcaption></figure>`).join('');
    const rate = rates[t.level];
    return `<div class="sh-tierrow">
      <div class="sh-tierlabel">
        <div class="sh-badge"><span class="sh-lv">LV ${t.level}</span><span class="sh-name">${esc(t.name)}</span></div>
        <div class="sh-desc">${esc(t.desc)}</div>
        <div class="sh-kv">区间 <b>${esc(rangeLabel(art, t))}</b> token/s</div>
        <div class="sh-kv">示例 <b>${fmtRate(rate)}</b> token/s · ${frames[0].length} path/帧</div>
        <div class="sh-kv">${t.frameMs}ms/帧 · beat ${t.beat}ms · 余烬 ${t.sparks}</div>
      </div>
      <div class="sh-frames">${frameFigs}</div>
      <div class="sh-sizes">${sizes}</div>
    </div>`;
  }).join('');
  return `<section>
    ${sectionHeader('②', '每档 16 帧序列', '44px 一帧，共 16 帧；右侧是同一帧在 19px / 34px / 3× 下的样子')}
    <p class="sh-note">帧序列由 <code>framesFor(level)</code> 直接产出（缓存后的真实数据）。序列里不画余烬以免干扰轮廓判断；
      <b>线上余烬只在火焰宽度 ≥24px（<code>MIN_EMBER_WIDTH</code>）且燃烧中才画</b>，所以右侧 19px 列故意没有余烬、34px 与 3× 有（pill 里的 19px 永远没有）。</p>
    ${rows}
  </section>`;
}

function sectionCards(art, rates) {
  const cards = art.TIERS.map((t) => cardMarkup(art, t, rates[t.level])).join('');
  return `<section>
    ${sectionHeader('③', '展开卡 · 火候进度条', '卡宽 420px（线上真值）；hero 34px 火焰 + 7 段火候条 + fun copy')}
    <p class="sh-note">每张卡就是用户点开 pill 看到的第二屏：<b>火候</b>条第 N 段点亮，标题旁是 <b>Lv.N 档名</b>徽标，hero 里是速率、趋势 chip 与 fun copy。</p>
    <div class="sh-cards">${cards}</div>
  </section>`;
}

function sectionTable(art, rates) {
  const rows = art.TIERS.map((t) => {
    const level = art.tierOf(rates[t.level]);
    if (level !== t.level) {
      throw new Error(`④ 表自检失败：${t.name} 的示例速率 ${fmtRate(rates[t.level])} token/s 被 tierOf 判成 Lv.${level}（区间 ${rangeLabel(art, t)}）`);
    }
    const palette = ['a', 'b', 'c', 'd', 'e', 'glow', 'edge']
      .map((slot) => `<i class="sh-swatch" style="background:${esc(t.palette[slot])}" title="palette.${slot} ${esc(t.palette[slot])}"></i>`).join('');
    return `<tr>
      <td>LV ${t.level} · ${esc(t.name)}</td>
      <td>${esc(t.desc)}</td>
      <td class="num">${esc(rangeLabel(art, t))}</td>
      <td class="num">${fmtRate(rates[t.level])}</td>
      <td class="num">${t.frameMs}ms</td>
      <td class="num">${t.beat}ms</td>
      <td class="num">${t.sparks}</td>
      <td class="num">${sizeLabel(art, t.level, 19)}</td>
      <td><div class="sh-swatches">${palette}</div></td>
    </tr>`;
  }).join('');
  return `<section>
    ${sectionHeader('④', '配色 / 阈值 / 参数', 'palette 从 art.TIERS 读出，用于对照档位色阶是否成阶梯')}
    <p class="sh-palette-lede">
      <span><i class="sh-swatch" style="background:#1e3a8a"></i>a 外焰底</span>
      <span><i class="sh-swatch" style="background:#2563eb"></i>b 外焰</span>
      <span><i class="sh-swatch" style="background:#22d3ee"></i>c 内焰</span>
      <span><i class="sh-swatch" style="background:#7dd3fc"></i>d 高光</span>
      <span><i class="sh-swatch" style="background:#e0f2fe"></i>e 焰心</span>
      <span><i class="sh-swatch" style="background:#3b82f6"></i>glow 光晕</span>
      <span><i class="sh-swatch" style="background:#3b82f680"></i>edge pill 描边</span>
    </p>
    <table class="sh-table">
      <thead><tr>
        <th>档位</th><th>文案</th><th>绝对区间 token/s</th><th>示例速率</th>
        <th>帧间隔</th><th>呼吸 beat</th><th>余烬</th><th>19px 轮廓</th><th>palette a b c d e glow edge</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

function sectionNative(art, rates) {
  const rows = art.TIERS.map((t) => `<div class="sh-natrow">
      ${pillMarkup(art, t, rates[t.level])}
      <div class="sh-natcap"><b>Lv.${t.level} ${esc(t.name)}</b> · 区间 ${esc(rangeLabel(art, t))} token/s<br>示例 ${fmtRate(rates[t.level])} token/s · ${t.frameMs}ms/帧</div>
    </div>`).join('');
  return `<section>
    ${sectionHeader('★', '1:1 真实视图', '480 CSS px 宽窄幅，DPR2 截图不缩小——这就是 Retina 用户看到的尺寸')}
    <p class="sh-note">每行一条真实 pill（19px 火 + 档名 + 速率 + 迷你曲线 + 今日）。<b>请在 1:1 像素下判断</b>：相邻档位是否只靠颜色区分、19px 处火舌是否还能数出来。</p>
    ${rows}
  </section>`;
}

/** 艺术层内容指纹：同样的 client.js 重跑应产出同一张图（不含墙钟时间）。 */
function artHash(art) {
  const hash = createHash('sha256');
  hash.update(art.CSS);
  hash.update(JSON.stringify([art.RISE_MS, art.FALL_MS, art.FRAME_COUNT]));
  hash.update(JSON.stringify(art.idleFrame())); // 熄火态也是艺术层，改了就该换 hash
  for (const tier of art.TIERS) {
    hash.update(JSON.stringify([tier.level, tier.minRate, tier.frameMs, tier.beat, tier.sparks, tier.palette]));
    hash.update(JSON.stringify(art.framesFor(tier.level)));
    hash.update(JSON.stringify(art.embersFor(tier.level)));
  }
  return hash.digest('hex').slice(0, 12);
}

function footerMarkup(art, compact) {
  return `<footer class="sh-foot">
    <span>由 <b>node verify/preview.mjs</b> 生成（headless Chrome 2× 截图，无第三方依赖）。文案/阈值/palette 全部来自 client.js，不是本脚本写死的。</span>
    ${compact ? '' : `<span>art hash <b>${artHash(art)}</b> · 内容确定，重跑同图</span>`}
  </footer>`;
}

function buildSheet(art, opts = {}) {
  const rates = {};
  for (const tier of art.TIERS) rates[tier.level] = MOCK.rate[tier.level];

  // 自检：mock 速率必须真的落在该档，否则截图上的「Lv.N」就是骗人的。
  for (const tier of art.TIERS) {
    const level = art.tierOf(rates[tier.level]);
    if (level !== tier.level) {
      throw new Error(`mock 速率与档位不自洽：${tier.name}（区间 ${rangeLabel(art, tier)}）期望 Lv.${tier.level}，tierOf(${rates[tier.level]}) 给出 Lv.${level}`);
    }
  }

  const only = opts.only;
  const sections = [];
  if (!only || only === 'realsize') sections.push(sectionRealSize(art, rates));
  if (!only || only === 'frames') sections.push(sectionFrames(art, rates));
  if (!only) {
    sections.push(sectionCards(art, rates));
    sections.push(sectionTable(art, rates));
  }
  if (only === 'native') sections.push(sectionNative(art, rates));
  const compact = !!opts.compact;
  const body = headerMarkup(art, compact) + sections.join('') + footerMarkup(art, compact);
  return page({ art, body, title: opts.title || 'Token 燃烧指数 · 7 档火候联系表', width: opts.width || WIDTH });
}

// ---------------------------------------------------------------------------
// Chrome：先量高，再截图。--screenshot 只抓视口，所以高度必须提前知道。
// ---------------------------------------------------------------------------
function chromeArgs(extra) {
  return [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-features=Translate',
    `--user-data-dir=${join(PROFILE_ROOT, `p${profileSeq += 1}`)}`,
    ...extra,
  ];
}

/** Chrome 启动 + 一次容错重试（profile 是新建的，重试只会更干净）。 */
function spawnChrome(extra) {
  const run = () => spawnSync(CHROME, chromeArgs(extra), { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  let result = run();
  if (result.status === 21 || /SingletonLock|ProcessSingleton/.test(result.stderr || '')) {
    result = run();
  }
  return result;
}

function fileUrl(path) {
  return 'file://' + path.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function measureHeight(htmlPath, width) {
  const result = spawnChrome([`--window-size=${width},900`, '--dump-dom', fileUrl(htmlPath)]);
  if (result.error) throw new Error(`无法启动 Chrome：${result.error.message}`);
  if (result.status !== 0) throw new Error(`Chrome --dump-dom 退出码 ${result.status}：${(result.stderr || '').slice(0, 400)}`);
  const match = /data-sheet-height="(\d+)"/.exec(result.stdout || '');
  if (!match) throw new Error('没能从 --dump-dom 里读到页面高度（data-sheet-height）');
  return Number(match[1]);
}

function pngSize(path) {
  const head = readFileSync(path).subarray(0, 33);
  if (head.length < 33 || head.readUInt32BE(0) !== 0x89504e47 || head.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

function shoot(htmlPath, pngPath, width, height) {
  rmSync(pngPath, { force: true });
  const result = spawnChrome([
    `--window-size=${width},${height}`,
    `--force-device-scale-factor=${SCALE}`,
    `--screenshot=${pngPath}`,
    fileUrl(htmlPath),
  ]);
  if (result.error) throw new Error(`无法启动 Chrome：${result.error.message}`);
  if (result.status !== 0) throw new Error(`Chrome --screenshot 退出码 ${result.status}：${(result.stderr || '').slice(0, 400)}`);
  if (!existsSync(pngPath)) throw new Error(`Chrome 没有生成截图：${pngPath}`);
  const bytes = statSync(pngPath).size;
  if (bytes < MIN_PNG_BYTES) throw new Error(`截图只有 ${bytes} 字节（< ${MIN_PNG_BYTES}），页面大概是空的：${pngPath}`);
  const size = pngSize(pngPath);
  if (!size) throw new Error(`不是合法 PNG：${pngPath}`);
  return { bytes, ...size };
}

/**
 * README 用的轻量副本：把已经截好的 2× PNG 交给 cwebp 转有损 webp（同像素）。
 * 这是附属产物——cwebp 缺失、退出码非 0、产物不像 webp 都只打印提示并跳过，
 * 绝不让 preview 失败：docs/preview-tiers.png 才是确定性的校验产物。
 */
function exportReadmeCopy() {
  // 先不删旧文件：cwebp 缺失时（CI、别的 Mac）不能让仓库里已有的 webp 凭空消失。
  const result = spawnSync('cwebp', ['-quiet', '-q', WEBP_QUALITY, DOCS_PNG, '-o', DOCS_WEBP], { encoding: 'utf8' });
  if (result.error && result.error.code === 'ENOENT') {
    return {
      skipped: '本机没有 cwebp（brew install webp）',
      kept: existsSync(DOCS_WEBP),
    };
  }
  if (result.error) return { skipped: `cwebp 启动失败：${result.error.message}` };
  if (result.status !== 0) {
    return { skipped: `cwebp 退出码 ${result.status}：${(result.stderr || result.stdout || '').slice(0, 200)}` };
  }
  if (!existsSync(DOCS_WEBP)) return { skipped: 'cwebp 没有生成文件' };
  const bytes = statSync(DOCS_WEBP).size;
  const head = readFileSync(DOCS_WEBP).subarray(0, 12);
  const riff = head.length >= 12
    && head.toString('latin1', 0, 4) === 'RIFF'
    && head.toString('latin1', 8, 12) === 'WEBP';
  if (!riff || bytes < MIN_WEBP_BYTES) {
    rmSync(DOCS_WEBP, { force: true });
    return { skipped: riff ? `webp 只有 ${bytes} 字节（< ${MIN_WEBP_BYTES}），已删除` : '产物不是合法 webp（RIFF/WEBP 头不对），已删除' };
  }
  return { bytes };
}

function render(art, opts) {
  const width = opts.width || WIDTH;
  const htmlPath = join(OUT_DIR, opts.html);
  const pngPath = join(OUT_DIR, opts.png);
  writeFileSync(htmlPath, buildSheet(art, opts), 'utf8');
  const height = measureHeight(htmlPath, width);
  if (!(height > 320)) throw new Error(`页面高度异常：${height}px（HTML 生成有问题？）`);
  const shot = shoot(htmlPath, pngPath, width, height + 2);
  // 2× 截图：宽高都应是 CSS 尺寸的两倍（高度 +2px 的安全边）。
  if (shot.width !== width * SCALE) {
    throw new Error(`截图宽度 ${shot.width} 与预期 ${width * SCALE} 不符（DPR 没生效？）`);
  }
  if (Math.abs(shot.height - (height + 2) * SCALE) > 8) {
    throw new Error(`截图高度 ${shot.height} 与页面高度 ${height}×${SCALE} 不符（可能被截断）`);
  }
  return { htmlPath, pngPath, height, ...shot };
}

function main() {
  if (!existsSync(CHROME)) {
    throw new Error(`找不到 Chrome：${CHROME}（可用 TB_CHROME 环境变量指定）`);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(join(ROOT, 'docs'), { recursive: true });
  rmSync(join(OUT_DIR, 'chrome-profile'), { recursive: true, force: true });

  const art = loadArt();
  console.log(`token-burned preview · art hash ${artHash(art)}`);

  // 排版前先确认每一帧都是合法 path：非法 path 在浏览器里会整条不画，
  // 联系表可以「看起来没问题」，但线上渲染就是缺一块。
  for (const name of ['framesFor', 'idleFrame', 'embersFor', 'tierOf']) {
    if (typeof art[name] !== 'function') throw new Error(`client.js 的 __tbArt 缺少 ${name}()：预览要复刻熄火态、余烬门槛与绝对阈值`);
  }

  // 绝对阈值自检：档位不再是「相对个人基线的倍率」，而是 token/s 硬阈值。
  // client.js 调了阈值/边界语义而本脚本没跟上时，在这里就失败，别画出一张骗人的图。
  if (art.tierOf(0) !== 0) throw new Error(`tierOf(0) 应为 0（熄灭），实际 Lv.${art.tierOf(0)}`);
  if (art.tierOf(0.02) !== 1) throw new Error(`tierOf(0.02) 应为 Lv.1（有正常流量就至少点亮星火），实际 Lv.${art.tierOf(0.02)}`);
  for (const [index, tier] of art.TIERS.entries()) {
    if (!Number.isFinite(tier.minRate)) throw new Error(`TIERS[${index}] 缺少数字型 minRate（绝对阈值 token/s）`);
    const level = art.tierOf(tier.minRate);
    const below = art.tierOf(tier.minRate - 0.01);
    if (index === 0) {
      if (tier.minRate !== 0) throw new Error(`Lv.1 的 minRate 应为 0，实际 ${tier.minRate}`);
      continue; // minRate 0 属于「熄灭↔点亮」边界，上面两行已单独验
    }
    if (!(tier.minRate > art.TIERS[index - 1].minRate)) {
      throw new Error(`TIERS 的 minRate 必须严格递增：Lv.${tier.level} = ${tier.minRate}，Lv.${art.TIERS[index - 1].level} = ${art.TIERS[index - 1].minRate}`);
    }
    if (level !== tier.level) throw new Error(`阈值边界自检失败：tierOf(${tier.minRate}) 应为 Lv.${tier.level}，实际 Lv.${level}`);
    if (below !== tier.level - 1) throw new Error(`阈值左边界自检失败：tierOf(${tier.minRate - 0.01}) 应为 Lv.${tier.level - 1}，实际 Lv.${below}`);
    if (art.tierOf(MOCK.rate[tier.level]) !== tier.level) {
      throw new Error(`mock 代表速率 ${MOCK.rate[tier.level]} token/s 不在 Lv.${tier.level}（${rangeLabel(art, tier)}）区间内`);
    }
  }
  for (const tier of art.TIERS) {
    for (const [frameIndex, frame] of art.framesFor(tier.level).entries()) {
      for (const seg of frame) {
        const bad = pathError(seg.d);
        if (bad) throw new Error(`${tier.name} 第 ${frameIndex} 帧的 .tb-fire-${seg.layer} path 非法：${bad}`);
      }
    }
  }
  for (const seg of art.idleFrame()) {
    const bad = pathError(seg.d);
    if (bad) throw new Error(`idleFrame() 的 .tb-fire-${seg.layer} path 非法：${bad}`);
  }

  const sheet = render(art, { html: 'preview.html', png: 'preview-tiers.png' });
  copyFileSync(sheet.pngPath, DOCS_PNG);

  const detailReal = render(art, {
    html: 'tiers-realsize.html', png: 'tiers-realsize.png', only: 'realsize',
    title: '实尺寸对照 · 19px / 34px',
  });
  const detailFrames = render(art, {
    html: 'tiers-frames.html', png: 'tiers-frames.png', only: 'frames',
    title: '每档 16 帧序列',
  });
  const detailNative = render(art, {
    html: 'tiers-native.html', png: 'tiers-native.png', only: 'native', width: 480, compact: true,
    title: '1:1 真实视图（480 CSS px）',
  });

  const size = statSync(DOCS_PNG).size;
  const readme = exportReadmeCopy();
  console.log('token-burned preview: OK');
  console.log(`  html:      ${sheet.htmlPath}`);
  console.log(`  sheet:     ${sheet.pngPath}  (${sheet.width}×${sheet.height}, ${(sheet.bytes / 1024).toFixed(0)}KB)`);
  console.log(`  realsize:  ${detailReal.pngPath}  (${detailReal.width}×${detailReal.height})`);
  console.log(`  frames:    ${detailFrames.pngPath}  (${detailFrames.width}×${detailFrames.height})`);
  console.log(`  native:    ${detailNative.pngPath}  (${detailNative.width}×${detailNative.height})`);
  console.log(`  docs:      ${resolve(DOCS_PNG)}  (${(size / 1024).toFixed(0)}KB)`);
  if (readme.bytes) {
    console.log(`  readme:    ${resolve(DOCS_WEBP)}  (${(readme.bytes / 1024).toFixed(0)}KB, webp q${WEBP_QUALITY}, 同 2× 像素)`);
  } else {
    console.log(`  readme:    skipped — ${readme.skipped}${readme.kept ? '（保留上次生成的 webp）' : ''}`);
  }
  // 19px/34px 的真实轮廓（px）：评审时直接看这两行数字，不用去图上量。
  const sizes = (px) => art.TIERS.map((t) => `${t.name} ${sizeLabel(art, t.level, px)}`).join(' · ');
  console.log(`  @19px:     ${sizes(19)}`);
  console.log(`  @34px:     ${sizes(34)}`);
  console.log(`  @off:      已熄灭 ${idleSizeLabel(art, 19)} @19px · ${idleSizeLabel(art, 34)} @34px（idleFrame，无余烬）`);
  console.log(`  ladder:    ${art.TIERS.map((t) => rangeLabel(art, t)).join(' · ')} token/s（绝对速率，与历史/基线无关）`);
  console.log(`  @rates:    ${art.TIERS.map((t) => `${t.name} ${fmtRate(MOCK.rate[t.level])}`).join(' · ')} token/s`);
}

try {
  main();
} catch (error) {
  console.error(`token-burned preview: FAIL — ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(PROFILE_ROOT, { recursive: true, force: true });
}
