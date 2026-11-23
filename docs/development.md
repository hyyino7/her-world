# 开发与验证

先读 README 和本文。保留当前源码与运行说明；不新增历史方案、交接或审计报告集合。

<a id="local-tools"></a>
## 本机工具

本机使用 mise 提供 Node、pnpm，uv 提供受管理的 Python；先把 mise 的 shims 加入 PATH。本机安装方法见 `~/Developer/dev-kit/README.md` 的「本机运行环境」。从新的登录 shell 进入仓库后，版本分别由 `.node-version`、`package.json` 的 `packageManager` 和 `.python-version` 选择，不改全局版本或已安装的 DSH。

首次准备、移动检出目录或环境检查报告旧路径时，在仓库目录执行恢复命令：

```sh
rm -rf .venv node_modules && mise install && uv venv --managed-python && uv pip install --python .venv/bin/python -r vendor/mnemosyne/requirements-test.lock && pnpm install --frozen-lockfile --ignore-scripts
```

该命令按锁文件重建两个可丢弃目录，移除手工加装的依赖；pnpm 使用默认共享 store。离线且依赖已可用时，直接使用现有环境。

```sh
pnpm run check:env
```

环境检查核对 Node、pnpm 和虚拟环境 Python 的版本、Python 可执行性及 `.venv/bin/activate` 的路径；不检查运行时来自哪里，也不证明所有锁定的 Python 依赖已经安装，后者由全量验证中的 Python 测试覆盖。缺少 mise shims 的 shell 可能找不到 pnpm，或选错 Node。

上游来源和许可证保留在 `references/manifest.json`、vendor 记录及 `THIRD_PARTY_NOTICES.md`。

## 日常快测

只跑本次改动相关的检查。以种地时钟为例：

```sh
pnpm run build
node --test dist/tests/behavior/garden-clock-continuity.test.js tests/regressions/audit-r5-garden-clock.test.mjs
```

build 会更新生成文件和编译产物；`dist/src` 中已有跟踪文件的差异也要检查。只改文档时做链接、diff 和范围检查。`pnpm test` 和已有的聚焦测试脚本仍可用，不串联重叠套件重复构建。

<a id="architecture-behavior"></a>
## 架构检查与行为清单

以下命令用于源码检出；声明在 `arch/layers.json`、`arch/storage.json`，R1–R4 和 R8 基线在 `arch/baseline/`，R5 仅报告。普通检查比较新增和消失项，报告模式另打印调用位置、依赖边、写入者、词表定义、判断数和跳过的生成源。

```sh
pnpm run check:arch
pnpm run check:arch -- --report
```

清理旧违规时，在同一个提交内运行以下命令收紧基线；它拒绝新增条目：

```sh
pnpm run check:arch -- --write-baseline
```

在源码检出中运行 `pnpm run metrics` 查看自动度量，或用 `pnpm run metrics -- --json` 获取 JSON。输出包括规则违规、词表及字符串判断、超过 1500 行的手写文件和模块间依赖。度量只报告。

行为索引是 `tests/behavior-list/index.json`。先完成上面的 build，再运行含索引自测的入口：

```sh
pnpm run test:behavior-list
```

只执行并核对索引条目的既有入口：

```sh
node scripts/checks/run-behavior-list.mjs
```

L1 是插件入口的完整流程，L2 是公开面行为，L3 是保留在全量门禁的回归参考。清单入口只跑 L1/L2，要求每条身份恰好执行一次并通过，零匹配、跳过、取消或 todo 都算失败。它使用合成数据和假模型；其中真实 Memory provider 需要本机回环，沙箱拒绝监听应记录为环境失败，不改成通过或跳过。

<a id="migration-inventory"></a>

## 合成副本与盘点

先构建，再选一个不存在或为空的输出目录生成已迁移基线布局。盘点只读已完成安装回执，核对存储绑定、文件、表、行数、已知记录及登记差异。SQLite 在临时副本里读取，副本含源数据库和 WAL。执行期间保持合成副本的写入者停止。

```sh
node scripts/fixtures/synthetic-companion.mjs --out /tmp/her-world-synthetic
node scripts/migrate/inventory.mjs --installation /tmp/her-world-synthetic/installation.json
```

主人提供停写的 0.5.0 隔离副本时，只提交获准的字段名、计数和通过状态。未登记记录只报种类数量。需要按类别核对时，只按获准的前缀汇总。原始输出留在本机。

准入失败时，设置页显示「需要迁移」及固定拒写原因。核对选中的 Repo、v3 工作区清单和 0.5.0 存储完成凭证；确需旧版本升级时，查阅 [v0.5.0 对应工具和步骤](https://github.com/hyyino7/her-world/blob/v0.5.0/docs/development.md#migration-inventory)。盘点入口只读取状态。

新装、搬家、离线修复与同机备份恢复见[可搬迁存储](portability.md)。升级和换回 0.5.0 的隔离流程见[安装与更新](github-updates.md#dsh-installation-and-updates)。

## 全量验证与发布

```sh
pnpm run verify
```

这是 PR 与发布共用的检查。先查环境、类型和架构棘轮并构建一次，再递归收集 `dist/tests/**/*.test.js`、`tests/**/*.test.mjs`，各入口执行一次，随后跑 Python Memory 测试、校验发布元数据，并生成和检查一份归档（`scripts/checks/verify.mjs:13–25`）。测试使用可丢弃数据且不调用付费模型。Memory 进程测试需要本机回环，沙箱拒绝监听时记为环境失败并在允许回环的环境复跑（`src/memory/main.py:17`、`tests/memory/memory-process.test.mjs:72–83`）。

PR CI 和发布工作流各自执行全量检查（`.github/workflows/ci.yml:13–16`、`.github/workflows/release.yml:49–53`）。日常只做相关快测。发布入口和冻结候选的方式见[发布与更新说明](github-updates.md#publication)。

## 可选原生检查

`scripts/checks/`、`tests/manual/` 中的原生与窗口检查需要显式指定的隔离环境，不对个人伙伴数据运行。

- `test:native-context`：已安装 DSH 的原生循环与落盘，使用本机脚本模型，核对上下文、互动确认、原始记录和已接受计划。
- `test:native-services`：跨会话 Bank 召回、provider 重启和 guest 权限。
- `test:native-room`：合成或隔离宿主上的原生 Room 拍照入口。
- `test:room-voice`：Room 语音窗口和请求生命周期。
- `test:native-life`：限定作用域的回顾读写、越界拒绝、纠正/撤回、原生历史恢复及压缩连续性。
- `test:room-refresh`：可选的 macOS Room 合成器与窗口检查。
- 以下窗口检查需手动运行。先 `pnpm run build`，Electron 用 DSH 自带的 `~/.dsh/electron/Electron.app/Contents/MacOS/Electron`。
  - `tests/manual/room-canvas.cjs`：用 Electron 直接运行，隔离的 Chromium 合成回归，不连正在运行的 Room。
  - `tests/manual/companion-settings-window.cjs`：用 Electron 直接运行，需要已安装的 DSH（`DSH_APP` 改安装路径），设置页处理器用临时 Repo。
  - `node scripts/checks/check-standalone-window.mjs`：独立桌宠窗口探针（`tests/desktop/standalone-window-probe.cjs`），`DSH_CHATBOT_ELECTRON_PATH` 可改 Electron 路径。
  - `scripts/checks/check-room-interactions.cjs`：用 Electron 直接运行，在临时 Room 上走一遍 3D 视图和原生消息端口，不用个人资料、电视截图或平台账号。
  - `tests/desktop/compact-voice-window.cjs` 用合成麦克风和宿主夹具检查停止朗读、切换会话、隐藏 Compact 窗口时是否取消同一请求（`6dd3e4c:docs/plans/stage3-presentation.md:232,237`）。

    ```sh
    env -u ELECTRON_RUN_AS_NODE "${DSH_CHATBOT_ELECTRON_PATH:-${DSH_HOME:-$HOME/.dsh}/electron/Electron.app/Contents/MacOS/Electron}" tests/desktop/compact-voice-window.cjs
    ```

这些检查不安装或更新 DSH。已安装环境里的主人验收，与源码、包和脚本宿主验证分开。

对明确选中的原生日志，可用只读检查比较上下文呈现：

```sh
pnpm run check:context-payload -- /absolute/events.jsonl.zstd --day YYYY-MM-DD --offset-hours 7
```

结果是按请求加权的文本字符数，不是计费 token 或实测缓存节省；重叠估计不能相加。

## 运行时与数据边界

DSH 拥有聊天和调度。各模块拥有自己的数据并暴露显式接口，呈现端和读取器不新建助手运行时，不独立写 Memory。当前状态使用原生必需的尾部快照和 surface 替换；原始事件、对话、互动回执和阅读文本仍保留。历史维护在原生空闲时准备，在下一次真实请求中应用，不另调模型。Memory、压缩、回顾和来源撤回保持现有拥有者。设置和存储细节见 [设置](settings.md) 与 [可搬迁存储](portability.md)。

已接受的 Life 步骤按实际完成事件续行，无需模型再次决定。身体在提交前明确拒绝时保留原操作，等主人互动完成后继续；提交结果未知时仍须核对原回执。集成测试经真实协调器驱动这些转移，不手动推进下一步。

送达确认和共享 Memory 召回分开。已准入的领域事实保持系统证据及原始执行者和来源，传输信封只作证据。跨会话检查须在首个会话确认事实后，由第二个会话真正调用 provider recall，不能把已知事实 ID 直接塞给它。

Body 在现有 home 检查点保留可选 `gardenClockEnabled` 元数据。显式暂停 Life 会冻结作物时间，组件挂起保留时钟意图；恢复前的查询保留经过的生长量。Economy 拒绝倒退已有生长或结算时钟的检查点；无法重建旧存档中已丢失的进度。

回顾回归包含 `tests/life/life-review-runtime.test.mjs` 及编译后的 `life-review-files`、`review-continuation`、`life-sleep-continuity`，覆盖按日重试、重启核对、历史日记保护，以及经 Life/Body 协调器完成实际睡眠，不用付费模型。

当前支持基线及包的公开面见源码检出的 `docs/architecture.md` 第 6 节。`dist/src` 保留给 GitHub 安装，发布工作流将它与已验证源码一起构建并冻结；`dist/tests`、source map、缓存、工具和个人伙伴数据不交付。普通 build 校验内置媒体，可选重新生成使用 `src/presentation/animation-allocation.json` 与 `art/` 素材。

素材交接、画布与锚点、时序、视觉验收及登记见源码检出中的 `docs/animation-standard.md`。
