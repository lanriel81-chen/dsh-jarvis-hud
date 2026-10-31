# J.A.R.V.I.S. HUD

钢铁侠贾维斯风格的 DeepSeek Harness 界面插件：开机自检动画、常驻 HUD、语音提示，以及对话区的粒子效果。

A J.A.R.V.I.S.-style interface plugin for the DeepSeek Harness Web UI: a boot self-check sequence, a persistent corner HUD, spoken status lines, and a particle field behind the conversation.

## 功能

**启动校验**：每次新会话首次打开时播放，7 步分步校验（链路握手 → 身份核验 → 访问许可 → 记忆索引 → 检索链路 → 会话总线 → 认知核心），每步有「扫描中 → OK」两态，全部通过后显示 `ACCESS GRANTED`。按 `Esc` 或点击任意位置可跳过。

**常驻 HUD**：屏幕四角的科技感角标、状态胶囊（`IDLE` / `RETRIEVAL` / `ACCESSING` / `ANOMALY`）、字幕条。

**语音**：使用浏览器内置 `speechSynthesis`，覆盖五个时机——启动、模型思考、工具调用、回答完成、出错。语速、音色、语言可调，一个静音键，选择会被记住。

**粒子**：对话区中央的粒子尘环，模型生成时整体变亮、转得更快；单个粒子有各自的闪烁周期，不会整齐划一地闪。

**玻璃质感**：输入框和侧栏「新会话」按钮带半透明折射与镜面高光。

**主题**：冰蓝色深色调（`#0c1a24` 底 + `#4fd8ff` 主色），通过 `body` 上的令牌覆盖实现，重载自动重建。

## 安装

插件以 Harness 的 bundle 形式加载，需要先装进 profile。

1. 把整个目录放到本机任意位置，例如 `D:\plugins\jarvis-hud`。

2. 在 profile 的 `package.json` 里加依赖：

   ```jsonc
   {
     "dependencies": {
       "@local/jarvis-hud": "link:D:/plugins/jarvis-hud"
     },
     "dsh": {
       "profile": {
         "bundles": ["@local/jarvis-hud"]
       }
     }
   }
   ```

   profile 目录通常在 `C:\Users\<你>\.dsh\profiles\desktop`。

3. 装依赖并重启：

   ```sh
   cd C:\Users\<你>\.dsh\profiles\desktop
   pnpm install
   ```

4. 重新打开 DeepSeek Harness。

## 卸载

从 profile 的 `dependencies` 和 `dsh.profile.bundles` 里移除 `@local/jarvis-hud`，然后 `pnpm install` 并重启。

不想卸载只想关掉的话，打开界面里的 J.A.R.V.I.S. 控制面板（右下角模式按钮），把 `PLUGIN` 切成 OFF。右下角会留一个小的 `J` 按钮用来恢复。

## 设置

| 项 | 说明 |
| --- | --- |
| `PLUGIN` | 总开关 |
| `VOICE` | 静音/取消静音 |
| `LANGUAGE` | 语音语言 |
| `SPEAKER` | 语音音色 |
| `RATE` | 语速 |
| `THEME` | 冰蓝配色开关 |
| `HUD` | 四角角标 |
| `BOOT` | 启动动画开关 |
| `BOOT LENGTH` | 启动动画时长 |
| `REPLAY BOOT SEQUENCE` | 重播一次启动动画 |

设置存在 `localStorage` 的 `jarvis-hud:settings` 键下。启动动画每个浏览器会话只播放一次（`sessionStorage` 的 `jarvis-hud:booted`）。

## 结构

```
index.js           Host 半边，只负责让 bundle 有一条 Loader 记录
client.js          Client 半边，全部界面、语音、主题逻辑
cordis.patch.yml   bundle 的 Loader 插入行
locale/en.json     界面文案（英文）
locale/zh.json     界面文案（中文）
icon.svg           插件图标
```

## 已知限制

- 第三方主题 id 无法穿过 Harness 的内置设置 schema 持久化，所以主题偏好钉在内置的 `dark`，冰蓝调子由运行时注入的样式层提供。
- 玻璃质感的两个目标元素按结构定位（`data-input-scroll` 属性、按文本匹配），应用改版后可能需要跟着调整。
- 桌面壳的窗口按钮区颜色由主进程决定，插件只能通过测量侧栏底色间接影响它。

## License

MIT