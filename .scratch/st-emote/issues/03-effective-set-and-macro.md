# 03 — 生效集与宏：让用户拿到清单

**What to build:** 除了全局，用户还能为某个角色（跟着角色卡走）和某个聊天（跟着聊天记录走）额外启用表情包；生效集是三层的并集。用户在自己的预设里写宏，就能拿到当前可用表情的清单——扩展全程不改用户的提示词。

**Blocked by:** 01 — 闭环：一张表情能在消息里出现

**Status:** resolved

- [x] 能在角色层与聊天层额外启用表情包；生效集是三层并集、按包去重；没有任何"排除/覆盖/优先级"
- [x] 群聊里每条消息按该条消息作者所属角色卡的配置解析
- [x] 新建与导入的表情包默认不启用
- [x] 角色卡引用了本地没有的表情包时，界面显示缺失清单，并能一键导入
- [x] 预设里写 `{{st-emote}}` 得到一行一个 `包名:标签`；`{{st-emote::simple}}` 只列标签；`{{st-emote::full}}` 与不带参数一致；清单里永不出现描述
- [x] 没有任何可用表情时清单展开为「无」；启用新包后不需要任何刷新动作，下一次构建提示词时清单已更新
- [x] 清单文案跟随 ST 界面语言；面板里能看到宏的用法示例
- [x] 扩展不向提示词写入任何内容——提示词里只有用户自己写的宏被展开
- [x] 交付一条「只清上下文」的正则规则，以可复制的 JSON 形式给出：`promptOnly: true`、同时匹配 `[[sticker:…]]` 与 `<标签名>…</标签名>` 两种形态、开启 `runOnEdit`；不自动注入正则扩展

## Comments

- 2026-09-28：已实现。纯核心测试 89 项通过（从 72 项增加到 89 项）。
- `core/effective-set.js` 新增三个作用域的纯函数：`mergeEnabledPackNames`（并集、按包名归一化去重、保留首次出现的写法与顺序）、`scopeHasPack`、`setPackInScope`、`renamePackInScope`。`adapter/settings.js` 的全局启停改为复用它们。
- `core/listing.js` 新增 `buildListing`：`simple` 只列标签、其余档位列 `包名:标签`，永远不读描述；生效集为空时按 locale 展开为 `无`（中文）或 `none`（其它语言）；同名标签在 `simple` 下保留重复行（与 CONTEXT 的「冲突」定义一致）。
- `adapter/scope.js` 新增：角色层（角色卡 `data.extensions.st-emote.enabledPackNames`，经 `writeExtensionField` 写盘）、聊天层（`chatMetadata.st-emote.enabledPackNames`，经 `updateChatMetadata` + `saveMetadata` 落盘）、缺失包计算。因为 ST 在切换聊天时会重新赋值 `chat_metadata`，而启动时捕获的 context 会指向旧对象，所以凡涉及当前聊天/当前角色的读取都通过 `liveContext()` 重新取 `SillyTavern.getContext()`。
- `adapter/rendering.js`：每条消息的生效集 = 全局 ∪ 该消息作者的角色卡 ∪ 当前聊天。作者由 `chat[mesid].original_avatar` 反查角色卡（群聊即该条消息作者；没有该字段时退回当前角色），因此群聊里每条消息按自己的角色层解析。`rerenderChat` 也改为读实时 chat。
- `adapter/macro.js`：注册 `{{st-emote}}`。只要宏引擎存在（`context.macros.register`，1.15 起可用，含 `unnamedArgs` / `exampleUsage`）就注册带参数的处理器，`{{st-emote::simple}}` / `{{st-emote::full}}` / 无参数都走同一处理器；每次展开实时计算，无刷新步骤。当用户的 `experimental_macro_engine` 开关关闭时（此时提示词替换走 legacy 解析器，读不到新引擎的注册），额外用 legacy 的零参 `context.registerMacro` 注册 `{{st-emote}}`；legacy 宏系统本身不支持参数，所以那种安装下 `::simple` 会按 ST 的既有方式留存为字面量。
- `adapter/regex.js` + `docs/st-emote-clear-context-regex.json`：交付「只清上下文」正则 JSON；`promptOnly: true`、`markdownOnly: false`、`placement: [2]`、`runOnEdit: true`，同时匹配 `[[sticker:…]]`、原样 `<标签名>…</标签名>`、实体转义两种落地形态，标签名取当前配置。面板里有可复制的 JSON 与复制按钮，绝不自动写入正则扩展。
- 面板：每个包一行三档独立勾选 Global / Character / Chat（角色未选中时 Character 置灰）；当前聊天会涉及的角色卡（选中的角色、群成员、已加载消息的作者）引用的缺失包在列表上方给出清单与「Create missing packs」按钮；新增宏用法示例块与正则 JSON 块。改包名会同步改写全局、当前角色、当前聊天三处的启用引用。
- 收口：三层并集的规则收进 `core/effective-set.js` 的 `buildScopedEffectiveSet`，渲染与宏共用同一个入口；`adapter/settings.js` 的重命名改为复用 `renamePackInScope`。
- 「一键导入」的取舍：角色卡按 ADR-0003 只带「启用哪些包」，不带图片或标签数据，所以此处的一键补齐 = 为缺失的包名在本地建出空包占位，用户随后上传图片或从别处导入包文件（包文件导入见票据 06）。
- Spec 对照：宏清单的数据源直接用 `core/effective-set.js` 的 `packs`（票 02 已保证其中只含有标签的表情），没有另加过滤。
- 待人工验收（适配层不写单测）：本地 ST 1.18 里分别为某角色、某聊天勾选包，确认 AI 回复随作用域变化；群聊里验一条消息用错角色的包时不命中；宏在预设里 `{{st-emote}}` / `::simple` / `::full` 三档输出；空生效集显示「无」；面板复制正则 JSON 后导入 Regex 扩展（Import To: Global）确认只清上下文。
