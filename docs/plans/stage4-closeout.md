# 阶段 4：收尾（P5）· 激进版

- 级别：大改。跨模块删除兼容层，动高风险目录（`scripts/migrate/`、`package.json` 的 `exports`、`src/core/workspace.ts`），改公开面和发布方式。
- 状态：已确认（2026-11-23 主人：「全部按推荐」）。盘点基点为 `main` 的 `ce19135`。
- 来源：Codex 只读起草两轮（保守版、激进版），Claude 抽查并定稿。
- 方向（主人原话）：「我是目前唯一的用户，我觉得不用太保守，完全可以激进一点，一步到位，清清爽爽」。

## 方向与基线

**支持基线上移到「已迁移的 0.5.0」。** 主人是唯一用户，日常机器已在 0.5.0，钱包迁移已完成（`docs/product.md:441–447`）。所以：

- **删**：只为 0.5.0 之前的版本、旧数据格式、旧安装（`dsh-Chatpet`、`codex-pet`）、旧端点／路径／别名／事件／配置字段服务的代码、脚本、测试、文档段落和迁移路线，以及没有消费者的 npm 导出键。
- **改名**：靠兼容层撑着的混淆命名（provider wire 的 `workspaceId` → `bankId`，`actLegacyGarden` → `actUnadoptedGarden`）。
- **保留**：当前功能真正在用的东西，每项写明「现在谁在用」。Cordis 服务名（`petCore` 等）、插件 ID、默认 bundle、现用 Console RPC 都属于这一类。
- **回退**：从 DSH 版本页换回 0.5.0 包。0.5.0 包自带它需要的旧代码；新版不改落盘格式，所以换包后数据仍可读（验收第 3 步实测）。
- **主人真实数据**：「核对后删」的项先用只读核对脚本在主人提供的停写 0.5.0 隔离副本上跑，脚本只输出字段名、文件数、计数和通过与否（见「只读核对办法」）。命中旧格式的项按证据保留或先用现有功能存成当前格式。
- **不加机制**：「清清爽爽」是删东西。典型修改 7 不建通用设置声明，`contracts/` 不按层搬目录（理由见下文「已知问题和结构取舍」）。

### Claude 定稿时的调整

1. 典型修改 2、3、7 不复做计数：阶段 3 的试做补丁没保留（仓库只剩 `codex/m1-baseline-*`、`codex/m4-measure-1-garden`、`codex/2b-measure-8-*`），总表引用阶段 3 执行记录并注明「原补丁未保留」。
2. 设置窗口夹具（已知问题 13）并进 `codex/p5-entry-cleanup` 作为第一个提交，不单开分支。
3. 三份英文文档（README、`docs/github-updates.md`、`docs/settings.md`）全文译成中文，并进文档批。激进版本来就要大改这三份里的旧安装、旧字段和外观导入段落，顺手翻译成本最低。
4. 执行顺序压成三波（见「执行顺序」），减少分支间来回等待。

## 目标与外部变化

- 功能不变；旧版本、旧安装、旧数据的迁移入口消失：`prepare-store-switch`、`install-dsh --replace-codex-pet`、`companion-migrate` 的 0001–0004 执行路线、`check-native-memory-live` 付费脚本。
- npm 子路径 `her-world/core`、`her-world/contracts`、`her-world/world` 删除；`./cordis.patch.yml`、两个 `locale` 键按隔离包核对结果决定。
- 设置页去掉旧外观导入（`presentationMigration`）和桌宠聊天的「孤儿记录」空壳界面。
- guest 和 Room 电视的回复不再改共享情绪（已知问题 1，待拍板）。
- 设置窗口手动检查恢复可跑（已知问题 13）。
- 发 `0.6.0` 一个正式版，不发 RC；发布说明只写从已迁移的 0.5.0 升级和换回 0.5.0。

### 九项完成标准（激进版）

| # | 判断 | 完成标准 |
| --- | --- | --- |
| 1. 旧适配 | **做（扩大）** | 按下方盘点表逐项删除或改名；「核对后删」的项附只读核对结果。构建归档里退役深路径、npm 键零命中；`pnpm run check:arch -- --report` 新增为零。保留项都写明当前消费者。 |
| 2. 架构与文档 | **做** | `docs/architecture.md`、`docs/decisions.md`、`docs/development.md`、`docs/portability.md`、`docs/settings.md`、`docs/github-updates.md`、`AGENTS.md`、`arch/*.json` 按「要改写或退役的决定与文档」表更新为收尾后的结构；`docs/decisions.md:21–25`「重构期间兼容面保持不变」改写为 0.5.0 支持基线。三份英文文档译成中文。改动文档的相对链接和锚点逐个验证，`git diff --check` 通过。 |
| 3. 典型修改与词表 | **做** | 更新前后对比总表（计数表见下）。词表上限 R8 ≤586、裸字段 ≤30、`kind` ≤282、`action` ≤105、规则新增 0；删除带走的基线条目用工具收紧。 |
| 4. 5b 聊天平台接入 | **延期** | 没有已确认的新平台场景。重开条件写进 product.md：主人确认一个实际平台及私聊／群聊、主人／访客场景。 |
| 5. 典型修改 7 | **不再做** | 记录收益评估和「不建通用字段声明」的决定，保留 3 文件／2 层的未达标结论。 |
| 6. `contracts/` 拆分 | **不拆** | 保留共用物理目录，删掉无消费者的 `./contracts` npm 出口；写清照料表由第二层拥有。第 8 题按原口径收尾。 |
| 7. 发布说明 | **做（改写）** | 0.4.0 钱包迁移两条路线退役，发布说明改为「从已迁移的 0.5.0 升级、换回 0.5.0」，操作入口留在历史 tag `v0.5.0`。 |
| 8. 设置窗口夹具 | **做** | 见「已知问题 13 的修法」，沙箱外 Electron 跑通退出 0。 |
| 9. 门禁、体检与发版 | **做** | 全量门禁、行为清单全绿；G8 体检；`0.6.0` 正式包隔离激活 + 换包回退演练通过后升日常机器。 |

## 范围变化

扩大范围的依据是主人改了方向（原话见上）。

- **替换或延期了什么**：替换了保守版「只删三处内部转发、其余兼容面全保留」的第 1 项；替换了 `docs/decisions.md:21–25` 的兼容面不变原则和 0.4.0 钱包迁移的两条现行路线。5b 继续延期。
- **当前闭环怎么验收**：全量门禁 + 行为清单 + 设置窗 Electron + 0.6.0 隔离激活 + 换回 0.5.0 的双向读回。
- **原完成标准还算不算数**：九项全部保留，第 1、7 项口径改为上表。
- **对应的用户场景**：主人日常使用的原生聊天、桌宠、Room、QQ／微信、语音，见 `docs/product.md:10–18`；没有新增场景。

## 执行顺序

| 波次 | 内容 | 并行 |
| --- | --- | --- |
| 第一波 | `codex/p5-entry-cleanup`（含设置窗夹具）、`codex/p5-memory-policy`、`codex/p5-offline-retirement`、`codex/p5-package-setup` 的源码和测试准备；同时 Codex 写只读核对脚本 | 四个分支各开 worktree 并行；共享写点（`package.json`、`workspace.ts`、Console 客户端、PetPlatform、`arch/`）按「批次、阈值与高风险路径」表串行合并 |
| 主人一步 | 提供停写的 0.5.0 隔离副本，跑只读核对脚本，把输出（只有字段名、计数、通过与否）给 Claude | — |
| 第二波 | `codex/p5-data-retirement`，只删核对未命中的旧读法 | 依赖第一波合并和核对结果 |
| 第三波 | `codex/p5-acceptance-docs`（文档、翻译、度量、G8 体检）→ 全量门禁 → `0.6.0` | 串行 |

单个提交照旧 ≤15 文件、600 行；`dist/src/**` 构建产物和工具生成的基线另计。`src/desktop/platform/client.js` 的生成差异计入阈值。纯删除超阈值时一律拆开，不申请例外。

## 改动范围

下面的盘点基于 `main` 的 `ce19135`；安装后的 DSH 加载情况和真实数据形状标为**待核实**，由只读核对和隔离包验收补证。行数是预计改动量。

### 一、入口、转发与现用服务

| 项目 | 判定和同步改动 | 预计改动 |
| --- | --- | ---: |
| Life 回顾写作转发 | **删** `review-writing.ts` 和 `review.ts` 的再导出。让 `review.ts` 使用 Core 的 `CompanionWritingScope`，原生回顾检查直接调用 `readCompanionWriting`。保留日期日记、自述和自述历史的原断言。`src/living/plan/review-writing.ts:1–3`、`src/living/plan/review.ts:8–16`、`src/core/companion-writing.ts:19–59`、`src/core/companion-foundation.ts:11,171,203`、`src/core/records.ts:11,75,120`、`scripts/lib/check-life-review.mjs:9,88–91,133–135`、`scripts/checks/check-native-life.mjs:14`。 | 15–35 行 |
| 群资料 `Options.deviceDirectory` | **删 helper 别名**。生产传的是 `dataDirectory`，测试换成相同入参。**保留 Channels 的设备配置** `deviceDirectory`，账号连接需要它。验证群和账号隔离、重载及越权拒绝。`src/channels/group-material.ts:27–30,64–69,294`、`src/channels/messaging.ts:58,67,118–119`、`src/channels/plugin.ts:171–177`、`tests/infrastructure/group-material.test.ts:13–15,74,122`、`tests/regressions/mapped-group-name-wake.test.mjs:48–53`、`docs/architecture.md:531–534`。 | 12–25 行 |
| Body `companionFeelings` | **删转发**。Body、桌宠和测试直接用 `COMPANION_FEELINGS`。**保留**仍由 Body 输出的 `behaviorPresentation` 及混合情绪顺序。`src/contracts/emotion.ts:2–6`、`src/living/body/presentation.ts:2–5,22,32–45`、`src/living/body/plugin.ts:338,401`、`src/desktop/platform/plugin.ts:13,32`、`tests/desktop/pet-platform.test.mjs:13,266–270`。 | 12–30 行 |
| Desktop 语音深路径 | **删全部八个转发**。迁测试到 `dist/src/voice/upstream/host/`。`stage3-voice-upstream` 改验新入口的 ESM 和 CJS 共享注册、撤销及取消。`scripts/build/build-desktop-animation.mjs:37–55`、`src/voice/plugin.ts:23,53–64`、`tests/life/voice-and-life-library.test.ts:38,62`、`tests/room/room-voice-window.cjs:22`、`tests/behavior-list/presentation-voice.test.mjs:7,66`、`tests/regressions/stage3-voice-upstream.test.mjs:8–16`、`tests/regressions/audit-r4-voice-rate.test.mjs:7`、`docs/architecture.md:240`。干净构建清 `dist`，归档检查再核对旧路径零命中。`scripts/build/clean-build.mjs:1–6`。 | 35–80 行，另删 8 个生成文件 |
| `lifeDates`、`lifeJournal`、`lifeAlbum`、`lifeSearch`、`lifePhoto`、`lifeForgetPhoto` | **保留六条现用 Console RPC，删 `petLife.library()` 空转门面**。Console 现已直达 Core 的 `records.library`。Room 的 `roomHistory` 提供 Room 对话，`archiveFind` / `archiveRead` 查 Memory，两者都无法替代日记、相册和照片撤回。为删六个名字再造一条通用 RPC，收益只剩改名。同步把文档里的「兼容端点」改成「Core 记录库端点」。保留 Room 拒绝 `lifeDates` 和 Life 卸载后仍能查日记的断言。`src/console/settings.ts:34–40,183–184`、`src/core/console-operations.ts:22–41`、`src/core/records.ts:114–120`、`src/console/plugin.ts:23–37`、`src/console/client.js:399,405,417,419,425,432`、`src/desktop/platform/client.js:17420,17426,17438,17440,17446,17453`、`src/living/plan/plugin.ts:17,718–720`、`src/presentation/room-transport.ts:8–39`、`src/room/plugin.ts:99`、`tests/room/room-transport.test.mjs:61,86,93–140`、`tests/behavior-list/entries-lifecycle.test.mjs:978–1018`、`docs/product.md:451`。 | 10–25 行 |
| `economyAction`、`economySettings` | **保留**。当前 Console 用它们操作钱包和保存经济设置，持久请求也用它们识别原操作。保留 `economyPending/Check/Retry/Abandon` 和断线后的原号查证。`src/console/settings.ts:48–50,113–137`、`src/console/client.js:546,588,598,637`、`src/living/economy/console-requests.ts:7`、`tests/behavior-list/console-wallet.test.mjs:28–48,66–128,156–219`、`docs/architecture.md:81–82,188`。 | 0 行 |
| `desktopAppearance` RPC | **删**这条只有回归测试调用的默认值读取。当前外观编辑器由生成客户端提供，旧便携外观的 Core 校验按下文单独判断。R7 的重复登记断言改测现用 `foundation` 或 `presentationTiming`，保留独立外观解析测试。`src/core/console-operations.ts:4,42–45`、`src/core/companion-settings.ts:4,76`、`src/console/settings.ts:36,42`、`src/console/client.js:1258`、`scripts/build/build-pet-platform.mjs:426–428`、`tests/behavior-list/presentation-r7.test.mjs:518–556`、`tests/desktop/desktop-appearance.test.ts:3–7`。 | 25–65 行 |
| Desktop `chat/memory` | **删端点和当前客户端的空壳调用**。现有 GET 永远给空 `orphans`，DELETE 返回 405。用现有生成器一次去掉孤儿记录获取、清除及其确认 UI。保留聊天设置、原生会话打开及现用记录操作。以当前桌宠设置实测没有请求旧 URL、其他操作照常为准。`src/desktop/platform/plugin.ts:710`、`src/desktop/platform/client.js:14497–14517,14622–14660,14726–14733,14954–14968,15047–15052,15624`、`scripts/build/build-pet-platform.mjs:30,401–447`。 | 40–100 行手写，另计生成 diff |
| Room 媒体 URL、播放回包 | **保留**。Room 当前按这些 URL 取媒体，`activity-playback.js` 也直接导入 `media-playback.js`。现有 Room 和桌宠消费播放回包。`src/presentation/animation-allocation.json:30,3713`、`scripts/build/build-animation-map.mjs:16–25,31–42`、`src/room/assets.ts:6,22,162–168`、`src/presentation/playback.ts:4–17,130–153`、`tests/life/life-media.test.mjs:113–136`、`tests/room/room-transport.test.mjs:144–148`、`docs/decisions.md:268`。 | 0 行 |
| 旧 Life 事件 | **删残留** `pet/life.changed` 和 `pet/life.review` 的专用反例和旧说明。`pet/behavior.changed`、`pet/economy.fact` 已无当前发布或订阅，`pet/economy.changed` 也未见运行引用。Channels 保留当前、过期绑定的 `world.changed` 两条断言。架构夹具继续用虚构的未登记事件验证检测能力。`src/living/index.ts:166–188,347–379`、`arch/layers.json:60–61,73,101`、`tests/behavior-list/channels.test.mjs:15–41`、`scripts/arch/fixtures/known-violations/src/memory/events.ts:2`、`tests/arch/known-violations.test.mjs:23`、`docs/architecture.md:628,636`、`docs/product.md:351,455`。 | 15–40 行 |

Cordis 的旧名字有两种情况。以下是每个名字现在的消费者，括号里的行数是建议改动量。

| 判定 | 服务及当前调用 |
| --- | --- |
| **保留**（0 行） | `petCore` 由 Core 提供，Memory、Emotion、Voice、Console、Channels、Life、Room、Desktop 都从它拿绑定或能力。`src/core/plugin.ts:12,36`、`src/memory/plugin.ts:6–14`、`src/emotion/plugin.ts:316,342`、`src/voice/plugin.ts:71–80`、`src/console/plugin.ts:19–25`、`src/channels/plugin.ts:172–179`、`src/living/plan/plugin.ts:737,770`、`src/room/plugin.ts:222–227`、`src/desktop/plugin.ts:9,57`。 |
| **保留**（0 行） | `petWorld` 由 Core 创建，原生会话、Emotion、Console、Room、Life 和 Economy 用它查会话归属、模块或准入。`src/core/plugin.ts:38–39`、`src/world/service.ts:2,9–14`、`src/core/native/agent.ts:20,33`、`src/emotion/plugin.ts:176,316`、`src/console/plugin.ts:20`、`src/room/chat.ts:142`、`src/living/plan/plugin.ts:87,737`、`src/living/plan/plan-tools.ts:117`、`src/living/economy/plugin.ts:500,529`。 |
| **保留**（0 行） | `petMemory` 供 Core 判断已装的 Memory 生命周期。`petEmotion` 供 Body、桌宠和 Console 查询或呈现，也由 Channels guest 接入。`src/memory/plugin.ts:7,14`、`src/core/plugin.ts:58–62`、`src/emotion/plugin.ts:318,345`、`src/channels/guest.ts:21–25`、`src/core/companion-foundation.ts:156`、`src/core/tables/console.ts:48–55`、`src/living/body/plugin.ts:191,317`、`src/desktop/index.ts:287`、`src/desktop/platform/plugin.ts:404,858–859`。 |
| **保留**（0 行） | `petBehavior` 供 Room 和桌宠做照料、活动呈现。`petLife` 供桌宠查看生活状态，也是可独立装卸的门面。`petEconomy` 供 Console 写钱包。`petTranscripts` 供 Life 恢复原生会话。`src/living/body/plugin.ts:499–509`、`src/room/plugin.ts:67–96,133–149`、`src/desktop/features.ts:121,168`、`src/desktop/platform/plugin.ts:255,399,617–623,757`、`src/living/plan/plugin.ts:240,737–789`、`src/desktop/index.ts:289`、`src/living/economy/plugin.ts:500–521`、`src/console/plugin.ts:20`、`arch/layers.json:7`。 |
| **保留**（0 行） | `petRoom`、`petDesktop`、`petPlatform` 分别支持 Room 开窗、桌宠呈现和原生平台接线。`petChannels` 是原生 Channels 检查实际调用的宿主入口，也作为 Console 和 Life 出口的隔离标签。`src/room/plugin.ts:223–243`、`src/desktop/plugin.ts:11,60`、`src/desktop/platform/plugin.ts:43–45,185,211,315,323–360,853`、`src/desktop/features.ts:68`、`src/desktop/index.ts:288`、`src/channels/plugin.ts:178–184,200`、`scripts/lib/check-messaging.mjs:207–215`、`src/core/tables/console.ts:48–55`、`src/living/outlets.ts:21,24–45`。 |
| **删直读转发，保留现用隔离键**（30–75 行） | `petVoice` 的直接 Cordis 对象目前由测试读取。产品的 Room、桌宠和 Channels 走 `VoiceTable`，保留 `70-Voice` 和表里的 `petVoice` 隔离键。取消、撤销和反序装载改从 Room／桌宠／VoiceTable 验同一行为。主人 profile 如有实际 `inject: petVoice`，待核实后处理具体引用。`src/voice/plugin.ts:70–97`、`src/core/tables/voice.ts:6,15–20,33–44`、`src/desktop/platform/plugin.ts:711–716`、`arch/layers.json:130–132`、`tests/core/capabilities.test.mjs:72,146`、`tests/behavior-list/families.test.mjs:105`、`tests/behavior-list/presentation-voice.test.mjs:16–87`、`tests/behavior-list/presentation-r7.test.mjs:13,112–125`。 |

### 二、安装与 npm 公开面

| 项目 | 判定和同步改动 | 预计改动 |
| --- | --- | ---: |
| `prepare-store-switch` | **删**脚本及唯一专用测试，移除 `test:release` 对该测试的引用。旧工具只读 `dsh-Chatpet/00-Core`、拼新 profile 覆盖。`core-config` 的 YAML 表达式解析仍用于保持当前 profile 内其他条目，删掉对旧脚本的注释引用即可。`scripts/prepare-store-switch.mjs:1–38`、`tests/infrastructure/release-flow.test.mjs:9–34`、`package.json:123`、`scripts/lib/core-config.mjs:171–182`、`docs/github-updates.md:14–21`。 | 75–90 行 |
| `install-dsh` 的 `codex-pet` 替换和旧 `--archive` | **删** `--replace-codex-pet`、旧包快照分支和卸载调用，删旧归档参数的专用提示及断言。**改名**新装才用的默认 Core 和 setup 备份目录。已绑定安装沿用回执/配置解析出的绝对路径，即使目录名还含 `codex-pet`。保留当前 setup 的默认备份、失败回滚、包状态比对、已配置的 Core 和 Bank。`scripts/install-dsh.mjs:31–52,212–222,225–253,331–350,420–428,445–478`、`tests/behavior-list/setup-config.test.mjs:83–103`、`tests/regressions/audit-r5-install-receipt.test.mjs:119–164`、`tests/infrastructure/first-install.test.mjs:27`、`tests/core/core-install-config.test.mjs:12–19,240–247`。 | 65–155 行 |
| `migrate-core-config` 和旧 provider 入口识别 | **删旧安装搬配置路线**，包括从旧包内取覆盖、靠两份 Python 文件字节推认旧安装目录的分支。当前工具还有两个可用的恢复动作：给现用 npm profile 补安装回执、凭经交叉核验的已完成回执恢复丢失的 Core 覆盖。**保留这两段**，收成同一个离线修复入口，推荐命名 `repair-core-config`。保留显式 `--memory-service-entry bundled` 及配置中确有使用的自定义入口；核对是否依赖自定义 provider 后再改 wire。`scripts/install-dsh.mjs:21,35,46–48,125–163,268–329,405–408`、`scripts/lib/core-config.mjs:23–76,101–124,157–182`、`tests/core/core-install-config.test.mjs:72–239,266–313`、`docs/decisions.md:174–186`、`docs/portability.md:17,37–43`。 | 100–260 行 |
| 备份格式里的 `codex-pet` | **保留**。`codex-pet.offline-data-backup` 是 0.5.0 的备份创建和校验双方共同使用的格式标识。当前同包恢复和 v0.5.0 回退演练都需要它。`scripts/lib/offline-backup.mjs:12,234–271,391–432`、`scripts/companion-backup.mjs:79–100`、`tests/infrastructure/offline-backup.test.mjs:51–79`、`docs/portability.md:67–116`。 | 0 行 |

### `package.json` 导出逐键判断

通用打包检查会遍历导出并确认文件存在。这条检查能证明声明可打包，消费者另见下表。`scripts/checks/check-release.mjs:18–24`、`scripts/checks/check-runtime-package.mjs:48–53,115`。

| 导出键 | 判定及消费者 |
| --- | --- |
| `.` | **保留**。默认 bundle 的 `chatpet-settings` 从包根装 Console。`package.json:7,29`、`cordis.patch.yml:32–33`、`src/console/plugin.ts:6,18–37`。 |
| `./core` | **删** npm 键。仓内 `00-Core` 和测试分别走插件入口和相对路径。内部 `src/core/index.ts` 是现用工厂。`package.json:8,14`、`src/core/plugin.ts:4,20`、`tests/core/workspace.test.ts:9`、`scripts/checks/check-release.mjs:16`。 |
| `./contracts` | **删** npm 键。仓内调用都走源文件相对路径。共用类型和词表继续由 `src/contracts/` 提供。`package.json:9`、`src/contracts/index.ts:1–13`、`src/core/native/conversation.ts:9–11`、`src/living/plan/plugin.ts:24–28`。 |
| `./world` | **删** npm 键。仅有两个仓内测试用包子路径，改用编译入口。`petWorld.modules` 及 `src/world/index.ts` 继续由 Core 的服务组装、Memory 批处理和 Console 模块清单使用。`package.json:10,93`、`tests/world/world-foundation.test.mjs:7`、`tests/world/world-modules.test.mjs:6`、`tests/manual/companion-settings-window.cjs:48`、`src/world/service.ts:2,9–14`、`src/core/plugin.ts:38,51`、`src/console/settings.ts:179`。 |
| `./package.json` | **保留**。Core 初始化、Room、Desktop、外观资源和 PetPlatform 用它定位安装包根。`package.json:11`、`src/core/initialization.ts:12`、`src/room/window.ts:56`、`src/desktop/index.ts:180`、`src/desktop/appearance.ts:9`、`src/desktop/platform/plugin.ts:23`、`src/desktop/platform/migration.ts:27`。 |
| `./cordis.patch.yml` | **删，DSH 加载方式待核实**。仓内 setup 根据 `dsh.bundle.patch` 读包内相对文件，无子路径导入。先用隔离包证明 DSH 也能发现 patch、启用所有插件，之后删导出键；包内文件及元数据继续供宿主装载。`package.json:12,44,159–162`、`scripts/install-dsh.mjs:115–120`、`scripts/checks/check-release.mjs:15,21–24`。 |
| `./locale/*.json` | **保留待核实**。随包提供根插件本地化元数据；仓内无自导入，实际消费者应在 DSH 插件界面。隔离包分别核对中文和英文的插件描述，查明 DSH 是否经此键取文件。若宿主也无消费，再删。`package.json:13,45`、`locale/en.json:1–5`、`locale/zh.json:1–5`、`locale/zh-CN.json:1–5`。 |
| `./00-Core/locale/*.json` | **保留待核实**。单独核对 DSH 的 `00-Core` 模块描述，根插件的验收替代不了它。`package.json:14–15,45`、`cordis.patch.yml:2–3`、`locale/core/en.json:1–5`、`locale/core/zh.json:1–5`、`locale/core/zh-CN.json:1–5`。 |
| `./client` | **保留**。DSH 浏览器入口加载设置页和外观编辑器，生成器负责组合。`package.json:16,47,163–170`、`docs/settings.md:223–236`、`scripts/build/build-pet-platform.mjs:426–448`、`src/console/client.js:1291–1295`。 |
| `./00-Core`、`./10-Memory`、`./20-Emotion` | **逐键保留**。默认 bundle 各自加载三者。`package.json:14,23,17`、`cordis.patch.yml:2–7`。 |
| `./22-Economy`、`./25-Behavior`、`./40-Life` | **逐键保留**。默认 bundle 分别装卸钱包、身体、计划。`package.json:18–19,24`、`cordis.patch.yml:8–11,16–17`、`docs/architecture.md:541–570`。 |
| `./30-Desktop`、`./35-PetPlatform`、`./50-Room`、`./60-Channels`、`./70-Voice` | **逐键保留**。各自有默认 bundle 条目。`package.json:20–22,25–26`、`cordis.patch.yml:12–15,18–23`。 |
| `./channel-guest` | **保留**。默认外部聊天预设实际装载它，Channels、Core 和群资料还按预设 ID 判断来源。`package.json:27`、`cordis.patch.yml:24–31`、`src/channels/guest.ts:5–7`、`src/channels/sessions.ts:193–220`、`src/channels/group-material.ts:270`、`src/core/plugin.ts:45`。 |

这一批估 **15–50 行**。三个 bin 都有现用入口。`imports` 四项由当前 Body、Economy、Channels 和 Console 消费。`files` 保留必需产物、Python、备份和搬家工具，可去掉包里独立的 `src/console/client.js` 源输入，前提是归档递归校验及 DSH 设置窗口确认只消费生成的 `./client`。`package.json:30–67,80–82`、`src/living/body/initial-state.ts:1–2`、`src/living/economy/store.ts:1–15`、`src/channels/group-material.ts:6–13`、`src/console/settings.ts:14`、`scripts/build/build-pet-platform.mjs:443–448`。默认 bundle 的名称、模块 ID、`chatpet-channel-preset` 和 `chatpet-settings` 继续供当前宿主使用。`cordis.patch.yml:2–33`。

### 三、旧数据读写和钱包迁移

**同一个旧名称可能对应三种东西：废弃导入器、当前数据的选址，或者防重放证据。** 本期可以把导入器退掉。后两种要先证实当前数据已经脱离该路径。比如钱包迁移完成只证明钱包已到目标版本，日记仍可能直接从 Life 目录读取。`docs/product.md:441–447`、`src/core/workspace.ts:203–241,324–328`、`src/core/record-paths.ts:5–18`。

| 项目 | 判定、同步和验收 | 预计改动 |
| --- | --- | ---: |
| `maxHistoryMessages`、`memoryColdHours` | **核对后删**。查看托管 `core.json`、Core `preferences/current`、有效 DSH 配置及回执是否还有这两个键。删除读时剥离和旧参数专用校验，仍严格拒绝未知当前字段。把旧档测试改为有效当前字段能保存、未知字段被拒绝。`src/core/options.ts:11–17`、`src/core/workspace.ts:333–337`、`src/core/companion-settings.ts:64–76`、`scripts/lib/core-config.mjs:11–20`、`tests/core/core.test.ts:103–123`、`tests/core/core-install-config.test.mjs:25–35`、`docs/settings.md:277–284`。 | 35–85 行 |
| 工作区清单 v1／v2、`STATE.md`、旧初始化标记 | **核对后删**旧读法和空旧标记接管。同步收紧 runtime 与 offline setup/backup 的准入。`STATE.md` 实物留原位，仍需防止有存量时被误作全新 Repo。保留当前标记的安全续做以及坏清单、缺库、外来绑定拒绝。`src/core/workspace.ts:20–41,193–201,244–279,324–328,405–456,620`、`scripts/lib/repo-storage.mjs:82–103`、`tests/core/workspace.test.ts:217–254`、`tests/infrastructure/first-install.test.mjs:64–81,259–311`、`arch/storage.json:7–13`。 | 60–140 行 |
| 旧位置的日记、自述、自述历史、相册 | **核对后删**路径探测。若当前仍用旧路径，它就是记录库权威位置，本轮保留；可先用已确认的离线搬移办法统一位置，再删选择逻辑。同步检查照片 SQLite 与附件、自述旧版本、回顾写入和 `manifest.json` 声明。`src/core/record-paths.ts:7–18,27–30`、`src/core/records.ts:10,23–24,114–120`、`src/core/companion-writing.ts:9,20,35–59`、`src/core/companion-foundation.ts:12,39`、`src/core/workspace.ts:364`、`src/living/plan/plugin.ts:18,82`、`src/living/plan/review-files.ts:5,43`、`scripts/lib/check-life-review.mjs:1,18,88–91,133–135`、`tests/behavior-list/entries-lifecycle.test.mjs:978–1018`、`arch/storage.json:45–46`、`docs/settings.md:293–297,391–395,463`。 | 25–75 行 |
| 原生提示词退休 | **核对后删**历史段名分支，**保留**解绑时移除伙伴私有上下文、现用动态段的位置替换及原生日志。当前 `previousSections` 里还有现用 `chatpet.expression-guide`，需要保留其当前生命周期语义。核对可恢复会话里仍活动的旧快照，不能只看原日志中有没有旧段名。`src/core/native/prompt.ts:14–15,23–63,65–86`、`src/core/native/agent.ts:11,175`、`src/emotion/plugin.ts:235,303–306`、`scripts/checks/check-native-workspace.mjs:85–100,198–210,272`、`tests/memory/native-memory-flow.test.mjs:201`、`docs/architecture.md:485,503`。 | 20–60 行 |
| Desktop 旧外观导入 | **核对后删**旧 JSON 回退、一轮外观字段搬运、冲突处理/回执写入、`presentationMigration` RPC 和界面。需确认主文件是 `main-config.jsonc`、无未解决或中断的冲突，且没有只靠旧便携字段才能恢复的外观。当前 `saveTiming()` 和重载仍调用导入器，先接回现用配置读写，主宠 ID 按已存 PetPlatform 配置解析，验多宠及空外观编辑器。保留正在消费的气泡、时长等设置。`src/desktop/platform/migration.ts:9–34,67–68,114–127,133–220`、`src/core/initialization.ts:41–55,67–76`、`src/core/companion-settings.ts:2,6–43,54–76`、`src/desktop/platform/plugin.ts:12,63,120,135–139,287–324,536,820,835–842`、`src/console/settings.ts:42`、`src/console/client.js:753–770,1161,1258`、`tests/behavior/presentation-migration.test.ts:7–38`、`tests/behavior-list/concepts-desktop.test.mjs:64`、`tests/manual/companion-settings-window.cjs:273–288`、`arch/baseline/writers.json:3796–3828`、`docs/decisions.md:278–282`、`docs/settings.md:243–252`。 | 290–440 行手写及测试 |
| 情绪旧 Core 行导入 | **核对后删**从 `emotion-state` 行初始化的回调。已有 `state.json` 可以带 `importedLegacy` 和来源字段。只要当前文件还含这些键，就保留原样读取，避免严格键校验挡住整个情绪文件。`roomMood` 照常由当前 Room 使用。以新建、读已有、改心情、旧 Core 行无法覆盖、坏档拒绝为验收。`src/core/initialization.ts:67–79`、`src/core/workspace.ts:453`、`src/emotion/plugin.ts:55–60,73–88,99–100,137–145`、`src/emotion/state.ts:8,23–30,36,63–78,103`、`src/contracts/emotion.ts:21–31,40–42`、`tests/emotion/emotion-state.test.ts:26–80`、`arch/storage.json:19`、`docs/settings.md:214–215`。 | 30–80 行 |
| Body 旧目录、Life 计划和事实 | **核对后删** Body 的旧目录选择、仅为旧计划放宽的旧形状，及确无数据使用的旧事实类型。已有 `data/life/home.json` 仍被 Body 读写时保留选址。保留 Life 的 `life.json`、Core `companion-home`、仍在运行的计划、同号续做和历史事实。收窄计划读法前，须证明全部当前落盘计划用新提交解析器也能读；历史事实有未知类型就保留读宽写严。`src/living/body/plugin.ts:180–199`、`src/living/body/room.ts:134–164`、`src/living/economy/adoption.ts:76–89`、`src/living/plan/plan.ts:109–185`、`src/living/plan/plugin.ts:522,611–616`、`src/core/workspace.ts:157–169`、`src/contracts/interaction.ts:48–64`、`src/core/native/conversation.ts:9–10,202–228`、`tests/life/life-domain-integration.test.ts:105–194`、`tests/behavior-list/concepts-facts.test.mjs:66`、`arch/storage.json:38–40`、`docs/decisions.md:206–210,254–258`。 | 30–95 行 |
| 旧钱包 JSON 导入与当前菜园 JSON | **删已采用钱包的旧导入路线，条件删除首次采用导入**。`EconomyStore` 的导入仅在开库前发生。若产品继续支持先玩 Body 菜园、以后第一次开启 Economy，`garden.json` 仍可能是下一版刚写出的数据，首次采用导入仍有当期生产者。建议保留这条首次交接，去掉专为过时布局的来源探测；`actLegacyGarden` **改名** `actUnadoptedGarden`。已采用钱包缺库时继续拒绝回到 JSON。历史 `legacy-import` 流水保留，当前钱包页读取它们。`src/living/body/room.ts:134–164,168–214,1173–1196`、`src/living/economy/plugin.ts:65–102,157–168,219`、`src/living/economy/store.ts:83–125,258–270`、`src/living/economy/types.ts:37–65`、`tests/behavior/room-garden-json.test.ts:25–63`、`tests/life/autonomous-life.test.ts:255–258`、`tests/life/life-domain-integration.test.ts:181–194`、`tests/behavior-list/domains.test.mjs:103–215`、`arch/storage.json:34,40,43`、`docs/decisions.md:45–49,212–216`。 | 20–95 行 |
| 旧钱包请求指纹与历史流水 | **核对后删** `legacyWalletDigest`。主人声明 0004 零条导入，有助于排除浏览器待办，无法单凭它排除 SQLite 里已经提交的旧请求。核对旧指纹是否仍用于查证。同样，若流水仍有历史 kind，保留透传或显示。同步把 `wallet-rollback-040` 的现用断线、冲突、重试断言移到 `console-wallet`。`src/living/economy/console-requests.ts:98`、`src/living/economy/plugin.ts:23,245–268`、`src/living/economy/types.ts:37–50`、`tests/migrate/wallet-rollback-040.mjs:202–215,380–463`、`tests/economy/economy-recovery.test.ts:281–293`、`tests/behavior-list/console-wallet.test.mjs:66–219`。 | 20–60 行 |
| Channels 旧策略与资料路径 | **核对后删**设备 `messaging.json` 拆出便携策略及删旧策略的启动写回。设备连接和当前 Repo `preferences.json` 都保留。检查旧设备目录是否还有 `group-material`、`conversations`、`qzone-*` 或旧微信资料。没有实际依赖时，删启动扫描及 `CHANNEL_MIGRATION_REQUIRED`。保留设备 `wechat.json` 和现用资料的 Repo 路径保护。命中且存有权威数据时，先从对应版本完成搬移；当前扫描只是拒绝启动，未找到生产搬移入口。`src/channels/messaging-storage.ts:6–45`、`src/channels/messaging.ts:21,58`、`src/channels/storage.ts:4–53`、`src/channels/plugin.ts:18,50,171–177`、`scripts/lib/check-messaging.mjs:165,207–215`、`tests/infrastructure/offline-backup.test.mjs:40`、`arch/baseline/writers.json:1089–1137`、`docs/architecture.md:531–534`。 | 40–95 行 |
| Channels 旧收件行 | **删专门的旧形状叙述和仅构造旧行的测试接线；保留原键去重**。`receivedAt` 旧行目前因已有键而被抑制，当前代码没有重放其正文的逻辑。有旧行就让已有键继续阻止重送。清理旧行会丢去重证据。保留 `qq-input`、`qq-batch`、微信/桥的当前收据及备份保护。`src/channels/qq-inbox.ts:25–33,36–55,67–104`、`tests/regressions/audit-qq-recovery.test.mjs:55,79,103,148`、`tests/behavior-list/channels.test.mjs:118–141`、`scripts/lib/offline-backup.mjs:309,338–366`、`tests/infrastructure/offline-backup.test.mjs:149–165,198–203`、`arch/storage.json:14–18`。 | 10–30 行 |
| Memory 的旧 Bank、启动修补与只留档的 Core 行 | **保留**显式绑定 Bank、禁止选中别的绑定的 Bank、已有 Bank 的路径选择。**核对后删**启动时补旧投影的扫描，先确认没有未投影的合格来源；正常 observe、回读、撤回和投递信封排除照常。`native-memory-action/view` 属于旧留档，登记为只留档即可，实物随原数据留存。`src/core/native/memory.ts:48–54`、`src/memory/client.ts:27–30,55–67`、`scripts/lib/repo-storage.mjs:108–123`、`src/memory/provider.py:42–65,67–107,126–145,267–305`、`tests/memory/memory_provider_test.py:95,312`、`arch/storage.json:60–61`、`docs/architecture.md:182`、`docs/portability.md:17,59`。 | 15–55 行 |

### 钱包 0004 与离线迁移整体退役

- **删 0.4.0 → 0.5.0 两条执行路线**，包括主人声明、浏览器来源导出、清源、回插、封锚和续做。定义和调用集中在 `companion-migrate.mjs`、`runner.mjs`、`wallet-{export,rollback}.mjs`、`browser-wallet.mjs`、`steps/0004-console-wallet.mjs`。旧浏览器残留键留原位，现页照常从钱包库查待办。`scripts/migrate/companion-migrate.mjs:7–45`、`scripts/migrate/runner.mjs:18–22,38–74,107–150,166–276`、`scripts/migrate/wallet-export.mjs:9–89`、`scripts/migrate/wallet-rollback.mjs:20–204`、`scripts/migrate/browser-wallet.mjs:45–146`、`scripts/migrate/steps/0004-console-wallet.mjs:3–92`、`src/console/client.js:546,569–605`、`docs/development.md:137–166`、`docs/release/notes.md:3,11–28`。
- **删 0001–0003 的执行步骤和旧轮次运行器**。`0001` 给存储清单打版本、`0002` 搬共享 home、`0003` 搬钱包采用标记。这些步骤在 0.5.0 基线之前，下一版旧档可拒写并指向对应旧 tag。存储盘点仍有当前用途，保留 `inventory.mjs` / `inventory-plan.mjs` 的当前盘点能力，抽掉对步骤文件的依赖及旧标记专用诊断。`scripts/migrate/steps/0001-storage-manifest.mjs:1–18`、`scripts/migrate/steps/0002-home-identity.mjs:6–82`、`scripts/migrate/steps/0003-economy-marker.mjs:6–123`、`scripts/migrate/runner.mjs:22,199–276`、`scripts/migrate/context.mjs:4–36,73–81`、`scripts/migrate/inventory.mjs:8–20,48–106`、`scripts/migrate/inventory-plan.mjs:8–28,48–100`、`docs/development.md:68–134`。
- **保留 0.5.0 的落盘格式和完成凭证**。保持 `arch/storage.json` 的版本值，继续接受新装 `fresh` 证明及已完成的 `migrations.jsonl`。Core 会用日志的 `walletImport.proof` 过绑定门槛；钱包用 `economyAdopted` 防止目录同时丢失后造新钱包；完成日志也可能包含首轮旧头。历史步骤描述在这个读取器里是现有数据的校验表，可以标明用途，不能和执行步骤一起拔掉。删 Console 的「当前源码跑迁移／`--resume`／换回 0.2.0」指令，保留损坏、异绑定、旧存储、迁移未完成时的固定拒写结果。`arch/storage.json:3,34,42–43`、`src/core/storage-migration.ts:13–46,80–103,121–166`、`src/core/workspace.ts:39–41,203–243,297–303,606–607`、`src/living/economy/adoption.ts:47–71`、`src/console/settings.ts:147–160`、`src/console/client.js:1239–1245`、`tests/core/workspace.test.ts:30–80`、`tests/behavior-list/domains.test.mjs:191–215`。
- **删迁移专用测试，移出用于保护现用行为的断言**。删除 `browser-wallet`、`console-wallet`、`wallet-rollback-040`、`wallet-rollout-child` 的旧导入、清源和回插；删除 `normal`、`metadata-normal`、`home-flow`、`home-rollback`、`economy-marker`、`crash`、`journal-exists`、`migration-child` 和旧迁移 `cli-errors/refusals` 场景。`binding` 保留当前绑定拒绝，`concurrency/lock-gate` 保留现用 restore 互斥，`inventory*` 和 `read-only` 保留当前盘点、SQLite WAL 及不写源的覆盖。`settlement`、`rollback` 和 `compatibility` 中仍有价值的断言改在 0.5.0 布局上验证。仓外目录的直接依赖在 `families`、`domains` 两处，先去掉对迁移 helpers 和 runner 的进口，留下「Body 已生效、钱包只结算一次」和「日志挡住钱包复活」；同步行为清单。`tests/migrate/compatibility.test.mjs:6–33`、`tests/migrate/concurrency.test.mjs:27–33,89`、`tests/migrate/read-only.test.mjs:24,49–58`、`tests/migrate/settlement.test.mjs:9–13,56–58`、`tests/migrate/wallet-rollback-040.mjs:13–16,181–215,380–477`、`tests/behavior-list/families.test.mjs:11–14,143–162,242–243`、`tests/behavior-list/domains.test.mjs:9–11,191–215`、`tests/behavior-list/index.json:211–247,1772–1781,1855–1928`。已知问题 9 随旧夹具退役，当前已送达事实必须能召回的测试继续保留。`docs/product.md:246`、`scripts/fixtures/synthetic-companion.mjs:41–62,104`。

迁移源码和测试目录实数是 **42 个 `.mjs` 文件、4,534 行**，包括要保留的盘点与当前安全断言。预计这一项净删约 **3,350–3,950 行**。`scripts/migrate/runner.mjs:1–276`、`scripts/migrate/inventory.mjs:1–106`、`tests/migrate/wallet-rollback-040.mjs:1–477`。

### 四、只读核对办法

建议复用现有盘点的绑定校验、SQLite 私有副本和计数办法，临时增加阶段 4 的固定字段检查。输入限主人提供的已停写 0.5.0 隔离副本及对应 profile／回执。SQLite 连同 WAL 复制到受限临时目录，仅读副本。配置和原生日志在本地解析，程序只输出预设路径标签、文件名、字段名、布尔值、计数和固定失败代码。解析错误、未覆盖输入或隔离核验失败都返回 `unknown`，该项不取得删除证据。`AGENTS.md:57–64`、`scripts/migrate/inventory.mjs:14–35,48–106`、`scripts/migrate/inventory-plan.mjs:17–28,48–100`、`docs/development.md:70,80–85,132–134`。

| 核对范围 | 允许输出的结果 |
| --- | --- |
| 配置、profile、包 | 两个退休字段是否存在及次数；旧包/旧覆盖/自定义 provider/显式旧入口/直接 `petVoice` 注入的有无；完整现用 Core 绑定校验是否通过。核对生效层、各原始层及回执，防止被上层覆盖后漏报。`scripts/install-dsh.mjs:115–163`、`scripts/lib/core-config.mjs:157–167`、`src/core/workspace.ts:333–337`。 |
| Repo、Desktop、日记与情绪 | 清单是否为当前格式；初始化标记是否属旧格式；旧位置各类文件数量、当前解析器是否选中旧位置；Desk 冲突/中断次数、旧外观是否还有独有设置；是否有情绪旧行及其唯一权威是否已在 `state.json`。目录中仍有留档可单独计数。`src/core/workspace.ts:200–201,324–328`、`src/core/record-paths.ts:7–18`、`src/desktop/platform/migration.ts:133–206`、`src/emotion/state.ts:63–78`。 |
| 原生会话与 Bank | 可恢复会话里仍活动的退休段计数；Bank 中未投影的合格旧观察数；现用 Bank 唯一性和绑定校验通过与否。检查本地范围内的内容结构，输出禁止会话 ID、Bank ID、字段值、正文及原始异常。`src/core/native/prompt.ts:65–86`、`src/memory/provider.py:42–65,88–145`、`scripts/lib/repo-storage.mjs:108–123`。 |
| Life、钱包、Channels | 旧 Body 位置是否仍生效；当前计划通过严格解析的数量；旧事实、旧流水类型和需旧指纹的收据数；钱包完成凭证校验结果、未结请求数；设备文件中旧策略键数、待迁资料数、只含 `receivedAt` 的去重行数。浏览器存储不进入这次检查。`src/living/plan/plan.ts:109–185`、`src/living/economy/adoption.ts:47–89`、`src/living/economy/plugin.ts:245–268`、`src/channels/messaging-storage.ts:21–38`、`src/channels/storage.ts:16–44`、`src/channels/qq-inbox.ts:49–55`。 |

核对命中后，**能用现有 0.5.0 功能保存成当前格式的，先在隔离副本验证再删**。例如重新保存剔除退休设置键。只有旧位置存了一份日记或旧收件行仍承担去重时，保留必要读法。若需要改真实数据，仅凭这次只读核对没有授权；任何预处理还必须验证 `v0.5.0` 能读其结果，才能维持换包回退承诺。`tests/core/core.test.ts:106–123`、`src/core/record-paths.ts:5–18`、`src/channels/qq-inbox.ts:49–55`、`docs/decisions.md:27–37,88–92`。

### 五、已知问题和结构取舍

| 项目 | 推荐 |
| --- | --- |
| **1 · guest／电视 footer** | **推荐两者都禁止写共享情绪**。当前已经有来源声明及完成时授权，直接把 guest、电视分支的 `footer` 改成 `false`，更新策略行；主人私聊、主人 QQ／微信、Life／回顾沿用现有授权。流处理继续剥离控制 footer，完成处理走原租约校验。测试覆盖 guest 与电视不改共享状态、主人来源仍会生效；再覆盖同轮多个来源，确保客人或电视发起的轮次不会借另一个来源授权落盘。约 55–120 行。`src/channels/sessions.ts:59–91`、`src/room/chat.ts:83–108`、`src/core/native/conversation.ts:109–125,149–165`、`src/emotion/plugin.ts:282–299`、`src/living/plan/tool-policy.ts:71–81`、`tests/behavior-list/policy-qq.test.mjs:54,99–108`、`tests/behavior-list/policy-room.test.mjs:50,180–186`、`tests/behavior-list/index.json:317–414,601–613`、`scripts/checks/check-native-services.mjs:103–112`、`docs/architecture.md:421–426,456`。 |
| **2 · Provider `workspaceId`** | **改 wire 为 `bankId`**。删除 TS 的第二份 scope 形状，`CHATPET_MEMORY_SCOPE` 和 HTTP `scope` 都传 `bankId`。Python `main.py` 启动参数和 `MemoryPort` 的请求校验同一提交改名。**磁盘的 `pet_scope.workspaceId` 保持为当前持久格式**：在 Python 入站校验后构造一次磁盘 scope，复用这一份给已有 SQLite 元数据的精确匹配、召回过滤和新写入。保留 Mnemosyne `workspace_id`、库键、Core `memory-session` / `memory-source-work` 记录形状。这样旧记录能被新包读，新记录也能被 0.5.0 读，无需双 wire 或重写 Bank。隔离里若确认有自定义 provider，先让该入口切到包内或同步改造。验证不同工作区 ID / Bank ID、旧记录的召回和撤回、异 Bank 拒绝、升级后写入再换回 0.5.0。约 60–140 行。`src/memory/client.ts:11–12,55–67`、`src/memory/main.py:22–36`、`src/memory/provider.py:21–28,47–64,80–84,149–190,226,267–305,403–465,497–555`、`src/core/native/memory.ts:49–54,152–153,175–187,206–214`、`tests/memory/memory-process.test.mjs:11,76`、`tests/memory/memory_provider_test.py:95,185–189,312`、`tests/regressions/audit-r6-memory-scope.test.mjs:43,67–70`、`tests/regressions/audit-r2-memory-self.test.mjs:12–13,45`。 |
| **3 · `EXPIRED_USE`** | **删该未使用错误码和 `Exclude`**。当前字面值只在拒绝码联合及辅助函数签名出现，未找到生产构造或测试消费者。让 `reject()` 直接接 `RejectedCode`，保留结构化 `effect/retry`。约 2–8 行。`src/contracts/common.ts:19–36`、`src/core/storage.ts:5–15`、`src/console/settings.ts:79–88`、`docs/product.md:243,446`。 |
| **10 · 付费检查读旧 `archive`** | **删旧脚本，关闭这条问题**。仓内未见门禁、包脚本或开发手册把它当现行入口。当前 `test:native-services` 和 provider 测试已覆盖跨会话召回及重启。以后明确要做付费体验，再针对 npm 归档和实际安装源码设计一次检查。净删 **445 行**。`scripts/checks/check-native-memory-live.mjs:163–178,439–445`、`scripts/install-dsh.mjs:469–478`、`package.json:95,107,128`、`scripts/checks/verify.mjs:13–24`、`docs/development.md:187,191–197`、`docs/product.md:247`。 |
| **12 · 换绑时在途的一次桌宠关闭** | **保留当前行为，维持已接受的边界**。本层在每只宠物派发前后都复核绑定，已交给上游的那一次仍可能收尾。为了追回这一笔要改变上游写盘取消契约或序列化换绑和所有相关写入，范围超过清理。回归覆盖 A→B／A→B→A、新工作区和后续宠物不受影响。调整问题位置到当前行。`src/desktop/platform/plugin.ts:335–349`、`tests/desktop/pet-platform.test.mjs:123–153`、`docs/product.md:225–233,244`、`AGENTS.md:65–67`。 |

- **典型修改 7：停止做通用设置声明。** Core 已统一便携设置的默认值、范围与校验。页面控件和实际消费各有明确位置，Channels 已有可复用的局部通用表单。阶段 3 已实做出 3 个手写文件／2 层，把未达 1／1 如实关账。`src/core/companion-settings.ts:6–43,54–76`、`src/console/client.js:1103–1111`、`src/emotion/recent.ts:71–72`、`src/channels/messaging-settings.ts:12`、`docs/architecture.md:516–518`、`docs/product.md:108,128,446,471`、`6dd3e4c:docs/plans/stage3-presentation.md:173–179`。
- **`contracts/`：保留共用物理目录，去掉无消费者的 npm 出口。** 照料表由 Living 拥有，Core、呈现和测试需要同一语义；事实还要与 Python 双向核对。按物理层搬文件会为了过度量再添跨层入口，实际新增行为还要编写执行、提供者和 Python 联动。第 8 题按原口径收尾，照料文件数达标、物理层未达标，事实领域未达标。`arch/layers.json:33–43,54–63`、`src/contracts/behavior.ts:10–69,100–101`、`src/contracts/interaction.ts:1–24,48–64`、`tests/memory/fact-attribution-contract.test.mjs`、`docs/architecture.md:57,519–520`、`docs/product.md:109,123–124,424,472`。
- **保留保守版其余收尾工作。** 设置窗夹具接真实 Cordis Context，用合成提供者走语音缺席、登记、撤销；保留外观、情绪、计时、草稿、取消和窄屏断言。5b 留到有实际新平台再做。计数表继续引用阶段 3 留下的 2、3、7 结果并注明原补丁未保留。`tests/manual/companion-settings-window.cjs:58–62,101–122,255–312`、`tests/behavior-list/fixture.mjs:81–101`、`tests/behavior-list/presentation-voice.test.mjs:48–67`、`docs/product.md:450,469–475`（见「典型修改前后对比与词表」「已知问题 13 的修法」）。

### 六、要改写或退役的决定与文档

| 位置 | 改动 |
| --- | --- |
| `docs/decisions.md:21–25`、`AGENTS.md:63,97` | 改成 0.5.0 支持基线。保留正在装载和运行的 bundle 标识、入口和协议；退休项按调用证据删除，遇到真实数据依赖时按核对结果处理。 |
| `docs/decisions.md:27–43,168–172,200–204,284–288`、`AGENTS.md:37,59–61,83` | 区分本次**换包回退**和灾难恢复。退役两份备份串联的旧迁移路线、四个旧执行步骤和当前版 `--resume`；保留未来确要改存储时的停写、幂等和旧数据保护原则。文档改指对应历史 tag。 |
| `docs/decisions.md:45–49,51–55,206–216,254–258` | 写清现用菜园 JSON／首次采用交接、共享 home 所有权、日志采用证据和历史事实读取。钱包待办说明改为当前持久请求。`docs/decisions.md:106–110` 的固定原因码原则转由当前盘点和离线校验承接。 |
| `docs/decisions.md:174–186` | 退役旧 setup 搬 Core 配置，只写当前 npm 安装、profile 覆盖、经核验的回执修复和失败回滚。 |
| `docs/decisions.md:266–282` | 去掉 0.4 浏览器导出期限这段活跃操作说明；退役实际已删除的外观 R1 例外；阶段 3 双发记录引用历史，下一版采用单正式包。保留当前播放、钱包请求和仍有消费的例外。 |
| `docs/architecture.md:180–202,240,421–456,485,503,507–520,528–570,586–611,628–641` | 更新实际数据所有权、语音入口、会话权限、服务表、当前版回退和阶段关闭状态。删旧事件说明、迁移运行顺序和已退役适配。同步 `arch/layers.json`、`arch/storage.json`。实际删掉的规则项只用工具收紧基线。`AGENTS.md:36–37,65–70`。 |
| `docs/development.md:68–166,187–212`、`docs/portability.md:17–19,37–43,67–116` | 删旧升级、封锚、续做、旧包演练操作。留下隔离核对、现用 setup/搬家、备份/恢复、无付费验证和正式包验收。 |
| `docs/settings.md:214–215,223–252,269–284,293–297,391–395,463`、`docs/github-updates.md:9–26,28–45` | 修正设置槽位 ID，删退役字段、外观导入和旧安装切换说明，按实际检查结果写当前记录位置。触及的英文小节按仓规改为中文。`src/console/client.js:1291–1295`、`AGENTS.md:7`。 |
| `docs/product.md:201–218,235–248,439–459,463–477`、`docs/release/notes.md:1–28` | 改阶段 4 验收标准；更新问题 1、2、3、9、10、12、13 的结果或边界。保留 0.5.0 已迁移的验收结论，旧操作说明由历史 tag 承接。下一版发布说明只写从已迁移 0.5.0 怎么升级、走哪些实际入口、怎么换回。 |

### 七、批次、阈值与高风险路径

预计净删 **4,100–5,300 行手写源码、测试和文档**，另有生成产物。区间主要取决于旧迁移测试能迁回多少现行断言、真实外观/工作区/Channels 还依赖哪些旧读法。已数到的整文件删除候选中，付费脚本 445 行、旧换包工具 38 行、外观导入器 228 行。`scripts/checks/check-native-memory-live.mjs:1–445`、`scripts/prepare-store-switch.mjs:1–38`、`src/desktop/platform/migration.ts:1–228`。

**普通纯删除也受 15 文件／600 行约束。** 方案预先写明构建产物、工具生成基线另计。`src/desktop/platform/client.js` 虽然由构建生成，目前规则只明确豁免 `dist/src/**` 和脚本基线，所以该客户端的 diff 要计入 600 行。删除整份完成的方案属于现有例外。如果确实要用一个超过阈值的纯删除提交，须在定稿里列具体文件和行数并确认；建议用下表拆开。`AGENTS.md:65–70,81`。

| 分支 | 依赖、允许修改的路径与提交切法 |
| --- | --- |
| `codex/p5-entry-cleanup` | 可先做。允许 `src/living/plan/{review,review-writing,plugin}.ts`、`src/living/body/presentation.ts`、`src/desktop/platform/plugin.ts`、`src/channels/group-material.ts`、`src/voice/plugin.ts`、`src/core/console-operations.ts`、`src/console/settings.ts`、两个桌宠构建器中实际生成语音与客户端的部分、`scripts/lib/check-life-review.mjs`、上表点名的语音／Room／桌宠／群资料测试和 `arch/layers.json`。内部转发、语音深路径、`petVoice`、两个 Console/Desktop 退役 RPC、旧事件各独立提交。客户端生成差异较大的提交单独计数。 |
| `codex/p5-memory-policy` | 可与迁移、安装分支并行。允许 `src/memory/{client.ts,main.py,provider.py}`、`src/core/native/memory.ts`、`src/core/native/conversation.ts`、`src/emotion/plugin.ts` 的 footer 接线、`src/channels/sessions.ts`、`src/room/chat.ts`、`src/contracts/common.ts`、`src/core/storage.ts` 的 `reject()`、对应 Memory/策略测试和 `scripts/checks/check-native-services.mjs`。wire、权限、错误码、付费脚本删除各一提交。若情绪数据批也改 `src/emotion/plugin.ts`，先合 footer 改动。 |
| `codex/p5-offline-retirement` | 可先在合成副本做。允许 `scripts/migrate/**`、`tests/migrate/**`、`scripts/fixtures/synthetic-companion.mjs`、`tests/behavior-list/{domains,families,index}.…` 对应文件、`src/core/{storage-migration,workspace}.ts` 的存储准入、`src/console/{settings.ts,client.js}` 的旧迁移提示、`arch/storage.json` 的迁移条目，以及保留互斥测试所需的 `scripts/companion-backup.mjs` / 现有备份测试。先迁出现行断言，后分组删旧测试。`wallet-rollback-040` 和 child 共 503 行一提交，两个钱包迁移单测共 414 行一提交。运行器、CLI 与 0004 约 422 行一提交，浏览器/导出/封锚三文件 439 行一提交。0001–0003 在盘点解开引用后删，其他旧测试按原文件大小每批不超 600。 |
| `codex/p5-data-retirement` | 依赖只读核对，且在离线批稳定后接 `workspace.ts`，在入口批后接 PetPlatform。允许 `src/core/{options,workspace,record-paths,initialization,companion-settings}.ts`、`src/core/native/{agent,prompt}.ts` 的旧提示词部分、`src/emotion/{state,plugin}.ts`、`src/desktop/platform/{migration,plugin}.ts`、`src/console/{settings.ts,client.js}` 的旧外观接线、`src/living/{body,plan,economy}` 与 `src/channels/{storage,messaging-storage,qq-inbox,plugin}.ts` 中上表点名的兼容分支、相关测试、`arch/{layers,storage}.json`。配置清单、记录路径、外观、情绪、生活钱包、Channels 各提交。实际命中的项目从删除提交剔出。 |
| `codex/p5-package-setup` | 可并行做源文件和测试，涉及 `package.json`、迁移 helper 或 `arch/storage.json` 的提交在前置批合并后落主线。允许 `scripts/{install-dsh,prepare-store-switch}.mjs`、`scripts/lib/{core-config,repo-storage}.mjs`、`package.json`、`scripts/checks/{check-release,check-runtime-package}.mjs`、`tests/{core/core-install-config,infrastructure/{release-flow,first-install},regressions/audit-r5-install-receipt,behavior-list/setup-config,world/world-foundation,world/world-modules}.test.mjs`。两种旧安装、当前修复入口、导出各独立提交。 |
| `codex/p5-acceptance-docs` | 先可独立修 `tests/manual/companion-settings-window.cjs`。文档最终汇总在上面各分支之后。只改本方案列出的文档、`AGENTS.md`、行为清单中受影响条目，构建及规则基线随各对应源码提交。Claude 定稿和合并，Codex 实现及验证。 |

表中的 `tests/behavior-list/{domains,families,index}.…` 实际是 `domains.test.mjs`、`families.test.mjs`、`index.json`。共享的 `package.json`、`workspace.ts`、Console 客户端、PetPlatform 和 `arch/` 分批串行落地。可并行的是没有共享写点的准备和测试。基线只用 `pnpm run check:arch -- --write-baseline` 清理消失的条目。`AGENTS.md:54–70`、`docs/development.md:38–50`。

### 高风险逐项与回退

| 路径 | 本期处置与回退 |
| --- | --- |
| `scripts/migrate/` | 退役旧执行路线，保留当前盘点。旧档确需处理时用相应 `v0.5.0` 或旧 tag 的源码及匹配包；本次升级只换回 `v0.5.0` 包。`scripts/migrate/runner.mjs:22,199–276`、`docs/development.md:120–166`。 |
| `scripts/lib/offline-backup.mjs` | 保留现行格式、停写、安装指纹和恢复保护。若盘点清理揭示只服务旧迁移的分支，单独提交且跑原 `offline-backup` 测试。备份恢复用创建该备份的同版本包和工具。`scripts/lib/offline-backup.mjs:12,145–179,234–275,309–366,391–432`。 |
| `scripts/lib/repo-storage.mjs` | 只在真实清单证据通过后收紧旧清单准入。保留当前 setup 选 Repo、搬 Core／Bank、备份定位和无写源探测。回退使用 0.5.0 的同包工具，数据路径和清单保持可读。`scripts/lib/repo-storage.mjs:34,82–123,215–307`、`scripts/install-dsh.mjs:372–403,458`。 |
| `src/core/storage.ts` | 只收 `reject()` 的死类型分支。无数据库变更，换回 0.5.0 包即可。`src/core/storage.ts:5–18,92–99`。 |
| `src/core/workspace.ts` | 分开提交旧格式准入与旧迁移指导的清理。保持当前存储版本、证据读取、绑定校验和写入形状。隔离环境先测升级，再写一笔当前数据后换回旧包。`src/core/workspace.ts:203–241,297–303,324–339,405–456`。 |
| `package.json` 的 `exports`、`files`、`imports` | 删已核实的导出和可证实多余的打包项。`imports` 当前四项继续由包内生产者使用。`verify`、归档和 DSH 入口验证通过后才发布；回退包包含旧出口。`package.json:6–28,35–67`、`scripts/checks/check-runtime-package.mjs:48–53,115`。 |
| `cordis.patch.yml` | 当前所有条目有 DSH 消费，建议保留。以后如果单独改 bundle，隔离验收必须包含原覆盖、启停及 guest 恢复，再试换回 0.5.0。`cordis.patch.yml:2–33`、`scripts/install-dsh.mjs:125–149`。 |
| 发布流程 | 保留 `.github/workflows/` 现有版本冻结、验证和下载核验。`check-release` 可把专门拒旧包名的断言改为核对现行 bundle 条目与实际导出。`github-updates.md` 改消费和操作说明。回退不覆盖已发标签或版本，从版本页选 `0.5.0`。`.github/workflows/release.yml:24–67,68–109`、`scripts/checks/check-release.mjs:15–24`、`docs/github-updates.md:30–45`。 |


### 典型修改前后对比与词表

计数沿用 `git diff --stat <起点>..<实验提交>`，同时保存逐文件差异。按实验点的物理目录判层，测试和产物归回源码模块，分列手写源码、`src` 生成文件、测试、`dist` 和其他文件。实验分支只度量。依据 `docs/development.md:169–179`、`docs/product.md:98–109,115–128`。

| 题 | 可复核差异与当前判断 |
| --- | --- |
| 1. 小萝卜 | 实查 `bfe069f..codex/m1-baseline-1-garden`、`6ba9b00..codex/m4-measure-1-garden`，前后都是手写 1、测试 1、产物 1，第二层 1 模块。**达标**。`docs/product.md:102`。 |
| 2. Room 口渴 | 实查 `bfe069f..codex/m1-baseline-2-room`，手写 1、测试 1、产物 1。阶段 3 记录也是 1／1／1、第三层 Room。**按执行记录达标**，原补丁未保留，不复做。`docs/product.md:103,450`、`6dd3e4c:docs/plans/stage3-presentation.md:145`。 |
| 3. QQ 主动额度 | 实查 `bfe069f..codex/m1-baseline-3-channel`，手写 3、源码生成 1、测试 1、产物 6，第三层 3 模块。阶段 3 记录手写 2、测试 1、产物 6，第三层 Channels 1 模块。**按执行记录达标**，原补丁未保留，不复做。`docs/product.md:104,113,450`、`6dd3e4c:docs/plans/stage3-presentation.md:150–155`。 |
| 4. 工具 | 基线 4a／4b／4c 为 1／2／4 个手写文件。实查 `d865bff..991c6fb`、`..5d1ef47`、`..9cfaeb7`，三题各手写 1、测试 1、产物 2，第二层 1 模块。**达标**。`docs/product.md:105,119,126–128`。 |
| 5. 输入来源 | 实查 `754a0a5..9be0496`，5a 手写 2、测试 1、产物 4，第二层 1 模块。超过最多 1 个手写文件的门槛，**未达标**。5b 的旧读码下限至少 5 个自有文件，**延期**，不填实做数。`docs/product.md:106,120,126–128`。 |
| 6. 上下文段 | 旧读码下限 1–2 个文件。原主线已停做段声明，**不设目标**。核对仍有登记和退休接点即可。`docs/product.md:107,121,128`、`docs/decisions.md:162–166`、`src/core/native/prompt.ts:27–63,99`。 |
| 7. 设置项 | 旧读码至少 3 个手写文件。阶段 3 试做手写 3、测试 1、产物 6、2 层，**未达标**。原补丁未保留，不复做。`docs/product.md:108,122,450`、`6dd3e4c:docs/plans/stage3-presentation.md:178`。 |
| 8. 照料动作、事实领域 | 实查 `b24c381..4399a2d`、`..190cbb2`，照料手写 1、测试分别 1／2、产物各 3，改在物理第一层 `contracts`，文件达标、层不达标。实查 `b24c381..982361d`，事实领域手写 8、测试 1、产物 12、文档 1。业务手写涉及 2 层 3 模块，Core 有生成类型联动，**未达标**。保留缺文案的类型失败、缺计划登记的 schema 失败、Python 缺领域的契约失败。`docs/product.md:109,123–124`。 |

**典型修改 7 的收益判断。** 伙伴便携设置已在 Core 集中默认值与校验。页面控件、提交和实际消费有各自职责，试做跨两层。QQ／微信确实已经从 Channels 的字段描述派生通用表单，可继续在该边界复用。为了给伙伴设置再省两个计数文件，需要扩展跨层字段声明并迁移既有接线，目前没有一组已确认设置需求来回收成本。建议 P5 不建通用字段系统。证据为 `src/core/companion-settings.ts:6–43,54–76`、`src/console/client.js:1103–1111`、`src/emotion/recent.ts:71–72`、`src/channels/messaging-settings.ts:12`、`docs/architecture.md:516–518`。

**`contracts/` 拆分的收益判断。** 把 `BODY_ACTIONS` 移到第二层，能让照料题的物理归层更贴近业务拥有者，但 `FACT_TYPES.body` 又从该表派生，Core、呈现和计划继续共用事实类型。事实领域还受 Python 识别和上游 `FactRef` 约束，换目录省不掉这些改动。建议保持当前目录，写清业务拥有者与物理归层。下一次有真实照料或事实需求时，再以消费链和差异判断是否值得拆。依据 `src/contracts/behavior.ts:10–46`、`src/contracts/interaction.ts:1–24`、`src/memory/provider.py:76–91`、`docs/architecture.md:57,519–520`、`docs/product.md:109`。

**方案起点与验收上限。** `pnpm run check:arch -- --report` 已实际运行，退出 0。规则 9 条全为 R1，R2–R4 为 0，规则和 R8 均新增 0、消失 0。R8 当前 586 条，`pnpm run metrics -- --json` 拆出 556 条重复或子集关系、30 个裸字符串字段。`kind` 282 点／48 文件，`action` 105 点／14 文件，合并为 387 点／52 文件。按原口径有 33 条模块间依赖，手写超 1500 行文件为 0。`docs/product.md:454` 的 590 是阶段 3 中的记录，P5 起点采用当前报告。命令实现及口径见 `package.json:125–126`、`scripts/arch/check.mjs:11–57`、`scripts/arch/metrics.mjs:78–111`。

推荐用 **R8 ≤586、裸字段 ≤30、规则 ≤9 且新增为 0** 作本期验收上限，`kind ≤282`、`action ≤105`。按概念逐个核对：照料、角色房间、计划身体动作各从 `BODY_ACTIONS` 派生，七种计划 kind、阅读状态、九种 feeling、Room 七维均各一份，身体呈现分类器一套，第二层 `roomClip`／`desktopClip` 为零处。只因真正移除重复而减少的基线，随对应提交用工具收紧。依据 `src/contracts/behavior.ts:10–69,100–101`、`src/contracts/emotion.ts:2–6`、`src/living/body/presentation.ts:11–29`、`src/presentation/playback.ts:4–17`、`docs/product.md:162–179`、`docs/development.md:47–50`。

### 已知问题 13 的修法

夹具在 `tests/manual/companion-settings-window.cjs:101–106` 构造普通对象，直接交给 `PetPlatform`。语音请求进入 `src/desktop/platform/plugin.ts:711–716`，`VoiceTable.lookup()` 在检查登记是否存在之前调用 `serviceIsolation()`。`src/core/tables/registry.ts:4–7` 要访问 Cordis 根和 `Context.isolate`，普通对象没有这套上下文。我用仓库已有构建产物做了只读探针，普通对象得到 `TypeError`，真实 `new Context()` 无登记时得到 `undefined`，登记后可查，撤销后恢复 `undefined`。因此只开一个 Voice 假服务、只补 `get()` 或只吞异常，都无法验证实际隔离边界。依据 `src/core/tables/voice.ts:15–29,33–44`。

建议只改夹具。用真实 Cordis `Context` 承载 `PetPlatform` 的夹具依赖，沿用已有 fixture 的根、隔离标签、fiber 组织方式。保留目前的临时 Repo、`.venv/bin/python` 和真实 `settingsHandler`。在同一根的有效作用域以 `voiceTable.register()` 登记一个纯内存语音提供者，走 `/chatpet-presentation/voice/voices` 验证缺席、登记、撤销。结束时撤销登记和 scope、停 IPC 与 HTTP、关 Core 和窗口。产品 `VoiceTable`、隔离逻辑和 Voice 插件本身无需改动。依据 `tests/behavior-list/fixture.mjs:81–101`、`tests/behavior-list/presentation-voice.test.mjs:48–67,90–103`、`src/voice/plugin.ts:72–86`、`tests/manual/companion-settings-window.cjs:58–62,107–122,309–312`。

## 特殊情况

- **空状态与装卸。** 无 Voice 走真实 503，登记撤销后晚到结果失效；Life 缺席时日记仍从 Core 读；已采用钱包缺库仍拒绝重新建库。`src/desktop/platform/plugin.ts:711–716`、`src/core/tables/voice.ts:33–44`、`tests/behavior-list/entries-lifecycle.test.mjs:978–1018`、`tests/behavior-list/domains.test.mjs:103`。
- **旧档。** 仍是 0.5.0 之前存储版本的数据，新版固定拒写，并提示用 `v0.5.0` tag 的工具先迁移；不再在当前源码里续做。`src/core/workspace.ts:203–243`、`src/console/settings.ts:147–160`。
- **核对命中。** 主人副本里确有旧字段或旧位置的数据：能用 0.5.0 现有功能重存成当前格式的，在隔离副本验证后再删读法；不能的保留该读法，并写进体检的保留理由。
- **环境故障。** 回环、临时目录、Electron、`/bin/ps` 被沙箱拒绝记为环境失败，到沙箱外复跑（`AGENTS.md:56–58`）。
- **发布失败。** 隔离正式包激活、设置读回、真实流程或换包回退任一失败，停住日常升级；修代码后重新冻结验收。`.github/workflows/release.yml:39–97`、`docs/github-updates.md:30–44`。

## 概念与扩展检查

无新增概念、词表、设置、输入来源、能力行或持久记录。照料、计划 kind、阅读状态沿用既有基础表，业务拥有者是生活世界。情绪词表沿用第一层契约。呈现的播放和媒体映射沿用第三层。兼容性删减只收内部转发，没有新的层间调用或新的包导出。夹具沿用第一层语音表的租约和隔离，真实语音与媒体行为按既有契约验收。依据 `docs/architecture.md:208–241,247–274,507–520`、`arch/layers.json:33–63,104–115,127–132`、`src/core/tables/voice.ts:15–44`。

## 拍板记录

| 需要主人拍板的点 | 推荐 | 决定 |
| --- | --- | --- |
| 1. 支持基线和发布方式 | 下一版从已迁移的 0.5.0 升级；按本方案点名的高风险范围删除；只发一个 `0.6.0` 正式版，隔离激活和换回 0.5.0 演练通过后再升日常机器 | 按推荐 |
| 2. guest／Room 电视回复能否改共享情绪（已知问题 1） | 两者都不能写；主人私聊、主人 QQ／微信、Life／回顾沿用现有权限 | 按推荐 |
| 3. 只读核对用的隔离副本 | 主人在第一波期间提供一份停写的 0.5.0 隔离副本；Agent 只看脚本输出的字段名、计数和通过与否 | 按推荐 |

## 验收

### 批次快测

先 `pnpm run build`，再跑本批相关用例。命令入口见 `package.json:92,102,115,125–128`、`docs/development.md:26–50`。构建清理旧 `dist` 的逻辑见 `scripts/build/clean-build.mjs:1–6`。

| 对象 | 命令与通过线 |
| --- | --- |
| 回顾转发 | `node --test tests/life/life-review-runtime.test.mjs`。随后在可用的隔离 DSH 环境跑 `pnpm run test:native-life`。保持原日期日记、自述、历史回读断言。`tests/life/life-review-runtime.test.mjs:1`、`scripts/lib/check-life-review.mjs:88–91,133–135`、`scripts/checks/check-native-life.mjs:1–27`。 |
| 群资料目录 | `node --test dist/tests/infrastructure/group-material.test.js tests/regressions/mapped-group-name-wake.test.mjs tests/behavior-list/channels.test.mjs`。账号和群隔离、重启收件、旧事件反例照常。`tests/infrastructure/group-material.test.ts:10,120`、`tests/regressions/mapped-group-name-wake.test.mjs:48–55`、`tests/behavior-list/channels.test.mjs:15,118`。 |
| 情绪别名及保留路由 | `node --test tests/desktop/pet-platform.test.mjs dist/tests/regressions/mapped-playback.test.js tests/room/room-transport.test.mjs tests/regressions/stage3-voice-upstream.test.mjs tests/behavior-list/presentation-voice.test.mjs`。`tests/desktop/pet-platform.test.mjs:266–282`、`tests/regressions/mapped-playback.test.ts:145–220`、`tests/room/room-transport.test.mjs:93–140`、`tests/regressions/stage3-voice-upstream.test.mjs:7–16`、`tests/behavior-list/presentation-voice.test.mjs:16–87`。 |
| 词表和旧安装 | `pnpm run check:arch -- --report`、`pnpm run metrics -- --json`、`node --test tests/behavior-list/concepts-{care-settings,plan,facts}.test.mjs tests/memory/fact-attribution-contract.test.mjs tests/core/core-install-config.test.mjs tests/infrastructure/repo-storage.test.mjs`。保持原行为、基线新增 0、无候选之外的产物删除。`docs/development.md:38–50,179`、`package.json:95,123,125–126`、`tests/behavior-list/concepts-care-settings.test.mjs:48`、`tests/core/core-install-config.test.mjs`。 |
| 文档 | `git diff --check`，复核本批 `git diff --stat`，逐个打开改动过的相对链接与 Markdown 锚点。历史方案引用指向可取回的 Git 版本，如 `6dd3e4c:docs/plans/stage3-presentation.md:145,155,178`。`docs/development.md:35,169–179`、`AGENTS.md:81,98`。 |

### 全量门禁与真实入口

在合并候选的同一源码上执行 `pnpm run verify`，再执行 `pnpm run test:behavior-list`。前者包含环境、类型、架构、构建、所有 Node 测试、Python Memory、发布元数据和归档检查。后者核对索引，每个 L1／L2 恰好一次并通过。阶段 3 的 1777／170 只用作历史对照，P5 记录实际数量、退出码、提交与归档摘要。依据 `scripts/checks/verify.mjs:13–25`、`scripts/checks/run-behavior-list.mjs:39–43`、`docs/development.md:53–65,181–189`、`docs/product.md:457`。

至少单独执行一次 `node --test tests/behavior-list/concepts-flow.test.mjs` 并记录 `2B1-12`：

1. 在真实 Console 入口提交 `lifeAction(feed)`，核对 Body 状态变化以及设置页来源的事实。
2. 合成一次原生日志落盘失败，确认事实仍待确认。恢复落盘后才确认。
3. 在另一会话召回该事实。关闭并重建夹具，确认仍可召回。

该用例走产品插件入口，使用合成资料和脚本宿主。生产 DSH 设置页和更新按钮在正式包隔离验收中实走。依据 `tests/behavior-list/index.json:1422–1429`、`tests/behavior-list/concepts-flow.test.mjs:6–32`、`src/console/plugin.ts:23–37`。

其余批次：先 `pnpm run build`，再跑盘点表各行点名的测试；迁移测试退役后，`tests/behavior-list/index.json` 同步删条目，`pnpm run test:behavior-list` 仍要求每个 L1／L2 恰好一次。

### 沙箱外 Electron 与主人手动验收

1. **设置窗口夹具。** 构建后，在可开窗口和监听回环的环境运行。默认 `DSH_APP` 指向已安装 DSH，可显式指隔离安装。用整窗断言和进程退出 0 判定。`docs/development.md:193–207`、`tests/manual/companion-settings-window.cjs:12–15,255–312`。

   ```sh
   pnpm run build
   env -u ELECTRON_RUN_AS_NODE \
     "${DSH_CHATBOT_ELECTRON_PATH:-${DSH_HOME:-$HOME/.dsh}/electron/Electron.app/Contents/MacOS/Electron}" \
     tests/manual/companion-settings-window.cjs
   ```

2. **合并前**用同一个候选做 `pnpm run verify`、行为清单、设置窗 Electron 检查和每组受影响快测。架构报告核对新增违规为零，构建归档核对退役深路径和 npm 键确实消失。按原收尾方案完成度量和 G8。`AGENTS.md:54–70`、`package.json:92,125–129`、`scripts/checks/verify.mjs:13–25`（见本节和「G8 体检及关闭条件」）。
3. **正式包验收**在 0.5.0 隔离副本用更新按钮装正式包。先看激活、设置保存重启、日记相册和当前钱包待办，再走「设置投喂 → 事实确认 → 跨会话召回 → 重启后仍可召回」。另外核对 Room、桌宠语音取消及实际配置的 QQ／微信收件去重。隔离正式包失败时停在隔离环境。`docs/product.md:10–18,459,474–475`、`docs/development.md:181–212`。
4. **在隔离副本验证只换包回退**。拿新版写过的当前设置、Bank 观察和钱包请求，换回 0.5.0，验证仍能读回、旧请求没再执行。这是证实「旧包带齐所需代码」之外，最重要的双向数据验证。发布后若是同版本、同源码的发布或下载超时，原运行重试。`src/memory/provider.py:188–190,455–468`、`src/living/economy/plugin.ts:245–268`、`tests/behavior-list/console-wallet.test.mjs:156–219`、`.github/workflows/release.yml:39–47,68–97`。

### G8 体检及关闭条件

逐条记录管理规则的保护目标、对应案例、当前证据和保留或调整决定。R1 按当前基线的实际位置逐条复核，并核对退役条目。R5 逐条检查五类 Channels 记录和 `desktop-session` 的业务拥有者、Core 容器和恢复证据。其他规则核对真实违规反例、撤销和外围组合用例是否仍有效。无案可支持的调整留作主人决定。依据 `arch/baseline/rules.json:3–97`、`arch/baseline/writers.json:1–3`、`arch/storage.json:14–20`、`docs/architecture.md:132–166`、`docs/product.md:187–195,352–356`、`docs/decisions.md:278–282`。

体检还要核对方案引用和相对链接、测试有没有跳过或削弱原断言、生成文件是否来自声明源、无关改动是否保留，以及 `codex/*` 工作分支和实验分支的去向。Claude 合并验收通过的实施分支，处理完成方案。删除分支单独按仓库约定请示。P5 以九项处置有证据、门禁全绿、正式包隔离激活完成和主人确认关闭为准。依据 `AGENTS.md:54–70,75–98`、`docs/product.md:70–73,463–477`。

## 执行结果

- 实现基点为 `22835b0..1153f2b`，共 46 个提交（42 个普通提交、4 个合并提交）。第一波各独立分支以 `22835b0` 为起点：`codex/p5-entry-cleanup` 为 `3405743..9484778`（含首笔，9 笔），`codex/p5-memory-policy` 为 `59cc109..5730d79`（含首笔，4 笔），`codex/p5-offline-retirement` 为 `eafafb9..97d290b`（含首笔，14 笔），`codex/p5-package-setup` 为 `5dbd0e6..163d6d4`（含首笔，4 笔）。合并边分别为 `7e80c4a`、`8202394`、`dd150b2`、`65e873f`。
- 第二波为 `65e873f..1153f2b`（11 笔）。第三波基于 `1153f2b`，交付 7 份顺序补丁：架构及规则登记、离线运维、安装与发布、两份设置翻译、产品度量、执行记录与体检。第三波只改 Markdown 和架构描述。
- 逐项对照上述盘点表的结果见下文。主人副本显示拟删除数据项均 absent；外观有历史回执、0 冲突，原导入器为空操作；主人未配置 Channels。
- 源码检查：七份补丁均通过 `pnpm run build`，对应 `node --test` 通过 35／15／17／12／27／1／11 项。策略、投喂和跨语言契约合跑 20 项通过。`pnpm run test:behavior-list` 在 `1153f2b` 的实现上通过 172/172，含独立快测通过的 `2B1-12`。
- `pnpm run check:arch`、报告模式及词表 JSON 通过（R1 为 8、R8 为 576，两类新增均为 0）。发布元数据和带归档参数的 `check:package` 通过。构建目录与本地归档中八个退役语音深路径、六个退役文件及三个旧 npm 键均零命中。本地归档沿用源码版本号，供包检查。
- 链接脚本逐个核对 11 份改动 Markdown，共 141 个相对链接（含 78 个锚点），无缺失。补丁按顺序在临时索引执行 `git apply --cached`，结果与工作区相同。文件/行数和 `git diff --check` 均通过。
- Claude 返回的沙箱外记录：设置整窗、Room 语音窗、Room 刷新窗、原生 Room 拍照、`pnpm run test:native-services` 和 Memory 进程检查通过；第一波合并后行为清单 172/172。
- 九项状态：①旧适配完成本地核对和归档检查，宿主保留项待第 9 项验；②文档、翻译、描述及链接通过；③度量达到本批上限；④5b 延期并已写重开条件；⑤设置声明停止扩展，3 文件／2 层未达标；⑥保留共用 contracts、收旧 npm 键并按原口径记录第 8 题；⑦0.6.0 草稿完成；⑧设置窗沙箱外通过；⑨G8 与 `2B1-12` 完成，待冻结源码全量门禁、正式包隔离激活和换回 0.5.0、主人验收。详见[当前阶段](../product.md#stage-4)。

### 逐项核对结论

| 方案项目 | 实现判定与证据 |
| --- | --- |
| Life 回顾、Channels 群资料、Body 情绪 | **已删转发／别名**。回顾用 `readCompanionWriting` 及 Core 作用域，群资料统一传绑定 Repo 的 `dataDirectory`，Body 与 Desktop 用 `COMPANION_FEELINGS`。Channels 仍消费设备 `deviceDirectory`，Body 仍输出 `behaviorPresentation`（`0550c24`、`bf4bb60`、`0f33d61`）。 |
| Desktop 语音深路径与服务 | **已删**八条深路径和直取 `petVoice` 的对象。Room、桌宠、Channels 用 Core 的 VoiceTable，`70-Voice` 和隔离键继续使用。ESM／CJS 共用登记、撤销和取消由 `tests/regressions/stage3-voice-upstream.test.mjs` 和 `tests/behavior-list/presentation-voice.test.mjs` 覆盖（`be7622e`、`4533bbc`）。 |
| 设置页与 Room | **已删** `petLife.library()`、`desktopAppearance` RPC 和桌宠 `chat/memory` 孤儿入口。Console 继续经 `lifeDates`、`lifeJournal`、`lifeAlbum`、`lifeSearch`、`lifePhoto`、`lifeForgetPhoto` 读写 Core 记录库；钱包动作、设置、待办／查证／重试／放弃由 Economy 处理。Room 的媒体 URL、播放回包、Room 历史和 Memory 档案入口继续由当前界面消费（`8891a35`、`80bbb90`、`src/core/console-operations.ts`、`src/console/settings.ts`、`src/presentation/room-transport.ts`）。 |
| 旧 Life 事件 | **已删**旧事件残留，保留当前／过期绑定的 `world.changed` 断言，并用未登记事件校验扫描器（`9484778`，`tests/behavior-list/channels.test.mjs`、`tests/arch/known-violations.test.mjs`）。 |
| Cordis 服务与身份 | **保留现用项**。Core／World 负责绑定与准入，Transcripts 负责 Life 会话恢复，Memory 供 Core 管生命周期，Emotion 供 Body、Desktop、Console、guest 查询和呈现。Behavior、Life、Economy 供照料／状态／钱包；Room、Desktop、PetPlatform 负责开窗与呈现；Channels 由原生检查消费并为运维和生活出口提供隔离标签。默认 bundle、预设和 Console 标识由 `cordis.patch.yml` 装载，服务登记见 [layers.json](../../arch/layers.json)。 |
| 安装工具和默认路径 | **已删**旧商店切换、`--replace-codex-pet`、`--archive` 与旧包搬配置。**已改名**离线修复 `repair-core-config`，新装 Core 用 `her-world/core`、备份用 `backups/her-world`；实际已绑定绝对路径沿用。现用 profile 用安装回执、包、Core 和实际绑定交叉验证；保留打包及显式自定义 Memory 选择（`5dbd0e6`、`4286abf`、`f2e6243`）。备份格式标识 `codex-pet.offline-data-backup` 由备份创建和恢复继续消费。 |
| npm 公开面与归档 | **已删** `./core`、`./contracts`、`./world`。**保留** 包根、`./package.json`、`./client`、编号模块和 `./channel-guest`，分别供 Console、包根定位、原生浏览器、默认 bundle 和 guest 预设。 `./cordis.patch.yml`、`./locale/*.json`、`./00-Core/locale/*.json` 当前都在；独立 `src/console/client.js` 也仍随包。这四项的实际宿主消费待隔离包核实，文档按现有归档写。四个 imports 和三个 bin 仍有当前入口（`163d6d4`，`package.json`、`cordis.patch.yml`）。 |
| 工作区清单及初始化 | **已删** v1／v2、`STATE.md` 读法和空旧初始化标记接管。旧实物和非空存量保护保留；v3 准入、当前标记安全续做、缺库及外来绑定拒绝继续有效（`a2b8acf`、`ed65577`）。 |
| 日记、自述与相册 | **已删**旧位置探测，当前路径由 Core 记录库确定。旧 Life 路径保留登记为只留档（`b2a4663`，`src/core/record-paths.ts`、[storage.json](../../arch/storage.json)）。 |
| 桌宠外观和情绪 | **已删**旧外观导入、冲突处理、旧 RPC 与界面，以及旧 Core 情绪行导入。PetPlatform 读写 JSONC 主文件和正式外观编辑器；Emotion 读写现有 `state.json`，历史 Core 行只留档（`9cb1186`、`ea93dec`）。合成探针确认当前文件可读，0.5.0 曾接受的 `importedLegacy` 和 `current.dependencies` 各会被基线候选拒绝。主人只读核对的删除项均 absent，本批登记这条读边界。 |
| Body、计划、事实与菜园 | **已删**钱包额外探测旧菜园位置；Body 现存 `data/life/home.json` 是有效检查点，继续按现行检查点选择，钱包首次交接由同一目录选址。**已改名** `actUnadoptedGarden`；未采用继续用 Body JSON，已采用缺库拒绝。持久计划按提交规则校验，历史事实读宽写严按核对保留（`d448957`、`7f6c157`、`e118d3d`）。 |
| 渠道策略与去重 | **已删**旧策略拆分、启动写回和旧资料扫描，改为直接读取设备连接与 Repo 策略。**保留** QQ 原键去重及当前回执、微信配置和 Repo 路径守卫。旧收件不重放，留有键就继续去重。主人未配置 Channels，合成覆盖与实机项分别记录（`9eb7eba`，`src/channels/qq-inbox.ts`）。 |
| 离线迁移及钱包请求 | **已删** CLI、运行器、0001–0004 执行步骤、两条钱包导入／清源／回插路线与接线。仍用当前盘点、保护既有账本、保留持久待办的查证与原号重试；`fresh` 独立证明和历史完成日志仍被 Core／钱包读取（`7b6f846`、`adcf8df`、`f096287`、`f3b4201`、`7f6c157`）。 |
| Memory 传输与授权 | **已改名** provider wire `bankId`；磁盘 `pet_scope.workspaceId` 和 Mnemosyne `workspace_id` 沿用。已有 Bank 选择与绑定隔离保留。**已改** guest／电视共享情绪授权、**已删** `EXPIRED_USE` 和旧付费脚本；现用语音、表情流和 Memory 仍由对应入口验证（`59cc109`、`8acb7fa`、`18af12f`、`5730d79`）。 |
| 度量、结构取舍与问题 13 | **保留**共用 contracts 与各拥有者；按原标准记录 5b 延期及第 7、8 题。设置整窗的真实 Cordis、合成 Repo Core 路径、运行时回执与现行按钮均接齐，`storageStatus()` 在 `main`／`v0.5.0`／`HEAD` 一致（`3405743`、`1153f2b`）。问题 6 待正式包观察，12 保留主人已接受的上游在途边界。 |

### 只读证据要求保留的路径

| 项目 | 主人隔离副本结论 | 当前消费者与保留理由 |
| --- | --- | --- |
| `maxHistoryMessages`、`memoryColdHours` | 各命中 1 | Core 读取既有对话和便携配置时校验并剥离，当前设置没有这两个选项（`src/core/options.ts`、`src/core/companion-settings.ts`）。 |
| `legacy-import` | 1 条 | 钱包历史流水继续回读和显示；首次采用的交接也使用该流水 kind（`src/living/economy/types.ts`、`src/living/economy/store.ts`）。 |
| `native-memory-action/view` | 共 12 行 | **只留档**，运行时没有读写。当前盘点通过登记识别，旧行随原数据保留（`c1eb430`）。 |
| `legacyWalletDigest` | 7 个未登记候选，证据不足 | Wallet 以原号查证同一旧请求时比对兼容指纹，保留历史冲突与重复执行防线（`src/living/economy/console-requests.ts`、`src/living/economy/plugin.ts`）。 |
| 历史事实读宽写严 | 证据不足 | Core 历史和 Life 回读接收未登记类型，新的事实必须通过所在领域的类型检查，和 Python 双向契约对齐（`src/contracts/interaction.ts`、`tests/memory/fact-attribution-contract.test.mjs`）。 |
| Memory 启动补投影 | 证据不足 | provider 启动修复已有合格 episode 的来源投影及撤回语义，继续排除投递信封（`src/memory/provider.py:67–145`、`tests/memory/memory_provider_test.py`）。 |
| 原生提示词退休历史段名 | 证据不足 | 原生会话重开后，在打开的请求中清理已退休段名；保留原日志和当前段生命周期（`src/core/native/prompt.ts`、`src/core/native/agent.ts`）。 |

## G8 体检

| 规则 | 保护目标和当前证据 | 处置 |
| --- | --- | --- |
| R1 | 阻挡逆向和非预期同层 import。已知违规夹具检查 TS／JS／MJS／CJS、动态 import、`createRequire` 及别名。当前 8 个位置、2 条逆向边，逐条见下。 | 保留棘轮与当前八条明确例外；已退役外观导入链按工具收紧。 |
| R2 | Cordis 服务依赖在声明和允许方向内；夹具覆盖别名、解构、计算名、inject 和未知目标（`tests/arch/known-violations.test.mjs`）。当前 0 违规。 | 保留，Voice 的当前隔离键走表。 |
| R3 | 只订阅和发布已登记的事件，保证方向；架构夹具测试未知事件，Channels 使用当前绑定和过期绑定的 `world.changed` 断言。当前 0 违规。 | 保留真实行为和虚构反例，旧事件实例已退役。 |
| R4 | 第三方模块经登记写入回调，禁止直接给他人对象赋值；夹具含直接、别名、解构赋值。当前 0 违规。 | 保留现有阻断。 |
| R5 | 路径、容器、记录 kind 与拥有者可查。报告及 `tests/arch/storage-locations.test.mjs` 区分不同物理位置和逻辑拥有者，原位例外见下。现有 Emotion 近期表写入和 Memory 批处理的 Core 记录访问仍有报告项。 | 保留报告边界。近期表的物理容器归 Memory 而业务拥有者是 Emotion，批处理借 CoreStore 处理当前会话批次。文件原子写第二参数和未登记 kind 有静态识别局限，通用句柄延期。本批依照授权只动描述。 |
| R6 | 装卸、换绑及取消会撤销订阅和请求，晚结果无效。VoiceTable、Room／桌宠语音、Compact 录音及进程关闭的现用断言见 `presentation-voice`、`stage3-voice-upstream`、`families` 和 Memory 进程检查。桌宠已交给上游的关闭是主人认可的边界。 | 保留撤销回归和现有上游边界。 |
| R7 | 外围全关、逐关、反序、重载及 A→B→A 时主链路仍可用；写前取消没有效果，写后断回复可按原号核对（`tests/behavior-list/presentation-r7.test.mjs`、`entries-lifecycle.test.mjs`）。 | 保留组合检查，将已删除的外观 RPC 重复登记断言移到现用 `foundation`。 |
| R8 | 阻止复制同一业务词表和公开裸字段。对象／布尔键与棘轮反例见 `tests/arch/object-vocabulary.test.mjs`、`ratchet.test.mjs`。报告 576 条，裸字段 30，新增 0；概念份数见[产品度量](../product.md#词表重复基线与目标)。 | 保留现行阈值和人读口径，无新增白名单。 |

### R1 八个基线位置

| 位置 | 保护目标 | 当前证据与理由 |
| --- | --- | --- |
| `src/core/companion-settings.ts:2` → Desktop 外观解析 | Core 独立校验当前便携外观 | Core 仍接受 `desktopAppearance` 字段，经 Desktop 的现用解析器校验。保留既有逆向依赖，避免重复外观语义；已退役的是导入器及默认值 RPC。 |
| `src/core/initialization.ts:5` → Life 库 | 初始化和就绪使用相同的正式控制文件契约 | Core 建 `control.json`，读时复用 `defaultLifePreferences` 和 `parseLifePreferences`。保留；改成独立上层初始化会改变可选入口缺席时的文件契约。 |
| `src/core/initialization.ts:12` → PetPlatform 运行时 | Core 就绪检查在包内准确读 JSONC | 从 `her-world/package.json` 定位包根再取固定上游运行时，复用 `readJsonc`。保留动态加载；归档仍有资源与定位键。 |
| `src/desktop/platform/plugin.ts:40` → PetPlatform 运行时 | 用同包上游呈现实现 | 从同一包根加载固定 `vendor/dsh-pet/platform/runtime.mjs`。保留；静态扫描不能推断 `join` 得到的目标，归档覆盖包内依赖。 |
| `src/desktop/standalone.mjs:8` → Core 编译设置 | npm bin 与主程序共享运行时默认设置 | 源码 bin 读 `dist/src/core/companion-settings.js`，归档检查确认路径存在。保留物理路径，不复刻默认值。 |
| `src/memory/client.ts:54` → Mnemosyne 进程宿主 | Memory 的启停与包一起部署 | 从包根加载固定上游 `memory-process.js`，提供者启动、取消和重启仍走该宿主。保留，原生服务及进程有集成记录。 |
| `src/memory/client.ts:55` → Mnemosyne 客户端 | 进程和客户端使用同一包版本 | 加载同包 `memory-client.js`，使用现有 HTTP 请求和 scope 校验；归档与 Bank 跨会话检查覆盖。保留；扫描不能解析运行时绝对路径。 |
| `src/room/shot-browser.cjs:18` → Room 编译资源 | 拍照与真实 Room 用同一素材和资源入口 | Electron CJS 入口加载同包 `dist/src/room/assets.js`。保留；归档能定位编译产物，Claude 沙箱外原生 Room 拍照通过。 |

第二波删除外观迁移入口的动态加载例外，当前基线由 9 条减至 8 条，见 `9cb1186`。R1 的展示行号以现行报告为准。

### R5 的 Core 原位例外

以下业务归属和写入者由 [storage.json](../../arch/storage.json) 声明，物理容器均为 Core `records`。离线恢复用 `scripts/lib/offline-backup.mjs:309,351–366` 保留当前 Channels 五类记录，`tests/infrastructure/offline-backup.test.mjs:149–170,198–203` 核对保留和冲突拒绝。桌宠映射随选中绑定恢复。

| 记录 | 保护目标与当前写入证据 | 处置 |
| --- | --- | --- |
| `channel-received` | Channels 的输入去重和重启核查，`src/channels/qq-inbox.ts`、`src/channels/messaging.ts:165–175`。 | 原位保留，恢复复用当前收件回执。 |
| `channel-reach` | Channels 发送 QQ 主动消息前记为待核对，确认后记为已送达，`src/channels/messaging.ts:218–225`。 | 原位保留，旧备份不会让已发送或未核实的联系再次执行。 |
| `life-outlet-delivery` | Channels 记录实际 Life 出口送达，`src/channels/bridge.ts:82–89`。 | 原位保留，恢复复用当前送达记录避免重送。 |
| `channel-usage` | Channels 保存用量聚合，`src/channels/usage.ts:12,34`。 | 原位保留当前聚合，避免恢复导致额度倒退。 |
| `channel-usage-event` | Channels 按来源事件固定用量查证，`src/channels/usage.ts:28–29`。 | 原位保留当前明细，聚合和去重依据一致。 |
| `desktop-session` | Desktop 的当前绑定与原生会话连续性，`src/desktop/index.ts:46–47`。 | 原位保留，随绑定的原生日志和 Core 备份回到同一快照。 |

### 测试、生成物与分支

- 测试复核对照 `main..1153f2b`。删除集中在旧安装切换、旧外观导入、旧布局与迁移执行。当前生命周期断言迁到新入口，包含 0.5.0 钱包证明、缺库拒绝、回执按原号重试与只结算一次、VoiceTable 撤销、记录库读回和 Console 路由重复登记。行为索引增加钱包两条，未删行为 ID；差异未引入跳过或 todo。合成服务、包加载和主人验收各保留独立证据。
- `src/desktop/platform/client.js` 由登记的生成器、Console 源和上游输入重建（`arch/layers.json`、`scripts/build/build-pet-platform.mjs`）。语音转发由 `scripts/build/build-desktop-animation.mjs` 停止生成。干净构建后生成物与 `1153f2b` 一致；本批补丁没有生成文件差异。
- 第一波四个分支已纳入候选，第二波 `codex/p5-data-retirement` 与本批同从 `1153f2b` 交接。本批 `codex/p5-acceptance-docs` 交顺序补丁，由 Claude 应用、检查和合并。建议确认新版进入主干、无需修复回溯后再收这六个工作分支；分支、worktree 的清理由主人决定。
- `codex/m1-baseline-{1-garden,2-room,3-channel}`、`codex/m2-retest-{4-tool,5-source,5-source-v2}`、`codex/m4-measure-1-garden`、`codex/2b-measure-8-{care,fact}` 共九个实验分支继续提供可复算证据。建议先保留；如需清理，先确保测量提交可从长期引用取回，由主人决定。

## 审查结论
