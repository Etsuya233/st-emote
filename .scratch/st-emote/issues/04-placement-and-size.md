# 04 — 投放方式与尺寸

**What to build:** 用户能决定图出现在哪里（原地 / 段后 / 消息末尾，可对单张表情单独覆盖），也能分别控制 inline 与 block 两种场景下的尺寸与填充方式，包括填错时的提示与不留配置时的默认表现。

**Blocked by:** 01 — 闭环：一张表情能在消息里出现

**Status:** resolved

- [x] 三种投放方式都落在预期位置："块后"落在当前段与下一段之间（段落、列表项、引用块、标题、表格单元按最近的块级容器取，断行不算块）——块边界规则在纯核心逐个容器测过（`tests/placement.test.js`）；DOM 路径对同一套规则的应用见「待人工验收」
- [x] 可以为单张表情覆盖全局的投放方式；覆盖后使用对应的那套尺寸配置
- [x] inline 与 block 两套都能设置最小/最大宽高与 `cover` / `contain` / `fill`；`em` / `px` / `%` 手写可用（取值与求值都在纯核心测过，值原样进 CSS；面板控件本身待目视）
- [ ] 非法尺寸值被当作未设置，并在输入框旁给出可见提示，不阻止继续编辑——「当作未设置 + 原样保留不丢」已由纯核心覆盖；**输入框旁的可见提示属适配层，待 ST 目视验收**
- [x] 未填任何值时使用默认值（inline 默认 `max-height: 3em`，block 默认 `max-width: 100%`），1024px 级的图不会撑破版面
- [ ] 块级语境下一条消息里的多张图各自成块、竖排——「各自成块、同边界按书写顺序」已由纯核心覆盖；**竖排来自 CSS `display: block`，无测试覆盖，待目视验收**
- [ ] 流式生成过程中标记一写完整就出图；改任何设置后当前聊天立刻重渲染——复用 01/03 已有的事件与 `rerenderChat` 路径，**只能在真实 ST 里验收**

## Comments

- 2026-09-28：已实现并提交。功能提交 `e4463cc`（feat: sticker placement and per-context size settings），评审修复提交 `1e1ee0d`（fix: keep the base class on block images so the DOM path sees them）。`npm test` 133 项通过 / 0 失败。
- 新增两个纯核心模块：`core/placement.js`（投放方式取值、逐表情覆盖、块级容器表、图像相对块的落点）与 `core/size.js`（手写尺寸的校验与求值、两套尺寸集的默认值）。`core/render.js` 继续是「HTML 进 / HTML 出」的缝：它按投放方式算出该用哪套尺寸、发出 `style` 与 `data-st-emote-placement`，并把非原地的图搬到落点上。
- 适配层只做搬运：`adapter/rendering.js` 把设置读成纯数据喂给核心，并在 DOM 路径上用同一套块级容器表与落点规则搬节点；`adapter/ui.js` 新增投放方式下拉、两套尺寸集（每个字段自带提示）、以及每张表情的投放方式覆盖；`adapter/settings.js` 的设置结构新增 `placement` / `sizes` / 逐表情 `placement`。任何一项改动都走既有的 `saveAndRefresh` → `rerenderChat`。
- CSS：基类 `.custom-st-emote` 只留两套尺寸集都成立的兜底值，具体尺寸一律由图上的内联 `style` 承担；块级修饰类 `.custom-st-emote-block` 负责 `display: block`（竖排靠它）。
- 文档：`CONTEXT.md` 补上「尺寸集 (Size set)」词条；`docs/adr/0002-dual-render-paths.md` 追加「块级修饰类」一节，写明基类必须常在、`-block` 只做加法、行为标识仍走 `data-*`。
- **评审抓到的真 bug（唯一一个）**：块级图当时只发 `custom-st-emote-block`、不带基类，而 DOM 路径靠 `img.custom-st-emote` 挑选表情图，于是块级投放方式在那条路径上**静默失效**（图照常渲染，就是不动），加载失败的块级图也不再上报。修法是基类 + 修饰类一起发，并补了一条按类名**分词**断言的回归测试（原来的断言是对 class 属性做子串匹配，结构上就抓不到这个 bug）。已验证该测试在修复前失败、修复后通过。

## 待人工验收（下次统一验证）

- [ ] 流式生成：逐字输出时，标记一写完整立即出图；改任何设置（投放方式、尺寸、逐表情覆盖）后当前聊天立刻重渲染。
- [ ] ST 净化是否保留图上的 `style` 属性，以及是否为第二个类名同样加上 `custom-` 前缀（即 `st-emote st-emote-block` → `custom-st-emote custom-st-emote-block`）。
- [ ] 三种投放方式 + 两套尺寸集的实际观感：块后图确实落在段与下一段之间；同一条消息里多张块级图竖排不并排；1024px 级的图不撑破版面。
- [ ] 尺寸填错（如 `3rem`、`12`）时输入框旁出现提示、且不阻止继续编辑；控制台有 `[st-emote]` 前缀的记录。
- [ ] 表格单元里的块后图留在单元格内（有意偏差，见下）。

## 留给后续 Ticket

- **05（旧版本兼容路径与产出统一）**：钩子路径必须传 `options.className`（`'st-emote'`），由 ST 净化统一补 `custom-` 前缀；核心侧已用 `tests/placement.test.js` 里的 `the hook path can emit the un-prefixed class…` 钉住 `st-emote` / `st-emote st-emote-block` 这条约定。类名与 `data-*` 契约、以及重渲染 / Show more / swipe / 编辑后的幂等断言也在 05 收口。
- **06（存储与生命周期）**：包导出 / 导入要带上逐表情的投放方式覆盖（spec 存储一节明确列了这一项）。
- **07（收尾）**：本票新增的面板文案目前只有英文，需并入中英双语那一轮；「`%` 只在宽度方向有意义」的提示也要跟着面板文案一起定稿。

## 已知取舍与偏差

- 表格单元（`td` / `th`）本身是最近的块级容器，但图**留在单元格内容末尾**而不是放到 `</td>` 之后：后者是非法标记，浏览器会把内容foster-parent 出表格。有意偏差，理由记在 `core/placement.js` 的 `CELL_TAGS` 注释里。
- 尺寸值必须带单位（`em` / `px` / `%`），裸数字按非法处理；`0` 例外，因为它是 CSS 里表达「不要这个界」的习惯写法。
- 基类 CSS 刻意不写 `max-height`：块级图同样带基类，写在基类上会顺着漏到块级图（`max-height: 3em` 只对原地图有意义）。
- 尺寸集用 `em` 时，界面按 spec 提示「1em = 当前聊天文字高度」；`%` 只在宽度方向承诺有意义，高度方向的百分比依赖父元素自身有高度，界面上也照此说明。
