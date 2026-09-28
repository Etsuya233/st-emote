# 通用开发资料

本文件入库跟踪，存放**跨设备通用**的开发资料：换一台机器 clone 下来后，靠这份文件就能接上项目。

只在本机有效、不应入库的内容（个人路径、密钥、临时环境配置）请写进 `local_dev.md`，它已被 `.gitignore` 忽略。

## 项目速览

- **名称**：st-emote
- **形态**：SillyTavern 扩展
- **一句话**：模型在回复里用标记指名表情，扩展把标记渲染成表情图片。
- **当前阶段**：票 01（闭环：一张表情能在消息里出现）、票 02（语法、约束、处理范围）、票 03（生效集与宏）、票 04（投放方式与尺寸）、票 05（旧版本兼容路径与产出统一）、票 06（存储与生命周期）与票 07（调试工具、操作入口、本地化与文档）已实现；后续票据见 `.scratch/st-emote/issues/`。

相关文档：

- 术语表：`CONTEXT.md`（全文以此为准）
- 需求规格：`.scratch/st-emote/spec.md`
- 关键取舍：`docs/adr/`
- 实施票据：`.scratch/st-emote/issues/`

## 仓库

- **远程**：https://github.com/Etsuya233/st-emote.git
- **默认分支**：`main`

## 协作约定

- 提交信息使用 Conventional Commits（`<type>[scope]: <description>`）。
- Agent 相关约定见 `AGENTS.md`，全局规则见 `~/.agents/AGENTS.md`。
- Issues 与 specs 以 markdown 形式放在 `.scratch/<feature-slug>/` 下。
- 业务术语在 `CONTEXT.md` 里定义，代码与文档都沿用其中的词。

## 常用命令

```bash
git clone https://github.com/Etsuya233/st-emote.git
git fetch origin
git switch main
git pull --ff-only
```

## 开发与运行

扩展没有构建步骤：SillyTavern 直接以静态站点形式加载仓库根目录里的 `manifest.json`、`index.js` 与 `style.css`。

把本仓库链到 SillyTavern 的第三方扩展目录，重启客户端即可在扩展列表里看到：

```bash
# Windows（以管理员或普通用户执行均可，Junction 不需要管理员权限）
powershell -NoProfile -Command "New-Item -ItemType Junction -Path '<SillyTavern>/public/scripts/extensions/third-party/st-emote' -Target '<本仓库路径>'"
```

本机实际路径见 `local_dev.md`。

### 代码布局

- `core/`：纯核心，不依赖 ST、不依赖 DOM，可直接用 node 运行。标记解析、生效集解析、渲染拼装、投放方式与尺寸求值、处理范围规则都在这里；票 06 起还有图片规则（`image-rules.js`）、表情库生命周期（`catalogue.js`）、表情包的读法与搜索（`library.js`）与导出包的**包清单**格式（`manifest.js`）；票 07 起还有界面文案目录（`i18n.js`）、冲突检测（`conflict.js`）与「试渲染」（`preview.js`）。
- `adapter/`：ST 适配层，只做搬运（读写设置、上传、设置面板、把核心结果送进 DOM）。两条渲染路径：`rendering.js` 是旧版 DOM 路径，`hook.js` 是新版官方钩子路径，`render-path.js` 负责二选一（钩子装不上就回落 DOM 路径），`render-common.js` 是两条路径共用的一层，`restore.js` 管关闭扩展时的还原。票 06 起：`upload.js` 是三个图片接口的调用（上传 / 删除 / 列出）加上「这条拒绝理由怎么跟用户说」这一句话；`archive.js` 负责 zip 字节的读写；`sizing-panel.js` 是投放方式与两套尺寸集的控件；`dialogs.js` 是 toast / 确认 / 输入框 / 剪贴板，每一项都有客户端 API 优先、浏览器 API 兜底两条路。票 07 起：`locale.js` 是「客户端是哪种语言」这**一个**事实（其余全交给 `core/i18n.js`）；`log.js` 是唯一的控制台出口（`LOG_PREFIX` 与 `logInfo`），`render-common.js` 只是把它转发出去；`commands.js` 注册 `/st-emote`；`debug-panel.js` 是调试区（试渲染 + 重新渲染）。`ui.js` 只剩表情包的列表与行。
- `tests/`：纯核心测试 + 共享契约 + 两条适配层的对照与生命周期测试 + 面板与压缩包的集成测试。

### 图片的存储与生命周期（票 06）

- 上传走 `POST /api/images/upload`，文件名 `st-emote-<stickerId>`，目录 `user/images/st-emote/`。删除走 `POST /api/images/delete`，缺图检测走 `POST /api/images/list`（一次列出目录，比逐个探测便宜）。
- **归属判定只有一条依据**：目录 + `st-emote-` 前缀（`isOwnImagePath`）。删除前一律先过它——目录是别的特性的，绝不删不是自己创建的文件。
- 「一张图只被一个表情用」是上面那条命名的推论，没有单独实现。
- 缺图的检测时机：面板挂载时取一次目录列表，之后在上传 / 删除 / 导入之后刷新。取不到列表时**不**报缺图（宁可不说，也不把整个库标灰）。外链不参与判定——它不是本机的文件。
- 压缩包读写用 ST 自带的 `/lib/jszip.min.js`（`await import()` 装全局），**运行时不新增依赖**。**包清单**（导出包里的 `st-emote.json`，注意与 `CONTEXT.md` 里的「清单 / Listing」是不同词：那个是宏输出）的校验在 `core/manifest.js`，压缩包是外来输入，一条不过就整包拒收——**包括图片格式与体积**：导入走的是同一套 `core/image-rules.js` 规则，不是一个绕过它们的洞。

### 两条渲染路径（ADR-0002）

- ST ≥ 1.19.0：`messageFormatter.addHook`，阶段 `afterMarkdown`，早于净化。发出的类名是**不带前缀**的 `st-emote`，由 ST 净化时补上 `custom-`。
- ST 1.15.0–1.18.x：DOM 后处理，直接发 `custom-st-emote`。
- 两者最终落在同一个类名、同一组 `data-*`、同一份 `style.css` 上；`core/render.js` 里 `STICKER_CLASS` 由 `STICKER_HOOK_CLASS` 派生，两边不会漂移。
- 装哪一条由特性探测决定（`messageFormatter.addHook` 是否存在），**只装一条**。

### 测试

```bash
npm install      # 仅测试需要：装 devDependency jsdom
npm test         # node --test，发现并运行 tests/*.test.js
```

- **依赖**：测试需要 `npm install`（`jsdom` 是 devDependency，扩展本身不依赖它，也没有构建步骤）。`core/` 仍然不依赖 ST、不依赖 DOM，可以直接用 node 跑；但测试夹具里有 DOM，所以纯核心的测试也经由 `jsdom`。
- 纯核心与契约：`tests/render-contract.test.js`（类名派生、标记重建、处理范围规则）。
- **两条路径的对照**：`tests/render-paths.test.js`。两侧都驱动**真实的适配层**——钩子路径走一个录制的 `messageFormatter`，DOM 路径走真的 jsdom 聊天——再把两边结果交给同一个 `assertRendersAs` 和同一份期望表。这才是 ADR-0002 那句话的守门人；拿纯核心跟它自己比什么也证明不了。
- 共享的断言契约在 `tests/contract/render-contract.js`：只断言最终 DOM 的结构、类名、`data-*` 与尺寸样式，不断言实现方式。里面 `applySanitizerClassPrefix` 是**唯一**模拟的客户端行为（净化补 `custom-` 前缀），需要在 1.19+ 上目视核对。
- 路径与生命周期：`tests/dom-path.test.js`、`tests/hook-path.test.js`、`tests/entry.test.js`。`tests/contract/st-dom.js` 只伪造客户的接口面（`getContext`、事件总线、`updateMessageBlock`、图片端点的 `fetch`），DOM 本身是真的。
- 票 06 的纯核心：`tests/image-rules.test.js`、`tests/catalogue.test.js`、`tests/manifest.test.js`、`tests/library.test.js`。
- 票 06 的适配层：`tests/panel.test.js`（真 jsdom 面板，驱动真实的 `adapter/ui.js`）与 `tests/archive.test.js`（真 zip 往返）。两者共用 `tests/contract/st-dom.js` 里的 `withJsZip`——它用 **devDependency `jszip`** 装出那个全局，**没有任何 skip 路径**：一套会静默跳过的导出/导入测试，等于一次什么都不证明的绿色 `npm test`。运行时仍然读客户自带的 `/lib/jszip.min.js`。
- 票 07 的纯核心：`tests/i18n.test.js`（两份目录键集对齐、回退、无标记、单复数）、`tests/conflict.test.js`（冲突检测与清单）、`tests/preview.test.js`（粘一段 → HTML、未命中的理由）。
- 票 07 的适配层：`tests/commands.test.js`（驱动真实的 `runCommand`；注册本身只查客户端有没有那几个类）、`tests/panel.test.js` 里新加的几条（整个面板是否双语、用户输入是否只当文本、试渲染不碰聊天、重渲染按钮）。
- 仍然只能在真实 ST 里验收的：流式生成时的即时出图、面板观感、净化是否保留图上的 `style` 属性、净化是否给两个类名都补上 `custom-` 前缀、**ST 切换语言后面板是否跟着变**（ST 自己会刷新页面，扩展只读一次语言）。

### 界面文案与日志（票 07）

- **所有用户可见文案只有一处**：`core/i18n.js` 的 `EN` / `ZH_CN` 两份目录 + 纯函数 `t(key, locale, values)`。适配层只提供 locale 字符串（`adapter/locale.js`），连宏的说明文字也走同一份目录。新增文案**必须**两边同时加：`tests/i18n.test.js` 的键集对齐会挂。
- 目录值**不带标记**（有测试守着），所以面板的固定骨架用 `innerHTML`、其余一律 `textContent`。用户输入（包名、搜索词、文件名）只进 `textContent`。
- `zh-cn` 之外的 `zh-*` 变体（`zh-tw` / `zh-hant` / `zh-hk`）**故意回落英文**——给繁体用户简体不如给他能读的英文。
- **控制台只有一个出口**：`adapter/log.js` 的 `LOG_PREFIX`（`[st-emote]`）与 `logInfo()`。未命中、冲突、非法尺寸、以及「调试区渲染了一次」都走它。**界面里没有日志面板**（spec「Out of Scope」）。
- `importFailureMessage(reason, locale)` 现在是目录查询而不是 switch：每种拒绝理由都要有一句 `import.reason.<reason>`，`tests/manifest.test.js` 会把 `parseManifest` / `planImport` 的全部理由跑一遍。

## 待补充

- 票 07 之后若再开票，先更新本文件与 `README.md`（README 已覆盖安装、三层作用域、宏、这条边界、最低 ST 版本）
- 参考资料链接（SillyTavern 扩展开发文档等）
