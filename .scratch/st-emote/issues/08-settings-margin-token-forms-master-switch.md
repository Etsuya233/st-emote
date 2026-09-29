# 08 — 设置项：表情间隙、标记形态开关、总开关

**What to build:** 三件互不相干但都只落在「设置 + 面板」上的事：① 两套尺寸集各加一对间隙字段（X / Y），让相邻表情之间有可配置的空隙；② `[[sticker:…]]` 与 HTML Tag 两种形态各自能单独关掉；③ 面板里有一个总开关，关掉后扩展整体不参与渲染、宏也不展开清单。

**Blocked by:** 04 — 投放方式与尺寸；07 — 调试工具、操作入口、本地化与文档

**Status:** ready-for-agent

三件事都不改**渲染产物的形状**（除了 `margin` 会进每张图的 `style`），所以它们可以共用一批测试改动。**票内顺序是刻意的：先做 ①。** 它的测试波及面最广（见下），先做完，后面两件事失败时就只有一个原因。

---

## ① 两套尺寸集各加一对间隙字段

- [ ] `inline` 与 `block` 各自能配一个水平间隙和一个垂直间隙，相邻表情之间因此有可见空隙
- [ ] 间隙值与尺寸值走同一套校验（`em` / `px` / `%`，裸数字非法，`0` 合法——`0` 正好是「我要贴紧」的表达方式）
- [ ] 非法值按未设置处理，输入框旁给提示，值原样保留不丢（与尺寸字段完全一致的行为）
- [ ] 间隙只有一个来源：字段没配时走字段默认值，`style.css` 里不再有第二条 `margin` 规则
- [ ] 未命中留下的标记文本**不吃**尺寸集（它不是图），这一点要么有测试钉住，要么在 `core/render.js` 的注释里写明理由

### 实现要点

`core/size.js:28-37` 的 `SIZE_PROPERTIES` 是「存储字段名 → CSS 属性」的**一对一**映射，`SIZE_FIELDS` 由它派生，`adapter/sizing-panel.js:137` 的面板循环又以 `SIZE_FIELDS` 为唯一字段来源。`marginX` / `marginY` 两个字段合成一条声明，进不了这个模型，所以这张票要动三处：

1. **`SIZE_DEFAULTS` 改成按存储字段名索引**（现在按 CSS 属性名）。`evaluateSize`（`core/size.js:234`）的 `defaults[property]` 改成 `defaults[field]`，`defaultSizeValue`（`core/size.js:214`）同理。这不是为 margin 加特例，是把「字段名 / 属性名」这层二重性消掉——否则两个字段都映射到 `margin` 时，面板两个输入框的 placeholder 会显示同一个默认值。改完 `SIZE_PROPERTIES` 与 `SIZE_DEFAULTS` 的键**就对齐了**，这是本票唯一一处结构性改动。
2. **发一条合并声明** `margin: <y> <x>`，在 `evaluateSize` 里作为一个显式步骤处理（不进 `SIZE_PROPERTIES`），并注释写清为什么不拆成 `margin-left` / `margin-top`。
3. **面板要一张比 `SIZE_FIELDS` 更宽的表**（例如 `SIZE_PANEL_FIELDS = [...SIZE_FIELDS, 'marginX', 'marginY']`），因为循环现在只看 `SIZE_FIELDS`。`adapter/sizing-panel.js:51-58` 的 `SIZE_FIELD_LABEL_KEYS` 加两个键。

默认值（可调整）：`inline` = X `0.15em` / Y `0`；`block` = X `0` / Y `0.25em`。`style.css:23-26` 里 `.custom-st-emote-block` 的 `margin: 4px 0` **删掉**——否则内联的 `margin` 覆盖它、没配时又走 CSS，两个来源互相打补丁，是后面极难查的一类 bug。

### 测试波及面（做之前先知道会红多少）

`margin` 会进**每一张**渲染出来的表情的 `style`，所以默认 style 字符串在这些地方全要改：`tests/size.test.js`（多处）、`tests/contract/render-contract.js:202` 与 `:232`、`tests/placement.test.js:265/267`、`tests/hook-path.test.js:192`、`tests/preview.test.js:72`。机械改动，但这是本批里最广的一处，所以放第一个做。

新增：`tests/size.test.js` 断言 `marginX` / `marginY` 单独配置时合成的那条声明、非法值按未设置处理、`0` 合法、两个字段的 placeholder 各是各的默认值。

---

## ② 两种标记形态各自开关

- [ ] `[[sticker:…]]` 可以单独关掉，关掉后这种形态在聊天里完全不生效
- [ ] HTML Tag 形态可以单独关掉，关掉后这种形态在聊天里完全不生效
- [ ] 关掉的形态**也不再被面板那份「只从上下文清掉标记」的正则剥掉**——否则用户写 `<sticker>…</sticker>` 会发现聊天里什么都没发生、提示词里却没了
- [ ] 形态关闭时，面板上的标签名输入框置灰（否则用户会改一个不起作用的设置）
- [ ] 两个都关是合法状态，面板给一句提示，不让用户以为扩展坏了
- [ ] 面板的预览（试渲染）与两条渲染路径表现一致

### 实现要点

核心只有一处：`core/token.js:66-87` 的 `findCandidates` 按开关决定拼哪几条正则。`findTokens` 已经接受 `options`，钩子路径、DOM 路径、`core/preview.js` 都透传同一个 `RenderOptions`，**所以一个改动点覆盖全部调用方**。

必须跟着收口、否则「关了」不等于「不生效」的五处：

- `adapter/rendering.js:91-122` `renderStickerElements` 直接 `querySelectorAll(options.tagName)`，**不看开关**——HTML 形态关了以后这里还在跑。
- `adapter/rendering.js:133` `tokenPrefixes` 预筛提示词。关了某形态就该少一条（只是白跑一趟，不算错，但要一致）。
- `adapter/regex.js:19-23` 生成的正则 JSON。改设置时重新生成，`adapter/ui.js:308` 已经有一处这么做了（标签名变更时），照抄即可。
- `render-path.js:70` `allowStickerTag` ——形态关掉就不必再往 DOMPurify 里开口子。**顺带一个好处**：`render-path.js:66-69` 那段注释说明钩子路径必须在净化前吃掉原始 `<sticker>`，否则被净化剥掉；形态关掉后不开口子，DOM 路径也不渲染，**两条路径的「不处理」表现因此一致**——正是 ADR-0002 要的那个性质。
- `core/constraints.js:152` `validateStickerTag` 保持不变。标签名仍然可以配、仍然校验，只是配了不生效。

新增测试：每个形态单独开关时的渲染结果、两个都关时聊天不变、正则 JSON 随开关变化、预览与聊天一致。

---

## ③ 总开关

- [ ] 面板里有一个总开关，关掉后聊天里不再出现任何表情，且**已经把图渲染出来的消息会退回标记**（不是刷新后才退）
- [ ] 总开关关掉时，宏**不展开清单**，返回空串
- [ ] 面板上写明「关掉后宏也不展开」，因为这是用户容易意外的连带效果
- [ ] 总开关与 ST 自己的扩展开关互不干扰：ST 关掉再打开，扩展回到本扩展自己的开关所决定的状态
- [ ] `/st-emote on` / `/st-emote off` 与面板开关走同一个入口
- [ ] 开关状态重启后保持

### 实现要点

**不新增第三层门。** `adapter/restore.js:62-118` 已经有一套现成机制：模块级 `renderingEnabled` + `stopRendering`（restitch 换回标记 + 清残留图）+ `resumeRendering`，两条路径都以它为门。ST 自己的扩展开关走的就是这一套，区别只是它不能重载页面。

- `settings.enabled`（默认 `true`），`adapter/settings.js:45` 的 `ensureSettings` 归一化。
- `index.js:14-21`：`jQuery` 回调里按 `settings.enabled` 决定要不要 `installRendering(context)`。`installRendering` 本来就幂等（`render-path.js:61`），面板里再调一次是安全的。
- 面板开关：关 → `stopRendering(context)`；开 → `installRendering(context)` + `rerenderChat(context)`。`index.js:33-39` 的 `onEnable` 已经是这个形状，照抄。
- 保存与重渲染走既有的 `adapter/ui.js:167-170` `saveAndRefresh`。
- `adapter/commands.js` 加 `on` / `off` 两个动作，与面板共用一个 `setEnabled` 入口。`ACTIONS` 导出后有一条测试断言目录里那句话提到每一个动作（票 07 立的），加动作要同步加目录文案，中英各一份。

**宏一起关，返回空串而不是 `t('listing.empty')`。** `adapter/macro.js:20` 的 `expandListing` 在总开关关着时返回 `''`——生效集里明明有表情，回一个「无」是撒谎。

**预览不受总开关约束。** `core/preview.js` 现在就绕过了 `isRenderingEnabled`，保持这样：它粘的是文本不是聊天，而且「关掉」的状态正是你想调试的状态。这是**有意的不一致**，要在 `core/preview.js` 的模块注释里写明，否则下一个读代码的人会去「修」它。

---

## 待人工验收（下次统一验证）

- [ ] 三种标记形态的开关组合（都开 / 只开 `[[]]` / 只开 Tag / 都关）在真实聊天里各跑一遍，特别是**流式生成途中改设置**的行为。
- [ ] 形态关闭后，面板那份 prompt-only 正则 JSON 复制到正则扩展里导入，确认它**没有**再剥掉已关闭的形态（`common_dev.md:92` 记着正则扩展本身只能在真机上验）。
- [ ] 间隙的观感：inline 表情之间、块级图之间、inline 与块级混排，以及窄面板 / 小字号下 `em` 是否还合适。
- [ ] 总开关：关掉后**当前已经渲染出来的聊天**立刻退回标记（含块后图——它在 DOM 里已经不挨着模型写的位置了，所以必须走 restitch 而不是就地替换，见 `adapter/restore.js:76-93` 的注释）；再打开后图立刻回来。以及与 ST 扩展开关的来回组合。
- [ ] 总开关关着时 `{{st-emote::full}}` 在预设里展开成空（不是「无」），且面板的提示写明了这一点。
- [ ] 面板观感：多出的四个控件（两个间隙 + 两个形态开关 + 总开关）在一行里挤不挤，需要的话调 `.st-emote-field` 的换行。

## 留给后续 Ticket

- **09（渲染产物变更）**：无依赖关系，可与本票并行。
- **未被任何测试盯住的一条**（承自票 07 的遗留）：未命中与非法尺寸那两行控制台输出的**字面前缀**仍然没有断言（冲突那行有）。本票动了尺寸字段，非法尺寸的输出路径被再次经过，是顺手补上这条断言的好时机。

## 已知取舍与偏差

- **间隙发成一条 `margin: <y> <x>`，而不是 `margin-inline` / `margin-block`。** 后者会让两个字段变成真正的一对一映射，面板、`SIZE_FIELDS`、`SIZE_DEFAULTS` 全都不用动，代码更少。放弃它是因为它要求赌 ST 净化时 `style` 属性里这两个逻辑属性能活下来，而 `common_dev.md:92` 已经有一串「只能在真实 ST 里验收」了，不再往里加。多付的代价是 `size.js` 里第一处非一对一的字段，以及面板需要一张比 `SIZE_FIELDS` 更宽的表。
- **`margin` 走内联 `style` 而不是 CSS 变量。** 与尺寸一致：尺寸本来就是内联在图上的，间隙跟着同一条路走，两条渲染路径自动一致，不需要在消息容器上挂任何东西。
- **总开关关掉时宏一起关，是对 ADR-0004 那条边界的一次收紧。** 那条边界的原话是「扩展从不修改、注入或整理你的提示词」，理由是宏是用户自己写进预设的。关掉宏等于扩展在用户没有明确要求的那一侧替他做了决定——**但反过来说，渲染关着而清单还在，模型会认真写一堆永远不会被渲染的标记，这是几乎确定的 bug 而不是 feature。** 结论是关，并在面板上把连带效果写明，让这个决定是可见的。
- **「总开关」这个叫法是为了避开撞词。** ST 自己的扩展开关、面板里这个总开关、以及作用域里表情包的启停，三者都是「启用 / 关闭」，`CONTEXT.md` 里会因此多一条词条，`_Avoid_` 写上「启用, 开关, 全局开关」。
