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
## 合成副本、迁移与盘点

这些也是源码检出命令，需要已经构建。输入是完成安装的 `installation.json` 回执。开发使用生成器产出的合成副本；真实副本由主人提供且只在另行授权的隔离检查点使用。已登记四步：`0001-storage-manifest` 写存储清单；`0002-home-identity` 把 `life.json` 的 home 会话 ID 复制到 Core 的 `companion-home` 记录（只复制，`life.json` 原字节保留；两边 ID 不同时报 `home-identity-conflict`），清单换成 `core:2`、`living:2`；`0003-economy-marker` 把 Core `meta` 里属于当前绑定的那一条 `economy.initialized:<storageId>` 搬进钱包库，并写独立证据 `.chatpet/data/living/economy-adoption.json`，两者都落盘后删掉 Core 旧键，清单换成 `core:3`、`living:3`。`0003` 只打开已存在、身份和 schema 都对的钱包库，不建库、不导入旧菜园；含 `0003` 的日志段头记 `economyAdopted`，用来区分「从未采用」和「源已删、目标缺失」。它的原因码：`economy-database-missing`（已采用而钱包库缺失）、`economy-database-invalid`（钱包库无效或 schema 不完整）、`economy-marker-multiple`（Core 有多条标记）、`economy-marker-invalid`（标记无效）、`economy-marker-binding-mismatch`（标记、钱包库或独立证据属于另一个绑定）；失败时 Core 旧键保留。盘点在 Core 库那一项报 `economyInitialized: {rows, matchesCurrentBinding}`。迁移后钱包目录和独立证据同时丢失时，离线 `status` 报 `binding-changed`，续做和开新一轮都拒绝。 `0004-console-wallet` 把经停写排空导出的浏览器钱包请求按原号登记，清单换成 `core:3/living:4`。导入不派发请求。已采用的库同时提交待办和导入证明，未采用且零条时原子写独立证明。新装写无旧来源证明。浏览器切换和双备份的操作顺序见 [Console 钱包迁移](#console-wallet-migration)。

存储清单落后于代码时，运行时进入「需要迁移」：对外状态和拒写码都是 `migration-required`，DSH 普通聊天照常，伙伴的设置、身份、策略、生活世界和记忆写入全部拒绝，设置页显示细因和操作提示。细因有 `storage-version-outdated`、`manifest-mismatch`、`migration-incomplete`、`journal-invalid`、`journal-step-mismatch`、`binding-changed`，以及 `binding-not-migratable`：绑定的形状离线迁移器接不了（例如选中的工作区和已初始化的绑定不一致），这时要在版本页换回 0.2.0，把工作区选择和初始化理顺后再升级。一旦判定需要迁移，本进程就锁定，迁移完成后要重启 DSH。新装由主人显式初始化时直接写最新清单，不需要迁移。

用一个不存在或为空的输出目录生成 0.5.0 合成布局。

```sh
node scripts/fixtures/synthetic-companion.mjs --out /tmp/her-world-synthetic
```

盘点只输出路径、大小、表名、行数、已知记录数量和登记差异。浏览器存储显示为待主人检查。盘点和迁移预检在关闭写入者后读取 SQLite 私有副本，复制数据库和 WAL，由 SQLite 在副本上重建 SHM：

```sh
node scripts/migrate/inventory.mjs --installation /tmp/her-world-synthetic/installation.json
```

查看待做步骤或当前状态：

```sh
node scripts/migrate/companion-migrate.mjs plan --installation /tmp/her-world-synthetic/installation.json
node scripts/migrate/companion-migrate.mjs status --installation /tmp/her-world-synthetic/installation.json
```

执行前退出全部 DSH 并确认所有写入者停下。正式探测无法确认停写时会拒绝；不拿日常 DSH 作为合成演练环境。备份目录必须是源目录之外的新目录：

```sh
node scripts/migrate/companion-migrate.mjs run --installation /tmp/her-world-synthetic/installation.json --backup /tmp/her-world-migration-backup
```

每轮先建并校验一份同包续做备份，再把本轮步骤、源和目标版本、绑定和备份校验值追加到同一日志。上一轮全部完成且目标仍在时，增加已登记的新步骤后可用新备份目录开下一轮。旧版 0.2.0 单段日志按当时唯一的步骤解释。

中断后先看 `status`。备份已经建好而本轮日志头还未写入时，保留原目录，改用新的备份目录重新开始。日志头已写入时，用步骤和版本契约一致的源码续做最后一轮，会继续使用该轮备份：

```sh
node scripts/migrate/companion-migrate.mjs run --installation /tmp/her-world-synthetic/installation.json --resume
```

失败只输出固定原因代码和说明，退出码非 0。已经提交的步骤通过目标检查后只补齐清单和日志。`status` 的 `segment` 表示最后一轮有没有收尾：`none` 没有日志，`settled` 已收尾，`unfinished` 要用 `--resume` 续做（即使各步骤都显示 `complete`）。已收尾的轮次再 `--resume` 不会重跑步骤，也不追加步骤记录。以前各轮完成的目标后来缺失时，`status` 显示 `inconsistent`，续做和开新一轮都报 `migration-inconsistent`，应核对该轮备份。

日志头记录 `storageId` 和仓库路径摘要。已收尾的轮次只核对 `storageId`，所以按 [portability.md](portability.md) 把 Repo 搬到新路径后，`status` 和下一轮迁移照常可用；未收尾的轮次只能在原路径、用原备份续做。

迁移和恢复按仓库路径互斥。互斥文件在仓库外：`/tmp/her-world-offline-<uid>/<仓库路径的 sha256>.sqlite`，目录权限 0700、只属于当前用户，进程退出或被杀时 SQLite 自动释放，不留陈旧锁。迁移 `run`、本检出的备份 `restore`、钱包封锚、声明预检及浏览器离线操作使用这把锁。已安装旧包里的 `companion-backup.mjs` 不持有，所以回退恢复要用本检出的命令。仓库内的 `.chatpet/data/migration.lock` 照旧：恢复带回的已退出进程旧锁会被下一轮接管并记入日志；若 PID 被复用而报 `lock-held`，先确认迁移和恢复都已结束，再按提示处理旧锁。

要回退安装版本，在旧包下退出 DSH，用 `companion-backup.mjs create` 预先做回退备份，再启动 DSH 从版本页换包。回退时先从版本页换回旧包，再退出 DSH，用本检出的命令恢复旧包对应的回退备份。同包续做备份也可在安装指纹相同的情况下恢复。恢复器先备份当前状态，并保留已送达、已消耗额度及 Life 花费：

```sh
node scripts/companion-backup.mjs restore --installation /tmp/her-world-synthetic/installation.json --backup /tmp/her-world-rollback-backup --before /tmp/her-world-before-restore
```

<a id="upgrade-0-3-0"></a>
### 从 0.2.0 升级到 0.3.0

新版本遇到未迁移的数据会先进入「需要迁移」，所以要先在旧版本下做回退备份、换包后再离线迁移。`$RECEIPT` 是安装回执，命令都在与要装版本同标签的源码检出里跑，而且已经构建：

1. **在 0.2.0 下做回退备份。** 完全退出 DSH，运行 `node scripts/companion-backup.mjs create --installation "$RECEIPT" --output "$ROLLBACK"`，再用 `verify --installation "$RECEIPT" --backup "$ROLLBACK"` 核对。旧 setup 装的机器先按已知问题 8 跑一次 `migrate-core-config --apply`。
2. **换包。** 启动 DSH，在版本页换到 0.3.0。看到设置页「需要迁移」、只有普通聊天可用，是预期。显示 `binding-not-migratable` 时换回 0.2.0，按提示理顺工作区选择和初始化再来。
3. **离线迁移。** 完全退出 DSH 和所有写入者，依次跑 `plan`、`run --backup "$RESUME_BACKUP"`、`status`（命令见上）。该版的三步都 `complete` 且 `segment` 为 `settled` 才算完成；`unfinished` 用 `--resume` 续做。
4. **启动核对。** 启动 DSH，确认工作区就绪，聊天、记忆召回、home 和钱包都正常。
5. **回退（需要时）。** 版本页换回 0.2.0，退出 DSH，用本检出的 `companion-backup.mjs restore` 恢复第 1 步的回退备份（命令见上）。

**换了设备的钱包**：Repo 搬到新设备、新路径后，0.2.0 的 Core 里那条 `economy.initialized` 标记还记着旧路径，`0003` 会报 `economy-marker-binding-mismatch` 停下。换包前先用 0.2.0 在新设备上绑定新路径并打开一次钱包，旧版本打开钱包时会把标记改成新路径，再做第 1 步。

原有恢复 CLI 的输出不属于迁移/盘点的固定原因与隐私输出契约；真实数据检查点不能把其原始输出交给 Agent。开发演练只用合成副本。

真实副本检查点（阶段 2 的 2a 做过一次；改数据格式的阶段都要再做，2b 没改格式所以没做）在独立设备上跑：源机退出 DSH 后，打包伙伴 Repo、安装包和源码 bundle，用隔空投送或移动硬盘传过去，不经云端；新设备按 [portability.md](portability.md)「搬到另一台设备」安装绑定，再盘点、迁移、回退、续做。设备 profile 里的语音、附件不随 Repo 走，新设备上为空属于预期。盘点只给出未登记 kind 的个数；要查是哪几种，只按冒号前的前缀聚合计数，不输出完整 kind 和字段值。恢复命令的输出重定向到本机日志，只取退出码和 `restored` 字段。

<a id="console-wallet-migration"></a>
### Console 钱包迁移

#### 主人声明无待办（0.4.0 → 0.5.0）

在隔离副本演练。用包含声明工具、已构建的 0.5.0 对应源码检出执行离线命令。`RECEIPT`、`ROLLBACK`、`RESUME_BACKUP` 和 `ANCHOR` 都用真实绝对路径，锚放在权限 `0700` 的私有材料目录。

1. 仅在一直使用 DSH 桌面设置页、从未用外部浏览器时采用。在 0.4.0 当前绑定确认钱包正常加载、无待确认、读取错误或在途操作，然后停止新写入、停 Life、退出 DSH。工具会拒绝私有材料目录里的 `wallet-export.json` 或 `wallet-sources.json`，由主人核对其他位置；发现待办或浏览器来源材料就走下方导出路线。
2. 仍装 0.4.0 时，用 `node scripts/companion-backup.mjs create --installation "$RECEIPT" --output "$ROLLBACK"` 建旧备份，再用同一脚本 `verify --installation "$RECEIPT" --backup "$ROLLBACK"` 核对。运行 `node scripts/migrate/companion-migrate.mjs seal-wallet-rollback --installation "$RECEIPT" --backup "$ROLLBACK" --output "$ANCHOR" --owner-attests-no-pending`。
3. 保持业务停写，换到 0.5.0 后再次退出 DSH。用 `node scripts/migrate/companion-migrate.mjs` 依次执行 `plan`、`run`、`status`，均带 `--installation "$RECEIPT" --wallet-rollback "$ANCHOR" --owner-attests-no-pending`。仅 `run` 另加 `--backup "$RESUME_BACKUP"`。中断后用同一工具 `run --installation "$RECEIPT" --resume`。
4. 核对 `0004-console-wallet` 为 `complete`、`segment=settled`、`walletImport.requestCount=0`。再在隔离验收环境打开 0.5.0，核对钱包、余额、库存和 Body。两份备份及锚保留到主人关闭回退窗口。
5. 需要回退时换回 0.4.0 并退出 DSH，以迁移工具 `verify-wallet-rollback --installation "$RECEIPT" --wallet-rollback "$ANCHOR"` 验锚，再用本检出的备份 `restore --installation "$RECEIPT" --backup "$ROLLBACK" --before "$BEFORE_RESTORE"` 恢复并核对钱包和 Body；旧页若显示待办，先核对流水再决定是否按原号处理。

#### 浏览器导出路线

隔离副本从备份到旧键清除一直保持停写。先隔离所有授权 profile／origin 的旧页面和写入口，核实 Economy 与 Body 在途已排空。若无法核实，停在导出之前。浏览器导出、清源和回插函数在 `scripts/migrate/browser-wallet.mjs`，要求调用方持有可复核的来源冻结租约。现有合成适配只用于测试。生产浏览器需要能核验冻结和排空的适配入口。

和回退备份一起封存私有导出。旧包下先完成备份 `create/verify`，再用 `companion-migrate.mjs seal-wallet-rollback --installation "$RECEIPT" --backup "$ROLLBACK" --wallet-export "$EXPORT" --output "$ANCHOR"` 绑定导出与旧备份。停写换包后，迁移 `run --installation "$RECEIPT" --backup "$RESUME_BACKUP" --wallet-export "$EXPORT" --wallet-rollback "$ANCHOR"`。中断后 `run --installation "$RECEIPT" --resume` 核对本轮原件。

验收窗口用隔离的一次性克隆。原副本 `segment=settled`、导入证明和每个待办均核对后，工具才逐源清除原键。回退时保持停写，换回旧包，运行 `verify-wallet-rollback --installation "$RECEIPT" --wallet-export "$EXPORT" --wallet-rollback "$ANCHOR"`，恢复核准的旧备份，验证钱包、存储清单和 Body，再按原值回插。主人关闭回退窗口后才能处理私有导出。历史核验使用持久摘要。

离线入口是 `scripts/migrate/runner.mjs` 的 `runWalletBrowserOperation`：按安装回执确定绑定，持有 Repo 互斥锁，复查 DSH、Core、Economy、Memory（含配置已移除但仍运行的保留 Bank）和工作区绑定；导出前全源复读，清源和回插前核对同一轮导出的迁移或回退证明，逐源比较原值，结束前再复读。可见的竞写报 `wallet-source-conflict`，日志记下冲突并阻止自动续做；无冲突的中断凭同轮 `intent` 续做。v0.4.0 已打开的页面先写 `localStorage` 再发 RPC，程序拦不住这段旧代码，只能靠下面的隔离。

主人在隔离副本上的操作顺序：

1. **隔断旧页和写入口**：停止新业务请求，完全退出使用该副本的浏览器及后台进程，关掉会话自动恢复；确认授权 profile／origin 都在清单内，清源或回退验收前只让获准工具访问原浏览器存储。
2. **排空并停住旧宿主**：停下 Life 和其他写入口，在 v0.4.0 宿主确认 Economy、Body 正常卸载且没有清理错误，再完全退出 DSH。页面关闭、请求取消或进程退出都不算排空证据；拿不到证据、来源无法独占或没有获准的读取适配时，停在导出前。
3. **导出和备份**：停写下由获准适配私有导出原来源；用 v0.4.0 建并核对旧备份，封存同轮锚；确认换包不会重新激活原副本的业务写。
4. **换包和迁移**：原副本继续停写，用 RC 同源码执行 `plan`、带导出和双备份锚的 `run`、`status`，中断用原轮 `--resume`；需要启动 DSH 时只用访问不到原库和原浏览器存储的一次性克隆。
5. **核对及清源**：确认 `segment=settled`、原号、余额、库存和 Body，并验克隆的新页面；主人确认后用同轮日志逐源清旧键，冲突时保留现场并停止放行。
6. **回退**：放行前保持停写，换回 v0.4.0，验锚、恢复旧备份，用单独的同轮日志按原值回插；原号、余额、库存和 Body 核对通过才解除停写。私有导出保留到主人关闭回退窗口，历史只留核对摘要。

<a id="baseline-counting"></a>
## 典型修改的计数

固定起点为 `bfe069f`（M1 基线）；M2 复测的起点是 `d865bff`，5a 重测的起点是 `754a0a5`，分支见源码检出中 `docs/product.md`「典型修改前后对比」。先把修改提交到对应的实验分支，再将 `<分支>` 替换为该分支名执行（M2 复测把 `bfe069f` 换成对应起点）：

```sh
git diff --stat bfe069f..<分支>
```

只统计起点与实验分支之间已提交的差异。分为 `src/`、测试和其他，其他包含跟踪的 build 产物；不为压低数字删除这些差异。按 `arch/layers.json` 的文件根映射模块和层，测试及 `dist/src` 归回相应源码模块，不另造测试层；位于 `src/` 的生成文件仍计入其物理模块，并注明它的生成源。三个分支都只度量，不合并。

在源码检出中用 `pnpm run metrics` 汇总 `docs/product.md`「G5 手工度量」，用 `pnpm run metrics -- --json` 输出 JSON。度量只报告，修复批次占比和典型修改基线显示表中最新一列的人工记录。

## 全量验证与发布

```sh
pnpm run verify
```

这是 PR 与发布共用的检查。先查环境、类型和架构棘轮并构建一次，再递归收集 `dist/tests/**/*.test.js`、`tests/**/*.test.mjs`，各入口执行一次，随后跑 Python Memory 测试、校验发布元数据，并生成和检查一份归档（`scripts/checks/verify.mjs:13–25`）。测试使用可丢弃数据且不调用付费模型。Memory 进程测试需要本机回环，沙箱拒绝监听时记为环境失败并在允许回环的环境复跑（`src/memory/main.py:17`、`tests/memory/memory-process.test.mjs:72–83`）。

PR CI 和发布工作流各自执行全量检查（`.github/workflows/ci.yml:13–16`、`.github/workflows/release.yml:49–53`）。日常只做相关快测。发布入口及脏工作区的隔离方法见[发布与更新说明](github-updates.md#publication)。

## 可选原生检查

`scripts/checks/`、`tests/manual/` 中的原生与窗口检查需要显式指定的隔离环境，不对个人伙伴数据运行。

- `test:native-context`：已安装 DSH 的原生循环与落盘，使用本机脚本模型，核对上下文、互动确认、原始记录和已接受计划。
- `test:native-services`：跨会话 Bank 召回及 provider 重启。
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

- 回退到 0.2.0 的演练 `tests/migrate/home-rollback.mjs` 不在门禁里，要先准备一份装好依赖并构建过的 v0.2.0 检出，再运行 `HER_WORLD_020_ROOT=/absolute/v0.2.0 node --test tests/migrate/home-rollback.mjs`。它核对回退后聊天、召回和共享 home 可用，2a 发版前跑过。

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

运行时 exports、原生 bundle ID 和伙伴数据格式保持稳定。`dist/src` 保留给 GitHub 安装，发布工作流将它与已验证源码一起构建并冻结；`dist/tests`、source map、缓存、工具和个人伙伴数据不交付。普通 build 校验内置媒体，可选重新生成使用 `src/presentation/animation-allocation.json` 与 `art/` 素材。

素材交接、画布与锚点、时序、视觉验收及登记见源码检出中的 `docs/animation-standard.md`。
