# dsh-plugin-token-burned

![Token Burn Dock — real runtime screenshots](https://raw.githubusercontent.com/yuna78/dsh-plugin-token-burned/main/docs/preview-real.webp)

> 上图说明：左侧为展开面板，右侧为最小化胶囊。

[English](README.en.md)

> 把每一次模型调用变成可见的“热量”：看见谁在烧、什么时候烧、今天烧了多少。

[安装插件](https://github.com/yuna78/dsh-plugin-token-burned/releases/latest) · [提交反馈](https://github.com/yuna78/dsh-plugin-token-burned/issues)

DSH 的悬浮 Token 燃烧指数 Dock：把全部 session 的 Token 使用量汇总成一个轻量的实时面板。

## 功能

- 收起胶囊：显示**当前火候档位**（星火 / 小火 / 中火 / 大火 / 烈火 / 火海 / 爆燃）或 `已熄灭`，附实时燃烧速率（含 `token/s` 单位）、**内嵌近 60 秒速率曲线**、今日总 Token
- 实时速率来自轮询差值的 45 秒滑动窗口，并做指数平滑；余额不变时自然衰减到 0
- 火焰分**7 档火候**：每档都是独立的 16 帧程序生成 SVG 序列，各有自己的配色、发光、闪烁速度与火舌布局，无图片资源
- 配色随档位递进：蓝 → 青 → 靛/白 → 紫 → 品红 → 金
- 火焰只在**有燃烧**时播放；没有新增燃烧时熄灭为静态灰色图标
- 档位**升快降慢**（升约 0.3s、降约 0.9s），避免速率抖动时火焰反复跳档
- 胶囊描边、火焰光晕与卡面光晕随档位染色；展开面板新增 **7 段火候进度条**与该档位的一句文案
- 展开视图：按模型 / 按小时切换
- 顶部 Hero：大号实时速率、相对日均的涨跌 chip、近 60 秒速率 sparkline
- 图表带左侧纵轴刻度，刻度数值随数据最大值缓动**升高**，柱体高度平滑过渡
- 近 30 天热力图按真实星期对齐，色阶按相对强度归一
- LIVE / OFFLINE 状态、`prefers-reduced-motion` 支持（后者不播放帧，火焰定格在当前档位）
- Dock 可拖动并保存位置；拖动超过 4px 不会误触展开

### 火候档位

档位直接按**实时速率**（`token/s`）的绝对阈值判定，速率稳定可预期——2 万/s 左右是火海，5 万/s 以上才是爆燃。

实时速率统计的是 provider usage 的**全量 token**：**输入 + 缓存读/写 + 输出**一起算。缓存读通常占大头，所以一次正常编码会话就会跑到 1–3 万 `token/s`，这不是异常。7 档燃烧 + `已熄灭`：

| 档位 | 实时速率（token/s） | 火焰 | 一句文案 |
| --- | --- | --- | --- |
| 1 星火 | < 100 | 单苗小焰，慢闪 | 一星火苗，刚点着 |
| 2 小火 | 100 – 500 | 火苗 + 内芯 | 小火慢烧，稳稳的 |
| 3 中火 | 500 – 2,000 | 双舌外焰 | 火势上来了 |
| 4 大火 | 2,000 – 3,000 | 三层火舌 + 高光内焰 | 三丛火舌，呼呼作响 |
| 5 烈火 | 3,000 – 9,000 | 宽火团 + 多舌 | 一团烈火，烧穿屏幕 |
| 6 火海 | 9,000 – 50,000 | 三簇并列 + 底部火墙 + 余烬 | 好多丛火，连成一片 |
| 7 爆燃 | ≥ 50,000 | 满宽火墙 + 多舌 + 余烬 | 整面火墙，全屏爆燃 |

没有新增燃烧时显示 `已熄灭`（静态灰色图标）。

![7 档火候联系表：胶囊 19px 火焰 / 展开面板 34px 火焰 / 真实 420px 面板](https://raw.githubusercontent.com/yuna78/dsh-plugin-token-burned/main/docs/preview-tiers.webp)

> 联系表由 `npm run preview` 离线生成，直接调用真实 `client.js` 的绘图层；19px 是胶囊里的真实火焰尺寸（展开面板 34px），无图片资源。

## 数据说明

统计范围为当前 DSH Host 中可观察到的**全部 session**。数据来自 `assistant/message` 的 provider usage：输入、缓存读写和输出 Token。没有可用 usage 时不会伪造账单数据。

- **"今日"与"某小时"按浏览器时区分桶**：客户端把自身 UTC 偏移（`?off=`，分钟）传给 Host，Host 用固定偏移计算日/小时边界。这样即使 Host 进程跑在 UTC 下，柱子也不会落到错误的小时标签上（历史 bug：Host 用 `getHours()` 按进程时区分桶，与浏览器标签不一致）。
- **持久化是原子的**：状态写入 `storages/dsh-token-burned.json`（先写 `.tmp` 再 `rename`），且**写入前一定等待历史加载完成**。旧实现存在竞态：重启后新进程若先写入，会用仅含最新事件的 Map 覆盖整个文件，导致历史被清空。
- 记录保留 31 天，读取时按 30 天窗口聚合；更早的条目会在加载时清理。

## 安装

在 DSH 的插件安装界面搜索：

```text
dsh-plugin-token-burned
```

## 开发

```bash
npm install
npm test
```

### 回填历史用量

0.2.0 之前的版本每次重启都会丢状态文件，历史天数因此缺失。可以一次性从本机会话日志里补回来：

```bash
npm run backfill            # 只报告（默认 dry-run）
npm run backfill -- --write # 写基线文件，然后重启 DSH
```

它只写 `~/.dsh/storages/dsh-token-burned.baseline.json`（约 30 个数字，不到 1 KB），不碰状态文件；今天的数据始终来自实时事件，不会被回填覆盖。

## License

MIT
