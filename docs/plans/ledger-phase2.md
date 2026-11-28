# 账本二期：渠道用量和 Life 预算改从账本派生

- 级别：大改。要改 `vendor/**`（需主人授权），停写两个 Core kind，改动横跨 `core`、`world`、`living`、`channels`、`console`、`desktop`（生成文件）六个模块和两份脚本。
- 状态：已确认（2026-11-28 主人：「全部按推荐」）
- 依据：
  - [大模型使用 1a 用量账本](../product.md#大模型使用-1a-用量账本)的 1a-2 行
  - [用量规则](../product.md#llm-product-rules)
  - [每个单位必须通过的检查](../product.md#每个单位必须通过的检查)「账本二期」行
  - 账本一期拍板第 2、3 条（`docs/decisions.md:259-260`）
  - [架构 5.8.6](../architecture.md#llm-usage-current)
- 盘点基点：`main` 的 `e2441c5`。rc.5 指本机安装包里的 DSH 源码。
- 来源：Claude 写初稿，Codex 只读挑刺一轮后修订（见文末「挑刺采纳情况」）。

## 目标与外部变化

账本二期是独立个体阶段 0 的第二个发行单位。一期只加了账本，和旧统计并行；二期把剩下两个读数改成从账本算，并删掉它们各自的旧累计代码。

改完后主人能看到的变化：

1. **QQ／微信设置里的用量行。**
   - 原来：显示「本账号模型调用 N 次 · 输入 / 输出 · 缓存读取」，口径是当前账号的全期累计（`src/console/client.js:352-354`、`src/channels/messaging.ts:193-194`、`src/channels/usage.ts:11-13`）。
   - 改为：「本伙伴经 QQ 近 30 天（含今天）：调用 N 次 · 未命中输入 · 缓存读 · 输出 · 估算 ¥x」。
   - 账本没有账号维度，所以这里按渠道合计这个伙伴的所有账号（拍板点 3）。
2. **生活页的「生活会话用量估算」。**
   - 原来：读 vendor 自己累计的 `state.spend`（`src/console/client.js:694`、`vendor/dsh-world/lib/life/runtime.js:955-959`）。
   - 改为：「今天 home 花费 ¥x（账本）」。有缺价的调用时加注「部分估算」，有无价格的调用时加注「另有 N 次无价格，未计入」。
3. **每日费用提醒。**
   - 设置项不变（`src/console/client.js:708-709`）。
   - 金额改为账本里当天 home 会话全部调用的估算花费，包括压缩和标题。
   - 检查时机不变：仍是 home 每出一条带用量的助手消息时检查一次（`runtime.js:1049-1051`）。所以如果是一次压缩把花费推过预算，提醒会在下一条助手消息时才发出。
   - 提醒文字和送达不变：生活往 home 里递一句「额度用完」（`vendor/dsh-world/templates/alarm.md:33-34`），每天最多一次。
4. **用量页底部的「旧统计对照」删掉。** 一期拍板时就定了二期删除（`docs/decisions.md:260`）。同一块里的漏记提示（`src/console/client.js:895-896`）保留。

聊天、渠道收发、生活计划都不变。

## 范围变化

无新增目标。完成标准沿用 `docs/product.md:229`（1a-2 行），往返要求沿用 `docs/product.md:426`，「两轮对不上就停在并行记账」（`docs/product.md:231`）仍然有效。

1a-2 原文没写死、由本方案定下的用户可见取舍都列在拍板点里：

- 渠道读数改成跨账号、近 30 天，并显示金额
- 预算的金额改为包含辅助调用
- 越线提醒在下一条助手消息时发出
- 离线恢复后，预算金额可能被下调

## 核心做法

### 1. 账本读取：Core 加两个汇总函数

新建 `src/core/usage/totals.ts`。逐行汇总的逻辑从 `src/core/usage/report.ts` 里抽出来共用，包括：

- `total()` 和 `add()`
- 账本行转 `TokenUsage`
- 缓存缺报计数
- 部分估算
- 读错映射

用量页和两个新函数走同一份代码（`report.ts:11-26,45-57,64`）。价格只用 `priceCall`（`src/world/usage.ts:16-26`）。

两个函数：

- `homeSpend(scope, sessionId, day)`：当天这个会话全部调用的汇总，返回已计价金额、已计价次数、无价格次数、部分估算标记和缺用量次数。
  - 按 `day` 列筛选，走索引 `calls_day`（`src/core/usage/ledger.ts:64`）。
  - **增量读取**：同一进程里按 `(账本文件, day, sessionId)` 缓存上次读到的 `rowid` 和累计值，之后每次只读新增的行。换日、换会话、账本留档重建（`meta.recovery` 变了）或文件身份变了，就清空缓存。这样每个 home 步的开销只和新增行数有关，不会随当天步数越来越慢。
- `channelTotals(scope, today)`：从「今天减 29 天」到今天，`entry` 以 `qq-` 或 `wechat-` 开头的调用，一次查询同时出 QQ 和微信两组合计（`src/channels/messaging.ts:192-194` 同一响应里都要）。

两个函数的返回值都区分五种状态：

| 状态 | 含义 |
| --- | --- |
| 无账本 | 还没有过调用，文件不存在；只读打开时不建库（`ledger.ts:73-77`） |
| 有账本、范围内为空 | 账本存在，但所选范围内没有调用 |
| 有数据 | 正常汇总 |
| 重建过 | 已从坏库留档重建，带「合计只覆盖新账本」提示（`ledger.ts:94-113`） |
| 读不了 | 不可读，或格式较新（原因码沿用 `report.ts:64`） |

读不了的时候不回退到旧累计。

账本按系统时区归日（`ledger.ts:24`），Life 实例创建时也取系统时区（`src/living/plan/plugin.ts:71`），平时口径一致。运行中改了设备时区，两者会暂时不一致，Life 重挂后恢复。这种情况在特殊情况里写明，不另做处理。

### 2. Life 预算：vendor 的 `spent()` 改读账本（需主人授权，拍板点 1）

现状：

- vendor 运行时只在 home 会话带 `usage` 的 `assistant/message` 上调 `spent()`（`runtime.js:1049-1051`）。
- `spent()` 用 vendor 自己的 `stepCost` 逐步累加到 `state.spend.yuan`。超过 `deps.dailyBudget()` 时先置 `reminded`、写盘，再异步打开 home 递提醒（`runtime.js:954-976`）。
- Her World 只接了 `dailyBudget` 这一个接口（`src/living/plan/plugin.ts:263`）。

时序已经核实：rc.1 和 rc.5 都是模型流先结束、账本写完（`src/core/usage/listener.ts:38-49`），然后才追加 `assistant/message`。证据：

- rc.1：`node_modules/@deepseek-ai/dsh-llm/lib/index.js:2258,2402`、`node_modules/@deepseek-ai/dsh-session/lib/index.js:1601`
- rc.5：安装包内 `dsh-agent-loop/lib/index.js:890-898,962-968`

所以 `spent()` 被调用时，这一步的账本行已经写进去了。

改法：

1. `runtime.js` 的 `LifeDeps` 新增可选钩子 `spentToday(homeSessionId, day)`，返回三种结果：
   - `{yuan}`：有效金额，可以是 0
   - `{unavailable: true}`：账本暂不可读，或者绑定已变
   - 不提供钩子：保持旧算法，逐字不变
2. 提供了钩子时，`spent()` 的顺序是：先调钩子拿结果，再动 `state.spend`。
   - 拿到 `{yuan}`：换日初始化照旧，然后 `spend.yuan = yuan`，不再累加 `stepCost`。
   - 拿到 `{unavailable}`：这一步什么都不改，也不提醒。
3. `reminded` 的判断、提醒文字、`say` 送达都不动。现有送达保证也随之保留：`reminded` 先于送达置位，停机时可能出现置位了却没收到的情况（`runtime.js:961-975`）。二期不改善这一点，也不让它变得更差。
4. `state.spend` 的格式 `{day, yuan, reminded?: true}` 不变（`vendor/dsh-world/lib/life/types.d.ts:20-25`）。`yuan` 写的是账本算出来的值，旧版读得懂。
5. `runtime.d.ts` 声明新钩子。`vendor/dsh-world/origin.json` 里 `lib/life/runtime.js`、`runtime.d.ts` 两条追加 `changes` 说明，并更新 `sha256`。登记方式沿用现有的本地修改记录（`origin.json:168-179`）。
6. Her World 在 `src/living/plan/plugin.ts` 里接钩子：
   - 用现有的 `canWrite()` 和绑定判断（`plugin.ts:247-256`）先复核，绑定不对就返回 `{unavailable}`。
   - 绑定没问题时调 `homeSpend(bound.scope, id, day)`。
   - Life 暂停收尾期间，旧 runtime 的在途写入照现有规则处理（`plugin.ts:151-160,276`）。

为什么推荐改 vendor：提醒是递给她本人的一句话，让她「手上的事收个尾就歇一歇」，必须走生活的送达路径，也就是准入加 `flush`（`runtime.js:145-149`）。Her World 自己重写的话，要复制这套准入，vendor 里的旧累计还会每步写一次 `life.json`，「删掉旧累计代码」就做不到。

### 3. 渠道用量：删 `channelUsage`，状态改读账本

- 删除 `src/channels/usage.ts`。它的作用是按 `session/event` 累计 `channel-usage` 和 `channel-usage-event`（`src/channels/usage.ts:8-38`）。
- `src/channels/messaging.ts:65,193-194,234` 改为在状态响应里调 `channelTotals`，字段名仍叫 `usage`，内容换成账本口径：次数、未命中输入、缓存读、缓存写、输出、缺用量、估算花费、部分估算、起止日、状态。
  - 读失败时只把 `usage` 标成不可读，渠道状态的其余部分和设置保存照常（`src/channels/plugin.ts:123-135`）。
  - 如果 `createMessaging` 拿不到伙伴根目录（现在参数里只有 `workspaceId`、`storageId`、渠道子目录和 `active()`，见 `src/channels/messaging.ts:24-26`），就从 `src/channels/plugin.ts:48-62` 把绑定传进去，并同步改直接构造它的探针（`scripts/lib/check-messaging.mjs:49`）。
- 同一个提交里，页面的渠道行（`src/console/client.js:352-354`）也一起换成新字段，避免出现旧页面读新响应的中间版本。
- 旧写入器的其他使用者：
  - 合成数据生成器 `scripts/fixtures/synthetic-companion.mjs:21,123-126` 不再调旧写入器，也不默认生成账本。`tests/migrate/inventory.test.mjs:20` 要的是「首次调用前没有账本」。
  - 消息探针 `scripts/lib/check-messaging.mjs:77,199` 改核新字段。
  - 原生渠道探针 `scripts/checks/check-native-channel-homes.mjs:92-101,142-146` 原来固定断言 QQ 等于 3，改为核对本段操作前后的增量，因为现在跨账号合计。
- `arch/storage.json:18-19`：两条登记保留 selector（离线盘点靠它识别旧 kind，见 `scripts/migrate/inventory.mjs:25-29`），清空运行时 `writers`，evidence 改指停写说明，disposition 改为「停写，保留待清理」（拍板点 5）。
- 架构检查：
  - `tests/arch/known-violations.test.mjs:53-64` 里的 `channel-usage` 是 R5 合成写入样例，对应的样例文件是 `scripts/arch/fixtures/known-violations/src/channels/writers.ts:6`，不是 R6 基线。
  - 撤销写权后，样例保留，断言改为「被报为违规」。
  - `tests/arch/storage-locations.test.mjs:56-70,95-101` 同步「登记写者等于实际写者」。

### 4. 设置页其余部分

- 生活卡：`src/console/client.js:694` 改读 `lifeView` 里新增的 `ledgerSpend`。
  - `ledgerSpend` 由 `src/living/plan/plugin.ts` 的 `snapshot()`（`plugin.ts:482-494`）附加，用的是第 1 节那五种状态。
  - 账本读错只影响这一个字段，生活页其余部分照常。
  - vendor 返回的 `spend` 原样透传，页面不再读它。
- 用量页：删除「旧统计对照」那块，包括 `legacy` 状态和两次额外请求（`src/console/client.js:839-854,873-874,897-904`）。同时删掉 `report.ts` 里只给对照用的 `channels` 和 `homeYuan`。
- `src/world/usage.ts:1` 不再转导出 vendor 的 `stepCost`，`tests/world/world-modules.test.mjs:138-143` 同步修改。vendor 的 `stepCost` 在提供了钩子时不再被使用，`isPeak` 继续被 `priceCall` 使用。
- vendor 快照里的 `budget` 字段（`vendor/dsh-world/lib/console/snapshot.js:16-25`）在 `src/` 里没有读者，不改。
- 重新生成 `src/desktop/platform/client.js`（生成器是 `scripts/build/build-pet-platform.mjs:474-475`）。生成文件的改动计入提交阈值。

## 改动范围

- 这一步是：改逻辑（含 vendor 一处经授权的修改）

允许修改：

- **Core 与 World**：
  - `src/core/usage/totals.ts`（新建）、`src/core/usage/report.ts`：账本汇总，抽共用逻辑，删对照字段
  - `src/world/usage.ts`：删 `stepCost` 转导出
- **Channels**：
  - `src/channels/usage.ts`（删除）、`src/channels/messaging.ts`、`src/channels/plugin.ts`（只有需要传绑定时才改）：渠道状态改读账本
- **Living**：
  - `src/living/plan/plugin.ts`：接 `spentToday`；`snapshot()` 附加 `ledgerSpend`
- **Vendor**（拍板点 1 选 A 才允许，且仅限第 2 节描述的钩子及其登记）：
  - `vendor/dsh-world/lib/life/runtime.js`
  - `vendor/dsh-world/lib/life/runtime.d.ts`
  - `vendor/dsh-world/origin.json`
- **页面**：
  - `src/console/client.js`：渠道行、生活卡、删旧统计对照
  - `src/desktop/platform/client.js`：只由 `pnpm run build` 重新生成
- **脚本**（都不是高风险目录）：
  - `scripts/fixtures/synthetic-companion.mjs`
  - `scripts/lib/check-messaging.mjs`
  - `scripts/checks/check-native-channel-homes.mjs`
- **架构登记**：
  - `arch/storage.json`
  - `arch/layers.json`（如需）
- **测试**：
  - `tests/core/usage-totals.test.ts`（新建）
  - `tests/core/usage-coverage.test.ts`
  - `tests/core/usage-ledger.test.ts`
  - `tests/behavior-list/usage-ledger.test.mjs`
  - `tests/behavior-list/index.json`
  - `tests/living/living-lifecycle.test.mjs`
  - `tests/world/world-modules.test.mjs`
  - `tests/arch/known-violations.test.mjs`
  - `tests/arch/storage-locations.test.mjs`
  - `tests/infrastructure/offline-backup.test.mjs`：只补用例，原断言保留
- **文档**：
  - `docs/architecture.md`：4.1、Channels 写记录清单、5.8.6，以及第 200、258、570-572、770 行
  - `docs/settings.md:145,172`：预算和渠道用量的口径
  - `docs/product.md`：当前状态
  - `docs/decisions.md`：二期拍板和 vendor 授权

必须复用：

- `src/core/usage/ledger.ts:readLedger`：只读打开
- `src/core/usage/report.ts` 的逐行汇总：抽出来共用，不另写一份
- `src/world/usage.ts:priceCall`：唯一价表
- vendor `runtime.js` 现有的 `say`、`budgetText` 和 `reminded` 逻辑：送达不重写
- `src/living/plan/plugin.ts` 的 `canWrite()` 和绑定判断

不做：

- 不清理旧 kind 的存量数据
- 不给账本加账号列
- 不改账本表结构和格式版本
- 不改离线恢复协议：不动 `scripts/lib/offline-backup.mjs`
- 不加「每日总上限」硬拦截（`docs/product.md:271` 写明后置）
- 不改用量页的分组和日期范围
- 不让辅助调用自己触发提醒检查
- 不动 `scripts/migrate/`、`src/core/storage.ts`

提交拆分（每个提交不超过 15 个文件、600 行，`dist/src/**` 不计，生成的 `client.js` 计入；以实际 `git diff --numstat` 为准，超了先停下）：

1. **账本：抽出逐行汇总，加 home 当日花费和渠道 30 天合计。** 涉及 `totals.ts`、`report.ts`、新测试。在旧计数仍在时跑「账本和旧统计一致」对账，结果写进执行结果。
2. **Life：预算改读账本。** 涉及 vendor 三个文件、`plugin.ts`（只接钩子）、living 测试，再补离线恢复用例。
3. **渠道：用量改读账本，删除旧累计。** 涉及 `channels/*`、页面渠道行和重新生成的 `client.js`、三份脚本、`arch/storage.json`、两份 arch 测试，以及 `usage-coverage.test.ts` 里对旧模块的 import。
4. **设置页：生活卡改账本口径，删旧统计对照。** 涉及 `client.js` 和生成文件、`plugin.ts`（`ledgerSpend`）、`report.ts`、`world/usage.ts`、世界模块测试、行为清单里的旧对照测试。
5. **行为清单与文档。**

## 特殊情况

1. **账本读不了**（不可读、格式较新）：
   - 提醒这一步跳过，`state.spend` 不改。
   - 生活卡和渠道行显示「账本暂不可读」。
   - 聊天、生活和渠道保存照常。
2. **重建过**：照常汇总，并提示「已重建，合计只覆盖新账本」。
3. **无账本，或范围内为空**：
   - 生活卡显示「今天还没有记录」。
   - 渠道行显示「近 30 天经 QQ 没有调用」。
   - 两者分别判断：「今天没有调用」推不出「30 天都没有」。
4. **越线在辅助调用上**：一次压缩或标题把花费推过预算后，如果 home 没有再出带用量的助手消息，当天就不会提醒。下一条助手消息出来时才检查并提醒。这是保留 vendor 检查时机的代价，验收里要有这个用例。
5. **价格与旧算法的差异**（对账时逐条列出来源）：
   - 无价格：模型不在价表里，或服务商不是官方 DeepSeek（`src/world/usage.ts:19-21`），不计入预算（拍板点 4）。旧算法按模型名子串选价，不认识的一律当 Flash，也不看服务商（`vendor/dsh-world/lib/life/pricing.js:3-6,25-29`）。
   - 峰谷时段：新算法按开始时刻判断，旧算法按事件处理时刻判断。跨峰谷的调用可能出现实际差额。
   - 缓存写：非零时记为「部分估算」，已有的金额照计。
6. **缺用量**：计次数，不计花费。旧渠道统计的「未返回用量」只对应同一批可配对的事件。账本还包括没有对应事件的失败流、在途的辅助调用和补答（`tests/core/usage-coverage.test.ts:226-241`），所以两边不是一一对应。
7. **预算改动**：当天第一次达到预算时提醒一次。之后改高，当天不再提醒；改低到已花金额以下，下一个合格的 home 步会提醒。这些和现状一致（`runtime.js:961-963`）。
8. **一天之内换了 home**（原 home 不可用时，Core 会换一个，见 `src/core/companion-foundation.ts:94-105`）：
   - 金额只算当前 home 会话，从新 home 开始重新累计。
   - `reminded` 按伙伴日记，所以原 home 已经提醒过的话，当天不会再提醒。
   - 这和旧口径不同：旧口径不分 home，跨 home 一直累加。这种情况很少，接受这个差异，在文档里写明。
9. **跨午夜**：账本按调用结束时刻归日（`docs/product.md:218`），旧 Life 按事件处理时刻归日。`reminded` 按 `state.spend.day` 换日重置，这一点不变。
10. **调用途中换绑**：账本已经不记这类调用，计入漏记（一期拍板第 5 条）。预算和渠道读数都不包含它们。迁移停写期间，监听者只告警、不计漏记（`listener.ts:55-60`），这个例外保留。
11. **运行中改设备时区**：账本和 Life 的「今天」可能暂时不一致，Life 重挂后恢复。
12. **离线恢复**：沿用现有协议，不改。
    - 恢复器保留恢复前的 `life.json` 里的 `spend`（`scripts/lib/offline-backup.mjs:367-376`），也保留两个旧渠道 kind 的当前值。账本则回卷到备份时的状态。
    - 恢复后的下一次预算检查，会用回卷后的账本重算 `yuan`，金额可能变小。`reminded` 沿用恢复前的值，所以当天已经提醒过的不会再提醒。
    - 补一个用例验证这一点。
13. **降级往返**，两条路径结果不同，分开验：
    - **退回账本一期正式版**：一期继续写账本，也继续累计旧渠道 kind。渠道旧值从冻结值接着累加，缺二期运行期间的调用。Life 旧版从 `state.spend.yuan` 接着累加；如果当天已经提醒过，不会再提醒。
    - **退回 `v0.6.0`**：没有账本。渠道和 Life 的行为同上。
    - 再从 `v0.6.0` 升回二期：当天升级前的花费不在账本里，金额会变小，甚至为 0。这是已知的取值差异，写进往返记录。
    - 以上格式都兼容（`vendor/dsh-world/lib/life/lifeStore.js:138-155`、`v0.6.0:vendor/dsh-world/lib/life/runtime.js:955-964`），不算故障。
14. **打包**：vendor 改动随包发出。包检查会核对 `origin.json` 的哈希（`scripts/checks/check-runtime-package.mjs:116-127`，`verify` 会带上归档路径，见 `scripts/checks/verify.mjs:21-23`），所以哈希必须更新。

## 概念与扩展检查

- 不新增概念、入口 kind、事件或词表。按 `qq-`、`wechat-` 前缀分渠道，沿用一期 `report.ts:45-47` 的做法；Codex 先跑 `pnpm run check:arch -- --report`，看 R8 有没有现成的集合可以复用。
- 三个已有概念换了拥有者或口径，写进 `docs/architecture.md`：
  - **花费事实**归 Core 账本。
  - **当天提醒标记，以及为了兼容旧版投影的 `yuan`**，仍归 Life。
  - **渠道设置里的用量**，改为跨账号、近 30 天的滚动合计。
- 新增或改变的契约，写进文档和类型：
  - `spentToday` 的三种结果
  - `lifeView.ledgerSpend`
  - `messaging.*.usage` 的新字段
- 层间：living 和 channels 原本就允许依赖 core（`arch/layers.json:60-63,123-126`），这次只是普通的函数导入，不需要登记新的服务读取。
- vendor 接口：`LifeDeps` 多一个可选钩子。没提供钩子时，行为必须和现在一致，要用一个不传钩子的调用者来验。

## 拍板记录

1. **Life 预算怎么切到账本**
   - 推荐：**A** 授权在 `vendor/dsh-world/lib/life/runtime.js` 加 `spentToday` 钩子，提醒仍走生活原有的送达路径，改动登记进 `origin.json`。
     - 这个文件已有多次经授权的本地修改，登记方式现成（`origin.json:168-172`）。
     - 改动只有几行，又能真正删掉旧累计。
   - 备选：**B** vendor 不动，Her World 关掉 vendor 提醒，自己往 home 递提醒。要复制生活的准入；vendor 的旧累计还会继续写 `life.json`。
   - 决定：A，授权改 vendor 的 Life 运行时，加 `spentToday` 钩子（主人 2026-11-28 授权）
2. **预算算哪些调用**
   - 推荐：**A** 当前 home 会话当天的全部调用，包括压缩、标题。预算管的是钱，旧算法只是因为这些调用不产生 `assistant/message` 才漏掉了它们。代价见特殊情况第 4、8 条。
   - 备选：**B** 只算普通对话，最接近旧口径；**C** 伙伴当天的全部调用，包括 Desktop、Room、渠道和碎碎念。
   - 决定：A，当前 home 会话当天的全部调用
3. **渠道用量怎么显示**
   - 推荐：**A** 本伙伴经该渠道近 30 天（含今天）的跨账号合计，加估算花费。账本没有账号维度；全期累计要扫整张表，而且会越来越慢。
   - 备选：**B** 全期累计。
   - 决定：A，近 30 天跨账号合计加估算花费
4. **无价格的调用怎么计入预算**
   - 推荐：不计入，生活卡注明次数，符合[用量规则](../product.md#llm-product-rules)。
   - 备选：按 Flash 计价，沿用旧算法。
   - 决定：不计入，生活卡注明次数
5. **旧 kind 的存量数据**
   - 推荐：停写保留，等下一个升存储版本的单位再清理。保留的话，降级时旧版还能接着用，离线盘点也认得；删除不可撤回，而且要动迁移步骤。
   - 备选：本版删除。
   - 决定：停写保留

**前提（不需要拍板）**：二期的「往返：上一版」指账本一期正式版，一期目前「验收通过、尚未发行」（`docs/product.md:195`）。二期开发现在就可以开始，但发行前必须先发出一期正式版。

## 验收

### 快测

```bash
pnpm run build
```

然后跑这几个测试（实际路径以 `package.json` 的脚本为准，Codex 执行时核对）：

- `tests/core/usage-totals.test.ts`
- `tests/core/usage-coverage.test.ts`
- `tests/behavior-list/usage-ledger.test.mjs`
- `tests/living/living-lifecycle.test.mjs`
- `tests/world/world-modules.test.mjs`
- `tests/arch/*.test.mjs`

最后跑：

```bash
pnpm run check:arch
```

### 对账

提交 1 完成、旧计数还在的时候跑一次，结果写进执行结果。

- 在 `tests/core/usage-coverage.test.ts` 已有的渠道对账用例（第 216-242 行）上，补一条 Life 用例。
- 同一组假适配器调用，三组数要对上：
  - 旧渠道计数和 `channelTotals`：只比可配对事件的普通对话，比次数、token 和缺用量。
  - 旧 `state.spend.yuan` 和 `homeSpend`：普通对话、官方模型、同一价表、同一时段，差在浮点误差内。
  - 用量页逐日金额相加和渠道 30 天合计：数据里要有一笔昨天的调用和一笔窗口外的调用。
- 辅助调用、无价格、跨峰谷、跨午夜各造一个例子，列出预期差额和来源。

### 行为测试

新增，写进行为清单：

- **LEDGER-BUDGET-01**：
  - home 普通调用跨过预算时，递一次「额度用完」；同一天再跨不再递。
  - 压缩跨过预算时，当下不递，下一条助手消息出来时递。
  - 账本不可读时不递、不改 `state.spend`、不报错。
  - 不传钩子的 runtime 行为和旧版一致。
- **LEDGER-CHANNEL-01**：QQ 主人、访客各一次调用后，渠道状态显示近 30 天合计；`channel-usage`、`channel-usage-event` 不再新增记录；账本不可读时只有用量字段报不可读，渠道设置照常保存。
- **离线恢复**（补进 `tests/infrastructure/offline-backup.test.mjs`）：恢复后账本回卷、`spend` 保留，下一次检查按账本重算，当天不重复提醒。

### 门禁

合并前跑一次 `pnpm run verify`，含包检查和 vendor 哈希，再跑：

```bash
pnpm run build && pnpm run test:behavior-list
```

### 往返

退回账本一期正式版、退回 `v0.6.0` 各做一次，按特殊情况第 13 条逐项核对：

- 生活卡能打开
- 旧版能读回 `life.json`，当天不重复提醒
- 渠道状态能显示，旧计数从冻结值接着累加
- 从 `v0.6.0` 再升回二期时的取值差异如实记录

### 宿主

rc.1 和 rc.5 各用安装包跑一遍「创建、聊一句、压缩、重启」。

### 手动

在隔离安装里用合成资料，主人操作：

1. 按 1a-1 的完整流程走一遍：
   - DSH 原生、QQ 主人、桌面、Room、guest 各聊一句
   - 跑一个 Life 回合和一次回顾
   - 触发一次碎碎念和一次压缩
2. 把每日预算设成比当前花费略高，再聊一句，确认她在 home 里收到「额度用完」，当天只收到一次。
3. 打开 QQ 设置看用量行，再在用量页把近 30 天每天的 QQ 数字加起来，确认两者一致；用量页已经没有「旧统计对照」。
4. 退出 DSH 再打开，确认读数还在，没有重复提醒。

## 挑刺采纳情况

Codex 只读挑刺一轮，全部采纳：

- **时序确认无问题**：rc.1 和 rc.5 都是先记账、后发 `assistant/message`。已写入核心做法第 2 节。
- **把检查时机说清楚**：压缩跨过预算要等下一条助手消息才提醒；原稿说「达到预算就提醒」，承诺过强。改了外部变化第 3 条和特殊情况第 4 条，并加了验收用例。
- **送达保证**：原稿把预算提醒和带回执的送达路径混为一谈，已改为如实说明「保留现状、不改善」。
- **离线恢复写反了**：恢复器实际保留恢复前的 `spend`。已改写特殊情况第 12 条，选择沿用现有协议，并补了用例。
- **降级往返**：分开写两条路径，补上从 `v0.6.0` 再升回来的取值差异。
- **一天内换 home**：会改变预算口径，已写进特殊情况第 8 条。
- **钩子的三种结果**：先复核绑定、再改 `state.spend`；读错只影响用量字段。
- **账本状态**：区分五种状态；不可读和重建过是两回事。
- **性能**：每个 home 步改为增量读取，渠道一次查询出两组。
- **30 天窗口**：明确起点是今天减 29 天，按逐日相加来对账。
- **缺用量不是一一对应**：已改写特殊情况第 6 条。
- **价格对账条件**：补了峰谷时段和服务商的差异。
- **复用**：要求复用 `report.ts` 的逐行汇总；删除旧对照时保留漏记提示。
- **补列文件**：合成数据生成器、两个探针、世界模块测试、离线恢复测试、`src/channels/plugin.ts`、`docs/settings.md`，以及 `docs/architecture.md` 的更多行号。
- **架构检查认错**：`channel-usage` 是 R5 合成样例，不是 R6 基线，已改正。
- **提交拆分**：渠道字段的生产者和页面消费者放在同一个提交里；生成的 `client.js` 计入阈值。

## 执行结果

- 第 1 份补丁在 `core/usage/totals.ts` 抽取逐行计量、定价和读错映射，供 `report.ts`、home 增量读数及双渠道 30 天合计复用。两个 Core 测试文件覆盖范围、重建、换库和新旧对账。
- 第 2 份在授权的 vendor 运行时及类型中加钩子，更新 `origin.json` 两项哈希。`living/plan/plugin.ts` 复核绑定并接入预算，生命周期、离线恢复和独立无钩子调用者均有用例。
- 第 3 份切换渠道的 `messaging.ts`、`plugin.ts` 和页面读数，删除 `channels/usage.ts`。合成生成器和两个探针改用新口径，`arch/storage.json` 撤销两种写权，两个 R5 测试验证停写。
- 第 4 份在 Life 快照加 `ledgerSpend`，更新设置页和生成的桌宠页面，删用量页旧对照及 Core 的对照字段，取消 World 的 `stepCost` 转导出，更新对应测试。
- 第 5 份登记预算、渠道和无钩子兼容行为，更新架构、设置、产品状态与五项拍板。五批均包含相应的已跟踪构建产物，按要求交付顺序补丁。
- 第 1 批保留旧写入器及旧 Life 算法时，`pnpm run build` 成功，`node --test dist/tests/core/usage-{coverage,totals}.test.js` 8 过、0 失败。可配对 QQ 事件共 2 次，未命中输入 3、缓存读 1、输出 5、缺用量 1，两边一致。缓存写仅账本记录，另有无事件失败流及辅助调用各 1 次。普通官方 home 两边均 ¥2，QQ 30 天与逐日之和均 ¥8，含昨天和起始日，排除窗口外 1 笔。
- 同组假调用的单笔增量（账本／旧 Life）为压缩 ¥2／¥0，非官方服务商 ¥0／¥2，北京时间 11:59 开始、12:01 处理 ¥2／¥1。午夜前流结束、午夜后助手事件到达，账本在前一天计 1 笔，旧 Life 在次日计费。
- 最终构建成功。`node --test` 运行方案快测及账本写入、离线恢复、合成盘点、行为索引和渠道表单回归共 171 过、0 失败、0 跳过。按索引运行 `LEDGER-*` 另 4 过。两端页面文案、两项 vendor 哈希、4 个 JS 语法检查通过。SQLite 查询计划使用 `calls_day (day=? AND rowid>?)`。
- `pnpm run check:arch -- --report` 和 `pnpm run check:arch` 用于核对词表和基线。开发中修正了 4 个 R8 状态词表重合项、渠道表单独立装载时的作用域错误及对账夹具缺少的 QQ 补答原消息 ID。最终架构检查新增 0，基线无修改。
- 拆分微调为第 3 批随旧渠道写入器撤掉渠道对照请求，第 4 批撤掉余下的 Life 对照请求。原生 QQ 固定计数实际在探针委托的 `check-messaging.mjs`，该处和外层探针均使用增量断言。
- 验收留意压缩越线后的下一条合格助手消息，以及恢复前 ¥1.20、恢复后账本 ¥0.60、下一步 ¥1.10 且当天仅一次提醒的用例。全量门禁、完整行为清单、退回一期正式版和 0.6.0 的往返、rc.1／rc.5 安装包及主人手动验收待执行，二期发行前须先发行一期。

## 审查结论
