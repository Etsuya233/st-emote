# 通用开发资料

本文件入库跟踪，存放**跨设备通用**的开发资料：换一台机器 clone 下来后，靠这份文件就能接上项目。

只在本机有效、不应入库的内容（个人路径、密钥、临时环境配置）请写进 `local_dev.md`，它已被 `.gitignore` 忽略。

## 项目速览

- **名称**：st-emote
- **形态**：SillyTavern 扩展
- **一句话**：模型在回复里用标记指名表情，扩展把标记渲染成表情图片。
- **当前阶段**：票 01（闭环：一张表情能在消息里出现）已实现，纯核心带测试；后续票据见 `.scratch/st-emote/issues/`。

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

- `core/`：纯核心，不依赖 ST、不依赖 DOM，可直接用 node 运行。标记解析、生效集解析、渲染拼装都在这里。
- `adapter/`：ST 适配层，只做搬运（读写设置、上传、设置面板、把核心结果送进 DOM）。
- `tests/`：纯核心测试。

### 测试

```bash
npm test        # node --test，发现并运行 tests/*.test.js
```

测试只覆盖纯核心（命中与未命中两类）、不覆盖适配层；适配层在 SillyTavern 里手动验收。

## 待补充

- README（安装、用法、最低支持的 ST 版本），见票 07
- 参考资料链接（SillyTavern 扩展开发文档等）
