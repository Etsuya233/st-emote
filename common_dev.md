# 通用开发资料

本文件入库跟踪，存放**跨设备通用**的开发资料：换一台机器 clone 下来后，靠这份文件就能接上项目。

只在本机有效、不应入库的内容（个人路径、密钥、临时环境配置）请写进 `local_dev.md`，它已被 `.gitignore` 忽略。

## 项目速览

- **名称**：st-emote
- **形态**：SillyTavern 扩展
- **一句话**：模型在回复里用标记指名表情，扩展把标记渲染成表情图片。
- **当前阶段**：票 01（闭环：一张表情能在消息里出现）、票 02（语法、约束、处理范围）、票 03（生效集与宏）、票 04（投放方式与尺寸）与票 05（旧版本兼容路径与产出统一）已实现；后续票据见 `.scratch/st-emote/issues/`。

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

- `core/`：纯核心，不依赖 ST、不依赖 DOM，可直接用 node 运行。标记解析、生效集解析、渲染拼装、投放方式与尺寸求值、处理范围规则都在这里。
- `adapter/`：ST 适配层，只做搬运（读写设置、上传、设置面板、把核心结果送进 DOM）。两条渲染路径：`rendering.js` 是旧版 DOM 路径，`hook.js` 是新版官方钩子路径，`render-path.js` 负责二选一（钩子装不上就回落 DOM 路径），`render-common.js` 是两条路径共用的一层，`restore.js` 管关闭扩展时的还原。
- `tests/`：纯核心测试 + 共享契约 + 两条适配层的对照与生命周期测试。

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
- 路径与生命周期：`tests/dom-path.test.js`、`tests/hook-path.test.js`、`tests/entry.test.js`。`tests/contract/st-dom.js` 只伪造客户的接口面（`getContext`、事件总线、`updateMessageBlock`），DOM 本身是真的。
- 仍然只能在真实 ST 里验收的：流式生成时的即时出图、面板观感、净化是否保留图上的 `style` 属性、净化是否给两个类名都补上 `custom-` 前缀。

## 待补充

- README（安装、用法、最低支持的 ST 版本），见票 07
- 参考资料链接（SillyTavern 扩展开发文档等）
