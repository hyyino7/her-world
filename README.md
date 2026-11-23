# Her World

Her World 是运行在 DSH 中的伙伴插件。同一个伙伴的身份、记忆和生活贯穿原生对话、Room、桌宠、QQ／微信与语音。

## 在 DSH 中安装或更新

首次安装与版本切换见 [DSH 安装与更新说明](docs/github-updates.md#dsh-installation-and-updates)。

## 源码目录

| 路径 | 用途 |
| --- | --- |
| `src/` | 按模块组织的 TypeScript、运行时代码和内置媒体 |
| `src/core/native/` | DSH 原生对话、Memory、会话日志及提示词的适配 |
| `tests/` | 领域测试、回归测试及手动检查夹具 |
| `scripts/build/` | 构建和媒体生成 |
| `scripts/checks/` | 发布、归档、原生服务与窗口检查 |
| `scripts/lib/` | setup、存储与生命周期共用工具 |
| `vendor/` | 随包复用的上游代码、许可证和来源记录 |
| `art/` | 用于重新生成生活媒体的原始素材 |
| `dist/src/` | 跟踪的构建产物，用于发行包和 GitHub 源安装 |
| `references/manifest.json` | 上游来源、提交和许可证记录 |
| `docs/` | 开发、设置、搬家和发布说明 |

- [开发和验证](docs/development.md)
- 动画和素材规范见源码检出的 `docs/animation-standard.md`。
- [安装、更新和发布](docs/github-updates.md)
- [设置](docs/settings.md)
- [伙伴数据搬家和恢复](docs/portability.md)
- [第三方声明](THIRD_PARTY_NOTICES.md)

伙伴数据在绑定的 Repo 里，设备配置在本机 DSH profile 里。
