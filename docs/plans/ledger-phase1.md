# 账本一期：用量账本和用量页

- 级别：大改。新增持久数据（独立的账本文件和一个 Core 记录 kind），改层间契约（来源分支多一个可选声明），涉及 `contracts`、`world`、`core`、`living`、`channels`、`room`、`desktop`、`console` 八个模块。
- 状态：已确认（2026-11-25 主人：「全部按推荐」）
- 依据：[大模型使用 1a 用量账本](../product.md#大模型使用-1a-用量账本)的 1a-1 行、[用量规则](../product.md#llm-product-rules)、[独立个体阶段 0](../product.md#阶段-0安全网)「账本一期」、[架构 4.1](../architecture.md#41-计划用量账本的拥有者)、[7.2.1](../architecture.md#721-计划用量账本的迁移与回退)。
- 盘点基点：`main` 的 `1c0b5ce`。DSH 接口按仓库锁定的开发依赖 `0.2.2-rc.1`；标 `DSH rc.5` 的路径指本机安装包里的源码。
- 来源：Claude 写初稿，Codex 只读挑刺一轮后修订（修订要点见文末「挑刺采纳情况」）。

## 目标与外部变化

账本一期是独立个体阶段 0 的第一个发行单位，对应原「大模型使用 1a-1」：只加账本和用量页，和旧统计并行。渠道统计和 Life 预算切到账本派生是二期（1a-2）的事。

主人能看到的变化：

1. **Her World 设置页多一个「用量」分页。** 选一天（默认今天，可往前翻 30 天），看到一张表：每行是「入口 × 预设 × 用途」，列出调用次数、未命中输入、缓存读、缓存写、输出、估算花费。命中（缓存读）和未命中分开；普通对话的用途为空，压缩、标题这类辅助调用单独成行。
2. 表下单列异常，有就显示：
   - **未归类**：红字报警，写明预设和用途，提示「这类调用找不到入口证据」；
   - **缺用量**：服务没返回用量的调用次数（计入次数，不计 token 和花费）；
   - **无价格 / 部分估算**：模型不在价表里，或有某类 token 没有单价，花费标「部分」并写明缺哪些；
   - **漏记**：账本写失败、没绑定伙伴、调用途中换绑，这三种没记进账本的次数，按天累计、重启后仍在。分页顶部写明「合计从某日起记录，不含漏记的次数」。
3. **旧统计对照**（只在一期存在，二期删除）：分页底部并排显示 QQ／微信渠道的旧计数和账本里同口径的计数、Life 当天的旧估算和账本里同口径的花费，差异按来源注明（见「特殊情况」第 7 条）。
4. 原来渠道状态里的「本账号模型调用 N 次」、生活页的「生活会话用量估算」照旧显示，一期不动。

聊天、生活、渠道的行为都不变。账本写失败时聊天照常。

## 范围变化

无新增目标。完成标准沿用 `docs/product.md` 1a-1 行；独立个体额外要求的「入口和预设是同一行的两个维度」写进了行结构。

1a-1 原文没写死、由本方案定下的设计（都在拍板点里）：账本用独立文件；用量页按天看 30 天；旧统计对照放在页面上直到二期；坏库的处置；换绑途中的调用不记、计入漏记。

## 核心做法

### 1. 一次调用一行：在 `llm/stream` 外面包一层

`llm/stream` 是 waterfall：DSH 每次调模型都走 `ctx.waterfall(this, "llm/stream", options, next)`（`node_modules/@deepseek-ai/dsh-llm/lib/index.js:2258,2401-2403`），监听者拿到 `(options, next)`，必须把流原样转发。Cordis 对 `{global: true}` 的监听者跳过作用域过滤（`node_modules/@deepseek-ai/cordis/lib/index.js:829`），所以 guest、`standard`、`cordis` 等预设作用域里的调用，全局监听都能收到（Codex 用锁定依赖跑过内存探针，3/3；DSH rc.5 的 `dsh-session-title/src/index.ts:360-363` 也这样观察主请求）。

账本由 Core 在根作用域登记**一次**全局监听者（写法照 `src/emotion/plugin.ts:289-295`），不在 `attachGuest` 里重复登记，否则同一条流会记两行：

- 流开始时取一次快照：开始时刻、`sessionId`、`purpose`、`provider`、`model`、`reasoningEffort`（字段见 `node_modules/@deepseek-ai/dsh-llm/lib/types/types.d.ts:538-584`），以及下文的入口、预设、归属工作区。**不碰 `messages`、`system`、`tools`。**
- 把 `next()` 的每个 chunk 原样往下传，只旁看两种：`{type:'usage'}`，多次出现时取最后一份，和 DSH 自己的做法一致（`index.js:997`）；`{type:'finish'}`，取结束原因。适配器失败会变成 `error` 或 `aborted` 的 finish（`index.js:2356,2371,2410-2421`）。
- `outcome` 取值：收到 finish 时记它的 `reason.kind` 原值（`completed`、`error`、`aborted`，以及 DSH 的其他取值）；没收到 finish 就被关闭的记 `cancelled`，包括消费方在 `for await` 循环体里抛错：这种情况监听者只收到无参数的 `return()`，和主动停止分不开（执行第一批的假流探针证实，碎碎念消费循环见 `vendor/dsh-pet/src/host/whisper.ts:142`）；从 `next()` 一侧传到监听者的异常（里层中间件、适配器分派之外的异常，`index.js:2387` 起的注释写明这些异常不会转成 finish）记 `error` 并原样抛出。
- 在 `finally` 里写一行。写行失败只计漏记、打一条警告，不往外抛。
- 拿到流却从没迭代的，适配器不会被调用，也就没有请求，不记。
- 外层看到的 `reasoningEffort` 是请求值，默认值可能在里层才补上（`index.js:2192`），列名写明「请求的推理强度」。
- 适配器内部的重发看不到，按[外部风险](../product.md#外部风险)披露。

### 2. 只记当前伙伴的调用

全局监听也会收到其他工作区的调用。只记三类：

- 会话属于当前绑定工作区（Core 已有的 `nativeScopeFor`，`src/core/native/agent.ts:45-52`，它同时认登记过的 guest）；
- Her World 自己发的无原生会话调用（碎碎念、梦话，见第 3 节）；
- 其他一律不记，也不计漏记。分页上写明「只记当前伙伴工作区的调用」。

流开始时记下 `host.workspace.homeScope()`（含 `bootId` 和 `generation`）；写行前用 `sameHomeBinding` 复核（`src/core/home-binding.ts:6-8`，用法见 `src/core/companion-foundation.ts:113-121`）。变了就不写，计入「换绑未记」。只比工作区、路径、存储 ID 不够：A→B→A 之后这几样都和原来一样，要靠代次区分，见[绑定代次的 G3 复盘](../product.md#绑定代次的-g3-复盘)。

### 3. 入口、预设、用途：同一行上的三个维度

| 维度 | 取自哪里 |
| --- | --- |
| 预设 | 流开始时 `agentPresets.composedPreset(agent.ctx)`，项目已经这样认 guest（`src/channels/sessions.ts:137`）。不读会话头的 `agentPreset`，它是创建时的值，空白会话换过预设后就不准。无原生会话的调用记「无会话」 |
| 用途 | `options.purpose` 原值。普通对话为空；压缩是 `compaction`（rc.1 和 rc.5 的 `dsh-compaction-basic/src/summarizer.ts:159-163` 都同时传 `sessionId` 和 `purpose`）；标题、自动审查等按宿主实际传的值 |
| 入口 | 见下 |

**入口按「这一步实际准入了谁的输入」定。** 共享 home 是容器，不是来源（[会话策略表第 2 行](../architecture.md#582-会话策略表来源选择与生命周期)）；Desktop 还能打开 home 等已有会话（`src/desktop/conversation.ts:140-145`）。所以入口既不能按会话定，也不能拿保存的消息事后重判：回顾中断后可以由普通 Life 输入续做（`src/living/plan/tool-policy.ts:93-118`），渠道历史分类对已认领消息统一返回 `owner`（`src/channels/sessions.ts:96-107`），重判会改写历史归属。

做法：

- Core 每一步都会先准入本步输入（`src/core/native/agent.ts:220-253` 的 `selectStepSources`，首步和后续步都走，包括主人中途接管）。准入成功后，Core 按会话记下「本步入口」，`turn/end` 时清掉（同文件 `:293-296`）。流开始时读一次。
- 入口由准入结果里的**来源分支**声明：`SourceBranch` 加一个可选字段 `usageEntry`（`src/contracts/tables.ts:89-99`）。Life 的 `life`、`review` 分支，Channels 的 `owner`、`guest` 和补答分支，Room 的 `television` 分支各自声明。读的是已准入的结果，不会再调一次 `admit`，渠道的一次性凭证不会被二次消费（`src/channels/sessions.ts:156`）。
- **DSH 原生、Desktop、Room 私聊这三种都由 `core-owner` 的 `owner` 分支准入**，消息形状也一样：DSH 原生 RPC 本身就带 `rpcId`（rc.1 `session-controller/src/index.ts:480-489`、DSH rc.5 `dsh-api-session-controller/src/index.ts:485-489`），Desktop 的 `requestId` 也可以以 `room-` 开头（`src/desktop/conversation.ts:170`）。所以不看消息字段，改由**发送方登记证据**：Desktop 和 Room 在创建消息时（`src/desktop/conversation.ts:181`、`src/room/chat.ts:174`）调用 Core 的 `host.native.usageEvidence.claim(sessionId, messageId, entry)`；`owner` 分支的入口是「有登记就用登记的，没有就是 DSH 原生」。证据只存内存，有上限，消息准入后即删。
- 一步里有多条输入时，取第一条前台输入的入口，没有前台就取第一条。
- **带用途的辅助调用**（压缩、标题等）：会话此刻有在途的一步（步间压力、上下文溢出触发的压缩），入口取这一步的；没有在途步骤（Memory 闲置或回顾后的整理，`src/memory/batch.ts:93-108`），入口记「后台整理」。压缩是会话做的，不能说成是最近一个发言入口引起的。
- **碎碎念、梦话**：没有原生会话，但请求带固定的 `sessionId: 'dsh-pet'`（`vendor/dsh-pet/src/host/whisper.ts:121`，上游说明某些路由依赖它，`vendor/dsh-pet/src/host/llm-call.ts:10`），这个值要原样保留。Desktop 在自己的包装处（`src/desktop/features.ts:223-228`）加 `purpose`，取值 `chatpet-whisper` 或 `chatpet-dream`，并按 DSH 增补用途的写法声明进 `LlmRequestPurposeMap`（参照 DSH rc.5 `dsh-compaction-basic/src/types.ts:7-9`）。账本把这两个用途映射到同名入口，`session_id` 记空。上游首选模型失败后会换下一个模型再试（`whisper.ts:87`），一次碎碎念可能记两行，这是对的。
- **未归类**：在属于当前伙伴的调用里，有会话但没有在途步骤的入口、又不带用途；或者是不认识的无会话调用。每种（预设 × 用途）每次启动打一条警告，分页标红。

入口词表放在新文件 `src/contracts/usage.ts`，带中文标签，分页的行名从它派生：DSH 原生、Desktop、Room 私聊、Room 电视、Life 回合、回顾、QQ 主人、QQ 访客、QQ 补答、微信主人、微信访客、碎碎念、梦话、后台整理、未归类。新增词表前先跑 `pnpm run check:arch -- --report` 看 R8 有没有可复用的定义。

### 4. 账本存在哪里

- **独立文件** `.chatpet/data/usage/ledger.sqlite`，拥有者 Core（第一层），唯一写入者是账本监听者。按当前绑定的工作区存，一个伙伴一份。
- 用 `node:sqlite`。复用 `src/core/record-paths.ts:18` 起的目录检查和 `src/core/sqlite.ts:4-11` 的元数据工具；主库和旁文件（`-wal`、`-shm`、`-journal`）的校验照 Emotion 近期账本（`src/emotion/recent.ts:56`）。**不照搬它的读路径**：`RecentLedger` 读的时候也会建表、`chmod`、开写事务（`recent.ts:40`），用量页的读口要以只读方式打开，文件不存在就返回空，不建库。
- 首次写入时建目录、建表、写格式版本和首行，在一个事务里提交。只在工作区状态为 ready 时创建（`src/core/workspace.ts:228` 的迁移判定会把缺清单的非空 `data/` 当旧数据）。
- **不进 `core.sqlite`**：不碰高风险的 `src/core/storage.ts`；1a-1 验收要「故意让账本目录只读」，独立目录才能只读而不连带聊天。
- **不登记进工作区清单，不用 `registerInitializer`**：工作区校验只要求清单里的文件存在，不拒绝多出来的文件（`src/core/workspace.ts:370` 起）；存储版本表一律不升，0.6.0 不受影响（[10.10](../architecture.md#1010-迁移与回退)）。10.10 把新格式概括为「新 kind、Bank metadata 或模块元数据」，独立文件是本方案的选择，定稿后在 architecture.md 写明理由（拍板点 1）。

**一行有什么（全部是标识和计数，没有内容）：**

| 列 | 说明 |
| --- | --- |
| `started_at`、`ended_at` | 毫秒时间戳 |
| `day` | 按结束时刻和生活时区算出的日期，写入时定下来。生活时区和 Core 用同一个来源 `Intl.DateTimeFormat().resolvedOptions().timeZone`（`src/living/plan/plugin.ts:71`、`src/core/records.ts:56`），日期格式化复用 `src/core/review-dialogue.ts:19` 一带的工具 |
| `session_id` | 原生会话 ID，可空 |
| `entry`、`preset`、`purpose` | 见上节；`purpose` 可空 |
| `provider`、`model`、`requested_effort` | 请求里的值 |
| `outcome` | 见第 1 节 |
| `input_miss`、`output` | 整数；缺用量时为空 |
| `cache_read`、`cache_write`、`reasoning` | 整数；服务没报时为空，分页显示「未报」 |

写入前逐列校验：`entry` 必须在词表里；`preset`、`purpose`、`provider`、`model` 是不超过 128 字、不含换行的标识；数字是非负整数。

**漏记**不能写进可能已经写不进的账本，所以记在 Core 的新记录 kind `usage-ledger-gaps`（按天一条：写失败、未绑定、换绑三种计数），走现有 CoreStore 的 `put`，不改 `storage.ts`。新 kind 对 0.6.0 无影响（`src/core/storage.ts:169-181` 按 kind 精确查询）。

**坏库的处置**：锁忙，下一条再试；只读、磁盘满，计漏记；格式版本比当前新，拒绝写、计漏记、分页提示升级；SQLite 明确报告文件损坏（`SQLITE_CORRUPT`、`SQLITE_NOTADB`），把原文件改名为 `ledger.corrupt-<时间>.sqlite` 留档，新建一份，分页提示一次。只凭「打不开」不改名，免得把完好的账本挪走。

### 5. 花费怎么算

- 账本**只存原始计量**，花费在读的时候算：按调用开始时刻选价表版本和峰谷时段（[用量规则](../product.md#llm-product-rules)）。
- 现在只有 vendor 里一份价表（`vendor/dsh-world/lib/life/pricing.js:1-29`），Life runtime 直接引用它（`vendor/dsh-world/lib/life/runtime.js:20`），`src/world/usage.ts:1` 只是转出 `stepCost`。它不符合用量规则的两处：没有版本；不认识的模型按 Flash 算（`pricing.js:3,26`），规则要求显示「无价格」。它也没有缓存写单价。vendor 禁改。
- 做法：在 `src/world/usage.ts` 加一份带生效日期的价表和 `priceCall(usage, provider, model, startedAt)`。返回已估的金额和「哪些 token 没有单价」；不认识的模型整行无价格。峰谷判定复用 vendor 已导出的 `isPeak`（`pricing.js:17`）；首个版本的单价抄自 vendor 并注明出处。vendor 数值是否就是 DeepSeek 当前执行价，执行时按官方价目核一次（不确定）。见拍板点 2。
- 一行或一个合计里只要有一部分没有单价，就标「部分估算」，不把它当完整合计显示。

### 6. 用量页

- 扩展 Core 已有的 `core` 控制台操作（`src/core/index.ts:47` 的 `coreConsoleOperations`），加只读操作 `usageLedger`：入参是工作区和日期，先校验绑定（照 `src/console/settings.ts:241` 一带），返回按「入口 × 预设 × 用途」聚合的行、异常计数、首次记录日。
- 旧统计对照由页面拼：渠道旧计数从现有渠道状态读（`src/channels/messaging.ts:193-194`），Life 旧估算从现有生活视图读（`src/console/client.js:690`）。Channels 或 Life 没加载时，对照里那一栏写「未加载」。Core 不去读第二、三层的数据。
- 前端在 `src/console/client.js` 的设置分页（`:1228` 的 tablist）里加「用量」分页。原「运行与用量」只是「World 功能接入情况」里的一段说明（`:25-26`），把它的说明文字改成指向新分页。桌宠的 `src/desktop/platform/client.js` 是生成文件，用 `scripts/build/build-pet-platform.mjs` 重新生成，不手改。

## 改动范围

- 这一步是：改逻辑（新增账本，不改旧统计）。
- 允许修改：
  - `src/contracts/usage.ts`（新）— 入口词表和中文标签
  - `src/contracts/tables.ts` — `SourceBranch` 加可选 `usageEntry`
  - `src/core/usage/*.ts`（新）— 账本存储、监听者、本步入口、发送方证据、聚合
  - `src/core/index.ts`、`src/core/console-operations.ts` — 登记监听者，扩展 `core` 控制台操作
  - `src/core/native/agent.ts` — 准入成功后记本步入口，`turn/end` 清除
  - `src/core/native/conversation.ts` — `core-owner` 的 `owner` 分支声明入口（读发送方证据，兜底 DSH 原生）
  - `src/world/usage.ts` — 带版本的价表和 `priceCall`
  - `src/living/plan/tool-policy.ts`、`src/channels/sessions.ts`、`src/room/chat.ts` — 各自分支的 `usageEntry`；Room 私聊发送时登记证据
  - `src/desktop/conversation.ts` — 发送时登记证据
  - `src/desktop/index.ts` — 构造 `Conversation` 时传入登记证据的回调（`src/desktop/index.ts:44-47`；执行第一轮发现漏列，Claude 补入）
  - `src/desktop/features.ts` — 碎碎念、梦话加 `purpose` 并声明用途
  - `src/console/settings.ts` — `usageLedger` 端点映射
  - `src/console/client.js` — 「用量」分页
  - `src/desktop/platform/client.js` — 只经生成脚本更新
  - `arch/layers.json` — core 的 `subscribes` 加 `llm/stream`
  - `arch/storage.json` — 新条目 `usage-ledger`（独立文件）和 `record-usage-ledger-gaps`（Core kind），各附写者证据
  - `tests/core/usage-*.test.ts`、`tests/behavior-list/usage-ledger.test.mjs`、`tests/behavior-list/index.json`
  - `docs/architecture.md`（4.1 由「计划」改为现状并写明独立文件的理由、第 4 节拥有者表、3.1 写明两项检查已建立、5.8.6 补账本一行、7.2.1 补离线恢复会回卷账本）、`docs/product.md`（当前状态）
- 必须复用：
  - `src/emotion/plugin.ts:289-295` — `llm/stream` 监听写法
  - `src/core/native/agent.ts:220-253` — 每一步已准入的来源，不另做判定
  - `agentPresets.composedPreset` — 实际预设
  - `src/core/record-paths.ts`、`src/core/sqlite.ts`、`src/emotion/recent.ts:56` — 目录、元数据、旁文件校验
  - `coreConsoleOperations` — 用量页读口
  - `src/world/usage.ts`、vendor 的 `isPeak` — 价表放置处和峰谷判定
- 不做：
  - 不改渠道统计和 Life 预算的计算，不删旧累计代码（二期）
  - 不做每日总上限，不拦调用（[机制清单](../product.md#机制清单)「可后置」）
  - 不做「请求差异」、合成序列、付费 A/B（1b）
  - 不动 `src/core/storage.ts`、`src/core/workspace.ts`、`scripts/lib/offline-backup.mjs`
  - 不改 `vendor/**`
  - 账本不做自动清理

**提交拆分**（每个 ≤15 文件、600 行；`dist/src/**` 构建产物不计入阈值；`src/desktop/platform/client.js` 的生成差异**计入**阈值，超了就把它单独成一个提交）：

1. 入口词表、`usageEntry` 契约、本步入口和发送方证据、各模块声明、碎碎念用途，加单元测试
2. 账本存储、漏记记录、监听者、价表、`arch/` 登记，加「用量全覆盖」「账本不含内容」测试
3. `usageLedger` 操作和「用量」分页
4. 重新生成桌宠客户端（若第 3 个提交超阈值）
5. 行为清单条目和文档

## 特殊情况

1. **空状态**：当天没有调用，显示「今天还没有模型调用」；账本文件不存在，显示「账本从首次调用起记录」，不建库。
2. **账本写失败**（磁盘满、目录只读）：聊天照常；按失败的流数计漏记；目录恢复可写后的下一条照常写入，不补记。坏库按第 4 节处置；坏库查不了时，分页仍能从 Core 记录显示漏记数。
3. **没绑定伙伴工作区**：不写，计「未绑定」。调用途中换绑：不写，计「换绑未记」。
4. **取消、失败**：照样记一行，`outcome` 写实；有用量就计用量，没有就算缺用量。
5. **缓存字段缺失**（换了服务商）：记空，显示「未报」，命中比例对这类调用不适用。
6. **重启**：发送方证据只在内存。Desktop 或 Room 的消息在重启前已排队、重启后才准入的，会记成 DSH 原生。窗口很窄，写进已知局限。
7. **和旧统计对不上是预期内的**，页面逐条说明来源。对照只在全新隔离安装的验收里有意义：旧计数是全期累计（渠道按 `storageId × 渠道 × 账号`，`src/channels/usage.ts:10-12`），Life 只留最近一天（`vendor/dsh-world/lib/life/runtime.js:954-975`），长期使用的环境里旧计数含账本之前的历史。对照口径：
   - **渠道**：账本取该渠道的主人、访客、补答三种入口、所有结局的行，按渠道合计（账本不记账号）。差异来源：旧计数一条 `assistant/message` 和一条 `assistant/attempt` 各算一次、缺用量也算次数、按 `session.id + seq` 去重（`src/channels/usage.ts:24-32`），没产生会话事件的失败流不算；旧计数不计缓存写；账本含压缩等辅助调用，对照时排除。
   - **Life**：账本取 home 会话里不带用途的行，按 vendor 的 `stepCost` 口径另算一列。差异来源：旧估算只在 Life 运行期间计 home 的、带用量的 `assistant/message`（`runtime.js:1041-1052`），按处理时刻的时钟定价，中断但有部分输出的也算；Life 停着时的 home 调用旧估算不计。
8. **降级到 0.6.0 再升级**：旧包不认识 `.chatpet/data/usage/` 和新 kind，也不读，正常使用；再升级接着写。
9. **恢复离线备份**：恢复器整棵替换 `.chatpet`（`scripts/lib/offline-backup.mjs:110,244,391`），账本回到备份时刻，旧备份没有账本就没了；而渠道计数和 Life 花费是特意保留恢复前的值（`:309,368,418`）。所以恢复之后账本会比旧统计少一段，对照永久对不上。7.2.1 允许无账本照常使用，一期不改恢复器（高风险），只写进文档和分页提示。
10. **打包后**：`node:sqlite` 已在 Core 和 Emotion 里用；新文件都在 `src/` 下随 `dist/src` 发布。
11. **宿主差异**：rc.5 适配器是否把 `purpose` 映射到传输层，标题、自动审查在主人目标配置下是否启用，按[目标宿主待核项](../architecture.md#594-目标宿主待核项)在隔离安装上核对。

## 概念与扩展检查

- **新增概念「用量入口」**，拥有者第一层（词表在 `contracts/usage.ts`）。它和 `source.kind`、授权分支、会话策略行都不是一一对应：`owner` 一个分支对应 DSH 原生、Desktop、Room 私聊三个入口，Desktop 也不对应固定会话。
- **扩展路径**：新增一个有会话的入口，要改词表、在来源分支上声明 `usageEntry`；入口和授权分支不一一对应时，发送方还要登记证据；再加一条覆盖样例。标签由词表一处派生，证据目前要两处配合，没有做到一处声明。新增一种无会话用途，要改词表和用途映射。
- **新增持久数据**：`.chatpet/data/usage/ledger.sqlite`（拥有者 Core，唯一写入者账本监听者）、Core kind `usage-ledger-gaps`（拥有者 Core）。都登记进 `arch/storage.json`，architecture.md 第 4 节写明拥有者。
- **层间接口变化**：`SourceBranch` 多一个可选字段，向上登记；Core 新增 `usageEvidence.claim` 给第三层调用（向下调用）；Core 订阅 `llm/stream`，登记进 `arch/layers.json`。
- **复用的已有声明**：来源分支、每步准入结果、`composedPreset`、`coreConsoleOperations`、`world/usage.ts`。
- [10.11](../architecture.md#1011-扩展路径)的「一种后台模型用途」还要求宿主用途表、预算、上限、降级；本方案的 `purpose` 列只覆盖其中的记账部分。

## 拍板记录

1. **账本放哪里** — 推荐：独立文件 `.chatpet/data/usage/ledger.sqlite`，漏记放 Core 的新 kind。理由：不碰高风险的 `storage.ts`，能单独做只读演练，旧包看不到。代价：离线恢复会把账本回卷（特殊情况第 9 条）。备选：账本也放 Core 新 kind（只读演练会连带聊天；每次调用都写 `core.sqlite`）。决定：按推荐，独立文件 `.chatpet/data/usage/ledger.sqlite`，漏记放 Core 新 kind `usage-ledger-gaps`。
2. **价表** — 推荐：在 `src/world/usage.ts` 新建带版本的价表，首版抄 vendor 数值并注明出处，不认识的模型显示「无价格」。备选：直接用 vendor 的 `stepCost`（不认识的模型会被当成 Flash，不符合用量规则）。代价：二期之前单价有两份，二期 Life 预算改从账本派生后只剩一份。决定：按推荐，`src/world/usage.ts` 新建带版本的价表，首版抄 vendor 数值并注明出处。
3. **旧统计对照放在页面上** — 推荐：放，二期删；只在全新隔离安装的验收里看。备选：只做假模型对账测试（主人在已装环境上看不到）。决定：按推荐，放在用量页上，二期删除。
4. **用量页的粒度** — 推荐：选一天看「入口 × 预设 × 用途」表，往前 30 天。周、月汇总以后按需要加。决定：按推荐，按天看「入口 × 预设 × 用途」，往前 30 天。
5. **调用途中换绑** — 推荐：不记，计入「换绑未记」。备选：写进开始时那份账本（要另做原绑定复核，仓库有范例 `src/core/native/transcripts.ts:233`，但多一套写路径）。决定：按推荐，不记，计入「换绑未记」。
6. **1a-1 隔离验收的付费授权**（[付费授权](../product.md#真实数据与付费授权)要求开工前确认）— 需要主人给出：验收用的账户、本单位额度、阶段 0 总额度、重试上限、授权人。推荐：本单位 ¥5，重试上限 1 次，超额即停；单元和集成测试一律假模型。决定：按推荐，本单位 ¥5，重试上限 1 次，超额即停；授权人为主人。验收账户由主人在隔离验收前提供；阶段 0 总额度在成本基线评审（1b）开工前另定。

## 验收

- 快测：
  - `pnpm run build && node --test dist/tests/core/usage-ledger.test.js dist/tests/core/usage-coverage.test.js dist/tests/core/tables-sources.test.js`
  - `pnpm run check:arch`
  - `pnpm run build && pnpm run test:behavior-list`
- 本单位新建的检查（每项附一份故意违规的样例，证明拦得住）：
  - **用量全覆盖**：假适配器记下自己实际收到的每次调用，和账本逐笔比对，条数和入口、预设、用途都对，不按「一个场景一行」算。场景：DSH 原生、Desktop（分别打开普通会话和 home）、Room 私聊、Room 电视、home 里的主人、Life 回合、回顾和回顾续做、主人中途接管、QQ 主人、QQ 补答、微信主人、guest、碎碎念（含换模型重试）、梦话、Memory 闲置压缩、步间压缩、空白会话换预设、排队后取消、一步多次 usage。另验：卸载重载 Core 后每条流仍只有一行；其他工作区的会话不记。违规样例：一个没声明 `usageEntry` 的新来源分支，发出的流必须落成「未归类」并报警（被准入拒绝、没发流的，账本应为零行，两种分开断言）。
  - **账本不含内容**：输入、系统提示、工具结果、输出里都放一段哨兵文字，跑完后在主库和所有旁文件的字节里都搜不到；列名白名单；写入时的列值校验。违规样例：往 `model` 列塞消息文本、或多加一列存正文，测试都必须失败。
  - **写失败不影响聊天**：账本目录只读、磁盘满（模拟）、文件损坏三种情况下，假模型多步对话照常完成；漏记数等于实际失败的流数；目录恢复可写后下一条写入成功；重启后漏记数还在；坏库时分页仍能显示漏记。
  - **旧口径对账测试**：同一组假会话事件同时喂给账本和 `src/channels/usage.ts`，按第 7 条的口径比较，差异只来自列明的来源。
- 门禁：`pnpm run verify`（合并前一次）。
- 往返：上一版就是原指纹的 0.6.0，记下包指纹，两项分别核对：home、Room、Desktop 各按原会话 ID 打开；再升回来，账本接着写。
- 宿主兼容：本单位首次用到 `llm/stream` 监听，按[每个单位必须通过的检查](../product.md#每个单位必须通过的检查)用安装包在 rc.1 和 rc.5 上各跑一遍创建、压缩、重启、降级，两份合成 profile（默认的、覆盖过 `standard` 的）。
- 手动（主人在全新隔离安装里，用合成资料）：
  1. DSH 原生聊天、QQ 主人私聊、桌面、Room 各聊一句，guest 私聊一句，跑一个 Life 回合和一次回顾，触发一次碎碎念和一次压缩；
  2. 打开 Her World 设置页的「用量」分页：每类都有，入口、预设、用途对，命中和未命中分开，压缩单独成行，没有未归类；
  3. 看旧统计对照：对得上，或差异都能用页面上的说明解释；
  4. 把 `.chatpet/data/usage/` 设成只读，再聊一句：聊天正常，漏记数等于这一句的调用数；改回可写，再聊一句，记上了；
  5. 退出 DSH 再开，记录和漏记数都还在。

## 挑刺采纳情况

Codex 第一轮挑刺的结论是「退回修改」，以下已采纳：

- 全局监听本来就能收到各预设作用域的调用，删掉初稿「先探针、收不到就停」的前置步骤，改为「只登记一次、不在 `attachGuest` 里重复」。
- 入口判据：DSH 原生 RPC 也带 `rpcId`，初稿「带 `rpcId` 的算 Desktop」会把原生聊天记错；改为按每步已准入的来源分支定，DSH 原生、Desktop、Room 私聊靠发送方登记证据区分。
- 不再按会话缓存「最近一轮的入口」、不再事后重判保存的消息（回顾续做、渠道角色会被改写）。
- 预设改用 `composedPreset`，不读会话头。
- 压缩：没有在途步骤的记「后台整理」，不归到最近的发言入口。
- 碎碎念保留固定的 `sessionId: 'dsh-pet'`，靠 `purpose` 识别。
- 只记当前伙伴的调用；换绑途中不写。
- 漏记持久化到 Core 新 kind；坏库按错误类型分别处置，不再「打不开就改名」；读口只读打开、不建库。
- 对账口径改为全新安装下按渠道合计，补上访客、补答、失败尝试、Life 只在运行期间计等差异来源。
- 补上离线恢复会回卷账本、旁文件也要查哨兵、覆盖测试按实际调用逐笔比、rc.1／rc.5 双宿主、付费授权补总额度和授权人、生成的桌宠客户端计入提交阈值、模块数改为八个。

未采纳：无。

## 执行结果

## 审查结论
