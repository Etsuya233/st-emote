## 全局约定

开始工作前，先阅读 `~/.agents/AGENTS.md` 并遵循其中的全局规则。

## 开发资料

跨设备通用的开发资料写进 `common_dev.md`（入库跟踪）。只在本机有效、不应入库的内容写进 `local_dev.md`（已被 `.gitignore` 忽略）。

## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/<feature-slug>/` in this repo; the skill runs the backlog against local files. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles, each label string equal to its role name (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), recorded as a `Status:` line in issue files. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
