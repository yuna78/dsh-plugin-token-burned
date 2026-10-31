# dsh-plugin-token-burned

![Token Burn Dock — real runtime screenshots](https://raw.githubusercontent.com/yuna78/dsh-plugin-token-burned/main/docs/preview-real.webp)

> 上图说明：左侧为展开面板，右侧为最小化胶囊。

[English](README.en.md)

> 把每一次模型调用变成可见的“热量”：看见谁在烧、什么时候烧、今天烧了多少。

[安装插件](https://github.com/yuna78/dsh-plugin-token-burned/releases/tag/v0.1.0) · [提交反馈](https://github.com/yuna78/dsh-plugin-token-burned/issues)

DSH 的悬浮 Token 燃烧指数 Dock：把全部 session 的 Token 使用量汇总成一个轻量的实时面板。

## 功能

- 收起胶囊：`燃烧中 / 已熄灭` + 实时燃烧速率（含 `token/s` 单位）、**内嵌近 60 秒速率曲线**、今日总 Token
- 实时速率来自轮询差值的 45 秒滑动窗口，并做指数平滑；余额不变时自然衰减到 0
- 火焰为**序列帧动画**：16 帧程序生成的 SVG 火焰（蓝→青→白五层舌焰），无图片资源
- 火焰只在**有燃烧**时播放；速率为 0 时熄灭为静态灰色图标
- 展开视图：按模型 / 按小时切换
- 顶部 Hero：大号实时速率、相对日均的涨跌 chip、近 60 秒速率 sparkline
- 图表带左侧纵轴刻度，刻度数值随数据最大值缓动**升高**，柱体高度平滑过渡
- 近 30 天热力图按真实星期对齐，色阶按相对强度归一
- LIVE / OFFLINE 状态、`prefers-reduced-motion` 支持
- Dock 可拖动并保存位置；拖动超过 4px 不会误触展开

## 数据说明

统计范围为当前 DSH Host 中可观察到的**全部 session**。数据来自 `assistant/message` 的 provider usage：输入、缓存读写和输出 Token。没有可用 usage 时不会伪造账单数据。

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

## License

MIT
