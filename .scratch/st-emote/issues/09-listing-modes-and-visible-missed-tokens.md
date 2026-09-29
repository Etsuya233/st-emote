# 09 — 渲染产物变更：清单两档、未命中不再剔除标记

**What to build:** 两件都改**扩展吐出去的文本**的事：① 宏的两个档位语义整体挪一位——`simple` 变成「包名:标签」，`full` 变成「包名:标签 (描述)」，无参数落 `full`；② 未命中时**不再把标记从聊天里剔除**，标记文本留在原地，控制台照旧记一行。

**Blocked by:** 03 — 生效集与宏；05 — 旧版本兼容路径与产出统一；07 — 调试工具、操作入口、本地化与文档

**Status:** resolved

这两件都落在 `core/render.js` 的输出与它的契约测试上，所以放一张票。**顺序是 ① 先做**——它不动渲染，只动清单与文档；② 改完之后「未命中」的断言要整体翻面，两者混着做，失败会互相掩盖。

---

## ① 清单的两档

- [x] `{{st-emote::simple}}` 每行一个 `包名:标签`
- [x] `{{st-emote::full}}` 每行一个 `包名:标签 (描述)`；**描述为空时省略括号**，整段退化成一个 `包名:标签`（因此无描述的表情在 `full` 下与 `simple` 完全相同——这是有意的，要补一条测试说明）
- [x] 无参数 `{{st-emote}}` 等同 `::full`
- [x] 生效集为空时仍展开成目录里的 `listing.empty`（中英各一份，票 07 立的规矩）
- [x] 一行一个表情成立：描述里不能有换行

### 实现要点

`core/listing.js:33` 的 `rows.push` 扩成三段拼装。`buildListing` 的默认 mode **不用动**（现在未知 mode 落 `full`，改完 `full` 仍是「包名:标签 (描述)」，行为一致），`adapter/macro.js:58` 的 `defaultValue: 'full'` 与 `:82` 旧引擎的 `registerMacro(…, 'full')` 也都**不用动**。这条比预想的省事。

行格式依赖一条**已经成立**的约束：`validateDescription`（`core/constraints.js:132`）禁换行，所以描述不会把行撑开。这条是 load-bearing 的，要在 `core/listing.js` 的注释里点明，否则哪天有人允许描述换行，清单会静默变形。

`包名:标签 (描述)` 用半角括号加空格：描述里允许出现 `(` `)` `:` 和空格（清单是注入提示词的纯文本，没有回读，所以不产生歧义），半角括号在中英文提示词里都不易与内容里的中文括号混。

### 文档与断言

- `CONTEXT.md:44`「清单」的定义改写成两档。**`CONTEXT.md:40`「冲突」里那句「也让 `{{st-emote::simple}}` 清单出现重复行」要删掉**——新 `simple` 是 `包名:标签`，两个包都定义 `happy` 得到 `daily:happy` 和 `roleplay:happy`，是两行不同的内容，不再重复。冲突检测本身不受影响：裸标签在多包下照样歧义，`core/conflict.js` 一行不用改。
- `README.md:82-88` 的宏表、`.scratch/st-emote/spec.md` 的清单与宏两节。
- `core/i18n-catalogs.js` 的 `macro.returns` / `macro.modeDescription` / `panel.macroExample`，**中英各一份**——`tests/i18n.test.js` 的键集对齐会挂，这是好事。
- `tests/listing.test.js` 要重写至少两条：第 36 行 `'keeps conflicts as duplicates'`（新 `simple` 不再产生重复行）和第 46 行 `'the listing never contains a description'`（**现在是反向断言**，必须改成只对 `simple` 成立）。另加「无描述的表情在 `full` 下等于 `simple` 的那一行」。

---

## ② 未命中不再剔除标记

- [x] 任何一种未命中（`pack-not-found` / `pack-not-enabled` / `label-not-found` / `ambiguous-bare-label` / `image-missing` / `external-link-failed`）之后，**标记文本留在聊天里**，形态与用户写的一致
- [x] 留下的文本是**字面文本**，不是会被浏览器当成元素的标记
- [x] `image-missing` 与 `external-link-failed`（图挂掉之后才判出来的两种）同样退回文本，而不是留一个裂图图标
- [x] 控制台照旧记那一行未命中
- [x] 两条渲染路径表现一致；预览（试渲染）同样显示这段文本
- [x] 关闭扩展时，已渲染的图退回标记——**这条本来就成立，本票不得把它弄坏**（没有新元素被插进 DOM，所以 `adapter/restore.js:30` 的选择器不需要动）

### 实现要点

**把它当「当作普通文本」做，不要当新功能做。** `core/render.js:193-210` 的 `renderChunk` 里，token 之间的文本已经按 `escape` 标志分别处理了（decoded 文本走 `escapeText`，HTML 走原样）——「不剔除」就是让未命中的 token 走同一条路。`core/render.js:167-179` 的返回从 `''` 变成标记文本本身。

**返回 `escapeText(tokenText(token, options))`，无条件转义**，即使在 `escape=false` 的 HTML 路径上。原因是 `render-path.js:70` 的 `allowStickerTag` 明确把 sticker 标签开给了 DOMPurify：原样吐一个 `<sticker>daily:happy</sticker>` 会**活着穿过净化变成真元素**，用户只看到 `daily:happy` 没有方括号——未命中反而变得半隐形，而且和 `[[…]]` 形态表现不一致。转义后两种形态统一显示成字面文本，也顺带绕开 `core/token.js:96-99` 注释里记的那个 raw / `&lt;` 往返问题（`tokenText` 本来就是从解析后的部分重建的）。

两处调用点：

- `adapter/rendering.js:112` 的 `if (!html) { element.remove(); continue; }` ——`renderTokenHtml` 现在永远返回非空，这个分支自然失效，**整段删掉**。一条规则，不是两处。
- `adapter/rendering.js:437` 的 `target.remove()`（error 守卫生效那步）→ `target.replaceWith(document.createTextNode(target.getAttribute(TOKEN_ATTRIBUTE)))`。这**和 `adapter/restore.js:32` 是同一个操作**，语义也顺：「画不出来的表情退回它替身的标记」与「关掉扩展把标记放回去」共用一行代码。img 上本来就带着 `TOKEN_ATTRIBUTE`，不用回查设置。

`core/preview.js:105` 的 `panel.previewMisses`（"Not rendered: …"）仍然准确（确实没渲染成图），但预览框里现在会同时显示那个标记，措辞可以顺一下。

### 测试

`tests/contract/render-contract.js` 的 `readText` / `visibleText` **不需要新能力**——未命中现在贡献一段标记文本，这两个助手本来就看得见。要做的是把断言从「标记消失了」翻成「标记还在，且是这一段文本」。另加一条：HTML 形态的未命中在最终 DOM 里是**文本节点而不是元素**（这是无条件转义那条决定的直接后果，必须钉住）。

---

## 需求变更：这是对票 02 一个明确决定的反转

票 02 在 `.scratch/st-emote/spec.md:83` 立了用户故事 56：「作为酒馆用户，我想未命中的标记从显示里消失，以便聊天里不出现控制符垃圾」，并在 `:24` 与 `:168` 落成规则、`README.md:144` 落成文档。本票把它反过来，所以**这三处是改写而不是补充**。

原始顾虑里「污染提示词」那一半已经被 `README.md:109` 那份 prompt-only 正则覆盖了（`promptOnly: true`，只清上下文、聊天照常显示），所以本票实际放弃的只是观感——而「错的标记留在眼前」恰好就是现在想要的效果：**排错时能直接看见模型写错了什么，比一个空缺有用得多。**

被放弃的备选方案（记录在此以免后来者重新发明）：占位符元素（`<span>` 显示 `包名:标签` 的方框）。它会让 `adapter/restore.js:30` 的选择器必须放宽（否则关扩展后聊天里留一地占位文字）、`tests/contract/render-contract.js` 需要新的折叠能力、并且撞上 `core/render.js:333` `markPlaced` 的一个陷阱——**它用 `imgTag.slice(0, -1)` 往标签尾部塞属性，假设标签以 `>` 结尾，而 span 是 `<span …>文字</span>`**，塞进去会把属性插到文字后面，产物直接是坏的。「不剔除」这条路上这些问题一个都不存在。

## 待人工验收（下次统一验证）

- [ ] 未命中的观感：`[[sticker:…]]` 与 `<sticker>…</sticker>` 两种形态留在聊天里时的样子，是否会被 ST 的 markdown 步骤再做一次处理（钩子路径上我们吐的是**已经转义过的**文本，要确认它不会被二次转义成 `&amp;lt;`）。
- [ ] `image-missing` / `external-link-failed` 那两种：断网或删掉一张图之后重渲染，聊天里退回的是文本而不是裂图图标。
- [ ] 清单两档的实际长度对比：`::full` 在一个几十张表情的包上展开有多长，值不值得作为默认（`{{st-emote}}` 无参数落 `full` 是这次的决定，若实测太长，改默认值是一行的事，但要连 README 与目录文案一起改）。

## 留给后续 Ticket

- **08（设置项）**：无依赖关系，可与本票并行。票 08 的「间隙只作用于图、不作用于未命中留下的文本」那一条要在本票落地后才有意义（那时才真的存在一段留下的文本）。

## 已知取舍与偏差

- **清单里只有数据，没有一句「你应该这样用」之类的指令文本。** `::full` 加了描述之后 temptation 更大——描述是写给模型看的自然语言，很容易变成偷偷加指示的地方。这条边界（`README.md:100-107`）不动：描述就是描述，不改写成祈使句。
- **留下的标记文本不可点击、也没有 tooltip 说明为什么没命中。** 理由只有一个：它就是用户写下的原文，加工它就不再是「不剔除」而是「换了个东西显示」，那又回到占位符方案的全部代价里。未命中的原因仍然在控制台（`adapter/render-common.js:226`），排错路径没变。
- **无参数 `{{st-emote}}` 展开成 `full`，比改之前长。** 这是这次明确选定的默认值。代价是用户若不写档位，提示词会明显变长；好处是模型第一次就看得见表情的画面内容，少一轮「这个表情到底是什么样」的来回。

## Comments

实现完毕，`npm test` 356 项全过、无 skip。核心改动很小，大头在文档与断言。

**实际做了什么**

① `core/listing.js`：`rows.push` 按票里说的扩成三段拼装。`simple` → `包名:标签`，其余 → `包名:标签 (描述)`（描述为空白串时省略括号）。默认 mode、`adapter/macro.js` 的 `defaultValue: 'full'`、旧引擎的 `registerMacro(…, 'full')` **一行没动**，`git diff` 里没有 `adapter/macro.js`——这与「实现要点」里的预判一致。`validateDescription` 那条 load-bearing 约束写进了 `buildListing` 的注释。文档侧：`CONTEXT.md`（清单定义改写成两档 + 冲突里那句删掉）、`README.md`（宏表、那条 `::simple` 的提示、冲突那节）、`spec.md`（`:23` Solution、`:62-63` 用户故事 35/36、`:83` 用户故事 56、`:168` 渲染规则、`:186-188` 宏、`:253` 含糊点）、两份目录的 `macro.returns` / `macro.modeDescription` / `panel.macroExample`。

② `core/render.js`：`renderTokenHtml` 的未命中分支从 `return ''` 变成 `return escapeText(marker)`，条件转义的**理由**（`allowStickerTag` 把 sticker 标签开给了 DOMPurify）写进了函数里的注释，它现在永远不返回空串。`adapter/rendering.js` 两处照票子说的改：`if (!html) { element.remove(); }` 整段删掉，`error` 守卫那步换成 `target.replaceWith(document.createTextNode(target.getAttribute(TOKEN_ATTRIBUTE)))`（需要 import `TOKEN_ATTRIBUTE`）。`adapter/restore.js` 的选择器没动，也确实不需要动。

**票子没提、我自己做的判断**

- **描述在行内做了 `trim()`**（`core/listing.js`）。描述是按用户原文存的，界面上留一个尾随空格会让 `包名:标签 ( … )` 这种行看起来是坏的；只裁空白，不改一个字。相应地，**全空白描述按空描述处理**——`tests/listing.test.js` 里那条「无描述时两档相同」同时钉了 `''` 和 `'   '` 两种。
- **`spec.md` 的用户故事 35 与 36 一并改写了。** 票子只点了三处（`:24` `:83` `:168`），但 35 写的是「清单只列标签、还是列全限定名」、36 写的是「让清单里永远不出现描述」——档位整体挪一位之后这两条字面上已经不成立，留着会是一份自相矛盾的规格。35 改成「只列 `包名:标签` 还是带上描述」，36 改成「描述为空时退化成一个 `包名:标签`」，正好把新行为里值得承诺的那一条单独写成故事。
- **`CONTEXT.md` 新增了一条「未命中 (Miss)」。** 票子只要求改清单与冲突两处，但未命中的**显示形态**现在是一条需要被复述的规则（「留在聊天里、字面文本」），而术语表是代码与文档共用的那份。写进去之后 `README.md` 与 `spec.md` 的说法都有出处。
- **`panel.previewMisses` 没动。** 票子说「仍然准确……措辞可以顺一下」。预览框里现在会同时显示那段标记文本，「Not rendered: no sticker of that label」并没有因此说错什么；改它会牵动 `tests/i18n.test.js` 与 `tests/panel.test.js` 的期望，而收益是零。这条留给将来觉得碍眼的人。

**翻转而不是删除的断言**

票子点名要翻的两条都翻了：`tests/listing.test.js` 里 `'keeps conflicts as duplicates'`（新 `simple` 下 `Happy`/`happy` 变成 `daily:Happy` 和 `roleplay:happy` 两行不同内容，另加了一条断言行数与去重后行数相等）以及 `'the listing never contains a description'`（改成只对 `simple` 成立，并额外断言 `full` 下确实有描述）。② 那边同样有一批：「消失」全部翻成「标记还在，且是这一段文本」，涉及 `tests/render.test.js` 六条、`tests/render-paths.test.js` 两条（其中 `a pack that stops being enabled` 的注释原来把「必须从源重渲染」的理由写成「miss 把 token 从 DOM 里删掉了」，这个理由现在不成立，已改写）、`tests/preview.test.js` 一条、`tests/panel.test.js` 一条、`tests/dom-path.test.js` 一条。

**新行为独有的钉子**

- HTML 形态的未命中在最终 DOM 里是**文本节点而不是元素**：`tests/render.test.js` 一条（`renderHtml` + 解析成 DOM 后断言 `childElementCount === 0` 且 `querySelector('sticker') === null`）、`tests/dom-path.test.js` 一条（真实走 `renderStickerElements` 那条被删掉分支的位置）。
- **代码块里的未命中仍然什么都不渲染**：`tests/render.test.js` 一条，断言输出与源串逐字相同且 `misses.length === 0`——代码块的跳过由标签扫描决定，与命不命中无关，所以那一处连未命中都不算。
- **两种形态观感一致**：`tests/render-paths.test.js` 一条，raw tag 与 escaped tag 两种输入喂给两条路径，期望同一段文本。
- **`external-link-failed` 单独一条**（`tests/dom-path.test.js`）。它与 `image-missing` 共用同一行代码、只有 `reason` 不同，而这一行以前只有 `image-missing` 被测到。

**没有验证的**

上面「待人工验收」那三条**一条都没做**：都需要真实 SillyTavern 客户端。测试里能证明的只是「钩子路径交出去的是已转义过的字符串」，**ST 的 markdown 步骤会不会把它二次转义成 `&amp;lt;` 没有验证**；`contract/render-contract.js` 里唯一模拟的客户行为仍然只有净化补 `custom-` 前缀那一处，本票没有扩大它。`::full` 在几十张表情的包上到底有多长，也没有实测。
