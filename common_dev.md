# 通用开发资料

本文件入库跟踪，存放**跨设备通用**的开发资料：换一台机器 clone 下来后，靠这份文件就能接上项目。

只在本机有效、不应入库的内容（个人路径、密钥、临时环境配置）请写进 `local_dev.md`，它已被 `.gitignore` 忽略。

## 项目速览

- **名称**：st-emote
- **形态**：SillyTavern 扩展
- **一句话**：模型在回复里用标记指名表情，扩展把标记渲染成表情图片。
- **当前阶段**：需求已冻结，代码尚未开始。

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

## 待补充

以下内容等落地后再补：

- 构建与运行方式
- 本地开发环境依赖
- 参考资料链接（SillyTavern 扩展开发文档等）
