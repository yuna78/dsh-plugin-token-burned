window.__ModuleLoader__.load({
  id: 'dsh-plugin-token-burned',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;
    const useMemo = React.useMemo;
    const useRef = React.useRef;

    const STORE = 'dsh-token-burned.pos';
    const ENDPOINT = '/api/dsh-token-burned.snapshot';
    const POLL_MS = 1000;
    const FRAME_MS = 70;
    const FRAME_COUNT = 16;
    const HISTORY = 60;
    const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
    const PALETTE = ['#66e3ff', '#a78bfa', '#5eead4', '#f0abfc', '#fbbf24'];
    const FALLBACK_MODELS = ['DeepSeek V3', 'Claude Sonnet', 'GPT-5', 'Gemini Pro'];
    const FIRE_VB = '0 0 64 96';
    const CSS = `
      [data-token-burn]{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#edf4ff;font-size:12px;line-height:1.4;letter-spacing:.01em}
      [data-token-burn] *{box-sizing:border-box}
      .tb-pill{height:48px;max-width:calc(100vw - 24px);display:flex;align-items:center;gap:9px;padding:0 15px 0 11px;border:1px solid #334966;border-radius:14px;background:linear-gradient(135deg,#111d31f5,#0a1425f5);box-shadow:0 16px 42px #020817aa,0 0 0 1px #ffffff08 inset,0 0 24px #66e3ff14;cursor:pointer;user-select:none;transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease}
      .tb-pill:hover{transform:translateY(-2px);border-color:#52708e;box-shadow:0 20px 48px #020817cc,0 0 26px #66e3ff22}
      .tb-pill[data-burning="on"]{border-color:#3d5b80;box-shadow:0 16px 42px #020817aa,0 0 0 1px #ffffff08 inset,0 0 20px #ff9a4d26,0 0 34px #66e3ff1c}
      .tb-pill:focus-visible,.tb-btn:focus-visible,.tb-tab:focus-visible{outline:2px solid #66e3ff;outline-offset:3px}
      .tb-fire{position:relative;display:inline-flex;align-items:flex-end;justify-content:center;flex:0 0 auto;transition:opacity .35s ease,filter .35s ease}
      .tb-fire svg{display:block;overflow:visible}
      .tb-fire[data-burning="on"]{filter:drop-shadow(0 0 5px #66e3ffaa) drop-shadow(0 0 12px #4a6cff66);animation:tb-breathe 2.2s ease-in-out infinite}
      .tb-fire[data-burning="off"]{opacity:.38;filter:grayscale(.55)}
      .tb-fire-a{fill:#2f6bff;opacity:.5}
      .tb-fire-b,.tb-fire-c{fill:#3f8dff;opacity:.62}
      .tb-fire-d{fill:#66e3ff;opacity:.92}
      .tb-fire-e{fill:#f2fbff}
      .tb-hot{color:#9fb4d0;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;white-space:nowrap}
      .tb-pill[data-burning="on"] .tb-hot{color:#a9ecff}
      .tb-rate{display:inline-flex;align-items:baseline;gap:3px;font-variant-numeric:tabular-nums;white-space:nowrap}
      .tb-rate b{font-size:15px;font-weight:800;color:#f4f8ff;letter-spacing:-.02em}
      .tb-unit{font-size:9px;font-weight:700;color:#7f96b5}
      .tb-sep{width:1px;height:18px;background:#ffffff1c;flex:0 0 auto}
      .tb-group{display:inline-flex;align-items:baseline;gap:5px;white-space:nowrap;min-width:0}
      .tb-gk{font-size:9px;font-weight:700;color:#7f96b5;letter-spacing:.04em}
      .tb-gv{font-size:13px;font-weight:800;color:#eaf2ff;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
      .tb-card{width:420px;max-width:calc(100vw - 24px);background:linear-gradient(150deg,#111d31f7 0%,#0a1324f8 100%);border:1px solid #334966;border-radius:18px;box-shadow:0 28px 80px #020817d9,0 0 0 1px #ffffff08 inset,0 0 36px #66e3ff12;overflow:hidden;animation:tb-in .24s ease-out;backdrop-filter:blur(24px)}
      .tb-head{display:flex;align-items:center;gap:11px;padding:15px 16px 13px;background:linear-gradient(110deg,#66e3ff12,#a78bfa0b 56%,transparent);border-bottom:1px solid #ffffff12;cursor:grab}
      .tb-head:active{cursor:grabbing}
      .tb-title{font-size:13px;font-weight:750;letter-spacing:.01em;flex:1;color:#f2f6ff;white-space:nowrap}
      .tb-sub{font-size:9px;font-weight:800;letter-spacing:.12em;color:#70e1d2;background:#5eead414;border:1px solid #5eead240;padding:4px 7px;border-radius:6px}
      .tb-btn{border:1px solid transparent;background:transparent;color:#849ab7;border-radius:8px;padding:4px 7px;cursor:pointer;font-size:18px;line-height:1;transition:background .2s,color .2s,border-color .2s}
      .tb-btn:hover{background:#ffffff10;color:#f3f7ff;border-color:#ffffff18}
      .tb-body{padding:14px 16px 15px}
      .tb-hero{display:flex;align-items:center;gap:11px;padding:11px 13px;margin-bottom:12px;border:1px solid #ffffff14;border-radius:12px;background:radial-gradient(130% 150% at 0% 50%,#ff9a4d1a,transparent 58%),linear-gradient(120deg,#ffffff0d,#ffffff04)}
      .tb-hero-main{flex:1;min-width:0}
      .tb-hero-num{display:flex;align-items:baseline;gap:4px;font-size:25px;font-weight:800;letter-spacing:-.03em;color:#f7fbff;font-variant-numeric:tabular-nums;line-height:1.05}
      .tb-hero-num span{font-size:10px;font-weight:700;color:#8ba3c2;letter-spacing:.02em}
      .tb-hero-meta{display:flex;align-items:center;gap:7px;margin-top:5px;min-width:0}
      .tb-chip{font-size:9px;font-weight:800;color:#9df0ff;background:#66e3ff1a;border:1px solid #66e3ff36;border-radius:5px;padding:2px 5px;font-variant-numeric:tabular-nums;white-space:nowrap}
      .tb-hero-note{font-size:9px;color:#7f96b5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .tb-spark{width:92px;height:38px;flex:0 0 auto;overflow:visible}
      .tb-spark-sm{width:54px;height:26px;margin-left:1px}
      .tb-spark-sm .tb-spark-line{stroke-width:1.4}
      .tb-spark-line{fill:none;stroke:#66e3ff;stroke-width:1.6;vector-effect:non-scaling-stroke;stroke-linejoin:round;stroke-linecap:round;filter:drop-shadow(0 0 4px #66e3ff88)}
      .tb-spark-area{fill:#66e3ff26}
      .tb-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:13px}
      .tb-stat{min-width:0;padding:10px 10px 9px;border:1px solid #ffffff12;border-radius:10px;background:#ffffff07;box-shadow:0 1px 0 #ffffff08 inset}
      .tb-label{font-size:9px;color:#8196b4;margin-bottom:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.06em}
      .tb-value{display:flex;align-items:baseline;gap:3px;font-size:15px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.02em;color:#f0f5ff}
      .tb-value i{font-style:normal;font-size:8px;font-weight:700;color:#748cad;letter-spacing:.03em}
      .tb-tabs{display:flex;gap:4px;background:#050c18aa;border:1px solid #ffffff0c;padding:3px;border-radius:9px;margin-bottom:13px}
      .tb-tab{flex:1;border:0;background:transparent;border-radius:6px;padding:7px 5px;color:#7890af;font:inherit;font-size:10px;font-weight:650;cursor:pointer;transition:color .2s,background .2s,box-shadow .2s}
      .tb-tab:hover{color:#d5e4f7}
      .tb-tab[data-on="on"]{background:#243752;color:#eef7ff;box-shadow:0 2px 8px #02081766}
      .tb-chart-title{display:flex;align-items:baseline;justify-content:space-between;font-size:10px;color:#c3d6ee;font-weight:700;margin-bottom:6px}
      .tb-chart-title span{font-size:9px;color:#6d84a3;font-weight:600}
      .tb-legend{display:flex;flex-wrap:wrap;gap:4px 9px;margin-bottom:8px;font-size:9px;color:#8ea6c4}
      .tb-model{display:inline-flex;align-items:center;gap:4px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .tb-dot{width:6px;height:6px;border-radius:50%;flex:0 0 auto;box-shadow:0 0 6px currentColor}
      .tb-chart{display:flex;align-items:flex-start;gap:5px}
      .tb-axis{display:flex;flex-direction:column;justify-content:space-between;align-items:flex-end;height:132px;flex:0 0 auto;padding-right:1px}
      .tb-tick{font-size:8px;color:#6f87a6;font-variant-numeric:tabular-nums;line-height:0;transition:color .3s ease}
      .tb-plot{position:relative;flex:1;min-width:0;border-left:1px solid #ffffff1a;padding-left:5px}
      .tb-grid{position:absolute;top:0;left:0;right:0;height:132px;pointer-events:none}
      .tb-gridline{position:absolute;left:0;right:0;height:1px;background:#ffffff0d}
      .tb-bars{position:relative;display:flex;align-items:flex-end;justify-content:center;gap:4px;height:132px}
      .tb-bar{flex:1 1 0;min-width:0;max-width:64px;display:flex;align-items:flex-end;height:100%}
      .tb-bar-fill{display:block;width:100%;border-radius:4px 4px 2px 2px;transition:height .8s cubic-bezier(.22,1,.36,1),box-shadow .3s}
      .tb-bar-fill[data-peak="on"]{box-shadow:0 0 10px #66e3ff55}
      .tb-xlabels{display:flex;justify-content:center;gap:4px;margin-top:5px}
      .tb-xlabel{flex:1 1 0;min-width:0;max-width:64px;font-size:8px;color:#6d84a3;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .tb-section{display:flex;align-items:baseline;justify-content:space-between;margin:14px 0 7px;font-size:10px;font-weight:700;color:#c3d6ee}
      .tb-section span{font-size:9px;font-weight:600;color:#6d84a3}
      .tb-cal-head{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:4px}
      .tb-cal-head i{font-style:normal;font-size:8px;color:#5d7695;text-align:center}
      .tb-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
      .tb-cell{display:block;height:16px;border-radius:4px;background:#1a2740;transition:transform .2s ease,box-shadow .2s ease}
      .tb-cell[data-pad="on"]{background:transparent}
      .tb-cell[data-l="1"]{background:#1d3a5e}
      .tb-cell[data-l="2"]{background:#265587}
      .tb-cell[data-l="3"]{background:#3583d6;box-shadow:0 0 8px #3583d655}
      .tb-cell[data-l="4"]{background:#66e3ff;box-shadow:0 0 12px #66e3ff66}
      .tb-cell:hover{transform:scale(1.14)}
      .tb-foot{display:flex;align-items:center;justify-content:space-between;margin-top:13px;padding-top:11px;border-top:1px solid #ffffff0f;font-size:9px;color:#6a82a1}
      .tb-foot span{display:inline-flex;align-items:center;gap:5px}
      .tb-live-dot{width:5px;height:5px;border-radius:50%;background:#5eead4;box-shadow:0 0 6px #5eead4;animation:tb-pulse 1.6s ease-in-out infinite}
      @keyframes tb-breathe{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-1px) scale(1.06)}}
      @keyframes tb-pulse{0%,100%{opacity:.45}50%{opacity:1}}
      @keyframes tb-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
      @media(max-width:430px){.tb-card{width:calc(100vw - 16px);max-width:calc(100vw - 16px)}.tb-body{padding:12px}.tb-head{padding:13px 12px}.tb-stats{gap:5px}.tb-stat{padding:9px 7px}.tb-value{font-size:13px}.tb-hero-num{font-size:21px}.tb-spark{display:none}.tb-bars,.tb-grid,.tb-axis{height:110px}}
      @media(prefers-reduced-motion:reduce){.tb-fire,.tb-card,.tb-live-dot{animation:none}.tb-pill,.tb-bar-fill,.tb-cell,.tb-fire{transition:none}}
    `;

    function round1(n) {
      return Math.round(n * 10) / 10;
    }

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

    // Axis ticks can be fractional when the data max is tiny; keep them readable.
    function fmtTick(n) {
      const v = Number(n) || 0;
      if (v >= 10 || v === 0) return fmt(v);
      return String(round1(v));
    }

    function niceMax(value) {
      const v = Number(value) || 0;
      if (v <= 0) return 1;
      const exp = Math.floor(Math.log10(v));
      const base = Math.pow(10, exp);
      const n = v / base;
      const mult = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
      return mult * base;
    }

    function emptySnapshot() {
      return { today: 0, recent30: 0, byModel: {}, byHour: new Array(24).fill(0), days: new Array(30).fill(0), updatedAt: null };
    }

    function readPos() {
      try { return JSON.parse(localStorage.getItem(STORE)); } catch { return null; }
    }

    function savePos(p) {
      try { localStorage.setItem(STORE, JSON.stringify(p)); } catch { /* position is best effort */ }
    }

    function useReducedMotion() {
      const [reduced, setReduced] = useState(false);
      useEffect(() => {
        const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
        if (!mq) return undefined;
        setReduced(mq.matches);
        const onChange = (e) => setReduced(e.matches);
        if (mq.addEventListener) mq.addEventListener('change', onChange); else mq.addListener(onChange);
        return () => {
          if (mq.removeEventListener) mq.removeEventListener('change', onChange); else mq.removeListener(onChange);
        };
      }, []);
      return reduced;
    }

    function useEased(target, duration) {
      const ms = duration || 700;
      const goal = Number(target) || 0;
      const [value, setValue] = useState(goal);
      const from = useRef(goal);
      useEffect(() => {
        const end = Number(target) || 0;
        const start = from.current;
        const delta = end - start;
        if (!delta) { setValue(end); return undefined; }
        const t0 = performance.now();
        let raf = 0;
        const step = (t) => {
          const p = Math.min(1, (t - t0) / ms);
          const eased = 1 - Math.pow(1 - p, 3);
          const next = start + delta * eased;
          from.current = next;
          setValue(next);
          if (p < 1) raf = requestAnimationFrame(step); else from.current = end;
        };
        raf = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf);
      }, [target, ms]);
      return value;
    }

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

    // One closed teardrop tongue of a flame: base at `base`, tip leaning by `lean`.
    function teardrop(cx, base, hw, ht, lean, bulge) {
      const tipX = cx + lean;
      const tipY = base - ht;
      const side = hw * (1 + bulge * 0.22);
      return 'M' + round1(cx - hw) + ' ' + round1(base)
        + 'C' + round1(cx - side) + ' ' + round1(base - ht * 0.42)
        + ' ' + round1(tipX - hw * 0.42) + ' ' + round1(tipY + ht * 0.34)
        + ' ' + round1(tipX) + ' ' + round1(tipY)
        + 'C' + round1(tipX + hw * 0.42) + ' ' + round1(tipY + ht * 0.34)
        + ' ' + round1(cx + side) + ' ' + round1(base - ht * 0.42)
        + ' ' + round1(cx + hw) + ' ' + round1(base)
        + 'C' + round1(cx + hw * 0.45) + ' ' + round1(base + ht * 0.05)
        + ' ' + round1(cx - hw * 0.45) + ' ' + round1(base + ht * 0.05)
        + ' ' + round1(cx - hw) + ' ' + round1(base) + 'Z';
    }

    // Pre-rendered sequence frames: 5 layered tongues per frame, deterministic per index.
    function flameFrames(count) {
      const frames = [];
      for (let i = 0; i < count; i += 1) {
        const rng = makeRng(i * 2654435761 + 9871);
        const sway = rng() * 2 - 1;
        const wobble = rng() * 2 - 1;
        frames.push({
          a: teardrop(32 + wobble * 1.2, 93, 18 + rng() * 1.5, 74 + rng() * 8, sway * 6, 1.1 + rng() * 0.3),
          b: teardrop(20 + wobble * 1.4, 93, 7.5 + rng(), 34 + rng() * 10, sway * -5 - 3, 1.2),
          c: teardrop(44 + wobble * 1.4, 93, 7 + rng(), 30 + rng() * 12, sway * 5 + 3, 1.2),
          d: teardrop(32 + wobble * 0.8, 93, 11.5 + rng(), 52 + rng() * 9, sway * -4, 1.05),
          e: teardrop(32 + wobble * 0.5, 93, 6 + rng() * 0.8, 30 + rng() * 7, sway * 2, 1.05),
        });
      }
      return frames;
    }

    function Fire(props) {
      const width = props.width || 18;
      const burning = props.burning !== false;
      const reduced = useReducedMotion();
      const frames = useMemo(() => flameFrames(FRAME_COUNT), []);
      const [frame, setFrame] = useState(0);
      const active = burning && !reduced;
      useEffect(() => {
        if (!active) { setFrame(0); return undefined; }
        const id = setInterval(() => setFrame((v) => (v + 1) % frames.length), FRAME_MS);
        return () => clearInterval(id);
      }, [active, frames.length]);
      const f = frames[frame % frames.length];
      const height = Math.round(width * 1.5);
      return h('span', { className: 'tb-fire', 'data-burning': burning ? 'on' : 'off', style: { width: width, height: height }, 'aria-hidden': 'true' },
        h('svg', { viewBox: FIRE_VB, width: width, height: height, focusable: 'false' },
          h('path', { className: 'tb-fire-a', d: f.a }),
          h('path', { className: 'tb-fire-b', d: f.b }),
          h('path', { className: 'tb-fire-c', d: f.c }),
          h('path', { className: 'tb-fire-d', d: f.d }),
          h('path', { className: 'tb-fire-e', d: f.e })));
    }

    function Sparkline(props) {
      const data = Array.isArray(props.data) && props.data.length > 1 ? props.data : [0, 0];
      const max = Math.max(1, ...data);
      const n = data.length;
      const pts = data.map((v, i) => {
        const x = (i / (n - 1)) * 100;
        const y = 30 - Math.max(0, Math.min(1, (Number(v) || 0) / max)) * 26;
        return round1(x) + ' ' + round1(y);
      });
      const line = 'M' + pts.join('L');
      return h('svg', { className: 'tb-spark' + (props.small ? ' tb-spark-sm' : ''), viewBox: '0 0 100 32', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
        h('path', { className: 'tb-spark-area', d: line + 'L100 32L0 32Z' }),
        h('path', { className: 'tb-spark-line', d: line }));
    }

    function Chart(props) {
      const values = props.values;
      const top = Math.max(1, props.axisMax);
      const peak = Math.max(0, ...values);
      const ticks = [1, 0.75, 0.5, 0.25, 0];
      const axis = h('div', { className: 'tb-axis', 'aria-hidden': 'true' },
        ticks.map((k) => h('span', { className: 'tb-tick', key: 't' + k }, fmtTick(top * k))));
      const grid = h('div', { className: 'tb-grid', 'aria-hidden': 'true' },
        ticks.map((k) => h('i', { className: 'tb-gridline', key: 'g' + k, style: { bottom: round1(k * 100) + '%' } })));
      const bars = values.map((v, i) => {
        const pct = Math.min(100, Math.max(v > 0 ? 1.5 : 0, (v / top) * 100));
        return h('div', { className: 'tb-bar', key: 'b' + i, title: props.titles[i] },
          h('i', {
            className: 'tb-bar-fill',
            'data-peak': v > 0 && v === peak ? 'on' : 'off',
            style: { height: round1(pct) + '%', background: 'linear-gradient(' + PALETTE[i % PALETTE.length] + ',#4a6cff)' },
          }));
      });
      const xlabels = values.map((v, i) => h('span', { className: 'tb-xlabel', key: 'x' + i, title: props.titles[i] }, props.labels[i]));
      return h('div', { className: 'tb-chart' },
        axis,
        h('div', { className: 'tb-plot' },
          grid,
          h('div', { className: 'tb-bars', role: 'img', 'aria-label': props.ariaLabel }, bars),
          h('div', { className: 'tb-xlabels', 'aria-hidden': 'true' }, xlabels)));
    }

    function Calendar(props) {
      const heat = Array.isArray(props.days) && props.days.length === 30 ? props.days : new Array(30).fill(0);
      const maxDay = Math.max(1, ...heat.map((v) => Number(v) || 0));
      const level = (v) => (v <= 0 ? 0 : Math.min(4, 1 + Math.floor((v / maxDay) * 3.99)));
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      // Walk back with calendar arithmetic, not millisecond subtraction: a DST
      // change would otherwise land on 23:00/01:00 of an adjacent day and shift
      // both the weekday header and every cell tooltip by one day.
      const daysAgo = (n) => { const d = new Date(dayStart); d.setDate(d.getDate() - n); return d; };
      const offset = daysAgo(29).getDay();
      const cells = [];
      for (let i = 0; i < offset; i += 1) cells.push(h('i', { className: 'tb-cell', key: 'pad' + i, 'data-pad': 'on' }));
      heat.forEach((v, i) => {
        const d = daysAgo(29 - i);
        const value = Number(v) || 0;
        cells.push(h('i', {
          className: 'tb-cell',
          key: 'd' + i,
          'data-l': level(value),
          'data-pad': 'off',
          title: (d.getMonth() + 1) + '/' + d.getDate() + ' · ' + fmt(value) + ' tokens',
        }));
      });
      return h('div', null,
        h('div', { className: 'tb-cal-head', 'aria-hidden': 'true' }, WEEK.map((w) => h('i', { key: w }, w))),
        h('div', { className: 'tb-cal', role: 'img', 'aria-label': '近 30 天 Token 燃烧日历' }, cells));
    }

    function Flame() {
      const [open, setOpen] = useState(false);
      const [view, setView] = useState('model');
      const [snapshot, setSnapshot] = useState(emptySnapshot);
      const [rate, setRate] = useState(0);
      const [primed, setPrimed] = useState(false);
      const [online, setOnline] = useState(true);
      // The host only starts sending `offsetMinutes` once the timezone-aware
      // build is loaded, i.e. after a host restart. Until then the hour labels
      // still follow the host process's timezone and the UI should say so
      // instead of silently showing a wrong axis.
      const [hostPatched, setHostPatched] = useState(true);
      const [history, setHistory] = useState([0, 0]);
      const [now, setNow] = useState(() => Date.now());
      const [pos, setPos] = useState(() => readPos() || { x: null, y: null });
      const drag = useRef(null);
      const suppress = useRef(false);
      const samples = useRef([]);

      useEffect(() => {
        let alive = true;
        const pull = () => {
          // Hand the host this browser's UTC offset: day and hour buckets must
          // follow the viewer's clock, not the server process's timezone.
          let query = '';
          try { query = '?off=' + String(-new Date().getTimezoneOffset()); } catch { query = ''; }
          fetch(ENDPOINT + query, { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
              if (!alive || !d) return;
              const next = { ...emptySnapshot(), ...d };
              setHostPatched(typeof d.offsetMinutes === 'number');
              const total = Number(next.today) || 0;
              const t = Date.now();
              const list = samples.current;
              list.push({ t: t, total: total });
              while (list.length > 2 && t - list[0].t > 45000) list.shift();
              const first = list[0];
              const last = list[list.length - 1];
              const dt = (last.t - first.t) / 1000;
              const live = dt >= 2 ? Math.max(0, (last.total - first.total) / dt) : 0;
              if (list.length >= 3) setPrimed(true);
              setRate((prev) => (live > 0 ? (prev > 0 ? prev * 0.55 + live * 0.45 : live) : prev * 0.55));
              setSnapshot(next);
              setOnline(true);
              setHistory((prev) => prev.concat([live]).slice(-HISTORY));
            })
            .catch(() => {
              if (!alive) return;
              // Without fresh polls we must not keep claiming an average-based
              // "burning" state; stop the daily-average fallback too.
              setPrimed(true);
              setOnline(false);
            });
        };
        pull();
        const id = setInterval(pull, POLL_MS);
        return () => { alive = false; clearInterval(id); };
      }, []);

      useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
      }, []);

      useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, []);

      const total = Number(snapshot.today) || 0;
      const recent30 = Number(snapshot.recent30) || 0;
      const dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);
      const seconds = Math.max(60, (now - dayStart.getTime()) / 1000);
      const dailyAvg = total / seconds;
      const liveRate = rate > 0.01 ? rate : (primed ? 0 : dailyAvg);
      const burning = liveRate > 0.01;
      // Huge ratios (a burst against a whole-day average) are meaningless as a
      // percentage; show a multiple instead so the chip stays readable.
      const ratio = dailyAvg > 0 ? liveRate / dailyAvg : 1;
      const deltaPct = Math.round((ratio - 1) * 100);
      const trend = ratio >= 10
        ? '× ' + (ratio >= 100 ? String(Math.round(ratio)) : ratio.toFixed(1))
        : (deltaPct >= 0 ? '▲ ' : '▼ ') + Math.abs(deltaPct) + '%';

      const modelNames = Object.keys(snapshot.byModel || {}).length ? Object.keys(snapshot.byModel) : FALLBACK_MODELS;
      const modelValues = modelNames.map((m) => Number(snapshot.byModel ? snapshot.byModel[m] : 0) || 0);
      const hourValues = Array.isArray(snapshot.byHour) && snapshot.byHour.length === 24 ? snapshot.byHour.map((v) => Number(v) || 0) : new Array(24).fill(0);
      const rawValues = view === 'model' ? modelValues : hourValues;
      const axisTarget = niceMax(Math.max(1, Math.max(0, ...rawValues) * 1.25) / 4) * 4;
      const axisMax = useEased(axisTarget, 900);
      const easedToday = useEased(total, 800);
      const easedRecent = useEased(recent30, 800);

      const startDrag = (e) => {
        if (e.button !== 0) return;
        // A stale suppress flag from a drag that ended outside the dock must not
        // swallow the next genuine click.
        suppress.current = false;
        const ox = pos.x;
        const oy = pos.y;
        drag.current = { sx: e.clientX, sy: e.clientY, ox: ox, oy: oy, moved: false };
        const move = (ev) => {
          const d = drag.current;
          if (!d) return;
          const dx = ev.clientX - d.sx;
          const dy = ev.clientY - d.sy;
          if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
          if (!d.moved) return;
          setPos({
            x: (d.ox == null ? window.innerWidth - 440 : d.ox) + dx,
            y: (d.oy == null ? window.innerHeight - 90 : d.oy) + dy,
          });
        };
        const up = () => {
          const moved = !!drag.current && drag.current.moved;
          drag.current = null;
          suppress.current = moved;
          if (moved) setPos((p) => { savePos(p); return p; });
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      };

      const openCard = () => {
        if (suppress.current) { suppress.current = false; return; }
        setOpen(true);
      };

      const style = pos.x == null
        ? { right: 18, bottom: 18 }
        : { left: Math.max(8, Math.min(pos.x, window.innerWidth - 430)), top: Math.max(8, Math.min(pos.y, window.innerHeight - 110)) };

      const stat = (label, value, unit) => h('div', { className: 'tb-stat' },
        h('div', { className: 'tb-label' }, label),
        h('div', { className: 'tb-value' }, value, unit ? h('i', null, unit) : null));

      const labels = view === 'model'
        ? modelNames.map((m) => (m.length > 14 ? m.slice(0, 13) + '…' : m))
        : hourValues.map((v, i) => (i % 3 === 0 ? String(i).padStart(2, '0') : ''));
      const titles = view === 'model'
        ? modelNames.map((m, i) => m + ' · ' + fmt(modelValues[i]) + ' tokens')
        : hourValues.map((v, i) => String(i).padStart(2, '0') + ':00 · ' + fmt(v) + ' tokens');

      const content = h('div', { className: 'tb-body' },
        h('div', { className: 'tb-hero' },
          h(Fire, { width: 34, burning: burning }),
          h('div', { className: 'tb-hero-main' },
            h('div', { className: 'tb-hero-num' }, fmtRate(liveRate), h('span', null, 'token/s')),
            h('div', { className: 'tb-hero-meta' },
              h('span', { className: 'tb-chip', title: '相对今日每秒平均' }, trend),
              h('span', { className: 'tb-hero-note' }, burning ? '熊熊燃烧中' : '已熄灭 · 暂无新增燃烧'))),
          h(Sparkline, { data: history })),
        h('div', { className: 'tb-stats' },
          stat('今日燃烧', fmt(easedToday), 'tokens'),
          stat('近 30 天', fmt(easedRecent), 'tokens'),
          stat('今日均值', fmtRate(dailyAvg), 'token/s')),
        h('div', { className: 'tb-tabs', role: 'tablist', 'aria-label': '数据视图' },
          h('button', { className: 'tb-tab', role: 'tab', type: 'button', 'aria-selected': view === 'model', 'data-on': view === 'model' ? 'on' : 'off', onClick: () => setView('model') }, '按模型'),
          h('button', { className: 'tb-tab', role: 'tab', type: 'button', 'aria-selected': view === 'hour', 'data-on': view === 'hour' ? 'on' : 'off', onClick: () => setView('hour') }, '按小时')),
        h('div', { className: 'tb-chart-title' },
          h('strong', null, view === 'model' ? '模型占比' : '每小时活动'),
          h('span', { title: hostPatched ? '按浏览器时区分桶' : 'Host 仍在运行旧版本：小时标签按 Host 进程时区，重启后自动按浏览器时区重算' },
            view === 'model' ? '今日实时' : (hostPatched ? '今日 24 小时' : '今日 24 小时 · 待重启校准'))),
        h('div', { className: 'tb-legend' },
          modelNames.slice(0, 5).map((m, i) => h('div', { className: 'tb-model', key: 'lg' + m },
            h('i', { className: 'tb-dot', style: { background: PALETTE[i % PALETTE.length], color: PALETTE[i % PALETTE.length] } }),
            m))),
        h(Chart, {
          values: rawValues,
          labels: labels,
          titles: titles,
          axisMax: axisMax,
          ariaLabel: view === 'model' ? '按模型 Token 使用量，纵轴随燃烧升高' : '按小时 Token 使用量，纵轴随燃烧升高',
        }),
        h('div', { className: 'tb-section' }, h('strong', null, '近一个月燃烧日历'), h('span', null, '少 · 多')),
        h(Calendar, { days: snapshot.days }),
        h('div', { className: 'tb-foot' },
          h('span', null, h('i', { className: 'tb-live-dot' }), online ? '数据随会话实时更新' : '连接中断，重试中'),
          h('span', null, '每秒刷新')));

      const card = h('section', { className: 'tb-card', 'aria-label': 'Token 燃烧指数详情' },
        h('div', { className: 'tb-head', onMouseDown: startDrag },
          h(Fire, { width: 17, burning: burning }),
          h('div', { className: 'tb-title' }, 'Token 燃烧指数'),
          h('span', { className: 'tb-sub', 'aria-label': '实时状态' }, online ? 'LIVE' : 'OFFLINE'),
          h('button', { className: 'tb-btn', type: 'button', onMouseDown: (e) => e.stopPropagation(), onClick: () => setOpen(false), 'aria-label': '收起 Token 燃烧指数' }, '×')),
        content);

      const pill = h('button', {
        className: 'tb-pill',
        type: 'button',
        'data-burning': burning ? 'on' : 'off',
        onMouseDown: startDrag,
        onClick: openCard,
        'aria-label': '展开 Token 燃烧指数：' + (burning ? '燃烧中 ' : '已熄灭 ') + fmtRate(liveRate) + ' token/s，今日 ' + fmt(total),
      },
        h(Fire, { width: 19, burning: burning }),
        h('span', { className: 'tb-hot' }, burning ? '燃烧中' : '已熄灭'),
        h('span', { className: 'tb-rate' },
          h('b', null, fmtRate(liveRate)),
          h('span', { className: 'tb-unit' }, 'token/s')),
        h(Sparkline, { data: history, small: true }),
        h('span', { className: 'tb-sep' }),
        h('span', { className: 'tb-group' },
          h('span', { className: 'tb-gk' }, '今日'),
          h('span', { className: 'tb-gv' }, fmt(total))));

      return h('div', { style: { position: 'fixed', ...style, zIndex: 90 }, 'data-token-burn': true },
        h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
        open ? card : pill);
    }

    function apply(ctx) {
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dsh-token-burned', order: 92 }, Flame));
    }

    return { apply, inject: ['slots'] };
  },
});
