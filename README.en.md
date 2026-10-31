# dsh-plugin-token-burned

![Token Burn Dock — real runtime screenshots](https://raw.githubusercontent.com/yuna78/dsh-plugin-token-burned/main/docs/preview-real.webp)

> Screenshot key: expanded panel on the left; minimized capsule on the right.

A floating Token Burn Dock for DeepSeek Harness (DSH). It summarizes observable usage across all sessions in a compact live panel.

## Features

- Collapsed capsule: `burning / extinguished` state, live burn rate **with a `token/s` unit**, an **inline 60-second rate curve**, and today's total
- Live rate is derived from poll deltas over a 45-second sliding window with exponential smoothing; it decays to 0 when nothing is burning
- The flame is a **sequence-frame animation**: 16 procedurally generated SVG frames (five layered tongues, blue → cyan → white), no image assets
- The flame only animates while tokens are burning; at rate 0 it turns into a static, desaturated icon
- Expanded model and hourly views
- Hero row: large live rate, a chip comparing it to today's average, and a 60-second rate sparkline
- Chart with a real left Y axis whose tick labels ease **upward** as the data max grows, plus smoothly transitioning bars
- 30-day heatmap aligned to real weekdays with relative-intensity levels
- LIVE / OFFLINE status and `prefers-reduced-motion` support
- Draggable dock with saved position; a drag over 4px no longer triggers expand

## Data

The plugin aggregates observable `assistant/message` provider usage across all sessions. Totals include input, cache read/write, and output tokens. It never fabricates billing data when usage is unavailable.

## License

MIT
