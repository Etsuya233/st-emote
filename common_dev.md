# 通用开发资料

本文件入库跟踪，存放**跨设备通用**的开发资料：换一台机器 clone 下来后，靠这份文件就能接上项目。

只在本机有效、不应入库的内容（个人路径、密钥、临时环境配置）请写进 `local_dev.md`，它已被 `.gitignore` 忽略。

## 项目速览

- **名称**：st-emote
- **形态**：SillyTavern 扩展
- **一句话**：模型在回复里用标记指名表情，扩展把标记渲染成表情图片。
- **当前阶段**：票 01（闭环：一张表情能在消息里出现）、票 02（语法、约束、处理范围）、票 03（生效集与宏）、票 04（投放方式与尺寸）、票 05（旧版本兼容路径与产出统一）、票 06（存储与生命周期）、票 07（调试工具、操作入口、本地化与文档）与票 09（渲染产物变更：清单两档、未命中不再剔除标记）已实现。票 08（设置项：表情间隙、标记形态开关、总开关）已拆出、待实现；后续票据见 `.scratch/st-emote/issues/`。

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

- `core/`：纯核心，不依赖 ST、不依赖 DOM，可直接用 node 运行。标记解析、生效集解析、渲染拼装、投放方式与尺寸求值、处理范围规则都在这里；票 06 起还有图片规则（`image-rules.js`）、表情库生命周期（`catalogue.js`）、表情包的读法与搜索（`library.js`）与导出包的**包清单**格式（`manifest.js`）；票 07 起还有界面文案（`i18n-catalogs.js` 是纯数据、`i18n.js` 是查找与 BCP-47 解析）、冲突检测（`conflict.js`）与「试渲染」（`preview.js`）。
- `adapter/`：ST 适配层，只做搬运（读写设置、上传、设置面板、把核心结果送进 DOM）。两条渲染路径：`rendering.js` 是旧版 DOM 路径，`hook.js` 是新版官方钩子路径，`render-path.js` 负责二选一（钩子装不上就回落 DOM 路径），`render-common.js` 是两条路径共用的一层（含两条路径都有效的 `restitchChat`），`restore.js` 管关闭扩展时的还原。票 06 起：`upload.js` 是三个图片接口的调用（上传 / 删除 / 列出）加上「这条拒绝理由怎么跟用户说」这一句话；`archive.js` 负责 zip 字节的读写；`sizing-panel.js` 是投放方式与两套尺寸集的控件；`dialogs.js` 是 toast / 确认 / 输入框 / 剪贴板，每一项都有客户端 API 优先、浏览器 API 兜底两条路。票 07 起：`locale.js` 是「客户端是哪种语言」这**一个**事实，并把它发布给 `core/i18n.js`（其余全交给核心）；`log.js` 是唯一的控制台出口（`logInfo` / `logError`）；`commands.js` 注册 `/st-emote`；`debug-panel.js` 是调试区（试渲染 + 重新渲染）。`ui.js` 只剩表情包的列表与行。
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
- 票 07 的纯核心：`tests/i18n.test.js`（两份目录键集对齐、回退、无标记、没有谁读不到的键、单复数）、`tests/conflict.test.js`（冲突检测与清单）、`tests/preview.test.js`（粘一段 → 最终结构：图搬到了没有、未命中的理由）。
- 票 07 的适配层：`tests/commands.test.js`（驱动真实的 `runCommand`；注册只查客户端有没有那几个类，并检查「登记两次」这件事真的会挂）、`tests/panel.test.js` 里新加的几条（整个面板是否双语、用户输入是否只当文本、试渲染不碰聊天、粘进去的文本是否走了客户端的 markdown 步骤、重渲染按钮）。
- 票 09 的断言方向翻了一面：`tests/render-paths.test.js` 与 `tests/render.test.js` 里所有「未命中**消失**了」的期望都改成「**标记还在，且是这一段文本**」。`readText` / `visibleText` 两个助手没有新增任何能力——未命中现在贡献一段它们本来就看得见的普通文本。另有两条是新行为独有的钉子：HTML 形态的未命中在最终 DOM 里是文本节点（`render.test.js` 与 `dom-path.test.js` 各一条），以及代码块里的未命中仍然什么都不渲染、**连未命中都不算**（`render.test.js` 一条）。
- 仍然只能在真实 ST 里验收的：流式生成时的即时出图、面板观感、净化是否保留图上的 `style` 属性、净化是否给两个类名都补上 `custom-` 前缀、**ST 切换语言后面板是否跟着变**（ST 自己会刷新页面，扩展只读一次语言）、**`SillyTavern.libs.showdown` 在真机上是否可用以及我们的开关是否够用**。

### 界面文案与日志（票 07）

- **界面文案只有一处**：用户**在界面上看到**的每一句都来自 `core/i18n-catalogs.js` 的两份目录 + `core/i18n.js` 的查找 `t(key, values)`。语言是**环境量而不是参数**：适配层在每个入口用 `adapter/locale.js` 的 `useClientLocale(context)` 把「客户端是哪种语言」发布给核心（`core/i18n.js` 的 `setLocale`），此后 `t(key, values)` 直接读它。**任何函数签名里都没有 `locale`**——`locale` 只出现在 i18n 模块自己的 `setLocale` / `resolveLocale` / `tKeys` 上；测试要另一种语言就用 `setLocale`（共享助手 `tests/contract/locale.js` 的 `withLocale` 会在用完后复位）。适配层没有 `tr` 这个转发层，直接调 `t`。连宏的说明文字也走同一份目录。新增文案**必须**两边同时加：`tests/i18n.test.js` 的键集对齐会挂，同一个测试还会检查「目录里没有谁读不到的键」。
- **控制台另有一条例外，且是有意的**：控制台的**机械性诊断行**（哪个字段、哪个文件、哪个 HTTP 状态）留在英文，因为它们要和 `reason` 枚举并排着读、还要能 grep；翻译它们只会让一次日志搜索依赖语言，而不增加任何信息。**讲用户自己数据的那几行走目录**：冲突（连同各包自己的拼法）、调试区显示的未命中理由、宏不展开的提示。这条线的位置写在 `adapter/log.js` 的模块注释里。
- 目录值**不带标记**（有测试守着），所以面板的固定骨架用 `innerHTML`、其余一律 `textContent`。用户输入（包名、搜索词、文件名）只进 `textContent`，也就**不需要任何转义查找**——`tHtml` 因此被删掉了，而不是留着备用。
- `zh-cn` 之外的 `zh-*` 变体（`zh-tw` / `zh-hant` / `zh-hk`）**故意回落英文**——给繁体用户简体不如给他能读的英文。
- **控制台只有一个出口**：`adapter/log.js` 的 `logInfo` / `logError`（前缀 `[st-emote]`）。`LOG_PREFIX` **不导出给任何别的模块**，也不用 `console.*`——`grep -rn "console\." adapter/` 只应命中 `adapter/log.js` 自己。
- `importFailureMessage(reason)` 现在是目录查询而不是 switch：每种拒绝理由都要有一句 `import.reason.<reason>`，`tests/manifest.test.js` 会把 `parseManifest` / `planImport` 的全部理由跑一遍。

### 「重新渲染」只有一条路径（票 07 返工）

`rerenderChat` 的两半是分开的，因为**只有「交还客户端重跑格式化」这一半在两条路径上都有效**：

- **restitch**（`render-common.js#restitchChat`）：把每条消息交还给 `updateMessageBlock`，客户端重跑整条格式化流水线，而钩子是这条流水线的一个环节——所以 ≥1.19 上图是靠**客户自己的钩子**回来的，我们什么也不用做。这一半原来住在 `restore.js` 里，现在两处共用一份。
- **DOM pass**（`renderMessageElement`）：只在 DOM 路径上跑，门控在 `shouldRunDomPass()` 里。

曾经整个 `rerenderChat` 被 `shouldRunDomPass()` 挡住，于是**钩子路径上它什么也不做**，而面板的「重新渲染」按钮和 `/st-emote reload` 都在报告自己重渲染过了。`tests/hook-path.test.js` 现在用一个会真的跑钩子的 `updateMessageBlock` 盯着这件事。

同理，`/st-emote reload` **不重读也不保存设置**：设置本来就是每次渲染现读的，而那次 `saveSettingsDebounced()` 会把用户手工改过的设置文件用内存里的版本盖掉——正好和它宣称的相反。

### 「试渲染」走的是同一段渲染逻辑

`core/preview.js` 走 `renderHtml`（两条真实路径的终点），**不是** `renderText`：后者只改 token，既不搬 块后 的图，也不跳过代码块。

粘贴的纯文本要变成 `renderHtml` 需要的消息体，这一步是**参数** `toMessageBody`，由 `adapter/debug-panel.js` 用**客户端自带的 showdown**（`SillyTavern.libs.showdown`，和 `archive.js` 用 `/lib/jszip.min.js` 是同一条规矩）来填。没有 showdown 就退回 `escapeText`（按纯文本处理），并且控制台会说明当时用的是哪一种。转换器的开关是**这个扩展自己定的**，不是客户的配置——只开了 spec 解析边界那几条真正需要的（围栏、表格）。

### 清单两档与「未命中不剔除标记」（票 09）

两件都只改**扩展吐出去的文本**，一个规则、一处实现：

- **清单分两档**：`::full`（也是无参数时的默认）每行 `表情包名:标签 (描述)`，**描述为空时整段退化成一个 `表情包名:标签`**；`::simple` 每行 `表情包名:标签`，不带描述。**两档都带表情包名**——所以同一个标签在两个包里是两行不同的内容，`CONTEXT.md` 的「冲突」里不再有「清单出现重复行」那一半。`buildListing` 的默认 mode、`adapter/macro.js` 的 `defaultValue` 与旧引擎的 `registerMacro(…, 'full')` 都因为这个落法而**无需改动**。一行一个表情靠 `validateDescription` 禁换行成立，那条约束是 load-bearing 的，`core/listing.js` 的注释里点明了。
- **未命中不剔除标记**：`core/render.js` 的 `renderTokenHtml` 命中时返回 `<img>`，未命中时返回 `escapeText(tokenText(token, options))`，因此它**永远不返回空串**。这一条让两处调用点各自塌缩成一行：`adapter/rendering.js` 里 `if (!html) { element.remove(); }` 整段删掉，`error` 守卫生效那步改成 `target.replaceWith(document.createTextNode(target.getAttribute(TOKEN_ATTRIBUTE)))`——**和 `adapter/restore.js` 是同一行代码**，语义也顺：「画不出来的表情退回标记」与「关掉扩展把标记放回去」。
- **无条件转义，连 HTML 路径也是**。`allowStickerTag` 明确把 sticker 标签开给了 DOMPurify，所以原样吐一个 `<sticker>daily:happy</sticker>` 会活着穿过净化变成真元素，方括号消失、未命中半隐形，比显示或隐藏都更糟。`tests/render.test.js` 与 `tests/dom-path.test.js` 各有一条断言最终 DOM 里是**文本节点而不是元素**的测试钉住它。`tokenText` 从解析后的部分重建标记，所以这也顺带绕开了 raw / `&lt;` 的往返问题。
- **被否掉的备选**：占位符元素（`<span>` 显示 `包名:标签` 的方框）。它会让 `adapter/restore.js` 的选择器必须放宽、`tests/contract/render-contract.js` 需要新的折叠能力，并且撞上 `core/render.js` 的 `markPlaced`——它用 `imgTag.slice(0, -1)` 往标签尾部塞属性、假设标签以 `>` 结尾，而 span 是 `<span …>文字</span>`」，塞进去属性就跑到文字后面去了。
- **这是对票 02 用户故事 56 的反转**，`spec.md` 与 `README.md` 是**改写**而非补充。原始顾虑里「污染提示词」那一半由 prompt-only 正则（`promptOnly: true`，只清上下文、显示端照常）覆盖，所以实际放弃的只是观感。

## 待补充

- 票 07 之后若再开票，先更新本文件与 `README.md`（README 已覆盖安装、三层作用域、宏、这条边界、最低 ST 版本）
- 参考资料链接（SillyTavern 扩展开发文档等）
