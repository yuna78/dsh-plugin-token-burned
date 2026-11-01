# dsh-plugin-token-burned

![Token Burn Dock — real runtime screenshots](https://raw.githubusercontent.com/yuna78/dsh-plugin-token-burned/main/docs/preview-real.webp)

> Screenshot key: expanded panel on the left; minimized capsule on the right.

A floating Token Burn Dock for DeepSeek Harness (DSH). It summarizes observable usage across all sessions in a compact live panel.

## Features

- Collapsed capsule: shows the **current burn tier** (星火 / 小火 / 中火 / 大火 / 烈火 / 火海 / 爆燃) or `已熄灭`, plus the live burn rate **with a `token/s` unit**, an **inline 60-second rate curve**, and today's total
- Live rate is derived from poll deltas over a 45-second sliding window with exponential smoothing; it decays to 0 when nothing is burning
- The flame comes in **7 burn tiers**: every tier is its own 16-frame procedurally generated SVG sequence with its own palette, glow, flicker speed and tongue layout; no image assets
- Palettes ramp with the tiers: blue → cyan → indigo/white → violet → magenta → gold
- The flame only animates while tokens are burning; with no new burn it settles into a static, desaturated icon
- Tiers **rise fast and fall slow** (~0.3s up, ~0.9s down) so a jittery rate cannot make the flame hop between tiers
- The capsule border, flame glow and card glow are tinted by tier; the expanded card gains a **7-segment burn-tier progress bar** and the tier's one-line copy
- Expanded model and hourly views
- Hero row: large live rate, a chip comparing it to today's average, and a 60-second rate sparkline
- Chart with a real left Y axis whose tick labels ease **upward** as the data max grows, plus smoothly transitioning bars
- 30-day heatmap aligned to real weekdays with relative-intensity levels
- LIVE / OFFLINE status and `prefers-reduced-motion` support (no frame playback; the flame freezes at the current tier)
- Draggable dock with saved position; a drag over 4px no longer triggers expand

### Burn tiers

Tiers are picked by **absolute `token/s` cut-offs** — the rate is stable and predictable: around 20k/s is 火海 (Inferno), and only 50k/s and up is 爆燃 (Detonation).

The live rate counts **all provider-usage tokens**: **input + cache read/write + output**. Cache reads usually dominate, so a normal coding session already runs at 10k–30k `token/s` — that is not an anomaly. 7 burning tiers plus `已熄灭`:

| Tier | Live rate (token/s) | Flame | One-liner |
| --- | --- | --- | --- |
| 1 星火 (Spark) | < 100 | single small tongue, slow flicker | 一星火苗，刚点着 — a lone spark, just lit |
| 2 小火 (Low) | 100 – 500 | tongue + inner core | 小火慢烧，稳稳的 — a low, steady burn |
| 3 中火 (Medium) | 500 – 2,000 | twin outer tongues | 火势上来了 — it's building up |
| 4 大火 (High) | 2,000 – 3,000 | three tongue layers + bright inner flame | 三丛火舌，呼呼作响 — three tongues roaring |
| 5 烈火 (Blaze) | 3,000 – 9,000 | wide fire body + many tongues | 一团烈火，烧穿屏幕 — a blaze burning through the screen |
| 6 火海 (Inferno) | 9,000 – 50,000 | three clusters + bottom fire wall + embers | 好多丛火，连成一片 — clusters merging into one |
| 7 爆燃 (Detonation) | ≥ 50,000 | full-width fire wall + many tongues + embers | 整面火墙，全屏爆燃 — the whole screen detonates |

With no new burn it shows `已熄灭` (a static, desaturated icon).

![Seven burn tiers contact sheet: 19px capsule flames, 34px expanded-panel hero flames, and real 420px panels](https://raw.githubusercontent.com/yuna78/dsh-plugin-token-burned/main/docs/preview-tiers.webp)

> Generated offline by `npm run preview` from the real `client.js` art layer (no image assets); 19px is the actual capsule size.

## Data

The plugin aggregates observable `assistant/message` provider usage across all sessions. Totals include input, cache read/write, and output tokens. It never fabricates billing data when usage is unavailable.

- **"Today" and "which hour" follow the browser's timezone.** The client passes its UTC offset (`?off=`, minutes) to the host, which buckets days and hours with that fixed offset. A host process running under `TZ=UTC` used to bucket by its own `getHours()`, so bars landed under the wrong hour labels.
- **Persistence is atomic and load-ordered.** State lives in `storages/dsh-token-burned.json` (write `.tmp`, then `rename`), and a write always waits for history to finish loading. The old code could have a restarted process overwrite the file with a Map that held only the newest event, wiping all earlier records.
- Entries are retained for 31 days and aggregated over a 30-day window; anything older is pruned at load time.

## License

MIT
