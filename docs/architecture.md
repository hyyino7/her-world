# Her World 架构

这里写三层重构的目标结构和现状基线。阶段安排和完成标准见 [product.md](product.md)，拍板过的取舍见 [decisions.md](decisions.md)。

- 2.1 的行数以 Her World 0.1.8（提交 `0a45ada`）为基线；其余「现状」说法对应 0.2.0。
- 代码路径默认相对 `src/`；`scripts/`、`tests/`、`vendor/` 下的文件写全路径。
- 目录：阶段 1 缩小后（[decisions.md](decisions.md)「阶段 1 缩小」），第一层、第三层保留现有目录（`src/core/`、`src/room/` 等）；第二层在 2a 合并进 `src/living/`。下面总览里的 `kernel / surface` 只是层的代号，不是目录。

---

## 0. 一页总览

```
        你（桌宠 / Room / QQ / 微信 / 语音 / 设置页）
                       │
┌──────────────────────▼─────────────────────────────┐
│ 第三层  呈现与连接  surface/                       │
│   Desktop·PetPlatform   Room   Channels   Voice   Console │
│   只往下依赖，同层不互相引用；只存自己的数据          │
└──────────────────────┬─────────────────────────────┘
        向下：调用（读快照、发命令） │ 向上：事件、登记
┌──────────────────────▼─────────────────────────────┐
│ 第二层  生活世界  living/                          │
│   身体 · 计划与回顾 · 钱包背包菜园阅读                  │
│   一个实例；内部直接调用                             │
└──────────────────────┬─────────────────────────────┘
        向下：调用            │ 向上：事件、登记
┌──────────────────────▼─────────────────────────────┐
│ 第一层  伙伴本体  kernel/                          │
│   身份与绑定 · DSH 聊天接缝 · 记忆 · 情绪 · 记录库       │
│   登记口：来源适配 · 能力状态 · 工具声明 · 初始化 · 运维操作      │
└────────────────────────────────────────────────────┘
                    DSH（聊天、调度、会话日志）
```

**一条总规则：向下用调用，向上用事件和登记。** 底层绝不主动去找上层要东西，也不订阅上层的事件。例如记忆不订阅生活世界的回顾事件，而是生活世界在回顾完成时**向下调用**记忆服务。

---

## 1. 外部能看到什么变化

- **主人看到的**：功能、界面、数据位置、DSH 里的插件名和更新按钮都不变，重构完应该和 0.1.8 用起来一样。
- **开发者看到的**：目录按三层重排；多一组自动检查；多一份状态拥有者表；多一套带版本号的迁移与回退流程。
- **这次不做**：新功能、换 DSH 插件体系、拆多个包。

---

## 2. 三层和模块

### 2.1 现在 → 以后

| 现在的目录 | 行数（不含上游生成文件） | 去哪里 | 说明 |
| --- | ---: | --- | --- |
| `core/` | 3370 | 第一层 | 目录不改；剩余的向上读取和 import 按 [product.md](product.md)「第一层剩余违规的去向」，归 2a 的 18 条已清，余下的在阶段 3 清，另有 4 条长期例外 |
| `memory/` | 966 | 第一层 | 记忆的创建和关闭归第一层 |
| `emotion/` | 698 | 第一层 | 含近期互动账本 |
| `contracts/` | 268 | 拆成三份，各层一份 | 接口跟着拥有者走 |
| `living/body/` + `living/plan/` + `living/economy/` | 6430（0.1.8 时三个旧目录合计） | 第二层 | 2a 已合并成 `src/living/` 和一个常驻实例，见 2.3 与第 6 节 |
| `desktop/` | 21380（大头是生成文件） | 第三层 | 生成文件改生成器，不手改 |
| `room/` | 989 | 第三层 | 不再引用 `desktop/images` |
| `channels/` | 1818 | 第三层 | 不再往 Core 数据库的 `records` 表写自己的记录 |
| `voice/` | 71 | 第三层 | 通过第一层声明的「语音接口」使用，见 5.4 |
| `console/` | 1674 | 第三层 | 通过「运维操作表」操作其他模块，见 5.5 |
| `world/` | 74 | 按调用者分到三层 | 它转发 `vendor/dsh-world`，还转发本地的记忆批处理；`petWorld.modules` 的公开形状必须保持不变 |

### 2.2 第一层「伙伴本体」管什么

1. **身份与绑定**：伙伴 ID、绑定的资料目录、存储清单、`core.json`；**共享 home 会话的身份记录**（前台打开 home 不要求自主生活启用，所以这条记录不能放在可卸载的生活入口里）。
2. **与 DSH 原生聊天的接缝**：现在的 `core/native/`。
3. **记忆**：Mnemosyne 引擎整体复用，创建、关闭、绑定校验都归本层。
4. **情绪**：状态文件和近期互动账本。
5. **记录库**：自述、历史、日记、相册。
6. **登记口**（本层提供，上层登记）：

| 表 | 作用 | 现状（M2 后） |
| --- | --- | --- |
| **初始化登记** | 各模块登记自己的初始化动作和清单里的文件 | 已有 `registerInitializer`（`core/workspace.ts:340-345`），Economy、Memory Bank、近期账本在用。Core 写死的 13 个目录、桌宠配置、Life 控制文件、情绪文件（`core/initialization.ts:8-10,67-79`）**不再改成登记**：显式初始化时一次建好、启动时一起校验，避免部分加载语义（阶段 1 缩小）；`initialization.ts` 的两条 R1 是长期例外 |
| **提示词与历史投影** | 各模块登记提示词片段；工具结果在历史里怎么瘦身 | 历史瘦身已由工具声明的 `historyOverview` 派生（`core/tables/tools.ts`），Core 不再 import 各模块的投影函数。提示词片段继续用 `registerWorldPrompt`（`core/native/prompt.ts:99`）在模块入口登记，动态段退休照旧（`core/native/prompt.ts:27-63`）；段声明表和状态快照退休表**不做**（阶段 1 缩小） |
| **来源适配表** | 一种「原生输入来源」登记一整套适配：准入、工具限制、守卫、历史投影、图片恢复 | 已落地：`core/tables/sources.ts`，挂在 `host.native.sourceTable`。Core 登记主人原生输入，Life、Room、Channels 各自登记适配器，Desktop 登记首步前的图片恢复和第 7、9 行声明（5.8）。判定分 `unclaimed / rejected / accepted / failed`，另有只读分类供历史投影。登记完成屏障未实现，见下面的契约 |
| **能力状态表** | 各模块登记自己的状态行（只有状态和操作名，不能被调用） | 已落地：`core/tables/capabilities.ts`。Core 只登记会话和记忆两行，其余由提供它的模块在入口登记、卸载时撤销；模块缺席即无行，设置页对这类拥有者显示「不可用」 |
| **运维操作表** | 设置页要执行的操作（开房间、授权访问、改平台设置、操作 Channels）由各模块登记，控制台只调用这张表 | 未做（阶段 3）：控制台直接认识 Desktop、Room、Life、Emotion、Economy、Channels |

另有伙伴工具声明表（`core/tables/tools.ts`，挂在 `host.native.toolTable`）：各模块在工具定义旁声明可用来源和可选的历史概览，Life 名单和历史瘦身由它派生。三个登记口共用 `core/tables/registry.ts` 的登记表。

另有伙伴判定登记口（`core/tables/companion-ports.ts`，挂在 `host.native.companionPorts`），复用同一个登记表，让第一层不再读生活服务：Body 登记「身体可用」，Plan 登记「此会话由 Life 自带相册」和「仍是运行中的 Life home」，Room 登记「此会话正在看电视」，`LivingWorld` 在首个可见区挂载时登记活动只读接口（`living/plan/activity-reader.ts`）。生产方只在挂载时按 Cordis 根和隔离标签判断对 Core 是否可见，读取时核对租约；读不到登记时等同服务不在。Memory 另提供向下调用的 `host.native.requestReviewCompaction(sessionId)`，由 Life 回顾完成和 Bridge 整理调用。

**每张表的契约（契约测试在 `tests/core/tables*.test.ts`）：**

- 重复登记：同一键重复登记是错误，不是覆盖。
- 优先级和顺序：需要顺序的表（提示词、来源适配）显式写排序键，不靠加载先后。
- 「没有适配器认领」和「适配器拒绝」是两种结果，不能都当成 `false`。
- 登记完成屏障：第一层在所有登记完成之前，对来源适配表返回「未就绪」，不是「放行」。**未实现，推迟不排期**：没有找到可用的宿主接点，硬加会让启动窗口里的主人输入被拒；现在没登记的来源返回 `unclaimed` 并拒绝，和 0.1.8 一致。2a、阶段 3 的验收继续覆盖「未登记即拒绝」和不同装载顺序；等 DSH 提供接点，或观察到启动窗口里有输入被误拒时再议。
- 撤销：模块卸载时撤销登记；撤销之后，在途调用必须失效或被取消，不能继续用旧回调。
- 异常：适配器抛错只影响它负责的来源，不拖垮其他来源，也不放行。
- 授权边界：owner、guest、Life、电视画面这几种输入的授权互相独立；渠道准入还要核验原消息和一次性授权，所以准入不是一个布尔回调，而是带上下文的结构化判定。
- 实时准入和只读分类分开：来源适配表的准入只判断「现在这条输入能不能进」；历史投影等事后读取已保存消息时，用只读分类按消息字段选出分支，不看当前运行状态、不消耗授权。没有被任何适配器认领的已保存输入，一律保护所在轮次不瘦身。
- 词表可扩展：`source.kind` 和工具来源的内置取值在 `contracts/tables.ts` 声明；新来源的 kind 在 DSH 的 `MessageSourceMap` 声明一次即可，新的工具来源用 `toolTable.registerSource` 登记，拼错或未登记的被拒绝，撤销后旧授权立即失效。

### 2.3 第二层「生活世界」管什么

| 区 | 现在对应 | 唯一拥有的数据 |
| --- | --- | --- |
| 身体 | `living/body/` | `data/behavior/home.json`（已有 `data/life/home.json` 则沿用） |
| 钱包背包菜园阅读 | `living/economy/` | `data/economy/economy.sqlite`、`storage.json`；和钱包目录分开的采用证据 `data/living/economy-adoption.json` |
| 计划、回顾、闹钟、日记复盘 | `living/plan/` | `data/life/control.json`、`life.json`（home ID 镜像和待迎接）、`life/wakes.jsonl`、`activity/*`、`compactions.jsonl` |

- **一个常驻实例**：`LivingWorld`（`living/index.ts`）按 Cordis 根、Core 实例和服务隔离标签分组，三个生活入口里先加载的那个创建，最后一个卸载时释放；每个区仍留在自己入口的作用域里，卸载哪个入口只停哪个区（6.2）。
- 对外四样（世界快照、命令、事实流、`world.changed`）的定义在 5.2。
- 三个区之间经实例查找，不再通过 Cordis 服务名互相查找；区之间仍互发的三个旧事件（Life 订阅 `pet/behavior.changed`、`pet/economy.fact`，Body 订阅 `pet/life.changed`）改成直接调用，归阶段 3，和第三层改用 `world.changed`、退掉旧事件一起做。
- **合并目录不等于合并事务。** 身体文件和经济数据库仍然分开提交，「身体效果已生效、库存结算失败后重启补结算」的现有协议原样保留，不改。

### 2.4 第三层「呈现与连接」管什么

Desktop（含 PetPlatform）、Room、Channels、Voice、Console。两条规则：

1. **只往下依赖，同层不互相引用。** 需要别的同层模块的能力时，经第一层的接口或登记表。
2. **只存自己的数据，不往第一层、第二层的存储里写。**

现在违反的：`room/chat.ts` 引用 `desktop/images`；Channels 把 5 类记录（kind）写进 Core 数据库的通用 `records` 表；Desktop 把会话映射 `desktop-session` 写进 Core 数据库（`desktop/index.ts:44`）；Desktop 读多个上层服务。

---

## 3. 依赖规则和自动检查

规则写成机器可读的清单 [arch/layers.json](../arch/layers.json)：每个模块属于哪层，允许依赖谁，允许读哪些服务，允许发布和订阅哪些事件。检查脚本用仓库已有的 TypeScript 编译器接口写，不加新依赖。

- **R0**：第三层 → 第二层 → 第一层；第三层模块之间禁止互相依赖。向下调用、向上事件与登记。

| 编号 | 检查什么 | 覆盖范围 | 怎么查 | 建立时间 |
| --- | --- | --- | --- | --- |
| **R1** | 静态 import 方向 | `.ts` 和 `.js/.mjs/.cjs`；动态 `import()`；`createRequire`；`#别名` 路径 | 脚本读 import 关系，对照 `layers.json` | M1 |
| **R2** | 运行时服务读取 | `ctx.get('petX')`、`ctx.petX`、`scope.petX`、`inject: [...]`；还要识别别名、解构、计算名（例如把服务名存进变量再读）；遇到无法静态判定的写法直接判失败，要求改成显式写法 | 扫描 + 每个模块声明允许读取的服务；声明是子集且方向合规 | M1 |
| **R3** | 事件 | `ctx.on / ctx.emit('pet/…')`，也包括 DSH 原生事件的订阅；事件只能向上流（订阅者所在层不低于发布者）；事件名在发布层的 contracts 里声明 | 扫描 | M1 |
| **R4** | 直接给别人的对象赋值 | `host.native.xxx =`，也包括通过别名、解构后的赋值 | 扫描，并配一个「已知违规」样例集验证脚本真的抓得到 | M1 |
| **R5** | 谁在写哪份数据 | 见下 | 见下 | M1 起只报告；存储句柄随阶段 3 的数据搬迁方案再定 |
| **R6** | 关闭后不留尾巴 | 定时器、订阅、在途请求，以及在途 I/O 和子进程 | 见第 8 节 | 从阶段 2a 起，每个新写的模块各带一条 |
| **R7** | 外围可关闭 | 见下 | 组合测试 | 阶段 2 覆盖生活世界的卸载与暂停；阶段 3 覆盖全部外围模块 |
| **R8** | 词汇重复与裸字符串 | 同一组字符串取值（例如六种照料动作）出现在多个文件；公开接口（各层 contracts 和对外服务）里的 `kind / action / status / type` 字段是裸 `string`，而不是声明出来的类型 | 扫描；旧重复留在基线里放行并只报告，随各阶段统一词表逐步清理；新增重复当场阻断 | M1 |

**棘轮**：R1–R4 的基线在 [arch/baseline/rules.json](../arch/baseline/rules.json)，R8 在 [arch/baseline/vocabulary.json](../arch/baseline/vocabulary.json)；R5 的 [arch/baseline/writers.json](../arch/baseline/writers.json) 只作报告，不参与棘轮。已建立的检查出现新增违规，或旧条目消失而未同步收紧基线，都会失败；更新基线只能删条目，清理旧违规时同提交收紧。检查与报告命令见 [开发说明](development.md#architecture-behavior)。尚未建立的检查不计为已生效。

**R5 的做法：**

- 状态拥有者表（第 4 节）登记每份持久数据的路径或表名、拥有者、**唯一写入协议**。
- （目标，未实现，随阶段 3 的数据搬迁方案再定）第一层提供**按拥有者划分的存储句柄**：句柄只暴露拥有者自己的表和行，别的模块拿不到。拼 `.chatpet/data/…` 路径的代码只允许在第一层的存储模块里。
- Core 的 SQLite 里**不许出现别的模块的表，也不许出现别的模块的记录 kind**。Core 的 `records` 表按 `kind` 区分记录，Channels 的 5 类记录和 Desktop 的会话映射就是这样混进来的。拥有者边界覆盖**记录 kind 和写入端口**，不只是建表。
- **局限**：脚本只能查到「哪个模块创建了哪个文件、哪张表、写了哪个记录 kind」，查不到「对已有文件的某一行的越权更新」。后者靠「句柄只暴露自己的数据」从设计上堵，再用一个运行时写入追踪测试在一次性数据目录里核对实际产生的文件和表。

**R7 要覆盖：**

- 外围模块全部关闭、逐个关闭、不同启动顺序、重载（关了再开）。
- **卸载和暂停是两回事**：卸载生活入口、显式暂停生活、卸载身体入口，分别验证。
- 工作区 A→B→A 换绑。
- 写入已完成但响应被取消。

另外，**绑定校验要带实例代次**（一个每次绑定新生成的 ID），不能只比较工作区名称和路径。现有 `memory/client.ts` 已经这样防范「同名绑定重新连接后旧请求返回」，把它升级成公共助手。

**每条检查都有真实案例**：R1 到 R8 在 Her World 的提交历史里都有对应案例（例如 R6：关闭后晚到的录音、语音排队取消丢失、关闭失败导致清理中断）。新增检查也要写明对应的案例，对应不上的不加。


**检查脚本的已知局限**（报告时要考虑，改法等用到时再定）：

- R5 只解析文件操作的第一个参数（`scripts/arch/lib/storage.mjs:28`）。`rename*`、`copyFile*` 的写入目标是第二个参数，所以原子写会被报成写临时文件，「无法静态判定」的条目里有一部分是这个原因。
- R5 把未登记的 CoreStore kind 默认归给 `core`（同文件 `:60`），Core 写一个未登记的 kind 会显示「一致」。目前靠逐 kind 对上 `store.put` 的测试兜底。
- R8 会收进 `src/` 里的非业务集合，例如协议前缀、本机地址、HTTP 方法、文件后缀。已有的照常修改不受影响；新代码写出同样的集合会被拦，属于误报，按「真误报就修脚本」处理。

---

## 4. 状态拥有者表

数据路径、物理容器、当前写入者、目标拥有者和版本的机器登记见 [arch/storage.json](../arch/storage.json)；路径清单在那里维护，本节说明归属和写入协议。数据位置默认**不变**。「唯一写入协议」一栏标「待定」的，在对应阶段的实施方案里补。

| 数据 | 新拥有者 | 现在谁写 | 变化 / 唯一写入协议 |
| --- | --- | --- | --- |
| `.chatpet/{manifest.json, SOUL.md, USER.md, COMPANION.md, core.json}` | 第一层·身份与绑定 | Core 初始化和设置 | 不变 |
| Core 数据库：身份、设置、请求去重、原生消息映射、记忆待处理/确认 | 第一层 | Core、NativeMemory、Memory batch | 不变 |
| Core 数据库：`channel-received / channel-reach / life-outlet-delivery / channel-usage / channel-usage-event` | **第三层·Channels** | Channels 直接写 | **搬出**到 Channels 自己的数据库（随 Channels 重写）；`life-outlet-delivery` 的归属另议，它连接生活与渠道 |
| Core 数据库：`desktop-session` | **第三层·Desktop** | Desktop 直接写 | **搬出**到 Desktop 自己的存储（随 Desktop 重写） |
| 钱包「已采用」证据：`economy.sqlite` 的 `meta.economy.initialized` 和独立文件 `data/living/economy-adoption.json`（都是 `{storageId, companionId}`） | 第二层·钱包区 | Economy | 原来放在 Core `meta` 的 `economy.initialized:<storageId>`，已由离线迁移步骤 `0003-economy-marker` 搬走：先在钱包库里写标记并提交，再原子写独立证据，两者都落盘后才删 Core 旧键（`scripts/migrate/steps/0003-economy-marker.mjs:101-121`）。首次建库时先验旧菜园，在钱包租约下先落独立证据，再在同一个事务里建表、导入旧菜园、写库内标记，提交后补 `storage.json`（`living/economy/store.ts:75-125`）。运行时认五种采用证据：独立证据、库内标记、`storage.json`、身体检查点的 `economyGardenAuthority`，以及同一 `storageId` 的迁移日志里含 `0003` 且记了 `economyAdopted:true` 的段（`living/economy/adoption.ts:31-73,85-106`）。任一成立而库缺失，就拒绝钱包，不建空库、不导入旧菜园，免费照料照常；钱包目录和 `data/living/` 同时丢失时，迁移日志这一条仍然挡住重建。日志缺失或损坏按没有这条证据处理，不影响工作区；所以钱包目录、`data/living/` 和迁移日志三处同时丢失或损坏时，运行时认不出曾经采用过，这是已知边界。证据文件内容坏了只拒绝钱包，工作区清单只看文件在不在。独立证据已落盘、库还没提交时拒绝自动补建，钱包能力状态行 `life.economy` 给出证据路径和处理办法 |
| Core 数据库：`native-memory-view / native-memory-action` | 第一层（只保留） | 无：旧版本写入，当前 `src/` 不读不写 | 原样保留，是否清理另议；登记后盘点不再报未知 kind |
| Mnemosyne 记忆库 `data/memory/data/memory.db` 等 | 第一层·记忆 | Mnemosyne 服务、Pet 接口 | 不变 |
| 情绪 `data/emotion/state.json`；近期账本 `.chatpet/data/memory/recent-interactions.sqlite`（`src/emotion/recent.ts:11-17,47-56`） | 第一层·情绪 | Emotion | 近期账本虽在 Memory 目录，业务拥有者仍是 Emotion；初始化改为自己登记 |
| 共享 home 会话身份记录：`core.sqlite` 的 `companion-home` 记录（`{sessionId, arrivalPending?}`，按 `storageId` 一条） | 第一层·身份与绑定 | Core | 共享 home 身份和待交接标记归第一层，Core 按绑定写 `companion-home`（`core/workspace.ts:156-169`）。前台和计划区建 home 都走同一个串行入口 `ensureCompanionHomeSession`（`core/companion-foundation.ts:88-108`），先写 Core 再返回。离线迁移步骤 `0002-home-identity` 从旧镜像复制 ID，不删 `life.json` 的字段 |
| 身体 `data/behavior/home.json`（或 `data/life/home.json`） | 第二层·身体区 | Behavior | 不变 |
| 旧菜园 `garden.json` | 第二层·钱包区（只作迁移来源） | 尚未采用 Economy 的存档由旧存储写 | 不再作为运行路径，只作尚未采用存档的一次性迁移来源 |
| 钱包背包 `data/economy/*` | 第二层·钱包区 | Economy | 不变；只用 `mode=rw` 打开已存在的库，库存在就必须有同绑定的库内标记，空壳库拒绝 |
| `data/life/control.json`、`life.json`（计划部分）、`data/life/life/wakes.jsonl`、`activity/*`、`compactions.jsonl` | 第二层·计划区 | Life | 计划区独占 `life.json` 的 home ID 镜像和待迎接 `greeting`（上游运行时要读，经 `living/plan/home-store.ts:12-57,63-76` 包装的 store 访问，以 Core 记录为准）。Core 置了 `arrivalPending` 时，计划区先把迎接写盘，再请 Core 清除这个标记；交接以镜像落盘为准，计划区不在时标记留着，下次装载时补交接（`living/plan/plugin.ts:193-213`）。记录库的日期、日记和搜索按当前存储绑定读取第二层登记的只读活动接口（`core/records.ts:103-132`、`living/plan/activity-reader.ts:17-43`）。任一区对 Core 可见时可读历史活动，三区都缺席时日期和正文由日记提供。查询缺失的活动目录返回空结果。`control.json` 的可选字段 `pauses`（暂停区间 `{from, to|null}` 的有序列表，缺省等于没有区间记录、沿用旧开关）只由 Life 改开关时维护，按 Economy 已提交的菜园时钟清理已经扣过的区间；Body、Economy 推进菜园时只读它，Life 服务不在时用 `living/plan/control-file.ts:25-51` 的 `readLifeControl` 读 |
| 日记、自述、历史 | 第一层·记录库 | 主人设置、DSH 原生 `write/edit` 工具、Life/World 回顾复制 | **唯一写入协议待定**：原生工具仍可直接写文件，需要决定经记录库守卫还是保留现状；路径要同时支持新位置 `.chatpet/{self.md, self.history/, diary/}` 和旧位置 `data/life/` |
| 相册 `data/core/photos/album.sqlite`（或旧位置 `data/life/photos/`） | 第一层·记录库 | Core 和 Life 通过记录库写入 | Core 的带前缀相册工具与 Life 的原生相册使用同一个受限句柄，提供 `keep`、`list`、`forget`（`core/records.ts:24-35`）。会话门控见 5.8.3。 |
| 原生会话副本 `data/core/native-sessions/*` | 第一层 | NativeTranscripts | 不变 |
| Desktop 待办、图片 `data/desktop/*`；`data/room/images/*` | 第三层·Desktop / Room | Desktop；Room 借用 Desktop 的图片组件 | 图片准入抽成共用小包（5.4） |
| `data/pet-platform/*` | 第三层·PetPlatform | PetPlatform、迁移器 | 不变 |
| `data/channels/*`；profile 下连接设置、令牌、语音缓存 | 第三层·Channels / Voice | Channels、Voice | 不变，设备相关 |
| 浏览器 localStorage：`chatpet:economy:pending:*`、Room 的 `home-*` | 第二层·钱包区 / 第三层·Room | 控制台和 Room 前端 | 经济待确认请求迁入钱包区持久存储，迁移顺序见 7.3 |

下面两类文件不进 `storage.json`，盘点把它们列在 `differences.extra` 里属于预期。它们只在部分安装里存在，登进去会让没有它们的安装报「缺失」：

- `.chatpet/.gitignore`：安装脚本搬迁存储时追加 `/data/`，让 Git 忽略个人数据（`scripts/lib/repo-storage.mjs:259-264`）。不归业务模块。
- `.chatpet/migrations/`：主人安装里一次性导入旧伙伴时留下的原始存档。只读，不归任何模块，迁移不处理它。

---

## 5. 层间接口

### 5.1 第一层对外

- 身份与绑定服务：沿用 `CoreService`。
- 会话接缝：只暴露「登记」，不暴露可赋值的函数字段。
- 记忆服务：观察、召回、修订、撤回、校验，沿用 Pet 接口。
- 情绪服务：沿用 `EmotionService`。
- 记录库：对上层提供受限句柄。
- 登记口：见 2.2。

### 5.2 第二层对外

四样契约的类型在 `contracts/living.ts`，经 `./contracts` 导出，挂在已有的三个门面服务上，不新增服务名。旧服务名的其余成员和三个旧事件（`pet/behavior.changed`、`pet/life.changed`、`pet/economy.fact`）是阶段性兼容入口，第三层改用四样归阶段 3。

- **世界快照** `WorldSnapshot`：`petBehavior.worldSnapshot(workspaceId)` 为主入口，`petEconomy.worldSnapshot` 委托同一实现，只挂 Economy 时也能读钱包、身体部分为 `{available:false}`。内容是身体投影（`BehaviorSnapshot`）加钱包只读视图 `WalletView`（余额、库存、持有读物和书签），返回独立副本。
- **命令** `WorldCommands`：照料（`petBehavior`）、执行计划步骤和阅读确认（`petLife`）、购买和出售（`petEconomy`），各门面的 `worldCommands` 只挂本区的命令；每条带请求 ID，复用原入口的准入、绑定复核和去重。错误语义沿用 `ContractError`：`effect` 有三种（`none / partial / unknown`），`retry` 有四种（`never / refresh / same_request / reconcile`）。
- **事实流**：`CompanionFactSource`，`petBehavior.worldFacts` 聚合身体和钱包的事实。事实的准备、验证、确认在第二层的 `living/prompt-context.ts`，仍在 Core 的原生作用域登记两段、调用第一层的 `acknowledgePromptFacts`；「原生日志落盘之后才确认事实」的顺序不变，确认前复核绑定、三区租约和准备结果。
- **变更信号**：一个事件 `world.changed`（`{workspaceId, storageId}`），只表示「去读快照」。三区可见状态实际变化、首次绑定和切换绑定时发，同一轮微任务内按绑定合并，卸载后的旧租约不发。它不是落盘回执（Cordis 的 `emit` 不等待返回），订阅方自己处理异步错误；目前 `src/` 里还没有订阅方。
- **生活出口**：`living/outlets.ts` 的 `registerLifeOutlet`。Desktop 登记暂停、恢复、呈现，Channels 登记主动消息送达，各自在入口登记、卸载时撤销；Life 在启动、休息和通知时用 `lookupLifeOutlet` 按租约取当前的出口，没有登记就跳过，和原来缺服务时一样。呈现出错时记原样警告，照样试 Channels。登记复用 `RegistrationTable`，按提供方的隔离标签区分。
- **启用意图读口**：同一文件的 `readLifeEnabled`，Desktop 判断「Life 是否接管自主」时读它：有 Plan 时读持久的生活开关（`bodyClockState`），读不到再看 Plan 是否在运行；没有 Plan 就当作未接管，桌宠恢复自主，`control.json` 不变。

### 5.3 第三层对外

几乎没有，只往下登记：能力状态行、提示词与历史投影、来源适配、生活出口、运维操作。别的模块不读它。

### 5.4 同层共用物

| 共用物 | 现在 | 新 |
| --- | --- | --- |
| 图片准入（`DesktopImages`，Room 在用） | `desktop/images.ts` | 抽成第三层的共用小包（目录在阶段 3 方案里定），Desktop 和 Room 都依赖它，彼此不依赖 |
| **语音**（Desktop、Room、Channels 都用） | 多处直接读 `petVoice` | **第一层的 contracts 声明一个「语音接口」**（说、听、取消、可用性），Voice 登记为实现，使用者通过第一层取得这个接口；接口撤销时，在途调用按 2.2 的契约失效。不用能力状态行，因为它不能被调用，也没有取消和失效约定 |
| 房间模型 `CompanionRoom` | `living/body/room.ts`，属第二层·身体区 | Room 只读快照 |

### 5.5 控制台

控制台的**外观先不动**，**架构定位现在就定**：它是第三层里唯一允许「操作别的第三层模块」的模块，操作通过**运维操作表**进行；读数据通过第二层快照和第一层服务。这样同层禁止依赖和控制台的实际职责不矛盾。

### 5.6 细粒度接口准则和概念表

三层只定了大块边界，同样的问题会在更细的地方出现：同一个词被各处各写一份，取值是裸字符串，转换散在各处。所以每个核心概念都按下面五条管：

1. **一个概念一个定义处。** 每个概念有唯一拥有者，其余地方只引用或派生，不再抄一份。
2. **取值是声明出来的类型。** 封闭的集合写成联合类型或常量表；确实开放的（自定义情绪、素材目录）写明「开放」，并写明谁登记、怎么校验。公开接口里不出现无声明的裸字符串词汇（R8）。
3. **转换只发生在一处，而且单向。** 从一套词汇转成另一套的函数集中放，并写明转换里会丢失什么信息。
4. **下层只输出语义，不认识素材和呈现端。**
5. **不同含义不共用一个名字。** 同名不同义的，各自改名；保留现有的序列化字段和外部名称，只在内部改。

这套准则**不是**把所有词合成一个枚举。十个核心概念各自的拥有者、取值范围和统一方式：

| 概念 | 拥有者 | 取值形式 | 统一方式 |
| --- | --- | --- | --- |
| 动作 `action` | 第二层（身体命令）；第一层（表达意图）；第三层（素材 ID、桌面命令） | 身体命令封闭；素材 ID 开放（目录登记） | 内部分成 `BodyAction`、`PresentationIntent`、`ExpressionAssetId`、`DesktopCommand` 四个名字；六种照料动作、十种角色动作、五种计划身体动作由第二层的一份基础表导出，后两者是它的明确子集 |
| 行为（身体状态） | 第二层 | 上游是 `any`，本地没有完整的种类表 | 第二层定义身体状态契约，输出「忙不忙、能否被打断、当前活动」；上游的 `any` 只留在一个适配器内 |
| 活动 `activity` | 第二层 | 标签是自然语言；`operationId`、`currentActivityId` 是 ID | 明确 `label / operationId / currentActivityId` 三种职责；以 `PlannedActivity → PlannedExecution → BehaviorActivity` 为基础，不另建一套活动运行时 |
| 阶段 `phase` | 第二层（身体、执行）；第三层（播放方式）；第一层（工作区绑定） | 各自封闭 | 保留各自的状态机，分别命名 `BodyPhase`、`ExecutionPhase`、`PlaybackMode`、`BindingPhase`；有损转换（例如把执行的 waiting 投影成 pending）集中成一个显式函数 |
| 表情与贴纸 | 第一层（意图、事件）；第三层（素材目录、播放回执、渠道表情库） | 目录开放 | 同形的两套目录类型合成一套；`StickerAssetId` 与 `ChannelStickerId` 分开；label 只用于显示 |
| 情绪 | 第一层 | 九种 feeling 封闭；Room 七维数值另一套；允许未知的自定义文字 | 保留两者的区别；一个统一的「情绪到呈现」优先级规则；未知 feeling 保留文字，不拒绝 |
| 槽位与素材 | 第二层（语义提示和许可规则）；第三层（素材分配、clip 名称、采样） | slot 引用现在是裸 `string` | 见 5.7 |
| 命令与请求 | 第二层 | 计划 kind、阅读状态、经济操作等集合各抄 3 到 4 份 | 每个集合一份，其余派生（5.10） |
| 事实 `CompanionFact` | 第二层 | `domain` 封闭；`type` 是裸 `string` | 补 `domain` 与 `type` 的关联类型和统一解码器；Python 侧的识别清单与它由同一份声明生成，或用契约测试对齐 |
| 会话来源 `source.kind / scope / admission` | 第一层 | `source.kind` 内建 7 种，可经 DSH 的 `MessageSourceMap` 扩展；`scope` 有三种含义 | 并入来源适配表（2.2、5.8）；`NativeScope`、`MemoryScope`、`scopeId` 分别命名，不再共用「scope」一词 |

每个概念的完整内容（所有定义处和转换点、同名不同义、拥有者）在用到它的阶段之前补进本节：第一批（动作、行为、活动、阶段、命令、事实）见 5.6.1；表情与贴纸、情绪、槽位与素材在阶段 3 开始前补。交付时间见 [product.md](product.md) 的「按需交付的表格」。

#### 5.6.1 第一批概念细表

第一批（动作、行为、活动、阶段、命令、事实）在阶段 2b 已收成各自一份声明，行号按 2b 收尾时的代码。声明大多写成「值为对象的表 + 派生数组和守卫」：表是唯一定义处，派生出的类型让漏改在编译时失败。R8 扫描器只认数组字面量和值全是字符串的对象，看不见值为对象或布尔的表，所以这些表和仍留着的副本（界面标签表、呈现表）之间的重叠不在 R8 基线里；份数以 [product.md](product.md)「词表重复基线」的人工核对为准。

##### 动作 `action`

| 定义处 | 取值 | 转换点及损失 | 同名不同义 |
| --- | --- | --- | --- |
| 六种照料动作，1 份。`contracts/behavior.ts:10-21` 基础表的 `care` 标记（带序号和按钮文案）派生 `CARE_ACTIONS` 和守卫 `isCareAction`（`:44,49-51`） | `feed / water / pet / play / sleep / wake`（按钮顺序） | Console → `life.act` → `behavior.act` → `roomAction({action}, …)`，动作值沿用，补请求标识及主人身份。设置页、Life `act`、World `care`、Body `act` 四个入口各自调用 `isCareAction`，报错各自保留（`console/settings.ts:229`、`living/plan/plugin.ts:655-657`、`living/body/plugin.ts:324,360-362`）。设置页按钮按 `lifeView.careActions` 渲染（`console/settings.ts:236-239`、`console/client.js:656`）。 | 这是简化照料入口。`pet` 在此集合内，计划身体动作集没有 `pet`。Desktop 自己开放的 `sleep / wake / pet` 是桌宠入口的子集，只受 `CareAction` 类型约束（`desktop/platform/plugin.ts:631`、`desktop/features.ts:165-166`）。 |
| 十种角色房间动作，1 份。基础表的 `role` 序号派生 `ROLE_ACTIONS`（`contracts/behavior.ts:45`），用于 `room_action` 枚举和 Body 角色白名单（`room/plugin.ts:122`、`living/body/room.ts:85,995-1003`） | `command / pet / poke / feed / water / play / talk / sleep / wake / lamp` | 工具传动作和参数，Body 再按上游 `HOME_ACTIONS` 和角色白名单核验。`talk` 文本修剪为最多 120 字符后传给实际动作（`living/body/room.ts:992-1003,1022-1032`）。 | 上游 `HOME_ACTIONS` 另含 `visit / go / place / sick / heal`（`vendor/feiyu-room-template/home-state.js:23-25`）。 |
| 五种计划身体动作，1 份。基础表的 `plan` 序号派生 `PlanBodyAction`、`PLAN_BODY_ACTIONS` 和 `isPlanBodyAction`（`contracts/behavior.ts:46,53-55`），用于计划类型、计划 schema、Life 校验和 Body 校验（`contracts/behavior.ts:112`、`living/plan/plan-tools.ts:104`、`living/plan/plan.ts:95`、`living/body/room.ts:612`） | `sleep / wake / water / feed / play` | `LifeStep.action` 经 `PlannedActivity` 转到上游 `applyHomeAction`。执行器按原回执处理，计划中的 `feed` 是免费基础餐食（`living/plan/plan.ts:397-400`、`living/body/room.ts:529-547`、`living/plan/plan-tools.ts:103`）。Life 草稿校验用 `String(value.action)` 比对，非字符串的 `['feed']` 也会被接受并原样保留；工具 schema 只收字符串（`living/plan/plan.ts:94-97`、`living/plan/plan-tools.ts:101-104`，2B1-04 固定）。 | 库存 `feed` 从经济入口转为 `consumeFood`。身体存档写 `catalog-food`，互动事实仍可用 `type:'feed'`（`living/economy/plugin.ts:264-272`、`living/body/room.ts:454-465`）。 |
| 表达意图、呈现分类及桌面素材。`emotion/index.ts:7-10,32-47`、`contracts/behavior.ts:35-39`、`desktop/platform/plugin.ts:671-690` | footer `action` 是目录名字符串。`BehaviorPresentation.action` 是 `sleep / walk / activity / expression / emotion/...` 等分类。桌面选择素材用名称或 URL。 | Emotion 按目录保留可识别的动作，未知动作不进入事件。Body 把状态和表情投影成展示分类。Desktop 的特定睡眠、起床、吃饭素材转换为 `sleep / wake / feed`，命令不带原素材选择（`emotion/index.ts:54-64`、`living/body/presentation.ts:12-23`、`desktop/platform/plugin.ts:671-689`）。「睡觉-起来」默认只出现在睡觉序列的 `sleep.end` 里，不在动画池中，所以 `/anim` 默认返回 `unknown-animation`；配置把它加进动画池后，才会派发 `wake`（`vendor/dsh-pet/platform/assets/config.jsonc:387-392`、`desktop/platform/plugin.ts:681-682`，2B1-08 固定）。 | 同名 `action` 分别可能是身体命令、表达选择、素材名或展示分类。 |

**拥有者**沿用 5.6，身体命令属第二层、表达意图属第一层、素材 ID 与桌面命令属第三层。**统一方式**沿用 `BodyAction / PresentationIntent / ExpressionAssetId / DesktopCommand` 及基础词表派生的结论。现行 `BehaviorPresentation.action` 仍归在第二层契约里且为裸 `string`（5.6 总表、`contracts/behavior.ts:35-39`）。

##### 行为（身体状态）

| 定义处 | 取值 | 转换点及损失 | 同名不同义 |
| --- | --- | --- | --- |
| `living/body/room.ts:89-90,105-115`、`vendor/feiyu-room-template/home-state.js:489,1704-1722` | 上游 JS 状态，本地 `state:any`。含路线、停留、睡眠、身体需要和 `kind`。 | 上游 `homeView` 将持久状态投影为当前画面，位置按当前时间求值。Body 公布的 `home` 保留 `any`，另提供原精度 `needs`（`BehaviorSnapshot.needs`，以 `BodyMetric` 为键）。 | `her.kind` 描述此刻身体状态，`PlannedActivity.kind` 描述要执行的操作类别。 |
| `BehaviorActivity`（`contracts/behavior.ts:153`）及忙碌判定 `companionBusy`（`living/body/activity.ts:17`） | `activityId`、开放 `kind`、`BodyPhase`、`busy`，附呈现和阅读提示。 | 所有公开的 `behavior` 由 Body 的 `publicBehavior(her)` 一处组装（`living/body/plugin.ts:234-237`），快照、`roomState()`、`act`、`roomAction`、`garden` 回执的 `busy` 都用同一份画面里的 `her` 算（2B4-01 固定）。`behaviorPresentation` 和 `resolveActivityPlayback` 仍各自再分类（已知问题 4，阶段 3）。 | `busy` 只回答「能不能发起一次新投喂」：睡着、走路、或 `kind` 不在七项空闲白名单（`activity.ts:8`）里为真；正在吃饭时为真，但吃饭素材仍放行、不再投喂。它和呈现分类器的白名单不同，后者管画面选什么分类。「能否被打断」按动作而异，没有统一输出，留到阶段 3。 |

**拥有者**第二层。**统一方式**：第三层读 `behavior.busy`，不再解释原始 `her.kind` 判断忙碌（`desktop/platform/plugin.ts:682`）；上游 `any` 留在 Body 适配器里，公开快照仍带 `home:any`，第三层其余读取归阶段 3。

##### 活动 `activity`

| 定义处 | 取值 | 转换点及损失 | 同名不同义 |
| --- | --- | --- | --- |
| `LifeStep`、`CurrentLifePlan`（`living/plan/plan.ts`）、`PlannedActivity`（`contracts/behavior.ts:181`） | `activity` 是 `ActivityLabel`：最多 80 字符的自然语言标签。`operationId` 是 `OperationId`：已派发操作标识（`contracts/behavior.ts:118-122`）。 | 派发合成 `life:<plan.id>:<step.id>`，把相对时长换为 `until` 和 `freezeOnPause`。Body 输入不再单列原 `durationMinutes`、计划目标、理由及游标。 | 活动标签只供描述，执行由 `kind` 及对应字段驱动。 |
| `PlannedExecution`（`contracts/behavior.ts:212`）、`BehaviorActivity.activityId`，内部执行指针 `currentPlannedOperation`（`living/body/room.ts`） | 公开字段 `activityId` 是 `CurrentActivityId`，可能取执行编号、菜园任务号、照料任务号、路线或睡眠摘要，或 `null`（`living/body/plugin.ts:209-230`）。 | Body 内部执行 → 公开回执，去掉原入参、指纹及内部时间/结算字段。公开回执 → `BehaviorActivity`，进一步舍弃回执状态、完成条件及原因。 | `home.her.activity` 是画面展示文字，`BehaviorPresentation.activity` 取它或 `待机`，与计划的 `activity` 同名、来源可以不同。 |

**拥有者**第二层。**统一方式**：三种职责用类型别名 `ActivityLabel / OperationId / CurrentActivityId` 标在字段上，序列化字段名仍是 `activity / operationId / activityId`，没有改名。

##### 阶段 `phase`

| 定义处 | 取值 | 转换点及损失 | 同名不同义 |
| --- | --- | --- | --- |
| 身体 `BodyPhase`（`contracts/behavior.ts:125`） | `idle / pending / moving / working / sleeping / completed` | 运行中计划经 `bodyPhaseOf`（`living/body/activity.ts:4`）投影：`moving / working` 照搬，`pending / waiting / completed` 都变成 `pending`。无运行中计划时，从路线、睡眠、等候、停留、反应及任务回执推导（`living/body/plugin.ts:209-230`）。 | 身体的 `completed` 来自 `task.completedAt`，计划、库存投喂和角色动作都会产生任务；不能单凭它判断计划或经济成功。 |
| 执行 `ExecutionPhase / ExecutionStatus`（`contracts/behavior.ts:130-131`）及计划 `PlanStatus`（`living/plan/plan.ts`） | 执行阶段 `pending / moving / working / waiting / completed`，执行状态 `running / paused / completed / cancelled / interrupted / failed`。计划状态 `active / paused / waiting / completed / cancelled`。 | Body 暂停写 `paused/waiting`，取消写 `cancelled/completed`。Body 把原始身体或上游菜园状态投影成执行阶段的几处留在 `room.ts` 原处，只引用 `ExecutionPhase`。设置页的执行阶段标签由契约测试与 `ExecutionPhase` 对齐（`tests/life/life-execution-labels.test.mjs`）。 | `waiting` 可以是仍在运行的执行阶段，也可以是计划自己的状态。执行 `phase:completed` 包含失败或取消终态；终态以 `status` 为准，旧存档有 `running + completed`，菜园失败会写 `failed + waiting`。 |
| `ActivityClip.mode`、`ActivityPlayback.phase`（`living/body/playback.ts:4-22`），工作区 `Binding.phase`（`core/workspace.ts:45`） | 播放 `loop / once / static`。播放描述另带身体阶段字符串。绑定 `ready / inactive`。 | 播放描述复制身体阶段并按片段次序、一次性动作和素材可用性选 `mode`。模式不携带业务完成信息。解绑写 `inactive`，公共状态另投影为 `unbound/pending/...`（`living/body/playback.ts:184-201`、`core/workspace.ts:142,435-437,464,585-603`）。 | `ActivityPlayback.phase` 和 clip `mode` 是两个字段。绑定阶段和前两套状态机独立。 |

**拥有者**第二层身体与执行、第三层播放、第一层绑定。**统一方式**：`BodyPhase / ExecutionPhase` 已各自命名，有损转换集中在 `bodyPhaseOf`。`PlaybackMode / BindingPhase` 的命名和 clip 类型搬出第二层归阶段 3；clip 类型仍位于 `living/body/`，播放 `phase` 仍是裸字符串（`living/body/playback.ts:4-22`）。

##### 命令与请求

| 定义处 | 取值 | 转换点及损失 | 同名不同义 |
| --- | --- | --- | --- |
| 七种计划 `kind`，1 份。`PLAN_KINDS` 表（`contracts/behavior.ts:57-65`）带 `target`（要指定房间位置）和 `executable`（依据真实回执结束、不接受时长）两项属性，派生 `PlanKind` 和守卫 `isPlanKind` | `hold / room / move / garden / body / economy / read` | 工具 schema 由 `Record<PlanKind, 分支>` 生成（`living/plan/plan-tools.ts:66-104`），注册结果与 2b 前逐字节相同；Life 草稿校验和 Body 执行校验各有一张 `Record<PlanKind, 校验函数>`（`living/plan/plan.ts:74`、`living/body/room.ts:78`），每一步只判断一次 kind，报错文案和先后不变。Life 用 `String(value.kind)` 宽松准入，数组形式的 kind 会被放行并跳过位置校验（2B1-04 固定）。 | `room` 是到目标后持续活动，`move` 是到达即结束，`hold` 是原地持续。 |
| 阅读状态，1 份。`READING_STATES`（`contracts/behavior.ts:100`）派生 `ReadingState`；Economy 存储行用 `Exclude<ReadingState,'unread'>`（`living/economy/store.ts:362`） | `unread / offered / confirmed`。存储行只含 `offered / confirmed`，无行时合成 `unread`。 | 取文生成耐久 `receiptToken`，确认推进原内容版本的书签。Body 根据状态投影 `read/reading-wait`，不携带正文、token 或书签偏移。确认会同步完成执行并清掉阅读投影，公开快照从 `offered` 直接回到空闲；`confirmed` 的呈现分支在公开路径上走不到（2B1-06 固定）。 | `confirmed` 是原文字片段的回执，不表示读懂。`reading-wait` 是呈现类别。 |
| 计划控制与经济操作。计划经济操作 `PLAN_ECONOMY_OPERATIONS`、计划菜园操作 `PLAN_GARDEN_OPERATIONS`（`contracts/behavior.ts:73-98`，菜园表记每个操作所属的 schema 分支和分支内序号）；计划控制在 `living/plan/plan-tools.ts`、`living/plan/plan.ts`；主人经济在 `living/economy/plugin.ts`；Room 菜园工具在 `room/plugin.ts` | 计划控制 `pause / resume / cancel`。计划经济 `buy / sell / consume`。主人经济 `buy / sell / grant / gift / importReading / feed`。Room 菜园另有 `state / visit / careNow / auto / till / plant / water / fertilize / harvest / sell / buySeed / buyCompost`。 | 计划经济按 `operationId` 调用购买、出售或库存食用。直接主人操作保留请求和来源，投喂转为稳定身体执行编号（`living/economy/plugin.ts:162-173,233-277`、`living/body/room.ts:417-465`）。 | `cancel` 可指持久计划、菜园作业或原生对话。`feed` 可指基础照料或库存餐食（`living/body/room.ts:873-879,1071-1081`、`living/plan/plugin.ts:386-398`、`living/economy/plugin.ts:264-272`）。 |
| 请求身份。`core/authority.ts:9-29`、`console/settings.ts:74-85,100-102`、`room/plugin.ts:86-95,123-126`、`living/body/room.ts:1004-1012` | Core `RequestContext`、入口 `requestId`、领域 `operationId`、版本 `expectedRevision` 分别承担授权、去重、执行关联、并发控制。 | Core 从宿主授权能力签发请求上下文。Room 用绑定、入口、请求号生成去重键，Body 对同键核对输入和 actor 指纹，重复请求返回原事实（`core/authority.ts:12-28`、`room/plugin.ts:86-95`、`living/body/room.ts:1004-1012`）。Economy 重试则从 `requests.result` 返回首次事务的视图，不返回原事实；事实只在首次事务里写入（`living/economy/store.ts:182-187`，2B1-09 固定）。 | DSH `rpcId` 是会话投递去重键，和身体执行编号分开（`desktop/conversation.ts:171-182`、`room/chat.ts:164-172`）。 |

**拥有者**第二层拥有生活命令及执行请求。Core 另拥有授权上下文，Desktop/Room 另拥有入口投递身份。**统一方式**：计划 kind、经济操作、菜园操作、阅读状态各一份，schema 和入口校验从它派生；计划控制 `pause / resume / cancel` 和 Room 菜园工具的 12 个操作（含 `state / auto / careNow` 等非计划操作）仍是各自入口的词表。PLAN_ECONOMY_OPERATIONS、READING_STATES 是布尔表，R8 看不见。

##### 事实 `CompanionFact`

| 定义处 | 取值 | 转换点及损失 | 同名不同义 |
| --- | --- | --- | --- |
| 领域声明 `FACT_DOMAINS`、参与者 `FACT_ACTORS`（`contracts/interaction.ts:3-23`），派生 `FactDomain / BodyFactType / EconomyFactType`、`isFactDomain`、`factDomainOf` | `body` 的 `type` 是上游 `HOME_ACTIONS` 的 15 项（基础表 10 项加 `visit / go / place / sick / heal`，测试比对 vendor）；`economy` 是 `purchase / sale / money-grant / item-gift / reading-import`。actor 为 `owner / companion / system`。 | 读取类型 `CompanionFact` 按领域区分，`type` 是已知值或带标记的 `LegacyFactType`，旧的、未登记的 `type` 照常读出；写入类型 `NewCompanionFact` 只收声明值，Body 三处写入和 Economy `recordFact` 用它（`contracts/interaction.ts:50-59`）。Body 的事实标签表以 `BodyFactType` 为键，`sick / heal` 没有标签，摘要回落成动作字。 | `fact.type` 是已提交结果类别。一个睡眠事实可记录「已接受并正在前往床」，实际睡着另看身体状态。账本 `owner-grant` 和事实 `money-grant` 是两件事。 |
| 原生快照、事实信封、Memory 投影（`core/interaction-presentation.ts`、`core/native/conversation.ts:202-220`、`memory/provider.py:67-86`） | 快照带事实身份、领域、类型、时间、actor 和结果摘要。Memory 使用 `native-fact:` 的 system 证据及来源归属。 | Core `observeFacts` 用 `isValidFactEnvelope`（`contracts/interaction.ts:61`）校验版本、ID、领域、actor、摘要和时间，不校验 `type`，缺 `type` 的事实照常接受（2B1-10 固定）。World 按 ID 读用 `factDomainOf`，Life 和提示词段按 `FACT_DOMAIN_NAMES` 取来源，Life 回读保留顺序、重复和无前缀编号。Python 不读事实 `type`；它的领域和 actor 元组由契约测试与 TS 声明双向比对（`tests/memory/fact-attribution-contract.test.mjs`，在 `test:memory` 里）。 | 提示词送达的确认、领域回执和 Memory 的长期经验是三个记录点。快照须匹配原样投影，原生日志成功 `flush` 后才能回写确认。 |

**拥有者**：Body、Economy 各自拥有本领域的原事实和 `type` 集合（Body 的集合由上游动作决定），Memory 拥有自己的证据投影。**统一方式**：领域和类型一份声明，新写入收窄、旧数据宽松读。上游 Life 的 `FactRef` 领域是封闭的（`vendor/dsh-world/lib/life/types.d.ts:27`），新增领域要经 Life 的回读适配，见 5.10。

### 5.7 动作与行为

「她在做什么」现在被至少八套词汇描述，没有统一的接口。新设计分四段，**每一段只认识自己和下一段**：

```
命令 → 执行记录 → 身体状态 → 表现意图 ─────────── 第二层 ──┐
                                                    │ 向下读
素材分配 → clip 名称 → 播放与采样 → 播放回执  ─── 第三层 ──┘
```

**第二层拥有**：

- **命令与执行。** `BodyAction` 是一份基础表（`contracts/behavior.ts:10`）；执行统一到 `PlannedActivity → PlannedExecution → BehaviorActivity`，`ActivityLabel / OperationId / CurrentActivityId` 三种职责用类型别名标明。照料、计划、阅读等各自的词表一份，工具 schema、入口校验、设置页白名单和按钮都从它派生。
- **身体状态契约。** 2b 已落地「忙不忙、当前活动」和有损的阶段转换：`companionBusy`、`bodyPhaseOf`（`living/body/activity.ts`），所有公开回执的 `behavior.busy` 一处组装，Desktop 的吃饭守卫只读这个结果。「能否被打断」现在按动作而异、没有消费方，留到阶段 3 和第三层改读一起定；`room/assets.ts` 仍按 `playback.kind` 显示提示文字，归阶段 3。
- **表现意图。** 语义，不含任何素材名：活动、阶段、情绪、是否独占。情绪与活动在这里合并，**合并规则只写一处**，取代现在 `living/body/presentation.ts` 和 `living/body/playback.ts` 里两套对同一情绪给出不同结果的分类器。
- **语义许可表。** 「哪种活动允许哪些语义槽」写成声明式的表，取代 `animationSlotAllowed()` 里约 40 行 `if` 链。计划里的「呈现提示」（`presentationSlot`）仍由第二层接受，但取值是语义槽，不含文件名。

**第三层拥有**：

- **素材分配**：槽位 → 素材 → `roomClip / desktopClip`，以及组合与采样、播放回执。Room 和 Desktop 各有自己的映射表。`ActivityClip`、`ActivityPlayback` 现在放在第二层目录，改放第三层，**第二层不再出现 `roomClip / desktopClip`**。
- **表情素材目录**：由桌宠平台登记，ID 与 label 的转换留在平台。
- **兼容行为留在适配边界**：Desktop 选了睡觉、起床、吃饭的素材就触发真实的 `sleep / wake / feed`（`desktop/platform/plugin.ts:681、686`），这是已有行为，明确写在适配层，不当成呈现端的业务逻辑。

**表情是独立的一条线**：第一层产出表达意图和事件，第三层登记素材并转换 ID，在「表现意图」里与活动合并。

**保持不变**：序列化字段和外部名称；九种 feeling 与七维 Room 数值的区别；上游素材 ID、文件名和兼容别名。**不做**：全仓统一的 `Action / Phase / Status` 枚举；素材和存档的重命名。

### 5.8 会话策略表

会话安排现在分散在 Desktop、Room、Channels、Core 四处，没有一张表能回答「哪种来源可以做什么」。来源适配表（2.2）的一部分是一张结构化的**会话策略表**，每种会话一行，列包括：

- 来源与可信 actor；
- 会话选择键（工作区、渠道、scope）、共享历史范围、预设如何选；
- 工具权限、可读写的数据；
- **自动观察权，记忆和情绪分开写**：工具权限、记忆观察、情绪更新是三个独立的授权面，每行必须分别声明；
- 取消、归档、恢复、owner 接管的行为；
- 绑定代次。

会话种类：普通 owner 会话、共享 home、Life 自主轮次、回顾轮次、渠道里的主人私聊、guest 私聊或群聊、Desktop 聊天、Room 私聊与电视观看、Desktop 碎碎念与梦话（没有原生会话，也要写出来）。每行的内容来自对现有源码的盘点，**不由适配器的回调隐含**；M2 起每一行由下面「登记者」表里的模块声明，下面的表就是登记要保持的行为。

下面四张表写行为现状，M2 后行为不变，只是声明改由登记者提供。行号已按 2a 收尾时的代码重核。准入、工具策略、记忆观察和情绪更新的现行代码以登记处为准。「测试」只算 `pnpm run verify` 会跑的测试；`scripts/checks/check-native-*.mjs` 是门禁外的手动检查，单独标出，不算有测试。每格由哪些测试覆盖，以 `tests/behavior-list/index.json` 的 `policyCells` 为准，`tests/behavior-list/index.test.mjs` 检查 5.8.2–5.8.4 每一格至少有一条非 L3 条目；表里「见行为清单」后的编号是其中的条目。

| 行 | 登记者 | 登记处 |
| --- | --- | --- |
| 1、2 | Core 的 `core-owner`（第 2 行只声明、不判定） | `src/core/native/conversation.ts:253-275`，`CoreNative` 构造时登记，`order` 排在其他认领 `user` 的适配器前面 |
| 3、4 | Life 的 `life`（`life`、`review` 两个分支） | `src/living/plan/tool-policy.ts:49-119` 的 `createLifeSourceAdapter`；`src/living/plan/plugin.ts:97-101,700-708,723-726` 登记和撤销 |
| 5、6 | Channels 的 `channels`（`owner`、`guest` 两个分支，含 QQ 补答） | `src/channels/sessions.ts:51-107,170-177` |
| 7、9 | Desktop 的 `desktop`（只声明，第 7 行沿用第 1 行；另登记首步前的图片恢复） | `src/desktop/plugin.ts:53-57` |
| 8 | Room 的 `room`（私聊、电视两个分支） | `src/room/chat.ts:88-124` 的 `sourceAdapter()`；`src/room/plugin.ts:174-185` 登记 |

播放证据由 Emotion 登记（`src/emotion/plugin.ts:179-191`，`host.native.registerPlaybackEvidence`）；footer 在轮次结束时按各来源声明取授权快照。工具能给哪些来源用，由工具在定义处声明、登记到工具声明表。

#### 5.8.1 会话来源的概念表

| 概念 | 定义处 | 取值或形状 | 同名不同义、转换点 |
| --- | --- | --- | --- |
| 输入来源 `source.kind` | DSH 的 `MessageSourceMap`；本地补充声明在 `room/chat.ts:12-16`（`chatpet-room-tv`）、`core/native/recall.ts:5`（`chatpet-recall`）、`core/native/prompt.ts:11`（`runtime-context`） | 内建 7 种（`contracts/tables.ts:37-42`）：`user`、`dsh-world-life`、`dsh-world-reply-nudge`、`chatpet-room-tv`，以及不作为输入的 `chatpet-recall`、`runtime-context`、`compact-checkpoint`；`NativeSourceKind` 同时接受 `MessageSourceMap` 扩展的种类，新来源可以登记（`contracts/tables.ts:37-48`）。上游的完整集合未知（见第 11 节） | `user` 同时承载主人原生输入、Desktop/Room 私聊（带 `rpcId`）和渠道输入（带 `identity`）三种来源，靠附加字段区分（`core/native/conversation.ts:76-78`、`desktop/conversation.ts:181`、`room/chat.ts:172`、`channels/sessions.ts:39-42`）；回顾不是独立 kind，而是 `dsh-world-life` 加 `purpose: 'review'`（`living/plan/tool-policy.ts:51-54,101-103`） |
| 准入 `admission` | `core/native/conversation.ts:125-127` 的 `acceptsInput`，判定来自来源适配表（`core/tables/sources.ts:45-49,86-99,108-133`） | 结构化判定 `unclaimed / rejected / accepted / failed`，只有 `accepted` 放行；不带 `identity` 的 `user` 由 Core 的 `core-owner` 准入；另有只读 `classify` 供历史投影 | 同一 `source.kind` 按 `order` 依次判定，只有 `unclaimed` 交给下一个；适配器抛错返回 `failed`，该 kind 后面的适配器不再判定，所以 `core-owner` 排在最前 |
| 原生会话作用域 `NativeScope` | `core/native/conversation.ts:21` | `{workspaceId, path, storageId, guest}`，由 `core/native/agent.ts:45-52` 算出 | guest 会话的 `workspaceId` 也取主人当前绑定的工作区（`core/native/agent.ts:46-51`），不是 guest 自己所在的渠道工作区；Emotion 另算一份 `{id, path, guest}`（`emotion/plugin.ts:171-176`） |
| 记忆作用域 `MemoryScope` | `memory/client.ts:11` | `{companionId, scopeId, bankId}`，`bankId` 取绑定的 `storageId`（`core/native/memory.ts:53`） | 发给 Python provider 的兼容形状仍叫 `workspaceId`（`memory/client.ts:12,57`，已知问题 2） |
| `scopeId` | `core/runtime.ts:12-15` 的 Core 配置 | 伙伴身份的作用域字符串，存进 Core 元数据 `scope`（`core/runtime.ts:49-56`） | 授权上下文用它（`core/authority.ts:11,25`），Memory 启动参数和会话副本也带它（`core/native/memory.ts:53`、`core/native/transcripts.ts:22`）；与上面两种「scope」无关 |

拥有者是第一层（5.6）。M2 把 `NativeScope`、`MemoryScope`、`scopeId` 分别命名，准入改成带结构化结果的来源适配器判定（2.2 的契约）。

#### 5.8.2 会话策略表：来源、选择与生命周期

| # | 会话 | 来源与可信 actor | 选择键、历史范围、预设 | 取消、归档、恢复、owner 接管 | 绑定校验 |
| --- | --- | --- | --- | --- | --- |
| 1 | 普通 owner 会话 | DSH 原生输入，`user` 无 `identity`，直接准入（`core/native/conversation.ts:76-78,272-274`）；证据记为 `owner_statement`，actor 是 `ownerActorId`（`core/native/conversation.ts:260-265`） | 当前绑定工作区里任一就绪会话（`core/native/agent.ts:45-52`）；历史是这个会话自己的；预设由主人在 DSH 里选 | 取消、权限由 DSH 原生负责（`core/native/agent.ts:196-209`）；工作区归档后把会话交给 Memory 归档（`core/native/agent.ts:141-161`）；首步前恢复 Desktop 图片和会话副本（`core/native/agent.ts:234-238`、`desktop/plugin.ts:53-57`） | `sameScope` 比较 `workspaceId/path/storageId/guest`（`core/native/conversation.ts:21-25`）；不带实例代次，在途轮次另查来源登记的租约代次（`core/native/agent.ts:53-59`） |
| 2 | 共享 home | 容器，不是来源：主人输入、Life 输入、渠道主人输入都落在这里，授权面随输入来源走（第 1、3、4、5 行） | 按 Core 实例和当前绑定的 `id/path/storageId` 缓存后复用（`core/companion-foundation.ts:57-60,111-148`）；home 的会话 ID 记在 Core 的 `companion-home` 记录（`core/companion-foundation.ts:45-48`、`core/workspace.ts:156-169`），新建只走串行入口 `ensureCompanionHomeSession`（`core/companion-foundation.ts:88-108`）；首次建立时预设按调用方传入的值（Life 传 `agentPreset`，渠道主人先打开时不传）、DSH 组合预设、`standard` 的顺序选（`core/companion-foundation.ts:124-129`、`living/plan/plugin.ts:225-228`、`channels/plugin.ts:54-58`）；标题随伙伴名刷新（`core/companion-foundation.ts:175-189`） | 归档的 home 由上游 `createHome` 识别（`vendor/dsh-world/lib/life/home.js:53-65`、`core/companion-foundation.ts:139-140`）；打开前先恢复会话副本（`core/companion-foundation.ts:111-116`）；前台打开不要求 Life 启用（`core/companion-foundation.ts:110-124`） | 打开时比较绑定的 `id/path`（`core/companion-foundation.ts:62-65,73-81`、`core/workspace.ts:151-159`）；R7 外的换绑由第 1 行规则负责 |
| 3 | Life 自主轮次 | `dsh-world-life`，由 Life 来源适配器准入：Life 运行中、会话是 home、事实批次被接受（`living/plan/plugin.ts:97-101` 的 `registerSource`）；actor 是伙伴，有事实时是 `system:companion-world`（`living/plan/tool-policy.ts:66-69`） | 只在 home（同上）；后台轮次（`living/plan/tool-policy.ts:55-61`、`core/native/agent.ts:221-233`） | 时长上限到点取消（`core/native/conversation.ts:306-323`）；卸载 Life 撤销准入，后台轮次一律拒绝（`living/plan/plugin.ts:700-708`、`core/native/agent.ts:66-74,221-222`）；主人输入入队即解除 Life 限制（`core/native/agent.ts:104-115`），轮中接管结束自主计数（`core/native/agent.ts:241-253`） | 同第 1 行；Life 自己另比 `storageId` 和 `companionId`（`living/plan/plugin.ts:132-145`） |
| 4 | 回顾轮次 | `dsh-world-life` 加 `purpose: 'review'` 和 `reviewDay`（`living/plan/tool-policy.ts:51-54,101-103`），准入同第 3 行 | 只在 home；中断的回顾把权限带到下一次 Life 输入（`core/native/agent.ts:298-303`、`living/plan/tool-policy.ts:93-118`） | 同第 3 行；主人输入结束回顾权限（`core/native/agent.ts:104-115,246-253`）；Life 仍运行、有 home 且开启回顾后压缩时，回顾完成调用 `requestReviewCompaction`（`living/plan/plugin.ts:254-258`）。Memory 可用时登记请求，等待运行中的 Life home 有待处理轮次且空闲，并满足重试和最短间隔（`memory/batch.ts:14,90-105`） | 同第 3 行；回顾文件守卫按访问键复核（`core/life-review-files.ts:47-57`） |
| 5 | 渠道里的主人私聊 | QQ/微信私聊且 `speakerId` 等于设置的主人（`channels/messaging-settings.ts:50-53`、`channels/sessions.ts:232-241`）；`user` 带 `identity`，由渠道来源适配器准入，每条收件只能用一次（`channels/sessions.ts:95-105,155-177,242-244`）；QQ 补答 `dsh-world-reply-nudge` 只准一次且核验原消息（`channels/sessions.ts:146-154,252-261`、`core/native/conversation.ts:166-172`），actor 是 `system:qq-reply`（`channels/sessions.ts:63-69`） | 路由到共享 home（`channels/plugin.ts:52-58`、`channels/sessions.ts:232-241`）；前台轮次（`channels/sessions.ts:54-57`、`core/native/agent.ts:221-233`） | 关闭渠道时取消已准入的主人轮次（`channels/sessions.ts:263-270`）；补答授权随关闭撤销（`channels/sessions.ts:261,263-270`） | 准入时存下 `scopeFor` 的 JSON，补答时逐字比较（`channels/sessions.ts:147-152,167,252-261`） |
| 6 | guest 私聊或群聊 | 渠道里不是主人的已登记身份（`channels/sessions.ts:133-145,232-241`）；准入同第 5 行的一次性收件；证据记为 `external_content`，actor 是发言人 `speakerId`（`channels/sessions.ts:59-72`） | 私聊按发言人、群聊按会话分开（`channels/sessions.ts:31`）；每个对话一个独立工作区目录（`channels/sessions.ts:181-187,202-207`），会话前缀 `chatpet-guest-<digest>-`（`channels/sessions.ts:184-187`）；预设固定 `chatpet-channel-guest`，不符就拒绝（`channels/sessions.ts:193-196,209-220`、`channels/guest.ts:5`） | 关闭渠道时取消在途 guest 轮次（`channels/sessions.ts:263-270`）；取最新未归档会话（`channels/sessions.ts:195-198`）；Memory 的归档同步只遍历主人工作区（`core/native/agent.ts:141-153`），guest 会话不经过它 | 同第 5 行；另要求会话 `cwd` 和组合预设不变（`channels/sessions.ts:133-136`） |
| 7 | Desktop 聊天 | `user` 带 `rpcId`，无 `identity`，按主人输入准入（`desktop/conversation.ts:181`）；同一 `rpcId` 不重复投递（`:173`） | 每个存储绑定记一个会话 ID，存在 Core 的 `desktop-session`（`desktop/index.ts:44-45`、`desktop/conversation.ts:138-141`）；可打开工作区里任一未归档会话（`:142-145`）；新建会话 `chatpet-<uuid>`，用 DSH 默认预设（`:159`） | 停止走原生取消（`:184-189`）；「新建」先保存再归档旧会话（`:147-157`）；关闭小窗只撤销排队命令，不停原生会话（`:81-85`） | `sameBinding` 比较 `id/path/storageId`，另有小窗代次 `revision`（`desktop/conversation.ts:37-39,128`） |
| 8 | Room 私聊与电视观看 | 私聊：`user` 带 `rpcId`，按主人输入准入（`room/chat.ts:164-172`）。电视：`chatpet-room-tv`，由 Room 来源适配器只准当前这一条（`room/chat.ts:82-86,118-122,172-176`），证据记为 `virtual_action`、actor 是伙伴（`room/chat.ts:99-104`） | 同一个会话：`chatpet-room-<storageId 摘要>-N` 取最新未归档（`room/chat.ts:71-77`），没有就新建，DSH 默认预设（`room/chat.ts:131-137`）。私聊是前台轮次，电视是后台轮次（`room/chat.ts:88-96`、`core/native/conversation.ts:254-258`、`core/native/agent.ts:221-233`） | 同时只处理一条（`room/chat.ts:152-155`）；调用方取消或 300 秒超时即取消原生轮次（`room/chat.ts:155,175-184`）；关闭 Room 先中止在途请求、取消原生轮次，再等空闲（`room/chat.ts:177-184,193-196`，关闭触发本身无测试）；先恢复会话副本和图片（`room/chat.ts:126-130`） | `binding()` 比较 `id/path`（`room/chat.ts:65-70`），回复前后复核会话没换（`room/chat.ts:170,187`） |
| 9 | Desktop 碎碎念与梦话 | 没有原生会话和输入：一次性调用模型，不建 Agent、不写会话记录、不写 Memory（`desktop/features.ts:202-206,211-233`） | 系统提示只有伙伴身份（`desktop/features.ts:206`）；梦话加上游的说梦话指令（`desktop/features.ts:227`） | 自动触发要求：同一绑定、不忙、非安静模式、Life 不接管自主、设置开启、睡着与否和梦话一致（`desktop/features.ts:84-89`）；条件变化即中止（`desktop/features.ts:269-274`），时长上限（`desktop/features.ts:205,209-210`），Life 启动时经生活出口暂停（`:306`、`living/plan/plugin.ts:218-223`、`desktop/plugin.ts:44-46`） | `same(target)` 复核绑定（`desktop/features.ts:218,230-231`） |

本表各行的测试：第 1 行 `tests/regressions/audit-r6-memory-scope.test.mjs:184`（等待期间绑定变化即撤下召回）、`tests/core/history-maintenance.test.ts:175`（换工作区不进历史维护）；第 2 行 `tests/core/companion-foundation.test.ts:88`；第 3、4 行 `tests/behavior-list/families.test.mjs:17,61`、`tests/life/review-continuation.test.ts:43`、`tests/life/life-review-runtime.test.mjs:128`；第 5 行 `tests/regressions/audit-qq-recovery.test.mjs:121`、`tests/regressions/audit-r7-channel-nudge.test.ts:135,150`、`tests/behavior-list/channels.test.mjs:52,75`；第 6 行 `tests/regressions/audit-qq-recovery.test.mjs:144`；第 7 行 `tests/desktop/desktop.test.ts:26,49`；第 8 行见行为清单 M2A-01、M2A-04、M2A-05、M2A-08、M2A-02、M2A-03（门禁外有 `scripts/checks/check-native-room.mjs`）；第 9 行 `tests/desktop/desktop-features.test.ts:24,168`、`tests/regressions/audit-desktop.test.ts:160`、`tests/regressions/audit-r2-desktop-policy.test.ts:51,68`。

#### 5.8.3 会话策略表：三个授权面

| # | 会话 | 工具权限 | 记忆观察 | 情绪更新 |
| --- | --- | --- | --- | --- |
| 1 | 普通 owner 会话 | 预设的原生工具，加上 Core 的 `pet_memory_*`（非 guest 且 Memory 开启，`core/native/agent.ts:187-195`）和各模块登记的工具；DSH 原生权限照常，不加计数（`core/native/agent.ts:196-209`）。测试：`tests/life/life-tool-policy.test.ts:12`（解除限制后恢复主人工具） | 首步召回（`core/native/agent.ts:264-277`）；输入记为 `owner_statement` 排进 Memory（`core/native/conversation.ts:149-187,254-268`），完成的回复也排进（`core/native/conversation.ts:229-249`）；Memory 总开关对所有会话一起生效（`core/native/conversation.ts:128-133`）。测试：`tests/behavior-list/native.test.mjs:21`、`tests/life/life-memory-integration.test.ts:142,193` | 回复末尾的 `pet-expression` 在轮次完成时，按该轮已准入来源声明的 footer 授权写入，写入前复核绑定和登记租约（`emotion/plugin.ts:280-296`、`core/native/conversation.ts:110-119`）；`pet_emotion_update` 工具（`emotion/plugin.ts:202-222`）。测试：footer 由 `tests/infrastructure/emotion.test.ts:23`、`tests/emotion/emotion-state.test.ts:10` 覆盖；工具本身见行为清单 M2A-10 |
| 2 | 共享 home | 随输入来源（第 1、3、4、5 行） | 随输入来源 | 随输入来源 |
| 3 | Life 自主轮次 | 只留工具声明里来源含 `life` 的工具（`living/plan/tool-policy.ts:21-23`，名单由各工具的声明派生）：入队时装限制（`core/native/agent.ts:66-83,104-115`），执行时再查（`core/native/agent.ts:198-209`、`living/plan/tool-policy.ts:59-62`）；另有步数、工具次数、时长上限（`core/native/conversation.ts:306-323,328-331`）。Memory 工具只有读、召回、记住声明了 Life 来源，更正和撤回只给 owner（`core/native/conversation.ts:17-19,400-414`）。测试：`tests/life/life-tool-policy.test.ts:12,53`；步数和次数上限见行为清单 B01、M2A-12、M2A-13、M2A-14、M2A-15 | 召回同第 1 行；输入信封记为 `virtual_action` 排进 Memory（`living/plan/tool-policy.ts:66-69`、`core/native/conversation.ts:149-187`），附带的事实逐条登记（`core/native/conversation.ts:162-165,202-228`）；完成的非回顾轮次之后安排空闲准备，按只读来源分类和工具的 `historyOverview` 在后续打开的请求里把旧生活状态投影成短版本，分类不明的轮次受保护（`core/native/agent.ts:125-139,173-180,306-309`、`core/native/history-maintenance.ts:40-56`）。测试：`tests/life/life-memory-integration.test.ts:98,220`、`tests/life/autonomous-life.test.ts:201,215`、`tests/core/history-maintenance.test.ts:65,124` | `pet_emotion_update` 声明了 Life 来源（`emotion/plugin.ts:222`）；footer 同第 1 行（Life 来源声明允许 footer）。测试：工具在名单内由 `tests/life/life-tool-policy.test.ts:35-41`、`tests/life/tool-declarations.test.mjs:19-37` 覆盖；footer 在 Life 轮次生效见行为清单 M2A-12 |
| 4 | 回顾轮次 | 名单加 `read`、`write`（`living/plan/tool-policy.ts:11,17`）；回顾文件守卫只许读材料和记录、只许写自述和未封存的日记日（规则在 `living/plan/review-files.ts:17-57`，经 `core/life-review-files.ts:19` 的通用来源文件守卫挂上）。测试：`tests/life/life-review-files.test.ts:24,43,55`、`tests/life/review-continuation.test.ts:43,56`、`tests/behavior-list/families.test.mjs:61` | 同第 3 行；回顾轮次不做历史投影（`core/native/agent.ts:306-309`、`living/plan/tool-policy.ts:72`，`core/native/history-maintenance.ts:40-56`）；回顾提前整理沿用 5.8.2 的准入，Bridge 整理复用同一个请求入口（`channels/plugin.ts:78-85`）。测试：`tests/core/history-maintenance.test.ts:124` | 同第 3 行。测试：见行为清单 M2A-16 |
| 5 | 渠道里的主人私聊 | 前台主人轮次，权限同第 1 行（`channels/sessions.ts:54-57`、`core/native/agent.ts:221-233,255-260`），没有 Life 限制和自主计数。测试：见行为清单 M2A-19（门禁外有 `scripts/checks/check-native-channel-homes.mjs`） | 输入记为 `owner_statement`，actor 是 `ownerActorId`，归属带渠道身份（`channels/sessions.ts:59-72`、`core/native/conversation.ts:149-187`）；补答把原消息加入证据根（`core/native/conversation.ts:166-172`）。测试：`tests/regressions/audit-r7-channel-nudge.test.ts:96,135`（补答核验原消息）；主人渠道输入进 Memory 见行为清单 M2A-19 | 同第 1 行。测试：见行为清单 M2A-19 |
| 6 | guest 私聊或群聊 | 预设屏蔽所有继承工具（`channels/guest.ts:13`）；`pet_memory_*`、`pet_emotion_update` 不对 guest 登记（`core/native/agent.ts:187-195`、`emotion/plugin.ts:206-222`）；自主工具校验拒绝 guest（`core/native/conversation.ts:306-309,324-331`）；看不到主人档案和私有环境事实（`core/native/agent.ts:163-170`、`core/companion-foundation.ts:164-170`）。测试：`tests/behavior-list/families.test.mjs:19`（guest 调 Life 工具被拒）；私有事实不注入见 `tests/life/life-core-integration.test.ts:109`；预设屏蔽全部工具见行为清单 M2A-20（门禁外有 `scripts/checks/check-native-services.mjs:103-107`） | 召回同一个共享 Bank（`core/native/agent.ts:264-277`，作用域见 5.8.1）；输入记为 `external_content`、actor 是发言人，排进 Memory（`channels/sessions.ts:59-72`、`core/native/conversation.ts:149-187`）；回复归属记为 `external`（`channels/sessions.ts:72`、`core/native/conversation.ts:229-240`）；拒绝主人私有事实（`core/native/conversation.ts:202-203`）；不做历史投影（`core/native/agent.ts:125-136`）。测试：`tests/regressions/audit-r6-memory-scope.test.mjs:233`、`tests/life/life-memory-integration.test.ts:206`、`tests/life/autonomous-life.test.ts:231` | 没有工具；**footer 会写共享情绪**（`emotion/plugin.ts:171-176,280-296`、`channels/sessions.ts:74`，已知问题 1）。测试：见行为清单 M2A-21（门禁外 `scripts/checks/check-native-services.mjs:110-112` 断言的就是这个现状） |
| 7 | Desktop 聊天 | 同第 1 行。测试：见行为清单 M2A-09（第 1 行的测试不经过 Desktop 入口） | 同第 1 行；附带的图片在首步前恢复（`core/native/agent.ts:234-238`、`desktop/plugin.ts:53-57`）。测试：见行为清单 M2A-09 | 同第 1 行。测试：见行为清单 M2A-09 |
| 8 | Room 私聊与电视观看 | 私聊：同第 1 行，另加 Room 工具（`room/plugin.ts:165-169`）。电视：Room 守卫拒绝执行工具，仍受自主步数和时长上限。画面从准入到收尾期间隐藏 Core 相册，主人接管时也继续门控（`room/chat.ts:87-104,118-122,173-196`、`room/plugin.ts:174-185`）。测试：见行为清单 M2A-01、M2A-02、M2A-03（门禁外有 `scripts/checks/check-native-room.mjs`） | 私聊：同第 1 行。电视：画面输入记为 `virtual_action`、actor 是伙伴，排进 Memory（`room/chat.ts:99-104`、`core/native/conversation.ts:149-187`），完成的观后感也排进（`core/native/conversation.ts:229-249`）。测试：见行为清单 M2A-06 | 私聊：同第 1 行。电视：仍可见的工具由 Room 拒绝执行；**footer 会写共享情绪**（已知问题 1）。测试：见行为清单 M2A-01、M2A-07 |
| 9 | Desktop 碎碎念与梦话 | 没有工具（`desktop/features.ts:219-229`）。测试：`tests/desktop/desktop-features.test.ts:24`（原生一次性调用） | 不读不写 Memory（`desktop/features.ts:202-206`）。测试：见行为清单 M2A-11 | 不读不写情绪，只发布 `say` 事件（`desktop/features.ts:230-233`）。测试：见行为清单 M2A-11 |

合格主人会话使用 Core 的 `pet_*` 相册。运行中的 Life home 在主人接管后仍使用 Life 的无前缀相册，暂停或卸载 Life 后恢复 Core 相册。Core 的 schema 与执行共用登记判定，执行时复核同一相册和原生会话（`core/plugin.ts:41-48`、`core/album-tools.ts:20-30`、`living/plan/plugin.ts:143-159,739-746`）。测试见 `tests/behavior-list/policy-life.test.mjs:168,190` 和 `tests/behavior-list/policy-room.test.mjs:104-126`。

#### 5.8.4 会话策略表：按会话身份的历史策略和组装方案

5.8.2、5.8.3 按来源分行，回答「这一轮能做什么」；这张表按会话身份分行，回答「这条历史怎么留、每轮带什么」。同一个会话里可能先后来过主人、Life、回顾、渠道主人四种输入，它们共用一条历史，所以历史策略跟着会话走，不跟着来源走。Life、回顾、渠道主人私聊没有自己的会话，都在 home 里。预设见 5.8.2。这两列只写现状，不改行为。

所有绑定内的原生会话共用这几种改写：

- **召回**：每轮首步按本轮输入召回，插在新输入前面（`core/native/agent.ts:264-277,287-289`），旧召回在打开的请求里换成空消息（`core/native/recall.ts:32-44`）；压缩结束只标记召回状态，下一个符合条件的首步再查询并替换（`core/native/agent.ts:294`、`core/native/recall.ts:22-25`）。
- **动态段退休**：环境、事实、情绪状态、经济这些尾部动态段，只保留最新一份，旧快照在打开的请求里替换掉（`core/native/prompt.ts:27-63`，`core/native/agent.ts:173-185` 调用）；已废弃的旧段名也在这里清掉（`core/native/prompt.ts:14-15,68-86`）。
- **压缩**：Memory 开启时，按设置的轮数或闲置分钟数做一次原生压缩，摘要核验观察来源、Bank 和撤回状态后才写进 Memory（`memory/batch.ts:19-28,90-101,49-81`）；Memory 关闭时不记批次（`:20`）。预设自带的 DSH 压缩另算，不归 Her World 管。

| 会话身份 | 会话策略（现状） | 组装方案（现状） | 测试 |
| --- | --- | --- | --- |
| 主人 home | 首次建立后复用已记录且可用的 home，不主动轮换，归档或失效时交给上游恢复（`core/companion-foundation.ts:73-108,111-148`）；在这里跑完的回顾按 5.8.2 的回顾条件请求提前整理；完成的非回顾 Life 轮次之后，把较早的生活状态在历史里投影成短版本，原始事件保留（`core/native/agent.ts:125-139,173-180,306-309`） | 前缀段：`chatpet.profile` 身份加主人档案（`core/native/agent.ts:163-170`）、`chatpet.foundation`（`core/companion-foundation.ts:190`）、`chatpet.records`（`core/companion-foundation.ts:191-195`）、`chatpet.expression-guide`（`emotion/plugin.ts:228-233`）、`chatpet.life`（仅 Life 运行时，`living/plan/plugin.ts:85-89`）、`chatpet.self`（`core/companion-foundation.ts:196-205`）。尾部动态段：`chatpet.environment` 与 `chatpet.interactions`（见 5.9.1）、`chatpet.expression-state`（`emotion/plugin.ts:234-248`）、`chatpet.economy`（`living/economy/plugin.ts:347-352`）。再加召回 | `tests/core/companion-foundation.test.ts:88`（复用一个会话）；`tests/core/history-maintenance.test.ts:65`（生活状态投影）；`tests/life/life-core-integration.test.ts:96,137`（两个主人会话组装出相同的身份、自述、计划和事实；尾部变化不动前缀）；`tests/world/world-recall.test.ts:6`；`tests/core/dynamic-context.test.ts:12`；`tests/memory/memory-batch.test.ts:11`。「回顾后提前压缩」见行为清单 M2A-16、M2A-17、M2A-22、M2A-25 |
| 普通 owner 会话 | 由主人在 DSH 里新建、切换、归档，Her World 不轮换；只有共用改写 | 同主人 home，但没有 `chatpet.life`（只对 home 输出，`living/plan/plugin.ts:85-89`） | 同上一行的组装和共用改写测试 |
| Desktop 聊天会话 | 每个存储绑定记一个会话；主人点「新建」才归档旧的、开新的（`desktop/conversation.ts:140-161`）；只有共用改写 | 同普通 owner 会话 | `tests/desktop/desktop.test.ts:26`（重开与归档）；组装见行为清单 M2A-09 |
| Room 会话 | 每个存储绑定一个，取编号最大的未归档会话，没有就新建（`room/chat.ts:71-77,131-137`）；Her World 不轮换；界面只回放最近 80 条（`room/chat.ts:51`）；私聊和电视共用这一条历史 | 同普通 owner 会话；电视轮次的输入是固定提示加一帧图片（`room/chat.ts:19,158-160,168`） | 见行为清单 M2A-01、M2A-02、M2A-05 |
| guest 会话 | 每个私聊对象、每个群各一个，复用最新未归档会话（`channels/sessions.ts:31,195-198`）；Memory 开启时同样按轮数或闲置压缩（`memory/batch.ts:24`）；不做生活状态投影（`core/native/agent.ts:125-136`） | 预设前缀换成公开角色卡（`channels/guest.ts:6,14-17`），并关闭可选的运行时上下文（`:18`）。只挂上三段：`chatpet.profile`，只有身份、没有主人档案（`core/native/agent.ts:163-170,292`）；`chatpet.expression-guide` 和 `chatpet.expression-state`（`emotion/plugin.ts:302-305`；后者是必需动态段，关闭运行时上下文后仍保留，见 `tests/core/dynamic-context.test.ts:27-30`）。再加召回。其余段只登记在插件作用域，没有挂到 guest 预设（`channels/guest.ts:19-22`），各段自己也排除 guest（如 `core/companion-foundation.ts:164-170`） | `tests/world/world-modules.test.mjs:73`（私聊与群分开路由）；`tests/life/life-core-integration.test.ts:109`（拿不到私有环境事实）；guest 的完整组装见行为清单 M2A-20（门禁外有 `scripts/checks/check-native-services.mjs`） |
| Desktop 碎碎念与梦话 | 没有会话、不留历史（`desktop/features.ts:202-206`） | 系统提示只有伙伴身份（`desktop/features.ts:206`），可选带一张贴图（`desktop/features.ts:214-217,228`），梦话加说梦话指令（`desktop/features.ts:227`） | `tests/desktop/desktop-features.test.ts:24`；组装内容见行为清单 M2A-11 |

#### 5.8.5 盘点发现

这些是现有行为，M2 照原样登记，不在 M2 里改；要改的由主人另行决定。

- 电视画面和 guest 的回复 footer 都会写共享情绪（已知问题 1）；电视画面还会作为伙伴的 `virtual_action` 进入 Memory。
- 准入是「任一适配器认领就放行」的布尔或运算，分不清谁认领、谁拒绝；Room 和渠道的一次性授权都藏在适配器内部状态里。
- Memory 开关是全局的（`core/native/conversation.ts:128-133`），不分会话种类。
- 各入口自己比较绑定，键各不相同（第 1、3、5、7、8 行的「绑定校验」），都没有实例代次（第 3 节）；M2 后在途轮次另查来源登记的租约代次，回顾文件守卫也查访问键和租约代次（`core/life-review-files.ts:22-57`）。
- Desktop 聊天和 Room 私聊在授权上等同普通 owner 会话，只是选择键和预设不同。
- Room 两种轮次、渠道主人私聊的工具权限、Desktop 聊天的三个授权面，门禁里都没有测试；M2 要先补测试，再搬适配。
- 召回每轮替换、动态段每步退休，都是在历史里原位改写；压缩只看轮数和闲置时间，home 不轮换。这些是重构后大模型使用细则要改的地方，重构期间保持不变。
- 历史策略和组装方案在门禁里没有测试的：Room 会话的全部、Desktop 与 guest 的组装内容、「回顾后提前压缩」。

### 5.9 上下文组装契约

提示词段继续用 `registerWorldPrompt` 登记（2.2）。阶段 1 缩小后，**不做逐段声明**（类别、可见性、准备依赖、有效期、预算、超时、退休），也不加 `order` 全局唯一检查；这些和召回策略一起砍出重构，记在 `~/Developer/project-design/ideas/inbox.md`，留给重构后的大模型使用细则。保留的是组装的事务顺序和下面的隐含契约，它们在阶段 2a 第一批变成契约测试，因为 2a 要搬的事实准备正靠它们保护。组装的事务顺序固定为：

> 准备 → 复核 scope → 输入准入 → 请求中替换 → 原生日志落盘 → 事实确认

规则：

- 区分五件不同的事：状态退休、召回替换、旧工具结果投影、原生压缩、完整日志保留。
- 现有的隐含契约在阶段 2a 变成契约测试（复用 `test:native-context` 和历史维护测试，只补没覆盖的项）：工具限制必须在 schema 解析前安装；`environment` 先于 `interactions` 准备；`chatpet.interactions` 这个段名及其原样 JSON 是「确认事实」协议的一部分，改名不能只改登记处；事实确认晚于原生日志落盘；替换历史只能发生在打开的原生请求里；会话预设名、会话前缀和渠道目录同时承担路由与恢复协议；「共享 home 的身份」与「Life 正在运行」是两个不同的判定。

#### 5.9.1 上下文段清单

按「模块全部加载、工作区就绪的主人 home」这一实际组合，Her World 登记 10 段；DSH 部署预设自己的段不在此列。清单从 `registerWorldPrompt`、`registerWorldContext`、Emotion 本地的 `registerPrompt`、直接调用 `systemPrompt.section/context`、`attachGuest` 和上游 `createPromptSections` 搜出；`world/persona.ts:1` 只转导出，`src/` 里没有调用。「前缀」段走 `systemPrompt.section`，「动态尾部」段走 `systemPrompt.context`，两组各自排序。测试只算 `pnpm run verify` 会跑的。

| 段名 | 顺序号 | 登记处 | 内容来源 | 出现条件 | 测试 |
| --- | --- | --- | --- | --- | --- |
| `chatpet.profile` | 前缀 `10` | `core/native/agent.ts:163` | Core 身份和 `profile/current` 主人档案，按 Agent 和轮次缓存（`core/native/conversation.ts:416-424`、`core/native/agent.ts:164-169`） | 有 `NativeScope`。主人含档案，guest 只含身份。渠道主人仍按主人组装（`core/native/agent.ts:45-52,163-170,292`） | `tests/behavior-list/policy-qq.test.mjs:64-85` |
| `chatpet.foundation` | 前缀 `12` | `core/companion-foundation.ts:190` | 工作区 `COMPANION.md`，按 Memory、Emotion、Behavior 是否可用展开，并引用 `self.md` 位置（`core/workspace.ts:571-583`、`core/companion-foundation.ts:151-158`） | 会话就绪且能取得记录作用域，渲染结果非空。无 Life 也可出现。guest 预设未挂接（`core/companion-foundation.ts:151-158`、`channels/guest.ts:19-22`、`core/native/agent.ts:292`） | `tests/core/companion-foundation.test.ts:49-67` |
| `chatpet.records` | 前缀 `13` | `core/companion-foundation.ts:191` | `self.md` 和 `diary/` 的实际路径及读写说明（`core/companion-foundation.ts:191-195`、`core/record-paths.ts:7-18`） | 会话就绪且有记录作用域。路径可在文件内容为空时提示。guest 预设未挂接（`core/companion-foundation.ts:191-195`、`core/native/agent.ts:292`） | 无测试（该段的正向内容） |
| `chatpet.expression-guide` | 前缀 `32` | `emotion/plugin.ts:225-233` | 表达和 footer 规则、Emotion 当前登记的动作与贴图目录（`emotion/plugin.ts:27-34,192-200`） | Emotion 已加载且能解析绑定。主人和 guest 都挂接。展示组件缺席时仍可给规则（`emotion/plugin.ts:171-175,192-200,229-233,300-305`） | `tests/behavior-list/policy-qq.test.mjs:81-85` |
| `chatpet.life` | 前缀 `34` | `living/plan/plugin.ts:85` | Life 固定的自主规划、经济、阅读及睡眠操作说明（`living/plan/plugin.ts:85-89`） | Life 正在运行、会话就绪且是运行时 home。运行中的 home 即使收到主人或渠道主人输入也带本段。显式暂停、卸载、普通非 home 主人会话均无本段（`living/plan/plugin.ts:85-89,132-145,631-655,700-712`） | `tests/core/context-contracts.test.ts:173-191`（2A1A-07，运行、暂停及卸载时的正文）。段名和其余出现条件无测试 |
| `chatpet.self` | 前缀 `35` | `core/companion-foundation.ts:196` | 异步稳定读取记录目录的 `self.md`，按 World 规则处理引文与长度（`core/companion-writing.ts:35-54`） | 会话就绪、属于记录作用域且有非空自述，准备结果仍属于当前工作区。无 Life 或 Memory 也能出现。guest 预设未挂接（`core/companion-foundation.ts:196-205`、`core/native/agent.ts:292`） | `tests/life/life-core-integration.test.ts:96-107` |
| `chatpet.environment` | 动态尾部 `14` | `living/prompt-context.ts:43` | Body 的 `snapshot/promptLine`、Plan 的 `currentPlanSummary`，另准备 Body/Economy 待确认事实 | 主人当前绑定、会话就绪且未归档。准备与读取须在同一绑定、同一套三区租约和准备结果上。至少一区对 Core 可见时提供，缺 Body 时沿用能力提示，缺 Plan 时省略计划。已加载但暂停的 Plan 仍可提供持久计划（`core/companion-foundation.ts:164-170`、`living/index.ts:117-147,161-163`、`living/prompt-context.ts:31-85`） | `tests/core/context-contracts.test.ts:36-70,96-135`（2A1A-02、2A1A-03、2A1A-05）及行为清单 2A1A-17、2A1A-19 |
| `chatpet.interactions` | 动态尾部 `15` | `living/prompt-context.ts:86`，段名常量在 `core/interaction-presentation.ts:4` | 复用环境段准备的事实，每个领域最多 16 条，按 `presentFacts` 投影成 JSON | 与环境段使用同一份准备结果，至少有一条待确认事实。完成轮次的原样有效快照落盘后，逐源复核绑定、租约和准备结果再确认（`living/prompt-context.ts:70-76,86-110`、`core/interaction-context.ts:12-22`） | `tests/core/context-contracts.test.ts:36-94`（2A1A-02、2A1A-03、2A1A-04）、`tests/core/interaction-context.test.ts:21-36`（2A1A-08、2A1A-09）、`tests/life/life-core-integration.test.ts:119-127`（2A1A-10）、`tests/living/living-lifecycle.test.mjs:612-680`及行为清单 2A1A-17、2A1A-19 |
| `chatpet.expression-state` | 动态尾部 `33` | `emotion/plugin.ts:234` | `emotion.read` 读持久情绪，`emotion.experience` 读近期播放与情绪记录，投影最近 24 条动作、8 条心情（`emotion/plugin.ts:53-63,74-89,112-114,234-248`） | Emotion 已加载，绑定可用且异步准备后仍是同一工作区。主人和 guest 都可出现。guest 关闭可选运行时上下文后，本段仍作为必需段保留（`emotion/plugin.ts:234-248,302-305`、`channels/guest.ts:18-22`、`core/native/prompt.ts:119-126`） | `tests/behavior-list/policy-qq.test.mjs:81-85`。门禁外 `scripts/checks/check-native-services.mjs:103-107` |
| `chatpet.economy` | 动态尾部 `35` | `living/economy/plugin.ts:347` | `petEconomy.gardenPort(...).loadGarden` 的金币数和固定经济说明，读取失败时给不可用提示（`living/economy/plugin.ts:150-161,347-352`） | Economy 已加载，Core 管理的非 guest 会话，与当前就绪绑定一致。Life 暂停不撤销此段。卸载 Economy 后撤销段和服务（`living/economy/plugin.ts:315-325,330-335,347-357`、`core/native/prompt.ts:169-182`） | 无测试（该段的组装） |

| 对照主人 home | 增减 |
| --- | --- |
| guest | 加公开角色卡 `deployment:persona-prefix`，顺序由 DSH 的 `getSectionOrder('DEPLOYMENT_PERSONA_PREFIX')` 决定。只保留 `chatpet.profile` 的身份部分、`chatpet.expression-guide` 和 `chatpet.expression-state`，其余七个 Her World 登记段均无。共享 Bank 的召回仍按每轮准备（`channels/guest.ts:5-22`、`core/native/agent.ts:163-170,264-292`、`emotion/plugin.ts:302-305`、`tests/behavior-list/policy-qq.test.mjs:64-95`）。 |
| Life 自主轮次 | 与同一运行中 home 的主人轮次用同一套登记段及出现条件。唤醒文本、可选结构化 `facts` 走 `dsh-world-life` 输入。`chatpet.interactions` 仍由当次待确认事实决定（`living/plan/plugin.ts:85-101,274-315`、`living/prompt-context.ts:70-89`、`vendor/dsh-world/lib/life/runtime.js:144,517-533`）。 |
| 回顾轮次 | 与同一运行中 home 的主人轮次用同一套登记段及出现条件。回顾说明走 `dsh-world-life` 输入，带 `purpose: 'review'` 和 `reviewDay`，文件工具权限随回顾分支切换（`vendor/dsh-world/lib/life/runtime.js:565-566`、`living/plan/tool-policy.ts:49-72,93-118`）。 |

| 单独核对项 | 结论 |
| --- | --- |
| 顺序号重复 | `chatpet.self` 与 `chatpet.economy` 均为 `35`，前者走 `systemPrompt.section`，后者走 `systemPrompt.context`，分别排序。异步 `prepare` 置于读取前，`interactions` 读 `environment` 已准备的结果（`living/prompt-context.ts:43-89`、`living/economy/plugin.ts:347`、`core/native/prompt.ts:119-126,133-142`）。 |
| 依赖回调结果 | `foundation` 取决于模板渲染，`self` 取决于稳定读取及正文，`interactions` 取决于本次待确认事实，`expression-state` 取决于异步读取及复核，`economy` 按读取结果给金币或不可用提示。只凭「全部加载」无法断定具体轮次的正文与非空段数（`core/companion-foundation.ts:151-158`、`living/prompt-context.ts:43-89`、`emotion/plugin.ts:234-248`、`living/economy/plugin.ts:347-352`）。实际 DSH 部署预设自己的其他段及其顺序待核，仓库代码只能确定 Her World 的贡献。 |
| 召回与退休 | `chatpet-recall` 是首步插到新输入前的消息，非登记段。动态段在 `agent/request` 中用位置替换退休旧快照，保留其他贡献和原始日志。`chatpet.environment`、`chatpet.interactions` 即使当前没有登记（三区都缺席）也按空值退休，重开的旧会话不会带着过时的生活快照。最近一份等值快照可复用。旧段名另由 `retireLegacyPrompt` 清理（`core/native/agent.ts:173-183,264-289`、`core/native/recall.ts:26-44`、`core/native/prompt.ts:14-15,27-86`）。门禁覆盖 `tests/core/dynamic-context.test.ts:12-47`、`tests/world/world-recall.test.ts:6`。 |

复核入口为 `registerWorldPrompt`、`registerWorldContext`、Emotion 本地 `registerPrompt`、直接调用 `systemPrompt.section/context`、`attachGuest` 以及上游 `createPromptSections`。`world/persona.ts:1` 仅转导出，`src/` 未发现调用。部署专用的直接登记为 `channels/guest.ts:14-18`。

### 5.10 扩展：一处声明，其余派生

新增一个能力时要改的文件，由「一处声明」决定，其余由它派生，漏改能被检查发现：

| 要做的事 | 一处声明 | 派生出来的 |
| --- | --- | --- |
| 新增工具 | 工具定义旁声明 `sources`（没写的只给主人），需要历史瘦身时再声明 `historyOverview`，登记到工具声明表 `host.native.toolTable`（M2 已落地） | Life 和回顾名单、历史瘦身识别、来源适配的工具限制 |
| 新增输入来源 | 在模块里写一个来源适配器（准入、分支、`turnKind`、工具策略、记忆观察、情绪更新、历史投影、会话策略行），在入口登记到 `host.native.sourceTable`；新的 `source.kind` 在 DSH 的 `MessageSourceMap` 声明，新的工具来源用 `toolTable.registerSource` 登记（M2 已落地） | 入队和首步准入、工具限制、记忆观察、情绪 footer、历史投影、会话策略一行 |
| 新增上下文段 | 在模块入口用 `registerWorldPrompt` 登记（缩小后不做段声明，5.9） | 无；顺序、可见性由登记处自己写 |
| 新增设置项 | 一份字段声明（阶段 3，按收益再评估） | 页面控件、保存键集合、校验、实际消费的接线 |
| 新增设置页操作 | 运维操作表的一条登记（阶段 3） | 路由清单、处理分支、客户端调用 |
| 新增照料动作 | 第二层的 `BodyAction` 基础表（`contracts/behavior.ts:10`），每个动作在照料、角色、计划、反馈各集合里记序号 | 主人入口、角色工具枚举、计划类型与校验、计划 schema、设置页白名单和按钮（`lifeView.careActions`）。动作的执行和事实标签仍在 Body 里写 |
| 新增事实领域 | `contracts/interaction.ts` 的 `FACT_DOMAINS` | 读写类型、领域清单（Core 准入、World、Life、提示词段）。领域提供者要另写；Python 元组要跟着改，契约测试会失败提醒；上游 Life 的 `FactRef` 领域封闭、vendor 不能改，要经 Life 的回读适配 |

重构前的基线和 M2 后的复测见 [product.md](product.md) 的「典型修改前后对比」。

---

## 6. 兼容面和旧入口语义

### 6.1 保持不变的清单

- 包名 `her-world`、Bundle 激活身份、旧 entry ID。
- 包入口：`./core`、`./contracts`、`./world`、`./client`、`./00-Core` 到 `./70-Voice`、`./channel-guest`、`./locale/*`。
- 旧 Cordis 服务名：`petCore / petWorld / petMemory / petEmotion / petEconomy / petBehavior / petLife / petRoom / petDesktop / petPlatform / petChannels / petVoice`，以及 `chatpet-channel-preset / chatpet-channel-guest / chatpet-settings`。整个重构期间都保留，阶段 4 删除前以已安装环境的配置实际不再引用为条件。
- 配置项和便携设置字段（含 `null = 未配置`）；Life 的 `agentPreset`；Channels、Voice 的 `deviceDirectory`。
- Python 服务入口、打包资源、相对路径。
- **可观察行为**：工具名、错误和重试语义、提示词段的名字、历史投影的方式、「原生日志落盘后才确认事实」的顺序。这些要变成**行为清单**里的条目，不能只靠门禁通过。

### 6.2 三个旧入口的语义

同一服务名同一时间只能有一个提供者，所以**不能新旧两份同时跑**；一个实例提供三个旧名字，**不会自动保留三个独立生命周期**。下表是 2a 合并后的语义：2a 第 1 批先在旧代码上用真实 Cordis 入口补了入口级测试（下表的 `2A1A-*`、`G3-GARDEN-*`，在 `tests/behavior-list/entries-lifecycle.test.mjs`、`families.test.mjs`），合并后断言不改继续通过；1A 发现与原表不符的三项（Body 缺席的整个暂停周期、Economy 缺席跨暂停的结算、暂停后在途回顾撤权）已按主人结论修成按区间结算和下表写法。行为测试 ID 和文件见 `tests/behavior-list/index.json`。

| 旧动作 | 现在的表现 | 待取证项的结论 | 证据测试 |
| --- | --- | --- | --- |
| 卸载 `40-Life` | **身体**：Behavior 仍接收显式操作，撤掉运行时自治准入并保存检查点。**计划与回顾**：撤销来源登记，停调度和回顾，若运行时已有 home 则向 DSH 取消该会话并等 Life 的投递收尾。**钱包背包菜园**：Economy 保留，已启用的作物时钟意图保留（`living/body/plugin.ts:85-114,361-364`、`living/body/room.ts:229-235,271-281`、`living/plan/plugin.ts:364-400,700-712`）。 | 取消对象是原生 home 会话，`close()` 调用的是无参的 `stopRuntime()`，不会调用计划 `pause/cancel` 或改写 `control.json`。正在执行的身体活动可留下原回执，`stopAutomatic` 跳过已接受的身体、菜园和计划工作。真实 `40-Life` 卸载时同时有原生轮次和在途持久计划：取消原生轮次，在途身体计划重挂后按原编号恢复（2A1A-11）。 | `tests/life/life-body.test.ts:217-221`（真实 Life 对象关闭后身体可用）<br>`tests/life/life-source-adapter.test.mjs:68-89`（关闭后拒绝尚未派发的回顾读写）<br>`tests/behavior/garden-clock-continuity.test.ts:114-131,138-141`（Cordis 撤掉 Life **服务替身**，原已启用作物时钟继续） |
| 显式暂停生活 | **身体**：先持久化 `enabled:false`，有 Body 时停止被动推进，显式照料仍可用。**计划与回顾**：匹配当前绑定时，主动暂停 `active/waiting` 计划，标记重启用时恢复，停止 Life 运行时和取消 home。**钱包背包菜园**：Economy 保持在线，手工经济和菜园操作仍可执行（`console/settings.ts:221-234`、`living/plan/plugin.ts:364-400,631-655`、`living/body/room.ts:237-270`、`living/economy/store.ts:473-479,501-509`）。 | 暂停先结算已启用区间，暂停区间不长作物，恢复只从新启用时继续。计划保留原 `operationId`，相对时长可冻结，绝对截止时间仍有效。如果已分配执行编号却无 Body，暂停该计划会报错，但开关已落盘，运行时仍走停止路径。暂停区间记在 `control.json` 的 `pauses`，菜园每次推进（Body 读取、照料、手工动作、旧 JSON，Economy 读取、动作、改配置）都按区间扣，所以暂停或恢复时 Body、Economy 不在场，暂停时间也不长；有区间记录时只按区间算，没有记录（旧存档）才沿用开关。区间文件无效时只有菜园报「生活开关文件无效」，身体照常（`living/plan/plugin.ts:618-655`、`living/plan/control-file.ts:25-51`、`living/economy/garden-clock.ts:41-55`、`living/body/room.ts:171-186,237-250`、`living/economy/plugin.ts:133-143,150-161,279-295`）。 | `tests/behavior-list/families.test.mjs:36-59`（暂停、重启、恢复后的作物）<br>`tests/regressions/audit-r5-garden-clock.test.mjs:96,157`（只扣暂停区间及暂停时手工交易）<br>`tests/behavior/garden-clock-continuity.test.ts:106-112`（Body 缺席时设置遵守暂停意图）<br>`tests/life/life-clock-intent.test.ts:72-80`（原编号恢复，Body 替身）<br>`tests/behavior-list/entries-lifecycle.test.mjs`（2A1A-12、2A1A-13 和 `G3-GARDEN-*`：组件缺席跨暂停、Life 卸载后读区间、区间无效、清理） |
| 卸载 `25-Behavior` | **身体**：清定时器、退订、保存检查点并释放绑定。**计划与回顾**：Life 可继续运行，缺 Body 时跳过身体计划推进，回顾仍由独立运行时调度。**钱包背包菜园**：Economy 及数据库仍在，钱包操作可直接进账，库存投喂和 Body 代办的菜园工作缺执行器（`living/body/plugin.ts:430-445`、`living/plan/plugin.ts:402-421,723-726`、`living/economy/plugin.ts:133-143,233-295,315-325`）。 | `suspendAutonomy()` 保存已推进的作物检查点且保留时钟意图。Economy 设置在无 Body 时先读 Life 的持久时钟意图，缺少已知意图时继续计时。单独卸载 `25-Behavior` 后，Life 回顾照常调度并写原日期日记（2A1A-14），跨暂停再启用时作物按区间结算（2A1A-12）。 | `tests/behavior/garden-clock-continuity.test.ts:114-143`（真实 Body 入口卸载和替换，Life/Economy 用服务夹具）<br>`tests/regressions/audit-r5-garden-clock.test.mjs:176-181`（无 Body 的 Economy 设置） |
| 卸载 `22-Economy` | **身体**：仍能执行免费照料和独立身体活动。对已采用 Economy 的存档，权威菜园拒绝读写，原钱包、库存与作物保留。**计划与回顾**：Life 仍在，依赖 Economy 的在途 `garden/economy/read` 执行可停在 `running/waiting`，保留原编号等待恢复。**钱包背包菜园**：Economy 关库，已采用的存档不会重新启用旧 JSON 钱包。尚未采用且无权威标记的存档仍有旧菜园路径（`living/body/plugin.ts:181-190,361-364`、`living/body/room.ts:139-222`、`living/economy/plugin.ts:297-299,353-357`、`living/economy/store.ts:510`）。 | 卸载没有计划取消语义。经济恢复后按原编号和原钱包继续，已有身体效果和未结算库存靠原回执核对。关闭 Economy 不写 Life 或 Body 的时钟开关。Economy 卸载期间跨过的暂停，恢复后按 `control.json` 的区间扣（2A1A-13）。 | `tests/life/life-domain-integration.test.ts:171-194`（真实领域对象、服务替换夹具，原执行和钱包恢复、免费照料、旧菜园未写）<br>`tests/behavior-list/domains.test.mjs:103`（缺库拒绝创建替代钱包） |

**卸载哪个入口会关闭哪个内部区**

表中服务状态以其他入口仍加载为前提。服务的独立提供点为 `living/economy/plugin.ts:325`、`living/body/plugin.ts:457`、`living/plan/plugin.ts:725`。

| 动作 | 身体区 | 计划与回顾区 | 钱包背包菜园区 | 旧服务是否还在 |
| --- | --- | --- | --- | --- |
| 卸载 `22-Economy` | 开，免费照料可用（`tests/life/life-domain-integration.test.ts:181-184`） | 开，经济步骤保留原编号等恢复（`tests/life/life-domain-integration.test.ts:177-191`）。回顾照常调度（2A1A-15） | 权威服务关闭，旧账和菜园保留（`living/economy/plugin.ts:297-299,353-357`、`tests/life/life-domain-integration.test.ts:185-191`） | `petEconomy` 否，`petBehavior`、`petLife` 是（各自 `provide`）。真实入口卸载见 2A1A-13、2A1A-15。 |
| 卸载 `25-Behavior` | 关闭并保存（`living/body/plugin.ts:430-445`、`tests/behavior/garden-clock-continuity.test.ts:126-143`） | 服务保留，缺执行器时不推进身体计划（`living/plan/plugin.ts:402-421,723-726`）。单入口卸载后回顾照常（2A1A-14）。 | 服务保留，Body 代办暂不可用（`living/economy/plugin.ts:264-295,325`、`tests/regressions/audit-r5-garden-clock.test.mjs:176-181`） | `petBehavior` 否，`petEconomy`、`petLife` 是（各自 `provide`）。Body 实际卸载见 `tests/behavior/garden-clock-continuity.test.ts:126-143`，其余服务是夹具。 |
| 卸载 `40-Life` | 开。撤掉运行时自治，保留显式操作（`living/body/plugin.ts:85-95,361-364`、`tests/life/life-body.test.ts:217-221`） | 停止调度和回顾，撤销来源（`living/plan/plugin.ts:386-400,700-712`、`tests/life/life-source-adapter.test.mjs:68-89`）。持久在途计划按原编号恢复（2A1A-11）。 | 服务保留，原启用的作物时钟可继续（`living/body/room.ts:229-235,271-281`、`tests/behavior/garden-clock-continuity.test.ts:114-131,138-141`） | `petLife` 否，`petBehavior`、`petEconomy` 是（各自 `provide`）。服务移除的门禁证据使用 Life 替身（`tests/behavior/garden-clock-continuity.test.ts:115-131`）。 |
| 显式暂停生活 | 开，被动变化暂停，显式操作可用（`living/body/room.ts:237-270`、`tests/life/life-body.test.ts:175-205`） | 服务在，调度和回顾停，已接收计划条件性暂停（`living/plan/plugin.ts:364-400,631-655`、`tests/living/living-lifecycle.test.mjs:1049-1086`）。暂停取消回顾轮次，但同一回顾收尾前原文件授权仍可复核（2A1A-16）。 | 服务在，作物暂停被动增长，手工交易可用（`tests/behavior-list/families.test.mjs:49-58`、`tests/regressions/audit-r5-garden-clock.test.mjs:157`） | 三者都在。暂停仅调用 `petLife.control(false)`，测试随后通过同一 `petLife` 重新启用，并继续用 Body/Economy 观察原菜园（`console/settings.ts:221-234`、`tests/behavior-list/families.test.mjs:49-58`）。 |
| 三个生活入口全卸载 | 关 | 关 | 关 | 三个旧服务都不在，`LivingWorld` 释放。普通聊天、相册和日记照常；`chatpet.environment`、`chatpet.interactions` 两段随第二层一起消失，重开原会话也退休旧快照（2A1A-17、2A1A-19，拍板点 8） |

**三个入口的装载依赖**

| 入口 | 装载依赖 |
| --- | --- |
| `22-Economy` | 硬 `inject` 为 `petCore / petWorld / tools / systemPrompt / agents`。库存投喂、同步检查点时经常驻实例 `LivingWorld` 按需读 Body，读时钟时按需读 Plan，不再按服务名查找（`living/economy/plugin.ts:133-143,264-272,279-295,302-303`）。 |
| `25-Behavior` | 硬 `inject` 只有 `petCore`。经 `LivingWorld` 按租约观察 Economy、Plan 的出现和消失（`internal/status` 刷新），用于刷新绑定和同步自治准入（`living/body/plugin.ts:57-68,85-114,447-448`、`living/index.ts:324-345`）。 |
| `40-Life` | 硬 `inject` 为 `petCore / petWorld / agents / sessions / tools / systemPrompt`。计划推进与事实读取经 `LivingWorld` 按需读 Body、Economy（`living/plan/plugin.ts:402-421,440-452,714-715`）。暂停、恢复桌宠自主和主动消息的呈现、送达经生活出口调用 Desktop、Channels 登记的回调，不按服务名读 `petDesktop`、`petChannels`（`living/plan/plugin.ts:165,218-223,344-353`）。 |

`cordis.patch.yml:8-17` 中配置顺序为 Economy、Behavior、Life，三者的硬 `inject` 均未声明另外两个旧服务。

**常驻实例**：`living/index.ts` 的 `LivingWorld` 是三个区的登记处，三个入口共用，谁先加载谁建、最后一个卸载时释放；键按 Cordis 根、Core 对象和三个服务的隔离标签区分，登记复用 `core/tables/registry.ts` 的租约。每个入口用 `mountLivingArea` 登记自己的区，卸载时先撤登记、再停接单、再 `close()`，卸载哪个入口只停哪个区，上面的矩阵逐格不变（`living/index.ts:51-114,150-163,354-383`）。三个旧服务名仍由各入口 `provide` 原对象，作为门面保留。

---

## 7. 迁移与回退

### 7.1 原则

1. 默认不改位置和格式；只有第 4 节标「搬出」「待定」的会真的改。
2. 每个模块带自己的数据版本号，登记在存储清单里。
3. 迁移是独立的、可重复执行的步骤。**幂等的判断依据是目标状态，不是「完成标记」**（「先写日志、再改数据、最后标完成」仍有数据已提交而标记没写的窗口）：每一步先判断「目标状态是否已经成立」，成立就跳过；同时保留原来的 operation / request ID，避免重复结算。
4. **全局停写才迁移**：迁移不是启动时静默自动做的，而是主人显式触发、DSH 已停写的一个步骤。它和现有备份流程（`scripts/lib/offline-backup.mjs`）串在一起，而不是绕开它。
5. 开发期间的迁移、回退、崩溃续做演练，先在**合成数据副本**上跑通（按真实布局生成、不含主人内容）；真实副本只在检查点用，由主人授权、在隔离环境、只盘点不读内容。

### 7.2 回退

- 回退 = 恢复安全备份 + 换回旧版安装包。现有恢复器要求**安装包文件指纹完全一致**，同机同路径，所以回退验收包含「旧代码、旧数据、旧绑定一起恢复」。
- 因此有两份用途不同的备份（拍板点 6）：**回退备份**在换包前、旧版本下用 `companion-backup` 做，记录旧包指纹，只用于换回旧版；**同包续做备份**由迁移器每轮另建，只用于同一个新包下的续做。一份备份满足不了两种指纹。完整顺序见 [development.md](development.md)。
- **新版运行期间新增的聊天，回退后旧版看不到。** 恢复器会把原生日志目录和会话登记恢复成备份时的样子（`scripts/lib/offline-backup.mjs:432-437,445-451`，对应测试 `tests/infrastructure/offline-backup.test.mjs:51-79`）；新版期间的聊天只保留在「回退前自动做的安全备份」里。要让它们重新出现，需要一个额外的、可选的恢复步骤，不在现有恢复器的范围内。
- 同理，**已送达的消息和已消耗的额度**是不可回退的状态；Channels 账本搬出后，现有恢复器也不会把新版的送达、去重和额度记录转回旧 Core。恢复契约要明确列出这类**不可回退状态**。
- 外部状态也要进恢复契约：DSH 工作区登记、原生日志、投影缓存、共享附件、工作区 `AGENTS.md`、设备配置引用。
- 现有恢复器不是纯回滚：恢复前，它把当前的渠道日志、Core 里受保护的送达、去重、额度记录和 Life 花费带进待恢复的数据（`scripts/lib/offline-backup.mjs:409-420`，受保护的 kind 列在 `:309`）。备份里有、当前却缺的受保护记录会让它拒绝恢复（`:354`），共享附件字节冲突也拒绝（`:426`）。回退验收按这些真实行为断言，不比较整个目录和备份是否逐字节相同。

### 7.3 经济待确认请求的迁移顺序

1. 先把浏览器 localStorage 里的待确认请求**原样导出**，保留原请求 ID、输入、绑定，并纳入备份。
2. 再导入钱包区的持久存储，核对数量和内容一致。
3. 核对通过后，才清除浏览器里的副本。

### 7.4 第一次迁移的定位

阶段 1 只做「存储清单加版本号和迁移日志」，数据格式其余不变。2a 登记了三步：`0001-storage-manifest` 写存储清单，`0002-home-identity` 把共享 home 身份从 `life.json` 复制进 Core，`0003-economy-marker` 把 `economy.initialized` 从 Core 搬进钱包库并写独立证据，存储版本随之升到 v3。`0003` 是第一次跨数据库搬迁，合成副本上已演练崩溃续做、结算守恒和用 v0.2.0 代码回退；主人随后在隔离环境做了升级、迁移和回退，在独立设备上做了真实副本演练，0.3.0 已发布并在日常机器上迁移通过，迁移链路按 [product.md](product.md) 2a 完成标准验收。换包后新版本遇到未迁移的数据进入「需要迁移」模式，只开普通聊天、拒绝伙伴数据写入；离线迁移器接不住的绑定形状另报 `binding-not-migratable`，提示换回旧版理顺。

版本号和日志放在 `.chatpet/data/storage-manifest.json` 和 `.chatpet/data/migrations.jsonl`，迁移锁是同目录的 `migration.lock`（`scripts/migrate/context.mjs:21-22`）。它们不放进 `.chatpet/manifest.json`：那个文件算进绑定指纹（`src/core/workspace.ts:309-311,324-327`），还会被 Core 改写（`src/core/workspace.ts:443-445`）。三个文件都在 `.chatpet/` 里，现有备份自然覆盖。

迁移按轮追加日志段：每轮的段头写明本轮步骤集、每步的源版本和目标版本、绑定（`storageId` 和仓库路径摘要）、同包续做备份的地址和校验值（`scripts/migrate/journal.mjs:5-11`、`scripts/migrate/runner.mjs:110-120`）。上一轮全部完成且目标仍在，才能开新一轮；`--resume` 只续最后一轮，并要求步骤集和当前代码一致（`scripts/migrate/runner.mjs:59-83`）。v1 存储清单冻结在步骤表里（`core/storage-migration.ts:13-15,24,29-31`、`scripts/migrate/steps/0001-storage-manifest.mjs:4-10`），之后每一步完成目标后由运行器推进清单（`scripts/migrate/runner.mjs:126-144`）。迁移和恢复用仓库外的互斥文件串行（`scripts/companion-backup.mjs:17-20,93-99`，`scripts/migrate/runner.mjs:90-108`），因为恢复会替换整个 `.chatpet/`；恢复带回的旧 `migration.lock` 按陈旧锁接管（`scripts/migrate/io.mjs:48`）。命令、状态值和原因码见 [development.md](development.md)。

### 7.5 演练覆盖

- 正常迁移 → 聊天和记忆可用 → 回退 → 旧版可用。
- 迁移到一半崩溃 → 重启接着做，不重复、不漏。
- 迁移前后，已撤回的记忆仍然不可见，身份和存储标识不变。
- 缺库、坏 JSON、软链接、外来身份：仍然不得创建空白替代（`tests/infrastructure/first-install.test.mjs` 已有断言，保留）。
- 「身体效果已生效、库存结算失败后重启」在迁移前后行为一致。

---

## 8. 生命周期规则

1. 所有定时器、订阅、在途请求通过模块的**作用域助手**登记（包装 `ctx.effect` 和 `AbortController`），不允许裸 `setTimeout`。
2. 关闭顺序：停接收新请求 → 取消在途请求 → 等已提交的写完成 → 释放资源。
3. **每个模块一条通用测试**：启动 → 触发活动 → 关闭 → 断言无残留。除假时钟外，还要断言在途 I/O 已结束、子进程已退出，并保留少量使用真实时钟的冒烟测试（假时钟证明不了 I/O 和子进程）。
4. 切换工作区或重载后，旧作用域的回调不得写新绑定的数据：绑定校验带**实例代次**（见第 3 节）。
5. **写入已完成但响应被取消**要有专门用例。
6. 生活三区和 Room 对 Core 的可见性、Desktop 和 Channels 登记的生活出口、Desktop 读 Life 启用意图时取的 Plan，都只在入口挂载时按隔离标签判定。改某个入口的 Cordis `isolate` 配置后，要重挂该入口才生效。

---

## 9. 重写顺序

第一层不能作为一个整体独立完成：Core 原先写 `life.json` 里的共享 home 身份（2a 第 4 批已迁到 Core 的 `companion-home` 记录）；Memory 订阅 `pet/life.review`、记录库读 Life 活动记录已在 2a 3C 改为向下调用和登记口。所以把它拆成几个**每步自己能完成、不破坏旧功能**的小单位。各步对应的里程碑和完成标准见 [product.md](product.md) 的「阶段」。阶段 1 缩小后（[decisions.md](decisions.md)「阶段 1 缩小」），第一层停在 P2b，P2c 取消，其中属于第二层的部分并入 P3。

| 步 | 做什么 |
| --- | --- |
| P0 | 行为基线：拆行为清单；定 `layers.json`；R1–R4、R8 先对旧代码跑，用已知违规样例集验证脚本抓得到，现状违规清单固定 |
| P1 | 迁移骨架：存储清单版本号、迁移日志、备份与回退串联、真实数据副本演练（7.4 的边界） |
| P2a | 能力状态表：Core 不再读上层服务拼状态（已完成）。原定的初始化表缩小后不做 |
| P2b | 来源适配表和工具声明表：把 Life 一类原生输入的整套适配（准入、工具限制、回顾守卫、历史投影）迁出第一层；`host.native.xxxAdmission` 赋值消失（已完成） |
| P2c | 取消。事件改调用（Memory 不再订阅 `pet/life.review`）、记录库改读第二层只读接口并入 P3；提示词段表砍掉；共享 home 身份记录的归属已定（第 4 节） |
| P3 | **已完成**：2a 合并（0.3.0）、2b 概念统一（0.4.0）。合并第二层（先合并、行为不变，概念统一随后逐步）：5.9 隐含契约的契约测试先行；第一层里属于第二层的 18 条违规搬走；共享 home 身份记录迁移、常驻实例、旧入口语义表落实、事实准备和确认搬入、旧服务名门面、`economy.initialized` 搬出 |
| P4 | 第三层原地治理，不重写模块：图片准入抽共用；语音接口落地；运维操作表；浏览器里的经济待确认请求迁入持久存储；Channels 账本暂留 Core 数据库，`desktop-session` 搬出为可选 |
| P5 | 收尾：删已不用的旧适配（以已安装配置核实为前提）、更新本文、按 G8 复核长期例外 |

每步结束都要：行为清单全绿、门禁通过、能发一个版本、更新「典型修改前后对比」。

---

## 10. 特殊情况

- **首次安装 / 空状态**：没有绑定资料目录时，第一层只开聊天，不创建上层数据。主人明确初始化时，Core 一次建好全部技术容器，可选服务既不打开也不启用（`core/initialization.ts:16`）；Economy、Memory Bank、近期账本经 `registerInitializer` 登记自己的初始化。沿用现状。
- **失败**：迁移任一步失败，保留原文件，标记「待核对」，不静默继续。
- **取消**：迁移可以在两步之间取消；已完成的步骤依赖目标状态判断，不依赖标记。
- **旧数据兼容**：新代码读 0.1.8 数据；有格式改动的项靠迁移，不靠读时兼容（读时兼容算兜底，要先说明理由并经主人同意）。
- **外围模块关闭**：关掉 Desktop、Room、Channels、Voice 任一个，聊天、记忆、身体、计划都不受影响（R7）。

---

## 11. 不确定的地方和怎么验证

| 不确定 | 怎么验证 |
| --- | --- |
| 登记口的契约能否覆盖第一层现在承担的全部上层策略（`core/native/agent.ts` 的 Life 工具限制和回顾守卫、Desktop 图片恢复，`core/companion-foundation.ts` 的事实准备） | P2b 前，列出 `agent.ts`、`companion-foundation.ts`、`prompt.ts` 里每一处向上的策略，逐条对应到某张表；`prompt.ts` 本身没有直接向上读取，但它的异步准备、准入、附着、卸载、历史替换契约要完整保留 |
| 合并后 Room、Desktop 只靠快照能否替代现在的直接读取 | P4 前，逐处列出它们读 `petBehavior / petLife / petEconomy` 的位置，核对快照字段够用 |
| 三个旧入口独立卸载的语义 | 已完成：6.2 的表在 2a 前填好，每行有入口测试（`2A1A-*`、`G3-GARDEN-*`） |
| 主人的真实数据是否都在第 4 节的位置里（含旧位置 `data/life/` 下的自述、日记、相册） | P1 在真实数据副本上盘点实际文件和表，对比登记表 |
| 旧安装能否无缝升级 | P1 在隔离的已安装环境里演练 |
| 检查脚本能否覆盖 R1–R4 | P0 对旧代码跑，要求准确列出 [product.md](product.md) G5 所列的 Core 向上读取、`lifeAdmission / roomAdmission / channelBoundary`；存储写入另看 R5 报告 |
| 记录库的唯一写入协议（原生 `write/edit` 工具） | 阶段 2a 前决定（和记录库改读第二层只读接口一起）：经记录库守卫，还是保留现状并在清单里明示 |
| 上游的完整集合：`HOME_ACTIONS`、身体 kind、`source.kind`、Life 自动登记的提示词段 | 本地只有声明或 `any`；需要上游契约，或隔离环境里的只读目录快照，才能确认完整取值 |
| 素材名称是否准确表现了动作、情绪和对象 | 分配表的文字匹配不能证明效果；需要在隔离的呈现端里观看素材验收 |
| 两套分类器对同一情绪的不同呈现，是 bug 还是有意为之 | M1 登记为已知问题，由主人判断；统一规则前先确认哪个是期望行为 |
