# 通用开发资料

本文件入库跟踪，存放**跨设备通用**的开发资料：换一台机器 clone 下来后，靠这份文件就能接上项目。

只在本机有效、不应入库的内容（个人路径、密钥、临时环境配置）请写进 `local_dev.md`，它已被 `.gitignore` 忽略。

## 项目速览

- **名称**：st-emote
- **形态**：SillyTavern 扩展
- **一句话**：模型在回复里用标记指名表情，扩展把标记渲染成表情图片。
- **当前阶段**：票 01–11 全部已实现——01 闭环：一张表情能在消息里出现、02 语法/约束/处理范围、03 生效集与宏、04 投放方式与尺寸、05 旧版本兼容路径与产出统一、06 存储与生命周期、07 调试工具/操作入口/本地化与文档、08 设置项（表情间隙、标记形态开关、总开关）、09 渲染产物变更（清单两档、未命中不再剔除标记）、10 面板版式（窄栏可用、动作按钮不换行、表情行分两行、版面节奏）、11 面板交互（动作按钮图标化、说明区与两套尺寸集可折叠、非法尺寸值自动展开）。后续票据见 `.scratch/st-emote/issues/`。

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

- `core/`：纯核心，不依赖 ST、不依赖 DOM，可直接用 node 运行。标记解析、生效集解析、渲染拼装、投放方式与尺寸求值、处理范围规则都在这里；票 06 起还有图片规则（`image-rules.js`）、表情库生命周期（`catalogue.js`）、表情包的读法与搜索（`library.js`）与导出包的**包清单**格式（`manifest.js`）；票 07 起还有界面文案（`i18n-catalogs.js` 是纯数据、`i18n.js` 是查找与 BCP-47 解析）、冲突检测（`conflict.js`）与「试渲染」（`preview.js`）；票 08 起 `size.js` 还多了一对**不是**一对一映射的间隙字段，`token.js` 多了两个**标记形态**开关。
- `adapter/`：ST 适配层，只做搬运（读写设置、上传、设置面板、把核心结果送进 DOM）。两条渲染路径：`rendering.js` 是旧版 DOM 路径，`hook.js` 是新版官方钩子路径，`render-path.js` 负责二选一（钩子装不上就回落 DOM 路径），`render-common.js` 是两条路径共用的一层（含两条路径都有效的 `restitchChat`），`restore.js` 管关闭扩展时的还原。票 06 起：`upload.js` 是三个图片接口的调用（上传 / 删除 / 列出）加上「这条拒绝理由怎么跟用户说」这一句话；`archive.js` 负责 zip 字节的读写；`sizing-panel.js` 是投放方式与两套尺寸集的控件；`dialogs.js` 是 toast / 确认 / 输入框 / 剪贴板，每一项都有客户端 API 优先、浏览器 API 兜底两条路。票 07 起：`locale.js` 是「客户端是哪种语言」这**一个**事实，并把它发布给 `core/i18n.js`（其余全交给核心）；`log.js` 是唯一的控制台出口（`logInfo` / `logError`）；`commands.js` 注册 `/st-emote`；`debug-panel.js` 是调试区（试渲染 + 重新渲染）。票 11 起多两个小模块，两个都只管面板的观感，业务规则一概不管：`buttons.js` 是图标表与按钮工厂，`collapsible.js` 是客户 `inline-drawer` 的封装。`ui.js` 只剩表情包的列表与行。
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
- 票 08 的纯核心：`tests/size.test.js` 里的间隙各条（单轴、零、非法值当未设置、两个 placeholder 各是各的默认值、未命中留下的文本不吃尺寸集）、`tests/token.test.js` 里的形态开关（关掉的形态不是 token、预筛与扫描器答同一个问题、缺省即开）、`tests/preview.test.js` 无新增（形态经由 `renderOptions` 透传，两条真实路径的对照在 `render-paths.test.js`）。
- 票 08 的适配层：`tests/render-paths.test.js` 加了「间隙到达的是图本身」与「关掉的形态在两条路径上都不生效」两组（都用共享契约断言，所以两边的差异会自己冒出来）；`tests/dom-path.test.js` 加了元素扫描读开关、两个都关时预筛短路、以及**承自票 07 遗留的那条日志字面断言**（未命中与非法尺寸两行前缀此前无人盯住，本票又走了一遍那条路径，是补上的时机）；`tests/panel.test.js` 加了形态开关、正则 JSON 随开关重生成、总开关实时退回标记、**总开关不压制试渲染**；`tests/commands.test.js` 加了 `on` / `off` 与宏空串；`tests/entry-disabled.test.js` 是**新文件**（`index.js` 每进程只跑一次，所以「启动即关」的客户端必须有自己的进程去观察）。
- 票 09 的断言方向翻了一面：`tests/render-paths.test.js` 与 `tests/render.test.js` 里所有「未命中**消失**了」的期望都改成「**标记还在，且是这一段文本**」。`readText` / `visibleText` 两个助手没有新增任何能力——未命中现在贡献一段它们本来就看得见的普通文本。另有两条是新行为独有的钉子：HTML 形态的未命中在最终 DOM 里是文本节点（`render.test.js` 与 `dom-path.test.js` 各一条），以及代码块里的未命中仍然什么都不渲染、**连未命中都不算**（`render.test.js` 一条）。
- 票 10 的适配层：`tests/panel.test.js` 里新增的五条。**其中「控件清单」那一条是本票唯一的硬保证**——它把面板的每一个控件拍成 `位置 :: 是什么 说了什么` 的有序列表（控件集合 87 行），版式改完必须一模一样；`PRESENTATION_HOOKS` 是被排除的类（挂在每个动作按钮上，不携带任何身份信息，另有专属测试盯着；票 11 又加进 `st-emote-icon-button`，理由相同）。另有：表情行确实分两行、作用域与全选同属一个容器、所有动作按钮都带 `st-emote-button`、面板用到的每个类要么有规则要么登记为 `QUERY_HOOKS`（**跨两种面板状态查**，因为「缺图」「勾选」「尺寸值非法」这几个类只在那些状态下出现，单看一种状态会漏掉三分之一）。
- 票 11 的适配层：`tests/panel.test.js` 里新增的十条，全部围绕**自动化测不出来的那一半**（图标是否真的画出来、折叠点得准不准）。字体名不能靠记忆，所以**图标名不查网络也不查客户目录**：`tests/contract/font-awesome.js` 记下 `FREE_ICON_CLASSES` / `FREE_ICON_CODEPOINTS`——当初对着客户的 `public/css/fontawesome.min.css` 与 `public/webfonts/fa-solid-900.ttf` 逐个核过，**记版本号**（6.5.2）是因为免费集在 6.x 内会长大，换名字时要重新核而不是相信旧记录。测试两端都查：表里每项都得有人画（孤儿键），画出来的每个类名都得在表里，**面板上的按钮与 `EXPECTED_ICON_BUTTON_KEYS` 双向相等**。另有：每个图标按钮都带双语 `title` + `aria-label`（遍历，不是一个样例）、三个说明区默认收起且**断言类名**、非说明性设置**不在任何折叠头后面**（总开关不能被藏起来）、非法尺寸值自动展开且**改对后下次挂载能收回**、收起的尺寸集在头上标出「已改过」、点一下 `aria-expanded` 与箭头同步翻、没有自造控件。
- 票 11 **没有重新生成控件清单**——改完之后 87 行快照与票 10 提交的**逐字节相同**。核对办法有两条，都可复跑：快照块 `git diff` 为空；另在四种面板状态下（普通 / 服务器无文件 / 角色卡引用缺失的表情包 / 勾选后）分别渲染票 10 的检出与本分支的检出，把每个控件的 `位置 :: 标签 类型 id 类名 文件过滤 select 选项 说了什么` 排成文本再 `diff`——除 `st-emote-icon-button` 这个新增的共享类之外**完全一致**（把该类归一化后 diff 为空）。
- 仍然只能在真实 ST 里验收的：流式生成时的即时出图、面板观感、净化是否保留图上的 `style` 属性、净化是否给两个类名都补上 `custom-` 前缀、**ST 切换语言后面板是否跟着变**（ST 自己会刷新页面，扩展只读一次语言）、**`SillyTavern.libs.showdown` 在真机上是否可用以及我们的开关是否够用**。
- 票 11 追加的（同一类）：**每一个图标是否真的画出来了，一个空白都没有**（codepoint 已经核过，但「核过」不等于「看得见」）；**悬停提示在深色/浅色主题下读不读得清**；**图标与旁边文字基线齐不齐、`min-width: 2.2em` 的点击区域够不够大**；**折叠块的展开/收起动画与客户自己的抽屉是否一致、`tab` 能不能走到折叠头、`enter`/`space` 能不能展开**（jsdom 没有 jQuery，这几项一条都测不了）；**收起的尺寸集，那两个「已改过」小标记在窄栏里挤不挤**；**`fa-trash-can`（删表情包）与 `fa-trash-arrow-up`（批量删除）并排时，用户分不分得清哪个是哪个**。
- 票 08 追加的（同一类，都得在真机上看一眼）：**形态关掉后那份 prompt-only 正则 JSON 导入正则扩展的实际行为**（我们只断言了生成的 `findRegex` 字符串，正则扩展本身只能在真机验）；**间隙的观感**（inline 之间、块级之间、混排、窄面板与小字号下 `em` 是否还合适）；**流式生成途中改设置**；**总开关关掉后含块后图的聊天立刻退回标记**（必须走 restitch，见 `restore.js` 的注释）与再打开后图立刻回来；**多出的几个控件在一行里挤不挤**。

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

### 设置项的三层开关（票 08）

三件互不相干的事，只落在「设置 + 面板」上。它们各有**不止一个**读点，列在这里是因为漏掉一个读点的后果都是同一类：面板上看着关了，实际还在生效。

- **间隙**（`marginX` / `marginY`，每套尺寸集各一对）。`core/size.js` 里它们是**第一处非一对一映射的字段**：`SIZE_PROPERTIES` 仍只放一对一的那五个，`SIZE_DEFAULTS` 改成**按存储字段名索引**（否则两个字段都映射到 `margin` 时，两个输入框的 placeholder 会显示同一个默认值），`SIZE_PANEL_FIELDS = [...SIZE_FIELDS, ...SIZE_MARGIN_FIELDS]` 才是面板与存储形状的字段来源。声明在 `evaluateSize` 里作为一个显式步骤发出，`margin: <y> <x>`。`style.css` 里 `.custom-st-emote-block` 的 `margin` **已删**——两条来源互相打补丁是后面极难查的一类 bug。
- **标记形态开关**（`bracketForm` / `tagForm`）。核心只有 `core/token.js` 的 `findCandidates` 一处，但**五个调用方都得收口**，否则「关了」不等于「不生效」：`adapter/rendering.js` 的元素扫描（DOM 路径上 raw `<sticker>` 是元素，不走 `findTokens`）、同一文件的 `tokenPrefixes` 预筛、`adapter/regex.js` 的 prompt-only 正则 JSON、`render-path.js` 的 `allowStickerTag`（形态关掉就不开口子，**顺带让两条路径对「不处理」表现一致**）、面板上的标签名输入框置灰。关闭的形态**不是未命中**——它不再是语法，文本原样保留。
- **总开关**（`settings.enabled`，默认 `true`）。**不新增第三层门**：`adapter/restore.js` 的 `renderingEnabled` + `stopRendering` / `resumeRendering` 已经是现成机制，ST 自己的扩展开关走的就是这一套。`setEnabled(context, enabled)` 放在 `adapter/render-path.js`（它要同时调 `installRendering`、`stopRendering`、`rerenderChat`，而 `restore.js` 不能反过来依赖 `render-path.js`），面板与 `/st-emote on|off` 共用它。`index.js` 在 jQuery 回调里按 `isEnabled(context)` 决定要不要装路径——**启动时就是关的**的客户端连订阅都不会有，比事后用标志拦更强。
- 开关的默认值一律是**开**，`ensureSettings` 用 `!== false` 归一化：老版本写下的设置里根本没有这些键，把「键不存在」读成「用户关掉了」会在升级时静默关停一个能用的扩展。

### 「试渲染」不受总开关约束（有意的不一致）

`core/preview.js` 绕过了 `isRenderingEnabled`，理由写在它的模块注释里：预览粘的是文本不是聊天，而且「关掉了」正是你想调试的状态。**这一条要钉住**（`tests/panel.test.js` 有一条专门断言它），否则下一个读代码的人会去「修」它。形态开关相反，**是**被预览遵守的：形态是设置，不是全局状态。

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

### 面板的版式约定（票 10）

面板挂进 ST 自己的扩展抽屉，宽度在 ~300px 到两倍之间。**改版式时沿用下面这几件现成的零件，不要另起第四种写法。**

- **两档间距，只有两档**：`#st_emote_drawer` 上的 `--st-emote-gap`（块内，6px）与 `--st-emote-space`（块间，12px）。分块线由 `.st-emote-group + .st-emote-group` 与 `.st-emote-debug` 共用一条规则画出，线落在间距中间而不是某一侧。**原先一路 `margin-bottom: 8px` 的写法已经全部并进这两档**，不要再写第三个数字。
- **动作按钮**：面板里每一个动作按钮都带 `st-emote-button`，规则是 `.menu_button.st-emote-button`（**两个类**）。ST 自己的 `.menu_button` 是 `display:flex; flex-direction:column`，一个类只能打平、还要看加载顺序；两个类才稳。**写选择器时保留两个类。** 动作收进 `.st-emote-actions` 这个可换行的组：**组换行，按钮不换行。** 三处动作区（包头、表情行、调试区）共用这一套，新增按钮只要带上这个类就自动一致。
- **表情行是两行**：`.st-emote-sticker` 是列，第一行 `.st-emote-sticker-main`（勾选 + 缩略图 + **标签** + 投放方式），第二行 `.st-emote-sticker-detail`（**描述** 通栏 + 动作）。标签是**标识**要一眼可见，描述是**内容**且往往是一整句，所以描述拿整行宽度。两行都读作一行 flex 的延续，**没有**用 grid —— 需要对齐的只有缩略图和勾选框，而那两个本来就是 `flex-shrink: 0` 的固定尺寸。
- **作用域与「全选」同一行**：`.st-emote-pack-controls` 里放 `.st-emote-scopes` 与 `.st-emote-selection` 两个子组。原先 `.st-emote-scopes` 上的 `flex-basis: 100%` 会硬撑出一行，那是「最不需要空间的控件占了最多纵向空间」的直接成因，已删。
- **`min-width: 0` 用在会伸缩的 flex 子项上**：输入框、select、`.st-emote-actions`。flex 子项的自动最小尺寸是**内容**尺寸，没有这一条输入框就会撑到「曾经输入过的最长标签」那么宽而溢出——截图里「测试表情,详」是这么来的，与 `flex: 2` / `flex: 1` 的比例无关。固定尺寸的东西（缩略图、勾选框）**不要**加，它们本来就该固定。
- **分块用间距和细线，不用卡片**：ST 的 `inline-drawer` 已经是一层卡片。**加块标题要在中英两份目录里同时加句子**，所以除非确实说不清，一律用间距解决。

### 面板的按钮与折叠约定（票 11）

两件零件，票 12（表情网格）直接接着用，**不要再自造第三种写法**。

**按钮图标化（`adapter/buttons.js`）**

- **图标名一张表，两半都要查**：`ACTION_ICONS`（语义名 → 类名）是**唯一**出现类名串的地方，与 `PLACEMENT_LABEL_KEYS` / `PACK_STATE_LABEL_KEYS` 同一写法。查不到名字 FA **画成空白且不报错**——所以类名必须同时出现在 `ACTION_ICONS` 与 `tests/contract/font-awesome.js` 的 `FREE_ICON_CLASSES` / `FREE_ICON_CODEPOINTS`（对照客户自带字体的 codepoint 录下的证据，**两份表对不上就挂**）。新增按钮要过孤儿键测试：表里每一项都得有人画。
- **`iconButton(icon, label, className)` 三件套**：类名 `menu_button st-emote-button st-emote-icon-button`，`title` 与 `aria-label` **都**填本地化句子，句子里套一个 `<i class="fa-solid fa-x st-emote-icon" aria-hidden="true">`。骨架里那三个有 id 的按钮走 `iconize()`（保留 id）；`filePickerButton(icon, label, options, onFiles)` 同签名。**`title` 与 `aria-label` 同源同键，所以翻译不可能只落到一边。**
- **动作才图标化，标签一律留字**。下拉框标题、字段名、复选框说明、那几段提示、还有「HTML tag form:」这种冒号前缀**全都不许动**。这是本票的硬边界。
- **尺寸与对齐只有一条规则**：`.st-emote-icon { font-size: 0.95em; line-height: 1 }` 加 `.menu_button.st-emote-button.st-emote-icon-button { min-width: 2.2em }`。不要给单个按钮写字号。

**可折叠（`adapter/collapsible.js`）**

- **用客户自己的 `inline-drawer-*`**，不要 `<details>`、不要手写 max-height 动画。`collapsibleSection({ title, open, className })` 返回 `{ section, toggle, content, icon, setExpanded }`；`collapseBlock(block, title)` 把骨架里现成的一段包起来。**有测试断言这些类名**，所以「退回自造」是可测的。
- **toggle 必须是 section 的直接子元素**，客户端的点击委托按 `>.inline-drawer-header` 找图标、按 `>.inline-drawer-content` 找内容，嵌深一层就永远打不开。
- **`aria-expanded` 写在 toggle 上，本扩展自己维护**：客户端只做动画与 `fa-circle-chevron-*` 切换，**从不写这个属性**。我们的监听器在目标阶段跑（早于 document 上的委托），**且刻意不碰 `content.style.display`**——`slideToggle` 靠当时的可见性决定方向，我们先改了会让它往反方向滑。
- **折叠绝不能藏住错误**：非法尺寸值的提示就在输入框旁边，收到起就看不见。`buildSizeSet` 遇到非法值**自动展开并说明原因**（`size.openedBecauseInvalid`），值改对或清空后下次挂载回到默认。**任何要放提示的控件，想清楚它在不在某个默认收起的区块里。**
- **折叠状态不持久化**：刷新回默认。持久化要决定存哪、怎么与票 08 的 `settings` 合并，是单独的票。设置区不随 `refresh()` 重建，所以编辑过程中天然保持。

## 待补充

- 票 07 之后若再开票，先更新本文件与 `README.md`（README 已覆盖安装、三层作用域、宏、这条边界、最低 ST 版本）
- 参考资料链接（SillyTavern 扩展开发文档等）