# Her World

A modular DSH-backed companion sharing identity, memory and life across native
chat, Room and Desktop. This checkout contains the current implementation only.

## 在 DSH 中安装或更新

首次安装、更新和从 GitHub 安装切换来源的步骤见 [DSH 安装与更新说明](docs/github-updates.md#dsh-installation-and-updates)。

## Source layout

| Path | Purpose |
| --- | --- |
| `src/` | Current TypeScript/runtime code and built-in media, grouped by module |
| `src/core/native/` | Native DSH chat, Memory, transcript and prompt adapters |
| `tests/` | Domain tests, current regression cases and explicit manual fixtures |
| `scripts/build/` | Deterministic build/media generation |
| `scripts/checks/` | Release/package checks and explicit native/manual checks |
| `scripts/lib/` | Shared setup, storage and lifecycle helpers |
| `vendor/` | Required bundled upstream code and license/origin records |
| `art/` | Source artwork used to regenerate the current life media |
| `dist/src/` | Current prebuilt runtime required by direct GitHub installation |
| `references/manifest.json` | Origin/commit/license provenance, without reference clones |
| `docs/` | Current development, settings, portability and release instructions |

- [Development and verification](docs/development.md)
- Animation and artwork standard: `docs/animation-standard.md` (source checkout only)
- [GitHub installation and release workflow](docs/github-updates.md)
- [Settings](docs/settings.md)
- [Portable storage](docs/portability.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

Historical plans, handoffs, audit reports, local packages, temporary workspaces
and research checkouts are not retained in this working tree. Companion data
and device configuration belong outside this repository.
