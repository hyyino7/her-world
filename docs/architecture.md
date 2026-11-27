# Her World 架构

这里记录 Her World 的三层结构和模块职责。版本与阶段进度见[产品当前状态](product.md#当前状态)，取舍见[决策](decisions.md)。

代码路径默认相对 `src/`。`scripts/`、`tests/`、`vendor/` 下的文件写全路径。

---

## 0. 一页总览

```
        你（桌宠 / Room / QQ / 微信 / 语音 / 设置页）
                       │
┌──────────────────────▼─────────────────────────────┐
│ 第三层  呈现与连接                                 │
│   Desktop · Room · Presentation                    │
│   Channels · Voice · Console                       │
│   向下依赖；按登记复用 Presentation；只存自己的数据          │
└──────────────────────┬─────────────────────────────┘
        向下：调用（读快照、发命令） │ 向上：事件、登记
┌──────────────────────▼─────────────────────────────┐
│ 第二层  生活世界  living/                          │
│   身体 · 计划与回顾 · 钱包背包菜园阅读                  │
│   一个实例；内部直接调用                             │
└──────────────────────┬─────────────────────────────┘
        向下：调用            │ 向上：事件、登记
┌──────────────────────▼─────────────────────────────┐
│ 第一层  伙伴本体                                   │
│   Core · Memory · Emotion · Contracts · World       │
│   登记口：来源适配 · 能力状态 · 工具声明 · 初始化 · 运维操作      │
└────────────────────────────────────────────────────┘
                    DSH（聊天、调度、会话日志）
```

**一条总规则：向下用调用，向上用事件和登记。** 底层绝不主动去找上层要东西，也不订阅上层的事件。例如记忆不订阅生活世界的回顾事件，而是生活世界在回顾完成时**向下调用**记忆服务。

---

## 1. 外部能看到什么变化

- **主人操作**：在 DSH 原生入口使用同一伙伴；可选组件各自启停。升级及权限变化见发布说明。
- **开发者看到的**：目录按三层重排；多一组自动检查；多一份状态拥有者表；带版本的存储准入与离线恢复流程。
- **下一阶段**见[产品计划](product.md#下一阶段)。

---

## 2. 三层和模块

<a id="21-现在--以后"></a>

### 2.1 模块归属

模块及归层以 [arch/layers.json](../arch/layers.json) 为准。

| 层 | 模块目录 | 职责 |
| --- | --- | --- |
| 第一层 | `core/` | 身份、存储与绑定、DSH 聊天接缝和登记口。R1 例外见[规则基线](../arch/baseline/rules.json) |
| 第一层 | `memory/` | 记忆引擎的创建、关闭与绑定 |
| 第一层 | `emotion/` | 情绪状态和近期互动账本 |
| 第一层 | `contracts/` | 共用契约。照料表的取值由 Living 拥有 |
| 第一层 | `world/` | Core 的 `petWorld` 使用其模块登记和会话归属，记忆批处理也使用模块登记 |
| 第二层 | `living/` | 身体、计划和回顾、钱包背包菜园阅读三区共用一个常驻实例 |
| 第三层 | `desktop/` | 桌宠与 PetPlatform 接线 |
| 第三层 | `room/` | 房间窗口、交互接线和图片副本 |
| 第三层 | `presentation/` | 桌宠与 Room 共用的呈现和播放契约、动画索引 |
| 第三层 | `channels/` | QQ／微信等渠道。Core 原位例外见[状态拥有者表](#4-状态拥有者表) |
| 第三层 | `voice/` | 通过[语音接口](#54-同层共用物)登记合成、识别和音色服务 |
| 第三层 | `console/` | 设置页经[运维操作表](#55-控制台)操作各模块 |

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
| **提示词与历史投影** | 各模块登记提示词片段；工具结果在历史里怎么瘦身 | 历史瘦身已由工具声明的 `historyOverview` 派生（`core/tables/tools.ts`），Core 不再 import 各模块的投影函数。提示词片段继续用 `registerWorldPrompt`（`core/native/prompt.ts:99`）在模块入口登记，动态段退休照旧（`core/native/prompt.ts:27-63`）。逐段声明的现状和分批计划见[5.9](#59-上下文组装契约) |
| **来源适配表** | 一种「原生输入来源」登记一整套适配：准入、工具限制、守卫、历史投影、图片恢复 | 已落地：`core/tables/sources.ts`，挂在 `host.native.sourceTable`。Core 登记主人原生输入，Life、Room、Channels 各自登记适配器，Desktop 登记首步前的图片恢复和第 7、9 行声明（5.8）。判定分 `unclaimed / rejected / accepted / failed`，另有只读分类供历史投影。登记完成屏障未实现，见下面的契约 |
| **能力状态表** | 各模块登记自己的状态行（只有状态和操作名，不能被调用） | 已落地：`core/tables/capabilities.ts`。Core 只登记会话和记忆两行，其余由提供它的模块在入口登记、卸载时撤销；模块缺席即无行，设置页对这类拥有者显示「不可用」 |
| **语音调用表** | 载体查询可用性并调用合成、识别和音色列表 | `host.native.voiceTable` 按 Core 实例和 Cordis 服务隔离标签解析 Voice 登记。每次调用捕获登记租约，提供方卸载或调用方取消时中止并丢弃迟到结果。 |
| **运维操作表** | 设置页要执行的操作（开房间、授权访问、改平台设置、操作 Channels）由各模块登记，控制台只调用这张表 | Core 的 `host.native.consoleOperations` 按拥有者登记，并沿用 Cordis 服务隔离。调用捕获登记租约、工作区绑定和请求号；Console 虽可独立装卸，仍统一负责 Connection 路由的撤销。两个旧钱包写入口保留原路径，由 Economy 统一持久登记和派发 |

另有伙伴工具声明表（`core/tables/tools.ts`，挂在 `host.native.toolTable`）：各模块在工具定义旁声明可用来源和可选的历史概览，Life 名单和历史瘦身由它派生。三个登记口共用 `core/tables/registry.ts` 的登记表。

另有伙伴判定登记口（`core/tables/companion-ports.ts`，挂在 `host.native.companionPorts`），复用同一个登记表，让第一层不再读生活服务：Body 登记「身体可用」，Plan 登记「此会话由 Life 自带相册」和「仍是运行中的 Life home」，Room 登记「此会话正在看电视」和「打开 Room 窗口」，`LivingWorld` 在首个可见区挂载时登记活动只读接口（`living/plan/activity-reader.ts`）。生产方只在挂载时按 Cordis 根和隔离标签判断对 Core 是否可见，读取时核对租约；读不到登记时等同服务不在。Memory 另提供向下调用的 `host.native.requestReviewCompaction(sessionId)`，由 Life 回顾完成和 Bridge 整理调用。

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
| 身体 | `living/body/` | `data/behavior/home.json`（已有 `data/life/home.json` 则沿用）。首次采用钱包从同目录的 `garden.json` 交接。 |
| 钱包背包菜园阅读 | `living/economy/` | `data/economy/economy.sqlite`、`storage.json`；和钱包目录分开的采用证据 `data/living/economy-adoption.json` |
| 计划、回顾、闹钟、日记复盘 | `living/plan/` | `data/life/control.json`、`life.json`（home ID 镜像和待迎接）、`life/wakes.jsonl`、`activity/*`、`compactions.jsonl` |

- **一个常驻实例**：`LivingWorld`（`living/index.ts`）按 Cordis 根、Core 实例和服务隔离标签分组，三个生活入口里先加载的那个创建，最后一个卸载时释放；每个区仍留在自己入口的作用域里，卸载哪个入口只停哪个区（6.2）。
- 对外四样（世界快照、命令、事实流、`world.changed`）的定义在 5.2。
- 三个区之间经实例查找。Body 的实际转场和 Economy 新提交的事实给当前 Plan 排队。Plan 在控制和启停边界安排 Body 串行同步，显式暂停会等待在场的 Body 停下原计划与自治。通知核对工作区绑定代次和双方租约。外部呈现订阅 `world.changed`。
- **合并目录不等于合并事务。** 身体文件和经济数据库仍然分开提交，「身体效果已生效、库存结算失败后重启补结算」的现有协议原样保留，不改。

### 2.4 第三层「呈现与连接」管什么

Desktop（含 PetPlatform）、Room、Channels、Voice 和 Console 经第一层接口或登记表使用同层能力。Desktop、Room 和 Console 可以依赖共用模块 `presentation/`。`presentation/` 独立于其他模块，也没有持久数据。

第三层各模块只写自己拥有的数据。Core 原位例外见[状态拥有者表](#4-状态拥有者表)。

<a id="room-extension-architecture"></a>

### 2.5 计划：空间重做的分层与声明

在 `LivingWorld` 增设空间区，与 Body、Plan、Economy 在同一实例内调用，沿用 [5.2](#52-第二层对外) 的快照、命令和事件。空间区声明地区、默认布局、家具种类及语义交互点，解析旧站位并通过 `Navigator` 算路径点。Body 持有身体状态和路线时钟，Plan 引用解析后的交互点。地区各有一张导航图和一个场景，首版的「家」包含房屋、小径和菜园，暂不引入多地区加载生命周期。

家具实例、门窗等结构件、菜畦等地区固定对象都能提供交互点。布局给对象分配稳定 ID，点用 `<实例 ID>:<点名>` 派生。每个可解析的旧 `room/spot` 在空间区统一映射到默认布局的交互点；别名随对象移动继续有效，删除对象后明确报告找不到。指定实例时用指定的，只给活动时按她当前位置的最短可达路径选。家具点按实例相对坐标声明并随实例平移，使用时的姿势、高度和朝向由种类声明提供。

Room 保留 `./50-Room`、`petRoom` 和现有登记接缝（`package.json:22`、`room/plugin.ts:221–243`）。按世界快照生成 three.js 场景，呈现侧负责家具模型和编辑界面，布局请求经 `presentation/room-transport.ts` 的共享传输表送到 Room，再调用第二层。布局、身体、路线和菜园按同一修订视图读取，拍照固定使用当次视图，已拍照片不会随布局变化。当前 Room 的拍照工具先后读取身体和菜园（`room/plugin.ts:179–188`）。第三层沿用绑定和版本校验，只通过命令提交布局编辑。拥有者和提交协议见[4.2](#room-extension-storage)。

Room 直接使用 DSH 的工具与 `webServer`，窗口默认使用 DSH 自带的 Electron（`room/plugin.ts:228–237`、`room/window.ts:49–59`）。宿主升级后先重跑 Room 行为清单和已装窗口入口。

<a id="room-extension-takeover"></a>

#### 接管后代码去哪

模板的上游是 `sh2234113/feiyu-room-template`，本地适配基于固定提交 `9df0a6b7`（`vendor/feiyu-room-template/origin.json:2–14,33–38`）。代码及内置 three.js 为 MIT，2D 素材按 CC BY-NC-SA 4.0 署名及相同方式共享，作者的 GLB 随模板用于个人非商业展示，商用或二次创作须有书面许可（`THIRD_PARTY_NOTICES.md:20–25`、`vendor/feiyu-room-template/THIRD_PARTY_NOTICES.md:3–30`）。接管的例外和重打包核对按[立项决定](decisions.md#room-extension-decisions)执行。

| 组 | 当前在模板内的内容与消费者 | 接管后的归属 |
| --- | --- | --- |
| 1a | `home-state.js`、`src/room-state.js`、`src/garden-store.js`、`src/garden-autonomy.js` 由 Body 消费（`package.json:32–37`、`living/body/room.ts:3–9`） | `src/living/body/` 保留身体状态、访客、旧菜园存取和执行语义。1b 建立空间区的默认布局。 |
| 1a | `public/room/garden-state.js` 供 Economy、Body 和 Room 静态页面使用（`living/economy/store.ts:6`、`living/body/room.ts:6`、`vendor/feiyu-room-template/public/room/garden-ui.js:1`） | 规则由 `src/living/economy/` 持有，构建为 Room 静态页提供同一份 JS。 |
| 1a | `public/room/` 的其余页面与资源由 Room 路由加载（`room/assets.ts:10–21,143–200`） | 迁到第三层 Room 静态资源，继续复用 `src/presentation/` 的传输和播放。 |
| 1e | Channels 消费 `affinity`、`group-wake`、`role-card`、`sticker-lib`、`slang-learner`、`forward`、`qzone`、`sensitive`，部分模块依赖 `src/md-to-plain.js`（`channels/group-material.ts:8–13`、`channels/group-social.ts:4–5`、`channels/group-qzone.ts:5`、`vendor/feiyu-room-template/src/sticker-lib.js:17`） | 迁到 `src/channels/`，随该组清理旧声明和别名。 |

构建、打包、动画映射及页面注入随各组改路径。1e 完成后删除模板目录，清掉剩余的运行、生成源、打包和来源登记引用，上游提交及许可记录归入第三方声明。各组的验收见[3.2](#room-extension-checks)。

---

## 3. 依赖规则和自动检查

规则写成机器可读的清单 [arch/layers.json](../arch/layers.json)：每个模块属于哪层，允许依赖谁，允许读哪些服务，允许发布和订阅哪些事件。检查脚本用仓库已有的 TypeScript 编译器接口写，不加新依赖。

- **R0**：第三层 → 第二层 → 第一层；第三层依照 `layers.json` 允许的入边复用 Presentation。向下调用、向上事件与登记。

| 编号 | 检查什么 | 覆盖范围 | 怎么查 | 建立时间 |
| --- | --- | --- | --- | --- |
| **R1** | 静态 import 方向 | `.ts` 和 `.js/.mjs/.cjs`；动态 `import()`；`createRequire`；`#别名` 路径 | 脚本读 import 关系，对照 `layers.json` | M1 |
| **R2** | 运行时服务读取 | `ctx.get('petX')`、`ctx.petX`、`scope.petX`、`inject: [...]`；还要识别别名、解构、计算名（例如把服务名存进变量再读）；遇到无法静态判定的写法直接判失败，要求改成显式写法 | 扫描 + 每个模块声明允许读取的服务；声明是子集且方向合规 | M1 |
| **R3** | 事件 | `ctx.on / ctx.emit('pet/…')`，也包括 DSH 原生事件的订阅；事件只能向上流（订阅者所在层不低于发布者）；事件名在发布层的 contracts 里声明 | 扫描 | M1 |
| **R4** | 直接给别人的对象赋值 | `host.native.xxx =`，也包括通过别名、解构后的赋值 | 扫描，并配一个「已知违规」样例集验证脚本真的抓得到 | M1 |
| **R5** | 谁在写哪份数据 | 见下 | 见下 | M1 起只报告。存储句柄延期，见下方边界 |
| **R6** | 关闭后不留尾巴 | 定时器、订阅、在途请求，以及在途 I/O 和子进程 | 见第 8 节 | 从阶段 2a 起，每个新写的模块各带一条 |
| **R7** | 外围可关闭 | 见下 | 组合测试 | 阶段 2 覆盖生活世界的卸载与暂停；阶段 3 覆盖全部外围模块 |
| **R8** | 词汇重复与裸字符串 | 同一组字符串取值出现在多个文件，阶段 3 纳入有类型或用途证据的对象表和布尔值表的键。另检查公开接口的 `kind / action / status / type` 裸 `string` 字段 | 扫描，旧重复按基线放行，新增重复阻断（[检查入口](../scripts/arch/check.mjs)、[对象表扫描](../tests/arch/object-vocabulary.test.mjs)与[棘轮测试](../tests/arch/ratchet.test.mjs)） | M1，阶段 3 扩面 |

**棘轮**：R1–R4 的基线在 [arch/baseline/rules.json](../arch/baseline/rules.json)，R8 在 [arch/baseline/vocabulary.json](../arch/baseline/vocabulary.json)。运行 `pnpm run check:arch -- --report` 可查看 R5 实时读写报告。已建立的检查出现新增违规，或旧条目消失而未同步收紧基线，都会失败；更新基线只能删条目，清理旧违规时同提交收紧。检查与报告命令见 [开发说明](development.md#architecture-behavior)。尚未建立的检查不计为已生效。

**R5 的做法**

- 状态拥有者表（第 4 节）登记每份持久数据的路径或表名、拥有者、**唯一写入协议**。
- 按拥有者限制表和行的通用存储句柄与 `records.kind` 公共类型化仍在延期，见[长期有效的规则](decisions.md#2026-11-23-阶段-3-拍板中长期有效的规则)。
- Core 的 SQLite 只放 Core 拥有的表、记录 kind 和[拥有者表](#4-状态拥有者表)批准的原位例外。拥有者边界覆盖**记录 kind 和写入端口**。
- **局限**。R5 能报告文件、表和记录 kind 的可识别写入点。对已有文件某一行的越权更新仍超出静态扫描边界，见下方已知局限（`scripts/arch/lib/storage.mjs:28,60`）。

**R7 要覆盖：**

- 外围模块全部关闭、逐个关闭、不同启动顺序、重载（关了再开）。
- **卸载和暂停是两回事**：卸载生活入口、显式暂停生活、卸载身体入口，分别验证。
- 工作区 A→B→A 换绑。
- 写入已完成但响应被取消。

绑定校验使用 Core 的 `sameHomeBinding`，同时核对工作区、路径、存储 ID、启动标识和绑定代次（`src/core/home-binding.ts:3–6`）。异步边界的用法与回归见[绑定代次的 G3 复盘](product.md#绑定代次的-g3-复盘)。

**每条检查都有真实案例**：R1 到 R8 在 Her World 的提交历史里都有对应案例（例如 R6：关闭后晚到的录音、语音排队取消丢失、关闭失败导致清理中断）。新增检查也要写明对应的案例，对应不上的不加。


**检查脚本的已知局限**（报告时要考虑，改法等用到时再定）：

- R5 只解析文件操作的第一个参数（`scripts/arch/lib/storage.mjs:28`）。`rename*`、`copyFile*` 的写入目标是第二个参数，所以原子写会被报成写临时文件，「无法静态判定」的条目里有一部分是这个原因。
- R5 把未登记的 CoreStore kind 默认归给 `core`（同文件 `:60`），Core 写一个未登记的 kind 会显示「一致」。目前靠逐 kind 对上 `store.put` 的测试兜底。
- R8 会收进 `src/` 里的非业务集合，例如协议前缀、本机地址、HTTP 方法、文件后缀。已有的照常修改不受影响；新代码写出同样的集合会被拦，属于误报，按「真误报就修脚本」处理。

<a id="llm-check-plan"></a>

### 3.1 用量账本检查

[逐笔覆盖与渠道对账](../tests/core/usage-coverage.test.ts)用假适配器的实际调用核对每行的入口、预设和用途，未声明入口的已准入调用会报警。[内容隔离与写失败](../tests/core/usage-ledger.test.ts)核对列名、标识、主库和旁文件的字节，验证计量失败时聊天可以继续。[设置读口与绑定](../tests/behavior-list/usage-ledger.test.mjs)覆盖换绑、漏记、跨日和 Life 对照。

「请求差异」和连贯性抽查在[大模型使用 1b](product.md#大模型使用-1b-观测和基线)建立基线，供独立个体对比。原 1c 以后的检查由[独立个体检查清单](#individual-checks)取代。

<a id="room-extension-checks"></a>

### 3.2 计划：空间重做的检查

沿用[行为清单](product.md#行为清单)和本节架构规则。新检查建立时标明保护的既有行为、事故或决定，用一份故意违规的样例验证能拦住。R5 继续报告读写，唯一写入路径用行为验证守住。

<a id="room-extension-behavior"></a>

#### 既有行为与待补用例

沿用现行通过标准，只有[有意改变的行为](product.md#空间重做与内容扩展)随对应发行单位修订预期并记录原因。下表按场景列出基线要保住的结果和时间规则，以及阶段 0 要锁定的用例。代表性已登记断言见 `tests/behavior-list/index.json:331–423,941–1159,1332–1342,1434–1444,1843–1851`，由阶段 0 重跑确认覆盖。

| 范围 | 保住的行为 | 阶段 0 补验 |
| --- | --- | --- |
| 身体与计划 | 到达回执以所属操作的真实停留为证，动画结束不算到达。到床才入睡，叫醒去床途中的她要保留实际位置、朝向和高度。路线和停留按原绝对时间推进；暂停、截止及照料后续行按现行规则，保留阅读进度。证据见 [导航](#room-extension-navigation)和[迁移](#room-extension-migration)。 | 复用到达、唤醒、读档与续行断言。补浏览器插值、迟到快照、家具占地进出、门洞及室内外通行。实窗验拖角色直接落点与点击地面走路，重载后落点保持。 |
| 菜园、访客、历史 | 园艺先走到再干活和结算，按地块及作物代次防止旧任务误用，自然生长和缺水独立推进（`vendor/feiyu-room-template/src/garden-autonomy.js:71–89,247–271`）。访客与身体事件同次提交（`living/body/room.ts:1104–1123`），留言在侧栏和记忆板显示。已写地点文字和原事实保持原意。 | 补改种后的旧采收、访客提交失败再重试、留言两处显示。 |
| 窗口、照片和呈现 | 保持一次性和循环播放、暂停进度、空闲降帧及活跃提帧。隐藏暂停媒体和投屏，回来先读最新快照（`vendor/feiyu-room-template/public/room/app.js:2098–2118`）；旧响应不得回滚画面，换绑使旧请求失效。保留三种角色模式和画质切换、照片、墙体剖切、屋顶、标签、灯光、时钟、相机预设和跟随、第一视角、拾放反馈、状态面板、家具热点与信息卡。 | 将状态更新、媒体取消和播放回归接入清单。补旧模式截图、迟到加载、照片、镜头及手势验收；接入布局时另验相机、拖角色、点家具和编辑手势各自只触发一次，以及照片的同一修订视图。 |
| 聊天、投屏与跨端 | 保留 Room 会话、去重、重启读回，以及 Life 经计划安排动作。投屏选屏、视频纹理、观看面板和观后感各走原入口。停止、隐藏、换屏结束旧投屏；关跟随取消在途观后感，视频继续（`vendor/feiyu-room-template/public/room/app.js:245–251,374–417,2098–2112`）。电视的三个授权面沿用 [5.8.3](#583-会话策略表三个授权面)。Desktop、Console 的位置名称及计划工具的可选地点与可执行目标一致。 | 用已装窗口验真实选屏、换屏、视频纹理和停投；补跨端地点文字和计划目标校验。 |

#### 自动检查与建立阶段

| 检查 | 检查方式与依据 | 建立阶段 |
| --- | --- | --- |
| Room 行为及合成存档演练 | 在 `tests/behavior-list/` 登记可复用回归；已装窗口流程单列。以合成档演练正常迁移、恢复和崩溃续做，保护[请求指纹与回执](#room-extension-migration)。 | 0 建骨架，1b 验实际迁移 |
| 模板接管 | R1 检查本组不再引用模板路径，迁移后纳入源码扫描。现行扫描跳过 vendor 生成源（`scripts/arch/lib/scan.mjs:34–43`）。在运行时包检查验证打包和页面注入，末组检查模板目录及其运行引用清空、许可登记齐全。 | 1a 起逐组，1e 收口 |
| 别名、默认布局、引用消费者 | 遍历 `HOME_LAYOUT.spots` 验旧名称全可解析，对比交互坐标、姿势、高度、朝向及截图；几何通行按[导航验收](#room-extension-navigation)。按[引用处置表](#room-extension-migration)验每种旧写法。 | 1b |
| 布局格式、拥有者与命令回执 | 检查版本、修订号、实例唯一、点可解析及坏档保留。登记 `arch/storage.json` 并核对 R5，发命令后验证唯一写入路径、同请求重试、并发和迟到回包。 | 1b 格式与登记，1d 命令 |
| 导航 | 用同组默认及合成布局按下节验通行、回执和恢复。 | 0 对比，1c 纳入回归 |
| 资产与外观 | 参考哈希和大小的现有媒体校验（`scripts/build/build-life-media.mjs:16–30,60`），增加面数、贴图预算、许可、批准来源及未登记模型拒绝入包。检查登记家具的外观映射齐全，阶段结束后均映射到资产。 | 2 纳入构建校验和回归 |
| 玩法登记口 | 用 R1 拦截玩法依赖调度、存储写入口或模型调用，执行测试走现有活动协议。 | 4 随玩法接入门禁 |

性能对比按[产品度量](product.md#room-空间重做的度量)执行。空间和家具概念在 1b 前补入 [5.6](#56-细粒度接口准则和概念表)，其余概念按使用阶段补。

<a id="room-extension-navigation"></a>

#### 导航接点与验收

现行 `buildMapRoute` 在门洞节点图上处理室内捷径与室外路点，家具占地采用起终点放行。`beginRoute` 无路线时直接进入目标停留（`vendor/feiyu-room-template/home-state.js:674–714,745–807,926–939`）。替换后由第二层用布局和角色宽度重建可走区域。导航路径接到交互点的接近点，再沿进入段抵达使用位。只有进出段可穿过所属家具占地，与主路径共用路线时钟，实际到使用位才施加效果并产生到达回执。Body 保留绝对出发和到达时间、睡眠、停留和恢复协议（`vendor/feiyu-room-template/home-state.js:553–582,954–970,1170–1189,1608–1628`）。Room 保留单调显示时钟、首帧延迟补偿与拖拽显示（`vendor/feiyu-room-template/public/room/app.js:1243–1270,2163–2172`）。

阶段 0 给自写二维占地网格（A* 加视线拉直）和 `recast-navigation-js` 各做一个 `Navigator` 原型，均在目标 DSH 插件进程加载一次，最多各修正一轮。用同一组场景比较通过项、代码量和依赖风险，原型留作评审证据。选型按[立项决定](decisions.md#room-extension-decisions)执行，采用导航库后锁版本。

同一组验收覆盖：床、沙发、茶几旁电视位等交互点的各方向进出，书架、室内外门道、菜园门及室外连通；窄门、斜角和拉直路线的连续碰撞；从家具内部出发脱困；堵门编辑拒绝；已在使用位和不可达的两种结果；途中退出 DSH 后按时间恢复、到达回执及叫醒时保留实际位置。1d 在挪过躺椅的布局重跑可达性；阶段 2 开放途中重算时再验在途变更。

---

## 4. 状态拥有者表

数据路径、物理容器、当前写入者、目标拥有者和版本的机器登记见 [arch/storage.json](../arch/storage.json)；路径清单在那里维护，本节说明归属和写入协议。数据位置默认**不变**。「唯一写入协议」一栏标「待定」的，在对应阶段的实施方案里补。

| 数据 | 新拥有者 | 现在谁写 | 变化 / 唯一写入协议 |
| --- | --- | --- | --- |
| `.chatpet/{manifest.json, SOUL.md, USER.md, COMPANION.md, core.json}` | 第一层·身份与绑定 | Core 初始化和设置 | 不变 |
| 用量账本与漏记记录 | 第一层·Core | Core 的全局模型流监听者 | [用量账本写入协议](#llm-storage-plan) |
| Core 数据库：身份、设置、请求去重、原生消息映射、记忆待处理/确认 | 第一层 | Core、NativeMemory、Memory batch | 不变 |
| Core 数据库：`channel-received / channel-reach / life-outlet-delivery / channel-usage / channel-usage-event` | **第三层·Channels** | Channels 直接写 | **原位例外**，沿用 CoreStore 记录协议及[离线恢复](#72-回退)对当前渠道记录的保护 |
| Core 数据库：`desktop-session` | **第三层·Desktop** | Desktop 直接写 | **原位例外**，会话映射随选中的 Core 备份恢复 |
| 钱包导入独立证明 `data/console-wallet-import.json` | 第一层·绑定 | Core 初始化 | 全新安装写入无旧来源的证明。已迁移绑定由完成日志中的凭证准入 |
| 钱包「已采用」证据：`economy.sqlite` 的 `meta.economy.initialized` 和独立文件 `data/living/economy-adoption.json`（都是 `{storageId, companionId}`） | 第二层·钱包区 | Economy | 首次建库时先验旧菜园，在钱包租约下先落独立证据，再在同一个事务里建表、导入旧菜园、写库内标记，提交后补 `storage.json`（`living/economy/store.ts:75-125`）。运行时认五种采用证据：独立证据、库内标记、`storage.json`、身体检查点的 `economyGardenAuthority`，以及同一 `storageId` 的迁移日志里含 `0003` 且记了 `economyAdopted:true` 的段（`living/economy/adoption.ts:31-73,85-106`）。任一成立而库缺失，就拒绝钱包，不建空库、不导入旧菜园，免费照料照常；钱包目录和 `data/living/` 同时丢失时，迁移日志这一条仍然挡住重建。日志缺失或损坏按没有这条证据处理，不影响工作区；所以钱包目录、`data/living/` 和迁移日志三处同时丢失或损坏时，运行时认不出曾经采用过，这是已知边界。证据文件内容坏了只拒绝钱包，工作区清单只看文件在不在。独立证据已落盘、库还没提交时拒绝自动补建，钱包能力状态行 `life.economy` 给出证据路径和处理办法 |
| Core 数据库：`native-memory-view / native-memory-action` | 第一层（只保留） | 无：旧版本写入，当前 `src/` 不读不写 | 原样保留，是否清理另议；登记后盘点不再报未知 kind |
| Mnemosyne 记忆库 `data/memory/data/memory.db` 等 | 第一层·记忆 | Mnemosyne 服务、Pet 接口 | 不变 |
| 情绪 `data/emotion/state.json`；近期账本 `.chatpet/data/memory/recent-interactions.sqlite`（`src/emotion/recent.ts:11-17,47-56`） | 第一层·情绪 | Emotion | Core 显式初始化当前情绪文件，Emotion 登记并写近期账本；近期账本在 Memory 目录，业务拥有者仍是 Emotion |
| 共享 home 会话身份记录：`core.sqlite` 的 `companion-home` 记录（`{sessionId, arrivalPending?}`，按 `storageId` 一条） | 第一层·身份与绑定 | Core | 共享 home 身份和待交接标记归第一层，Core 按绑定写 `companion-home`（`core/workspace.ts:156-169`）。前台和计划区建 home 都走同一个串行入口 `ensureCompanionHomeSession`（`core/companion-foundation.ts:88-108`），先写 Core 再返回 |
| 身体检查点 | 第二层·身体区 | Body | 已有 `data/life/home.json` 的绑定继续使用该目录，其余绑定使用 `data/behavior/`。钱包首次采用使用同一检查点目录中的菜园文件（`src/living/body/plugin.ts:180–196`、`src/living/economy/adoption.ts`） |
| 未采用 Economy 的菜园 `garden.json` | 第二层·生活世界 | Body | 首次采用时由 Economy 在建库事务里接收当前菜园。已采用的存档从钱包读写 |
| 钱包背包 `data/economy/*` | 第二层·钱包区 | Economy | 不变；只用 `mode=rw` 打开已存在的库，库存在就必须有同绑定的库内标记，空壳库拒绝。`console_wallet_requests` 保存 Console 原请求号和规范指纹，待办保留重试所需输入，结清后清除输入。余额、配置和库存仍由原交易、库存回执和 Body 检查点证明。查证读原号，显式重试续做，存在待办时拒绝新的 Console 钱包写入 |
| `data/life/control.json`、`life.json`（计划部分）、`data/life/life/wakes.jsonl`、`activity/*`、`compactions.jsonl` | 第二层·计划区 | Life | 计划区独占 `life.json` 的 home ID 镜像和待迎接 `greeting`（上游运行时要读，经 `living/plan/home-store.ts:12-57,63-76` 包装的 store 访问，以 Core 记录为准）。Core 置了 `arrivalPending` 时，计划区先把迎接写盘，再请 Core 清除这个标记；交接以镜像落盘为准，计划区不在时标记留着，下次装载时补交接（`living/plan/plugin.ts:193-213`）。记录库的日期、日记和搜索按当前存储绑定读取第二层登记的只读活动接口（`core/records.ts:103-132`、`living/plan/activity-reader.ts:17-43`）。任一区对 Core 可见时可读历史活动，三区都缺席时日期和正文由日记提供。活动目录已登记但为空时查询返回空结果；登记目录缺失时拒绝读旧绑定。`control.json` 的可选字段 `pauses`（暂停区间 `{from, to|null}` 的有序列表，缺省等于没有区间记录、沿用旧开关）只由 Life 改开关时维护，按 Economy 已提交的菜园时钟清理已经扣过的区间；Body、Economy 推进菜园时只读它，Life 服务不在时用 `living/plan/control-file.ts:25-51` 的 `readLifeControl` 读 |
| 日记、自述、历史 | 第一层·记录库 | 主人设置、DSH 原生 `write/edit` 工具、Life 回顾复制 | **唯一写入协议待定**：原生工具仍可直接写文件，需要决定经记录库守卫还是保留现状；路径为 `.chatpet/{self.md, self.history/, diary/}` |
| 相册 `data/core/photos/album.sqlite` | 第一层·记录库 | Core 和 Life 通过记录库写入 | Core 的带前缀相册工具与 Life 的原生相册使用同一个受限句柄，提供 `keep`、`list`、`forget`（`core/records.ts:24-35`）。会话门控见 5.8.3。 |
| 原生会话副本 `data/core/native-sessions/*` | 第一层 | NativeTranscripts | 不变 |
| Desktop 待办 `data/desktop/*` | 第三层·Desktop | Desktop | 沿用原写入协议 |
| 图片 `data/desktop/images/*`、`data/room/images/*` | 第三层·Desktop、Room 各拥有自己的目录 | `desktop/images.ts`、`room/images.ts` | 复用原生附件准入和原子副本流程（5.4），各拥有人按当前绑定读写 |
| `data/pet-platform/*` | 第三层·PetPlatform | Core 初始化与 PetPlatform | 现行外观和表现设置读写 `main-config.jsonc` |
| `data/channels/*`；profile 下连接设置、令牌、语音缓存 | 第三层·Channels / Voice | Channels、Voice | 渠道策略和群资料归绑定 Repo，连接设置与凭据归设备，语音缓存归 Voice |
| 浏览器 localStorage 的 `home-*` | 第三层·Room | Room 前端 | Room 本地界面状态 |

下面两类文件不进 `storage.json`，盘点把它们列在 `differences.extra` 里属于预期。它们只在部分安装里存在，登进去会让没有它们的安装报「缺失」：

- `.chatpet/.gitignore`：安装脚本搬迁存储时追加 `/data/`，让 Git 忽略个人数据（`scripts/lib/repo-storage.mjs:259-264`）。不归业务模块。
- `.chatpet/migrations/`：主人安装里一次性导入旧伙伴时留下的原始存档。只读，不归任何模块。

<a id="llm-storage-plan"></a>

<a id="41-计划用量账本的拥有者"></a>

### 4.1 用量账本的拥有者

Core 在根作用域监听 `llm/stream`，按结束日记录当前伙伴的调用。账本采用独立 SQLite 文件，目录只读时聊天仍可使用 Core 数据库。首次写入在同一事务里建立格式版本、索引和首行，设置页只读打开。文件路径和 Core 漏记 kind 见[存储登记](../arch/storage.json)。写失败、未绑定及调用途中换绑的次数由该伙伴的 CoreStore 按结束日合存一条记录。

账本只保存时间、标识、结局和原始用量。`requested_effort` 表示请求的推理强度。花费按开始时刻匹配[版本价表](../src/world/usage.ts)及峰谷时段。读取到较新版本时提示升级。写入遇到 SQLite 明确报告的损坏时留档原库，重新建账。独立个体新增和改变拥有者的数据见[10.8](#individual-ownership)。

<a id="room-extension-storage"></a>

### 4.2 计划：空间重做的拥有者

已有身体、计划、菜园、Room 图片和前端偏好的物理路径按[存储登记](../arch/storage.json)，代码接管不搬这些数据。身体当前按绑定选择既有 `.chatpet/data/life/home.json`，其余绑定用 `.chatpet/data/behavior/home.json`（`living/body/plugin.ts:180–190`）。未采用钱包时还有身体检查点旁的 `garden.json`，采用后以 Economy 的库和采用凭证为准（`living/body/room.ts:168–214`、`arch/storage.json:39–44,50,54`）。布局统一由空间区持有，独立于身体高频检查点和临时前端偏好。1b 登记布局存储和版本。

| 数据 | 拟负责的拥有者和写入方式 | 消费者 |
| --- | --- | --- |
| `.chatpet/data/behavior/layout.json` | 第二层空间区独占。文件含版本号、修订号、地区、结构、家具实例和近期命令回执。新绑定显式初始化，旧绑定走[布局迁移](#room-extension-migration)，编辑走下述命令。 | Body、Plan 和 Room 读快照或解析结果。 |
| 默认布局、地区和家具语义、旧站位别名 | 第二层空间区随包发布。默认布局以模板 `HOME_LAYOUT`、禁行区和场景几何为输入，1b 验等价；导航数据从布局重建。 | 计划和状态投影、导航、场景生成和编辑。 |
| 外观映射与资产清单 | 第三层 Room 随包发布。家具按种类选择手写几何或资产，同一类只登记一种外观。清单记录文件、哈希、大小、面数、贴图预算、许可及批准来源。 | Room 场景、照片和构建校验。 |

布局命令携带请求 ID 和期望修订号。第二层在同一实例串行读取当前身体状态、校验、写布局，期间不推进身体。检查限定区域、墙门、家具重叠、角色占位，以及从门口和角色当前位置到其他交互点的连通性。首版拒绝影响当前路线或离开路线的编辑，也拒绝仍被身体依附或被路线、当前／暂停计划、排队园艺操作引用的家具，活动结束后仍坐着也算在用。

布局和回执同次原子提交。回执含请求 ID、输入摘要和结果修订号。同一请求重试时先查回执，输入一致则返回原结果，改了输入则拒绝；新请求才比对期望修订号。坏档和未知新版本按[产品规则](product.md#特殊情况)处理。

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

四样契约的类型在 `contracts/living.ts`，由仓内入口共享，挂在现有的三个生活服务上。

- **世界快照** `WorldSnapshot`：`petBehavior.worldSnapshot(workspaceId)` 为主入口，`petEconomy.worldSnapshot` 委托同一实现，只挂 Economy 时也能读钱包、身体部分为 `{available:false}`。内容是身体投影（`BehaviorSnapshot`）加钱包只读视图 `WalletView`（余额、库存、持有读物和书签），返回独立副本。
- **命令** `WorldCommands`：照料（`petBehavior`）、执行计划步骤和阅读确认（`petLife`）、购买和出售（`petEconomy`），各门面的 `worldCommands` 只挂本区的命令；每条带请求 ID，复用原入口的准入、绑定复核和去重。错误语义沿用 `ContractError`：`effect` 有三种（`none / partial / unknown`），`retry` 有四种（`never / refresh / same_request / reconcile`）。
- **事实流**：`CompanionFactSource`，`petBehavior.worldFacts` 聚合身体和钱包的事实。事实的准备、验证、确认在第二层的 `living/prompt-context.ts`，仍在 Core 的原生作用域登记两段、调用第一层的 `acknowledgePromptFacts`；「原生日志落盘之后才确认事实」的顺序不变，确认前复核绑定、三区租约和准备结果。
- **变更信号**：`world.changed` 携带 `workspaceId/storageId` 和 `homeScope()` 的 `bootId/generation`。三区可见状态变化、首次绑定和切换绑定时发，同一微任务内按绑定代次合并，出队时复核原绑定与产出区租约。Room 按代次刷新，IPC 继续使用 Body 的 `bootId/revision` 拦住落后画面；仅 Body 变化的通知可由已覆盖的快照吸收。此事件只通知刷新，Cordis 的 `emit` 不等待订阅者或返回业务回执。
- Channels 按同一绑定代次刷新适配器。Plan 的 home 写入、启动、暂停和卸载都进入同一通知流。Channels 用按 Cordis 隔离标签查询的运行中 home 窄口；Bridge 整理通过 Memory 的压缩登记判断是否有待办。
- **生活出口**：`living/outlets.ts` 的 `registerLifeOutlet`。Desktop 登记暂停、恢复、呈现，Channels 登记主动消息送达，各自在入口登记、卸载时撤销；Life 在启动、休息和通知时用 `lookupLifeOutlet` 按租约取当前的出口，没有登记就跳过，和原来缺服务时一样。呈现出错时记原样警告，照样试 Channels。登记复用 `RegistrationTable`，按提供方的隔离标签区分。
- **启用意图读口**：同一文件的 `readLifeEnabled`，Desktop 判断「Life 是否接管自主」时读它：有 Plan 时读持久的生活开关（`bodyClockState`），读不到再看 Plan 是否在运行；没有 Plan 就当作未接管，桌宠恢复自主，`control.json` 不变。

### 5.3 第三层对外

几乎没有，只往下登记：能力状态行、提示词与历史投影、来源适配、生活出口、运维操作。别的模块不读它。

### 5.4 同层共用物

| 共用物 | 现在 | 新 |
| --- | --- | --- |
| 图片准入与便携副本 | `presentation/images.ts` | Desktop 和 Room 各自执行磁盘操作。桌宠保留 1 MiB 编码上限，Room 电视帧保留 2.5 MiB 原始字节上限，房间照片与附件副本按 Room 编码上限校验 |
| 活动播放 | `presentation/playback.ts` 映射素材并采样，素材索引和分配也由该目录管理 | Room、桌宠、拍照和 Console 在回包边界附上原有 `home.playback`，共享活动身份和时间 |
| Room 传输 | `presentation/room-transport.ts` 声明九个端点、超时和只读拍照子集 | 构建生成原生窗口与 Console 使用的子集；浏览器和拍照通过现有 Room 路径加载。各入口保留自己的身份和窗口准入 |
| **语音**（Desktop、Room、Channels 都用） | 通过 2.2 的语音调用表获得 `contracts/voice.ts` 接口。`70-Voice` 用 `petVoice` 作为调用表的隔离键，缺识别能力时仍可合成。 | 语音实现放在 `dist/src/voice/upstream/host/`。识别和合成各自共享一份登记表。 |
| 房间模型 `CompanionRoom` | `living/body/room.ts`，属第二层·身体区 | Room 只读快照 |

### 5.5 控制台

Console 通过运维操作表调用同层拥有者，通过第二层快照和第一层服务组装设置视图。旧 Connection 端点名继续可用，拥有者缺席时返回不可用。入口统一核对 owner、请求号、绑定和取消。设置错误沿用 `code/message/details`，有契约错误时保留 `effect/retry`。

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

第一批（动作、行为、活动、阶段、命令、事实）见 5.6.1。阶段 3 开工时交付了第二批概念表（`6dd3e4c:docs/plans/stage3-presentation.md:299–310`），涉及表情与贴纸、情绪、槽位与素材的现行边界见 [5.7](#57-动作与行为)，各项取舍见[长期有效的规则](decisions.md#2026-11-23-阶段-3-拍板中长期有效的规则)。

#### 5.6.1 第一批概念细表

第一批（动作、行为、活动、阶段、命令、事实）在阶段 2b 已收成各自一份声明，行号按 2b 收尾时的代码。声明大多由取值表派生数组、类型和守卫。阶段 3 扩面后的词表扫描范围见 [R8](#3-依赖规则和自动检查)。

##### 动作 `action`

| 定义处 | 取值 | 转换点及损失 | 同名不同义 |
| --- | --- | --- | --- |
| 六种照料动作，1 份。`contracts/behavior.ts:10-21` 基础表的 `care` 标记（带序号和按钮文案）派生 `CARE_ACTIONS` 和守卫 `isCareAction`（`:44,49-51`） | `feed / water / pet / play / sleep / wake`（按钮顺序） | Console → `life.act` → `behavior.act` → `roomAction({action}, …)`，动作值沿用，补请求标识及主人身份。设置页、Life `act`、World `care`、Body `act` 四个入口各自调用 `isCareAction`，报错各自保留（`living/plan/plugin.ts:687-690,765-770`、`living/body/plugin.ts:324,360-362`）。设置页按钮按 `lifeView.careActions` 渲染（`console/settings.ts:271-274`、`console/client.js:656`）。 | 这是简化照料入口。`pet` 在此集合内，计划身体动作集没有 `pet`。Desktop 自己开放的 `sleep / wake / pet` 是桌宠入口的子集，只受 `CareAction` 类型约束（`desktop/platform/plugin.ts:631`、`desktop/features.ts:165-166`）。 |
| 十种角色房间动作，1 份。基础表的 `role` 序号派生 `ROLE_ACTIONS`（`contracts/behavior.ts:45`），用于 `room_action` 枚举和 Body 角色白名单（`room/plugin.ts:122`、`living/body/room.ts:85,995-1003`） | `command / pet / poke / feed / water / play / talk / sleep / wake / lamp` | 工具传动作和参数，Body 再按上游 `HOME_ACTIONS` 和角色白名单核验。`talk` 文本修剪为最多 120 字符后传给实际动作（`living/body/room.ts:992-1003,1022-1032`）。 | 上游 `HOME_ACTIONS` 另含 `visit / go / place / sick / heal`（`vendor/feiyu-room-template/home-state.js:23-25`）。 |
| 五种计划身体动作，1 份。基础表的 `plan` 序号派生 `PlanBodyAction`、`PLAN_BODY_ACTIONS` 和 `isPlanBodyAction`（`contracts/behavior.ts:46,53-55`），用于计划类型、计划 schema、Life 校验和 Body 校验（`contracts/behavior.ts:112`、`living/plan/plan-tools.ts:104`、`living/plan/plan.ts:95`、`living/body/room.ts:612`） | `sleep / wake / water / feed / play` | `LifeStep.action` 经 `PlannedActivity` 转到上游 `applyHomeAction`。执行器按原回执处理，计划中的 `feed` 是免费基础餐食（`living/plan/plan.ts:397-400`、`living/body/room.ts:529-547`、`living/plan/plan-tools.ts:103`）。Life 草稿校验用 `String(value.action)` 比对，非字符串的 `['feed']` 也会被接受并原样保留；工具 schema 只收字符串（`living/plan/plan.ts:94-97`、`living/plan/plan-tools.ts:101-104`，2B1-04 固定）。 | 库存 `feed` 从经济入口转为 `consumeFood`。身体存档写 `catalog-food`，互动事实仍可用 `type:'feed'`（`living/economy/plugin.ts:264-272`、`living/body/room.ts:454-465`）。 |
| 表达意图、呈现分类及桌面素材。`emotion/index.ts:7-10,32-47`、`contracts/behavior.ts:35-39`、`desktop/platform/plugin.ts:671-690` | footer `action` 是目录名字符串。`BehaviorPresentation.action` 是 `sleep / walk / activity / expression / emotion/...` 等分类。桌面选择素材用名称或 URL。 | Emotion 按目录保留可识别的动作，未知动作不进入事件。Body 把状态和表情投影成展示分类。Desktop 的特定睡眠、起床、吃饭素材转换为 `sleep / wake / feed`，命令不带原素材选择（`emotion/index.ts:54-64`、`living/body/presentation.ts:12-23`、`desktop/platform/plugin.ts:671-689`）。「睡觉-起来」默认只出现在睡觉序列的 `sleep.end` 里，不在动画池中，所以 `/anim` 默认返回 `unknown-animation`；配置把它加进动画池后，才会派发 `wake`（`vendor/dsh-pet/platform/assets/config.jsonc:387-392`、`desktop/platform/plugin.ts:681-682`，2B1-08 固定）。 | 同名 `action` 分别可能是身体命令、表达选择、素材名或展示分类。 |

**拥有者**沿用 5.6，身体命令属第二层、表达意图属第一层、素材 ID 与桌面命令属第三层。**统一方式**沿用 `BodyAction / PresentationIntent / ExpressionAssetId / DesktopCommand` 及基础词表派生的结论。现行 `BehaviorPresentation.action` 仍归在第二层契约里且为裸 `string`（5.6 总表、`contracts/behavior.ts:35-39`）。

##### 行为（身体状态）

| 定义处 | 取值 | 转换点及损失 | 同名不同义 |
| --- | --- | --- | --- |
| `living/body/room.ts:89-90,105-115`、`vendor/feiyu-room-template/home-state.js:489,1704-1722` | 上游 JS 状态，本地 `state:any`。含路线、停留、睡眠、身体需要和 `kind`。 | 上游 `homeView` 将持久状态投影为当前画面，位置按当前时间求值。Body 公布的 `home` 保留 `any`，另提供原精度 `needs`（`BehaviorSnapshot.needs`，以 `BodyMetric` 为键）。 | `her.kind` 描述此刻身体状态，`PlannedActivity.kind` 描述要执行的操作类别。 |
| `BehaviorActivity`（`contracts/behavior.ts`）及吃饭准入 `feedAdmission`（`living/body/activity.ts`） | `activityId`、开放 `kind`、`BodyPhase`、`busy`、`interruptibility.feed`，附呈现和阅读提示。 | Body 的 `publicBehavior(her)` 给快照和公开回执组装同一份投影。发起吃饭由 Body 在串行队列中用同一规则重新判断。 | 睡眠、移动与忙碌拒绝新投喂。正在吃饭时允许重复播放。空闲且符合原插入条件时允许开始。呈现分类器另负责选择画面。 |

**拥有者是第二层。** 桌宠投喂按 Body 的目标动作准入，体现在上表的 `behavior.interruptibility.feed` 及串行判断。既有 `home` 的播放形状由呈现适配补齐（`tests/behavior-list/presentation-r7.test.mjs:291–314,336–486`、`src/presentation/playback.ts:151–153`）。

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
| `ActivityClip.mode`、`ActivityPlayback.phase`（`presentation/playback.ts`），工作区 `Binding.phase`（`core/workspace.ts:45`） | 播放 `loop / once / static`。播放描述另带身体阶段字符串。绑定 `ready / inactive`。 | 播放描述复制身体阶段并按片段次序、一次性动作和素材可用性选 `mode`。模式不携带业务完成信息。解绑写 `inactive`，公共状态另投影为 `unbound/pending/...`（`presentation/playback.ts:sampleActivityPlayback`、`core/workspace.ts:142,435-437,464,585-603`）。 | `ActivityPlayback.phase` 和 clip `mode` 是两个字段。绑定阶段和前两套状态机独立。 |

**拥有者**第二层身体与执行、第三层播放、第一层绑定。**统一方式**：`BodyPhase / ExecutionPhase` 已各自命名，有损转换集中在 `bodyPhaseOf`。`ActivityClip` 和 `ActivityPlayback` 由第三层定义（`presentation/playback.ts`），播放 `phase` 沿用兼容回包里的字符串。

##### 命令与请求

| 定义处 | 取值 | 转换点及损失 | 同名不同义 |
| --- | --- | --- | --- |
| 七种计划 `kind`，1 份。`PLAN_KINDS` 表（`contracts/behavior.ts:57-65`）带 `target`（要指定房间位置）和 `executable`（依据真实回执结束、不接受时长）两项属性，派生 `PlanKind` 和守卫 `isPlanKind` | `hold / room / move / garden / body / economy / read` | 工具 schema 由 `Record<PlanKind, 分支>` 生成（`living/plan/plan-tools.ts:66-104`），注册结果与 2b 前逐字节相同；Life 草稿校验和 Body 执行校验各有一张 `Record<PlanKind, 校验函数>`（`living/plan/plan.ts:74`、`living/body/room.ts:78`），每一步只判断一次 kind，报错文案和先后不变。Life 用 `String(value.kind)` 宽松准入，数组形式的 kind 会被放行并跳过位置校验（2B1-04 固定）。 | `room` 是到目标后持续活动，`move` 是到达即结束，`hold` 是原地持续。 |
| 阅读状态，1 份。`READING_STATES`（`contracts/behavior.ts:100`）派生 `ReadingState`；Economy 存储行用 `Exclude<ReadingState,'unread'>`（`living/economy/store.ts:362`） | `unread / offered / confirmed`。存储行只含 `offered / confirmed`，无行时合成 `unread`。 | 取文生成耐久 `receiptToken`，确认推进原内容版本的书签。Body 根据状态投影 `read/reading-wait`，不携带正文、token 或书签偏移。确认会同步完成执行并清掉阅读投影，公开快照从 `offered` 直接回到空闲；`confirmed` 的呈现分支在公开路径上走不到（2B1-06 固定）。 | `confirmed` 是原文字片段的回执，不表示读懂。`reading-wait` 是呈现类别。 |
| 计划控制与经济操作。计划经济操作 `PLAN_ECONOMY_OPERATIONS`、计划菜园操作 `PLAN_GARDEN_OPERATIONS`（`contracts/behavior.ts:73-98`，菜园表记每个操作所属的 schema 分支和分支内序号）；计划控制在 `living/plan/plan-tools.ts`、`living/plan/plan.ts`；主人经济在 `living/economy/plugin.ts`；Room 菜园工具在 `room/plugin.ts` | 计划控制 `pause / resume / cancel`。计划经济 `buy / sell / consume`。主人经济 `buy / sell / grant / gift / importReading / feed`。Room 菜园另有 `state / visit / careNow / auto / till / plant / water / fertilize / harvest / sell / buySeed / buyCompost`。 | 计划经济按 `operationId` 调用购买、出售或库存食用。直接主人操作保留请求和来源，投喂转为稳定身体执行编号（`living/economy/plugin.ts:162-173,233-277`、`living/body/room.ts:417-465`）。 | `cancel` 可指持久计划、菜园作业或原生对话。`feed` 可指基础照料或库存餐食（`living/body/room.ts:873-879,1071-1081`、`living/plan/plugin.ts:386-398`、`living/economy/plugin.ts:264-272`）。 |
| 请求身份。`core/authority.ts:9-29`、`console/settings.ts:105-132,236-265`、`room/plugin.ts:87-121`、`living/body/room.ts:1004-1012` | Core `RequestContext`、入口 `requestId`、领域 `operationId`、版本 `expectedRevision` 分别承担授权、去重、执行关联、并发控制。 | Core 从宿主授权能力签发请求上下文。Room 用绑定、入口、请求号生成去重键，Body 对同键核对输入和 actor 指纹，重复请求返回原事实（`core/authority.ts:12-28`、`room/plugin.ts:86-95`、`living/body/room.ts:1004-1012`）。Economy 重试则从 `requests.result` 返回首次事务的视图，不返回原事实；事实只在首次事务里写入（`living/economy/store.ts:182-187`，2B1-09 固定）。 | DSH `rpcId` 是会话投递去重键，和身体执行编号分开（`desktop/conversation.ts:171-182`、`room/chat.ts:164-172`）。 |

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
- **身体状态契约。** Body 统一组装 `behavior.busy`、当前活动与阶段，并以 `behavior.interruptibility.feed` 说明目标为吃饭时可开始、已呈现或拒绝。桌宠吃饭入口在 Body 串行执行中复核请求绑定、取消、呈现准入和原编号。已提交的同号请求返回原回执。
- **表现意图。** `living/body/presentation.ts` 的 `classifyActivity` 从活动、阶段和情绪派生两端共用的意图。休息按 `anger`、`boredom`、其余声明顺序选择情绪，保留输入次序和自由文字。触摸继续依据有效的主人互动和单一已知情绪。
- **语义许可。** `living/body/animation-slots.ts` 用现有活动许可规则校验 `presentationSlot`。构建从同一份素材分配生成槽 ID 集合和第三层的素材索引，第二层只读取槽 ID。

**第三层拥有**：

- **素材分配**包含槽位到素材和 `roomClip / desktopClip` 的映射、组合、采样及播放回执。`ActivityClip`、`ActivityPlayback` 在第三层共用代码中（`src/presentation/playback.ts:4–17,34–36,151–158`、`src/presentation/animation-map.ts:3–6`）。
- **表情素材目录**：由桌宠平台登记，ID 与 label 的转换留在平台。
- **兼容行为留在适配边界**：Desktop 选了睡觉、起床、吃饭的素材就触发真实的 `sleep / wake / feed`（`desktop/platform/plugin.ts:681、686`），这是已有行为，明确写在适配层，不当成呈现端的业务逻辑。

**表情是独立的一条线**：第一层产出表达意图和事件，第三层登记素材并转换 ID，在「表现意图」里与活动合并。

**保持不变**：序列化字段和外部名称；九种 feeling 与七维 Room 数值的区别；上游素材 ID、文件名和兼容别名。**不做**：全仓统一的 `Action / Phase / Status` 枚举；素材和存档的重命名。

### 5.8 会话策略表

运行时来源适配表负责准入与授权。下面的会话策略表记录各模块应保持的行为，按来源记录选择、生命周期及授权，按会话身份另记历史和组装。来源行记录：

- 来源与可信 actor；
- 会话选择键（工作区、渠道、scope）、共享历史范围、预设如何选；
- 工具权限、可读写的数据；
- **自动观察权，记忆和情绪分开写**：工具权限、记忆观察、情绪更新是三个独立的授权面，每行必须分别声明；
- 取消、归档、恢复、owner 接管的行为；
- 绑定代次。

会话种类：普通 owner 会话、共享 home、Life 自主轮次、回顾轮次、渠道里的主人私聊、guest 私聊或群聊、Desktop 聊天、Room 私聊与电视观看、Desktop 碎碎念与梦话（没有原生会话，也要写出来）。每行的内容来自对现有源码的盘点，**不由适配器的回调隐含**；M2 起每一行由下面「登记者」表里的模块声明，下面的表就是登记要保持的行为。

5.8.1–5.8.5 记现行行为。登记声明的 `SessionPolicyRow` 覆盖选择、预设、授权和生命周期，由 `policyRows()` 汇总；5.8.4 的历史和组装两列是文档契约（`src/contracts/tables.ts:60–73,101–111`、`src/core/tables/sources.ts:102–106`）。准入、工具策略、记忆观察和情绪更新的现行代码以登记处为准。「测试」只算 `pnpm run verify` 会跑的测试；`scripts/checks/check-native-*.mjs` 是门禁外的手动检查，单独标出，不算有测试。每格由哪些测试覆盖，以 `tests/behavior-list/index.json` 的 `policyCells` 为准，`tests/behavior-list/index.test.mjs` 检查 5.8.2–5.8.4 每一格至少有一条非 L3 条目；表里「见行为清单」后的编号是其中的条目。

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
| 记忆作用域 `MemoryScope` | `memory/client.ts:11` | `{companionId, scopeId, bankId}`，`bankId` 取绑定的 `storageId`（`core/native/memory.ts:53`） | 启动参数与 HTTP scope 都传 `bankId`；provider 在持久化边界使用既有 `pet_scope.workspaceId`（`src/memory/client.ts:38–67`、`src/memory/main.py:22–36`、`src/memory/provider.py:21–28`） |
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
| 6 | guest 私聊或群聊 | 预设屏蔽所有继承工具（`channels/guest.ts:13`）；`pet_memory_*`、`pet_emotion_update` 不对 guest 登记（`core/native/agent.ts:187-195`、`emotion/plugin.ts:206-222`）；自主工具校验拒绝 guest（`core/native/conversation.ts:306-309,324-331`）；看不到主人档案和私有环境事实（`core/native/agent.ts:163-170`、`core/companion-foundation.ts:164-170`）。测试：`tests/behavior-list/families.test.mjs:19`（guest 调 Life 工具被拒）；私有事实不注入见 `tests/life/life-core-integration.test.ts:109`；预设屏蔽全部工具见行为清单 M2A-20（门禁外有 `scripts/checks/check-native-services.mjs:103-107`） | 召回同一个共享 Bank（`core/native/agent.ts:264-277`，作用域见 5.8.1）；输入记为 `external_content`、actor 是发言人，排进 Memory（`channels/sessions.ts:59-72`、`core/native/conversation.ts:149-187`）；回复归属记为 `external`（`channels/sessions.ts:72`、`core/native/conversation.ts:229-240`）；拒绝主人私有事实（`core/native/conversation.ts:202-203`）；不做历史投影（`core/native/agent.ts:125-136`）。测试：`tests/regressions/audit-r6-memory-scope.test.mjs:233`、`tests/life/life-memory-integration.test.ts:206`、`tests/life/autonomous-life.test.ts:231` | 禁止工具和 footer 写共享情绪；流处理剥离控制 footer。测试见 M2A-21、`tests/behavior-list/policy-qq.test.mjs` 和原生服务检查 |
| 7 | Desktop 聊天 | 同第 1 行。测试：见行为清单 M2A-09（第 1 行的测试不经过 Desktop 入口） | 同第 1 行；附带的图片在首步前恢复（`core/native/agent.ts:234-238`、`desktop/plugin.ts:53-57`）。测试：见行为清单 M2A-09 | 同第 1 行。测试：见行为清单 M2A-09 |
| 8 | Room 私聊与电视观看 | 私聊：同第 1 行，另加 Room 工具（`room/plugin.ts:165-169`）。电视：Room 守卫拒绝执行工具，仍受自主步数和时长上限。画面从准入到收尾期间隐藏 Core 相册，主人接管时也继续门控（`room/chat.ts:87-104,118-122,173-196`、`room/plugin.ts:174-185`）。测试：见行为清单 M2A-01、M2A-02、M2A-03（门禁外有 `scripts/checks/check-native-room.mjs`） | 私聊：同第 1 行。电视：画面输入记为 `virtual_action`、actor 是伙伴，排进 Memory（`room/chat.ts:99-104`、`core/native/conversation.ts:149-187`），完成的观后感也排进（`core/native/conversation.ts:229-249`）。测试：见行为清单 M2A-06 | 私聊：同第 1 行。电视守卫拒绝执行工具，回复 footer 无共享情绪写权限。测试见 M2A-01、M2A-07 和 `tests/behavior-list/policy-room.test.mjs` |
| 9 | Desktop 碎碎念与梦话 | 没有工具（`desktop/features.ts:219-229`）。测试：`tests/desktop/desktop-features.test.ts:24`（原生一次性调用） | 不读不写 Memory（`desktop/features.ts:202-206`）。测试：见行为清单 M2A-11 | 不读不写情绪，只发布 `say` 事件（`desktop/features.ts:230-233`）。测试：见行为清单 M2A-11 |

合格主人会话使用 Core 的 `pet_*` 相册。运行中的 Life home 在主人接管后仍使用 Life 的无前缀相册，暂停或卸载 Life 后恢复 Core 相册。Core 的 schema 与执行共用登记判定，执行时复核同一相册和原生会话（`core/plugin.ts:41-48`、`core/album-tools.ts:20-30`、`living/plan/plugin.ts:143-159,739-746`）。测试见 `tests/behavior-list/policy-life.test.mjs:168,190` 和 `tests/behavior-list/policy-room.test.mjs:104-126`。

#### 5.8.4 会话策略表：按会话身份的历史策略和组装方案

5.8.2、5.8.3 按来源分行，回答「这一轮能做什么」；这张表按会话身份分行，回答「这条历史怎么留、每轮带什么」。同一个会话里可能先后来过主人、Life、回顾、渠道主人四种输入，它们共用一条历史，所以历史策略跟着会话走，不跟着来源走。Life、回顾、渠道主人私聊现在共用 home，Bridge 也用同一个 `ownerHome` 打开器（`src/channels/plugin.ts:52–62`）。预设见 5.8.2，后续计划见 5.8.7。

绑定内的原生会话共用以下策略。资料不可用、来源限制等情形按 5.8.3 和 5.9 处理：

- **召回**按照 5.9.2 的首步和请求写入顺序准备。压缩成功结束只标记召回状态，下一个符合条件的首步再查询并替换（`core/native/agent.ts:294`、`core/native/recall.ts:22-25`）。
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

#### 5.8.5 来源授权与绑定

回复中的控制 footer 在流处理中剥离。轮次完成时复核实际准入来源、绑定和登记租约。同轮有来源拒绝写共享情绪时，该轮不能借用另一个来源的授权。电视画面仍按第 8 行的记忆观察规则持久化。多来源和绑定代次边界见 `src/core/native/conversation.ts:109–125`、`src/emotion/plugin.ts:282–299` 与第 3 节。

<a id="llm-usage-current"></a>

#### 5.8.6 用量、独立调用和渠道收件现状

本节的 DSH 接口依据仓库锁定的开发依赖 `0.2.2-rc.1`，安装兼容范围见 `package.json:81–84,123–138`。目标宿主实际装载情况见[待核项](#llm-host-verification)。

| 接点 | 现状 |
| --- | --- |
| Life 预算与渠道统计 | Life 从共享 home 的 `assistant/message` 累计估价，达到日预算提醒一次，可进入当前回合后续步骤或触发提醒轮次。渠道主人私聊可能与该累计重叠。渠道只计已核验的渠道输入，处理 `assistant/message` 和 `assistant/attempt`，按会话事件去重并记录缺报。独立 Desktop、Room、碎碎念没经过这两条统计路径（`vendor/dsh-world/lib/life/runtime.js:954–975,1043–1052`、`vendor/dsh-world/lib/life/pricing.js:1–30`、`src/channels/usage.ts:8–35`、`src/desktop/features.ts:198–232`、`src/room/chat.ts:131–137`）。 |
| 用量归因 | 已准入分支与发送方登记决定本步入口。辅助调用沿用在途步骤，无在途步骤时归后台整理。预设取调用开始时的组合预设，碎碎念和梦话通过用途识别。Desktop 或 Room 消息跨重启排队时会丢失内存中的发送方证据，准入后归到 DSH 原生。 |
| 流与用量 | 锁定包的 `llm/stream` 在适配器流外。已报告的输入可由未命中、缓存读、缓存写相加，输出另计。会话事件可供旧口径对账。适配器内另发网络请求时，流级观测未必能分解失败及重试的账单（`node_modules/@deepseek-ai/dsh-llm/lib/index.js:2396–2403`、`node_modules/@deepseek-ai/dsh-llm/lib/types/types.d.ts:160–180`、`src/channels/usage.ts:23–34`）。 |
| 模型选择 | 预设用于选插件组合，Her World 的 home 与 guest 选择见 5.8.2。锁定包的会话模型选择把服务商、模型和推理强度写入 `model/selection`，切换提示取决于作用域装载的中间件。独立调用可直接传服务商、模型、推理强度、用途和取消信号，会话 ID 可省。碎碎念和梦话已复用该入口并限制时长（`node_modules/@deepseek-ai/dsh-agent/lib/types/model-selection.js:75–92,116–138`、`node_modules/@deepseek-ai/dsh-llm/lib/types/types.d.ts:538–580`、`src/core/companion-foundation.ts:124–129`、`src/channels/guest.ts:5–22`、`src/desktop/features.ts:198–232`）。 |

<a id="llm-channel-current"></a>

- QQ 现有收件箱是原消息与准入的回执检查点。输入可忽略或排队成批，批次的 `unknown` 按原会话凭证核对，只有确认缺失才写回 `queued`。准入的收据没有回复已送达的语义。微信使用自己的收据（`src/channels/qq-inbox.ts:10–28,36–45,50–96,110–147`、`src/channels/messaging.ts:160–177`）。
- QQ 批处理传入 `batchQuietMs`，该接点未传最长等待和优先级。现有自主限制、群唤醒限额、QQ 队列上限和自动回复设置仍决定准入（`src/core/options.ts:3–21`、`src/channels/group-social.ts:12–15,63–77`、`src/channels/qq.ts:156–164`、`src/channels/messaging-settings.ts:27–37`、`vendor/dsh-world/lib/adapters/qq-home.js:8–15`）。
- Body 在串行执行前复核绑定。续跑计划先核对原操作回执，确认过的效果缺回执时不重放，过期的绝对截止时间会拒绝执行（`src/living/body/plugin.ts:117–131,413–425`、`src/living/plan/plan.ts:398–421`）。

<a id="llm-session-plan"></a>

#### 5.8.7 计划：会话策略与触发

由独立个体取代：会话和预设见[10.3](#individual-presets)，注意力和四级消息见[10.4](#individual-attention)。实施时按实际变化更新 5.8.2–5.8.4。

### 5.9 上下文组装契约

**现状**沿用 `registerWorldPrompt`、`registerWorldContext` 和工具声明的 `historyOverview`。三层重构阶段 1 缩小后，逐段声明及校验和全局 `order` 唯一检查仍未实现。后续由独立个体按预设声明段，见[5.9.3](#llm-segment-plan)。现行组装顺序由契约测试保护（`src/core/native/prompt.ts:99–104,119–149,187–191`、`src/core/tables/tools.ts:18–25,54`、`tests/core/context-contracts.test.ts:24–94`）。

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

<a id="llm-request-current"></a>

#### 5.9.2 请求与召回的现行接点

- `agent/pre-step` 首步按当轮输入查询并在等待后复核作用域，召回插在新输入前，旧召回由 `agent/request` 在打开的请求里替换为空消息，锁定版 DSH 在模型消息中省略空系统消息。旧 Life 工具结果在空闲时准备，下次请求用位置替换和 `compaction/prune` 瘦身，保留原事件和工具配对。未知来源、回顾、接管、未完成轮次和最新轮次受保护（`src/core/native/agent.ts:125–139,173–185,264–309`、`src/core/native/recall.ts:26–44`、`src/core/native/history-maintenance.ts:35–58,66–115`、`tests/core/history-maintenance.test.ts:124–155`、`node_modules/@deepseek-ai/dsh-llm/lib/index.js:81–94`、`node_modules/@deepseek-ai/dsh-session/lib/index.js:206–229`）。
- Life 与回顾权限名单不同，入队时安装限制，主人接管可解除。首步会返回 `startsRequestSeries:true`，固定提示词变化也会标记新请求系列。工具变化经 DSH 按路由投影，新系列与工具变化的线上差异须分别测量（`src/living/plan/tool-policy.ts:11–33,49–73`、`src/core/native/agent.ts:104–115,246–253,287–289`、`src/core/native/prompt.ts:128,143–149`、`node_modules/@deepseek-ai/dsh-llm/lib/index.js:2332–2350`）。
- Memory 批处理核验摘要来源、Bank 和撤回状态后才接纳摘要，原生检查点仍留在会话日志。主动召回工具返回文本，撤回工具针对后续 Bank 召回。Bank 返回结构化条目及版本，Core 当前缓存投影文本并返回来源 ID；观察含 `actor_id`、`source_kind`，召回投影提供 `speakers`、`source_roles` 和归因证据。`native-visible-memories` 与 `native-visible-sources` 用来排除检查点内已可见的记忆及来源（`src/memory/batch.ts:32–81`、`src/core/native/conversation.ts:297–315,416–423`、`src/core/native/memory.ts:119–133,161–164,216–222`、`src/memory/client.ts:11–17`、`src/memory/provider.py:565–603`）。
- 现有假模型检查捕获模型接口的结构化参数，只配置了提示词的 `in-history` 模式。实际适配器的角色合并、工具更新和扩展字段须另捕获序列化请求。离线差异用于定位结构变化，实际用量和缓存代价由[大模型使用 1b](product.md#大模型使用-1b-观测和基线)测量（`scripts/checks/check-native-workspace.mjs:28–50`）。

<a id="llm-segment-plan"></a>

#### 5.9.3 计划：上下文段声明、人称与退休

由独立个体取代：段只挂在伙伴预设上并声明出现在哪些预设下（[10.3](#individual-presets)），想起的时刻和内容见[10.5](#individual-memory)；上下文组装契约在独立个体「想起」交付。

<a id="llm-host-verification"></a>

#### 5.9.4 目标宿主待核项

- 核对目标 DSH 版本、扩展、启用的预设、插件及额外段、实际模型路由、切换提示、`toolUpdate` 和序列化。用量验收查流的归因、适配器内部重发及可见的失败用量，按启用范围覆盖原生步间压缩、标题和自动审查。
- 核对裁剪、卸载、压缩、轮内后续步骤与重试的顺序，特别是没有 `compaction/end` 的改写、同轮撤回的可见性和上游已开始的摘要。上游请求场景以目标宿主捕获为准。
- 缓存保留、实际命中、扣费及执行时价表按所选模型和路由核实。具体查询能否选到已整理的跨会话记录、主人报告的人称错乱在哪一步出现、旧包能否读回新增投影及安全备份能否选择性找回，分别按对应单位的合成演练验证。

### 5.10 扩展：一处声明，其余派生

新增一个能力时要改的文件，由「一处声明」决定，其余由它派生，漏改能被检查发现：

| 要做的事 | 一处声明 | 派生出来的 |
| --- | --- | --- |
| 新增工具 | 工具定义旁声明 `sources`（没写的只给主人），需要历史瘦身时再声明 `historyOverview`，登记到工具声明表 `host.native.toolTable`（M2 已落地） | Life 和回顾名单、历史瘦身识别、来源适配的工具限制 |
| 新增输入来源 | 在模块里写一个来源适配器（准入、分支、`turnKind`、工具策略、记忆观察、情绪更新、历史投影、会话策略行），在入口登记到 `host.native.sourceTable`；新的 `source.kind` 在 DSH 的 `MessageSourceMap` 声明，新的工具来源用 `toolTable.registerSource` 登记（M2 已落地） | 入队和首步准入、工具限制、记忆观察、情绪 footer、历史投影、会话策略一行 |
| 新增上下文段 | 现行在模块入口用 `registerWorldPrompt` 登记（5.9） | 无；顺序、可见性由登记处自己写 |
| 新增伙伴设置项 | 便携字段的默认值和校验在 Core（`src/core/companion-settings.ts:6–43,54–76`） | 页面控件、保存键和实际消费仍分别接线（`src/console/client.js:1111`、`src/emotion/recent.ts:71–72`）。试做结果见[典型修改前后对比](product.md#典型修改前后对比) |
| 新增 QQ／微信设置项 | `channels/messaging-settings.ts` 声明可编辑字段并维护缺省值及校验 | Console 与生成的桌宠客户端从 Channels 的状态响应读取控件和保存键。Channels 按字段的设备归属落盘 |
| 新增设置页操作 | 拥有者声明校验和执行并登记到 `host.native.consoleOperations` | Console 用公开端点名映射到登记，入口统一管理准入和撤销 |
| 新增照料动作 | 第二层的 `BodyAction` 基础表（`contracts/behavior.ts:10`），每个动作在照料、角色、计划、反馈各集合里记序号 | 主人入口、角色工具枚举、计划类型与校验、计划 schema、设置页白名单和按钮（`lifeView.careActions`）。动作的执行和事实标签仍在 Body 里写 |
| 新增事实领域 | `contracts/interaction.ts` 的 `FACT_DOMAINS` | 读写类型、领域清单（Core 准入、World、Life、提示词段）。领域提供者要另写；Python 元组要跟着改，契约测试会失败提醒；上游 Life 的 `FactRef` 领域封闭、vendor 不能改，要经 Life 的回读适配 |

历次试做的最终判定见[典型修改前后对比](product.md#典型修改前后对比)。

#### 5.10.1 计划：会话、段与触发的扩展

见独立个体的[扩展路径](#individual-extension)。

<a id="room-extension-content"></a>

#### 5.10.2 计划：空间内容的扩展

| 要做的事 | 在哪里声明 | 派生出来的 |
| --- | --- | --- |
| 新增家具种类 | 第二层空间区声明占地、相对交互点及提供的活动；第三层 Room 增加外观映射和资产清单条目。 | 编辑候选、导航占地、可计划的交互点及构建校验。 |
| 摆放一件家具 | 主人经 Room 编辑命令在第二层布局存档增加或移动一条实例。 | 对象和热点、交互点 ID、导航重建。 |
| 新增活动 | 在第二层扩展 [5.7](#57-动作与行为) 的 `PlannedActivity → PlannedExecution → BehaviorActivity` 和语义许可，补时长及需求影响。 | 计划 schema、家具可引用的活动和呈现语义。身体动作继续由 `BodyAction` 表派生。 |
| 新增需求 | 第二层声明范围、变化速度、描述、满足它的活动及阈值触发。 | Body 状态投影、Life 规则与计划准入。判不了的信号按[产品阶段 5](product.md#阶段-5-需求和规则作息)调用第一层决策。 |
| 新增地区 | 第二层空间区声明网格大小、出入口、固定点和远景引用；第三层映射远景贴图。 | 地区场景、导航图和可选交互点。 |
| 新增商品 | 在第二层 `src/living/economy/catalog.ts` 所在的 Economy 目录维护商品声明；需要新交易语义时由 Economy 定种类、校验及效果。 | 目录、定价和消费能力，按 Economy 接口供工具和界面读取。当前种子和收获从 `CROPS` 派生，阅读品仍可由主人导入（`living/economy/catalog.ts:42–57`、`living/economy/plugin.ts:449–457`）。 |
| 新增玩法 | 第二层登记规则函数、工具声明并使用现有活动状态；第三层按玩法 ID 登记界面。 | 一局就是一次活动执行，开始、暂停、取消和恢复走现有协议。玩法自身只有规则和呈现，无独立生命周期、调度、写存储或模型调用。 |
| 新增外部内容家具 | 家具活动绑定已登记的输入来源，需新来源时沿用本节的来源适配。 | 工具、记忆观察和情绪由来源分别授权，历史由会话身份决定，见 [5.8](#58-会话策略表)。 |

---

<a id="6-兼容面和旧入口语义"></a>

## 6. 发行入口与生活入口

<a id="61-保持不变的清单"></a>

### 6.1 发行包和运行入口

- `her-world` 的默认 bundle 标识和编号入口由 DSH 装载，包根提供 Console，`./client` 是生成的浏览器入口。包内 patch 和本地化也随包交付，导出以 `package.json` 为准。
- Core 提供 `petCore`、`petWorld` 和 `petTranscripts`。Memory、Emotion、生活三区、Room、Desktop、PetPlatform 和 Channels 各自提供在 [模块登记](../arch/layers.json) 中声明的 Cordis 服务。
- Room、桌宠和 Channels 经 `host.native.voiceTable` 查询语音提供者；`70-Voice` 登记到该表，`petVoice` 是登记隔离键。
- Console 的日记、相册、搜索和照片撤回端点读写 Core 记录库。钱包动作和设置经 Economy 登记执行；持久请求的查证和重试沿用原号。
- Channels 的连接选择归设备，便携策略与公开群资料从绑定 Repo 读取。部署、回退和历史升级边界见第 7 节。

<a id="62-三个旧入口的语义"></a>

### 6.2 三个生活入口的装卸

三个生活入口各自装卸，共用一个常驻实例。同一服务名同时只由一个作用域提供。下表的行为测试 ID 可在 `tests/behavior-list/index.json` 查找。

| 操作 | 当前表现 | 异常与边界 | 证据测试 |
| --- | --- | --- | --- |
| 卸载 `40-Life` | **身体**：Behavior 仍接收显式操作，撤掉运行时自治准入并保存检查点。**计划与回顾**：撤销来源登记，停调度和回顾，若运行时已有 home 则向 DSH 取消该会话并等 Life 的投递收尾。**钱包背包菜园**：Economy 保留，已启用的作物时钟意图保留（`living/body/plugin.ts:85-114,361-364`、`living/body/room.ts:229-235,271-281`、`living/plan/plugin.ts:364-400,700-712`）。 | 取消对象是原生 home 会话，`close()` 调用的是无参的 `stopRuntime()`，不会调用计划 `pause/cancel` 或改写 `control.json`。正在执行的身体活动可留下原回执，`stopAutomatic` 跳过已接受的身体、菜园和计划工作。真实 `40-Life` 卸载时同时有原生轮次和在途持久计划：取消原生轮次，在途身体计划重挂后按原编号恢复（2A1A-11）。 | `tests/life/life-body.test.ts:217-221`（真实 Life 对象关闭后身体可用）<br>`tests/life/life-source-adapter.test.mjs:68-89`（关闭后拒绝尚未派发的回顾读写）<br>`tests/behavior/garden-clock-continuity.test.ts:114-131,138-141`（Cordis 撤掉 Life **服务替身**，原已启用作物时钟继续） |
| 显式暂停生活 | **身体**：先持久化 `enabled:false`，有 Body 时停止被动推进，显式照料仍可用。**计划与回顾**：匹配当前绑定时，主动暂停 `active/waiting` 计划，标记重启用时恢复，停止 Life 运行时和取消 home。**钱包背包菜园**：Economy 保持在线，手工经济和菜园操作仍可执行（`living/plan/plugin.ts:759-764`、`living/plan/plugin.ts:364-400,631-655`、`living/body/room.ts:237-270`、`living/economy/store.ts:473-479,501-509`）。 | 暂停先结算已启用区间，暂停区间不长作物，恢复只从新启用时继续。计划保留原 `operationId`，相对时长可冻结，绝对截止时间仍有效。如果已分配执行编号却无 Body，暂停该计划会报错，但开关已落盘，运行时仍走停止路径。暂停区间记在 `control.json` 的 `pauses`，菜园每次推进（Body 读取、照料、手工动作、旧 JSON，Economy 读取、动作、改配置）都按区间扣，所以暂停或恢复时 Body、Economy 不在场，暂停时间也不长；有区间记录时只按区间算，没有记录（旧存档）才沿用开关。区间文件无效时只有菜园报「生活开关文件无效」，身体照常（`living/plan/plugin.ts:618-655`、`living/plan/control-file.ts:25-51`、`living/economy/garden-clock.ts:41-55`、`living/body/room.ts:171-186,237-250`、`living/economy/plugin.ts:133-143,150-161,279-295`）。 | `tests/behavior-list/families.test.mjs:36-59`（暂停、重启、恢复后的作物）<br>`tests/regressions/audit-r5-garden-clock.test.mjs:96,157`（只扣暂停区间及暂停时手工交易）<br>`tests/behavior/garden-clock-continuity.test.ts:106-112`（Body 缺席时设置遵守暂停意图）<br>`tests/life/life-clock-intent.test.ts:72-80`（原编号恢复，Body 替身）<br>`tests/behavior-list/entries-lifecycle.test.mjs`（2A1A-12、2A1A-13 和 `G3-GARDEN-*`：组件缺席跨暂停、Life 卸载后读区间、区间无效、清理） |
| 卸载 `25-Behavior` | **身体**：清定时器、退订、保存检查点并释放绑定。**计划与回顾**：Life 可继续运行，缺 Body 时跳过身体计划推进，回顾仍由独立运行时调度。**钱包背包菜园**：Economy 及数据库仍在，钱包操作可直接进账，库存投喂和 Body 代办的菜园工作缺执行器（`living/body/plugin.ts:430-445`、`living/plan/plugin.ts:402-421,723-726`、`living/economy/plugin.ts:133-143,233-295,315-325`）。 | `suspendAutonomy()` 保存已推进的作物检查点且保留时钟意图。Economy 设置在无 Body 时先读 Life 的持久时钟意图，缺少已知意图时继续计时。单独卸载 `25-Behavior` 后，Life 回顾照常调度并写原日期日记（2A1A-14），跨暂停再启用时作物按区间结算（2A1A-12）。 | `tests/behavior/garden-clock-continuity.test.ts:114-143`（真实 Body 入口卸载和替换，Life/Economy 用服务夹具）<br>`tests/regressions/audit-r5-garden-clock.test.mjs:176-181`（无 Body 的 Economy 设置） |
| 卸载 `22-Economy` | **身体**：仍能执行免费照料和独立身体活动。对已采用 Economy 的存档，权威菜园拒绝读写，原钱包、库存与作物保留。**计划与回顾**：Life 仍在，依赖 Economy 的在途 `garden/economy/read` 执行可停在 `running/waiting`，保留原编号等待恢复。**钱包背包菜园**：Economy 关库，已采用的存档不会重新启用旧 JSON 钱包。尚未采用且无权威标记的存档继续通过 Body 使用 JSON 菜园（`living/body/plugin.ts:181-190,361-364`、`living/body/room.ts:139-222`、`living/economy/plugin.ts:297-299,353-357`、`living/economy/store.ts:510`）。 | 卸载没有计划取消语义。经济恢复后按原编号和原钱包继续，已有身体效果和未结算库存靠原回执核对。关闭 Economy 不写 Life 或 Body 的时钟开关。Economy 卸载期间跨过的暂停，恢复后按 `control.json` 的区间扣（2A1A-13）。 | `tests/life/life-domain-integration.test.ts:171-194`（真实领域对象、服务替换夹具，原执行和钱包恢复、免费照料、旧菜园未写）<br>`tests/behavior-list/domains.test.mjs:103`（缺库拒绝创建替代钱包） |

**卸载哪个入口会关闭哪个内部区**

表中服务状态以其他入口仍加载为前提。服务的独立提供点为 `living/economy/plugin.ts:325`、`living/body/plugin.ts:457`、`living/plan/plugin.ts:725`。

| 动作 | 身体区 | 计划与回顾区 | 钱包背包菜园区 | 服务是否还在 |
| --- | --- | --- | --- | --- |
| 卸载 `22-Economy` | 开，免费照料可用（`tests/life/life-domain-integration.test.ts:181-184`） | 开，经济步骤保留原编号等恢复（`tests/life/life-domain-integration.test.ts:177-191`）。回顾照常调度（2A1A-15） | 权威服务关闭，旧账和菜园保留（`living/economy/plugin.ts:297-299,353-357`、`tests/life/life-domain-integration.test.ts:185-191`） | `petEconomy` 否，`petBehavior`、`petLife` 是（各自 `provide`）。真实入口卸载见 2A1A-13、2A1A-15。 |
| 卸载 `25-Behavior` | 关闭并保存（`living/body/plugin.ts:430-445`、`tests/behavior/garden-clock-continuity.test.ts:126-143`） | 服务保留，缺执行器时不推进身体计划（`living/plan/plugin.ts:402-421,723-726`）。单入口卸载后回顾照常（2A1A-14）。 | 服务保留，Body 代办暂不可用（`living/economy/plugin.ts:264-295,325`、`tests/regressions/audit-r5-garden-clock.test.mjs:176-181`） | `petBehavior` 否，`petEconomy`、`petLife` 是（各自 `provide`）。Body 实际卸载见 `tests/behavior/garden-clock-continuity.test.ts:126-143`，其余服务是夹具。 |
| 卸载 `40-Life` | 开。撤掉运行时自治，保留显式操作（`living/body/plugin.ts:85-95,361-364`、`tests/life/life-body.test.ts:217-221`） | 停止调度和回顾，撤销来源（`living/plan/plugin.ts:386-400,700-712`、`tests/life/life-source-adapter.test.mjs:68-89`）。持久在途计划按原编号恢复（2A1A-11）。 | 服务保留，原启用的作物时钟可继续（`living/body/room.ts:229-235,271-281`、`tests/behavior/garden-clock-continuity.test.ts:114-131,138-141`） | `petLife` 否，`petBehavior`、`petEconomy` 是（各自 `provide`）。服务移除的门禁证据使用 Life 替身（`tests/behavior/garden-clock-continuity.test.ts:115-131`）。 |
| 显式暂停生活 | 开，被动变化暂停，显式操作可用（`living/body/room.ts:237-270`、`tests/life/life-body.test.ts:175-205`） | 服务在，调度和回顾停，已接收计划条件性暂停（`living/plan/plugin.ts:364-400,631-655`、`tests/living/living-lifecycle.test.mjs:1049-1086`）。暂停取消回顾轮次，但同一回顾收尾前原文件授权仍可复核（2A1A-16）。 | 服务在，作物暂停被动增长，手工交易可用（`tests/behavior-list/families.test.mjs:49-58`、`tests/regressions/audit-r5-garden-clock.test.mjs:157`） | 三者都在。暂停仅调用 `petLife.control(false)`，测试随后通过同一 `petLife` 重新启用，并继续用 Body/Economy 观察原菜园（`living/plan/plugin.ts:759-764`、`tests/behavior-list/families.test.mjs:49-58`）。 |
| 三个生活入口全卸载 | 关 | 关 | 关 | 三个服务都不在，`LivingWorld` 释放。普通聊天、相册和日记照常；`chatpet.environment`、`chatpet.interactions` 两段随第二层一起消失，重开原会话也退休旧快照（2A1A-17、2A1A-19，拍板点 8） |

**三个入口的装载依赖**

| 入口 | 装载依赖 |
| --- | --- |
| `22-Economy` | 硬 `inject` 为 `petCore / petWorld / tools / systemPrompt / agents`。库存投喂、同步检查点时经常驻实例 `LivingWorld` 按需读 Body，读时钟时按需读 Plan，不再按服务名查找（`living/economy/plugin.ts:133-143,264-272,279-295,302-303`）。 |
| `25-Behavior` | 硬 `inject` 只有 `petCore`。经 `LivingWorld` 按租约观察 Economy、Plan 的出现和消失（`internal/status` 刷新），用于刷新绑定和同步自治准入（`living/body/plugin.ts:57-68,85-114,447-448`、`living/index.ts:324-345`）。 |
| `40-Life` | 硬 `inject` 为 `petCore / petWorld / agents / sessions / tools / systemPrompt`。计划推进与事实读取经 `LivingWorld` 按需读 Body、Economy（`living/plan/plugin.ts:402-421,440-452,714-715`）。暂停、恢复桌宠自主和主动消息的呈现、送达经生活出口调用 Desktop、Channels 登记的回调，不按服务名读 `petDesktop`、`petChannels`（`living/plan/plugin.ts:165,218-223,344-353`）。 |

`cordis.patch.yml:8-17` 中配置顺序为 Economy、Behavior、Life，三者的硬 `inject` 均未声明另外两个服务。

**常驻实例**：`living/index.ts` 的 `LivingWorld` 是三个区的登记处，三个入口共用，谁先加载谁建、最后一个卸载时释放；键按 Cordis 根、Core 对象和三个服务的隔离标签区分，登记复用 `core/tables/registry.ts` 的租约。每个入口用 `mountLivingArea` 登记自己的区，卸载时先撤登记、再停接单、再 `close()`，卸载哪个入口只停哪个区，上面的矩阵逐格不变（`living/index.ts:51-114,150-163,354-383`）。三个服务由各入口分别 `provide`，独立装卸。

---

<a id="7-迁移与回退"></a>

## 7. 存储准入与回退

<a id="71-原则"></a>

### 7.1 存储准入

支持基线是已迁移的 0.5.0。运行时和离线工具核对工作区清单 v3、当前存储版本（Core 3、Living 4）和绑定证据。全新绑定写独立的 `fresh` 钱包证明；已迁移绑定读取 `migrations.jsonl` 的完成凭证（`src/core/workspace.ts`、`src/core/storage-migration.ts`）。未满足准入时，设置页给出固定拒写原因并指向历史标签。0.4.0 的操作见 [v0.5.0](https://github.com/hyyino7/her-world/tree/v0.5.0)。

`arch/storage.json` 中的 `lazy: true` 表示容器在首次写入时建立，离线盘点在文件缺席时报 `not-created`，文件存在时照常检查声明的表。

<a id="72-回退"></a>

### 7.2 换包回退与离线恢复

0.6.0 的回退演练直接换回 0.5.0，保留升级期间写入的数据。正式包双向读回见[隔离包验收](release/notes.md#隔离验收与换包回退)。

灾难恢复由[离线备份](portability.md#offline-file-backup-and-same-machine-recovery)承接。恢复器验证停写、同机、同绑定和相同安装包指纹，保存恢复前安全备份，再替换备份覆盖的原生日志与伙伴数据，保护当前渠道投递、去重和额度。现有入口直接输出结果对象（`scripts/companion-backup.mjs:66–76,79–102`、`scripts/lib/offline-backup.mjs:389–423,428–451`）。

<a id="llm-rollback-plan"></a>

<a id="721-计划用量账本的迁移与回退"></a>

#### 7.2.1 用量账本的迁移与回退

账本按首次调用建立，工作区清单和存储版本沿用 0.6.0。旧包按原有路径和 kind 运行，再次升级可从已有账本续写。离线恢复替换整棵 `.chatpet`，账本回到备份时刻，早于首次记账的备份会移除账本。渠道计数和 Life 旧花费保留恢复前的值，设置页提示这项对照差异。1b 只用原有日志和账本。独立个体的迁移与回退见[10.10](#individual-migration)。

<a id="room-extension-migration"></a>

#### 7.2.2 计划：空间重做的迁移与回退

1b 新增 `room-layout`，沿用 [7.1](#71-原则) 的准入和 [7.2](#72-回退) 的停写备份与离线恢复。主人显式触发。先在布局文件缺失时写默认布局（修订号 1），再分开改写身体和计划的静止引用，最后以完成凭证放行启动。已经达到目标状态的步骤跳过；中途退出后按目标状态续做。检测到坏档或未知新版本时停止并保留原件，迁移未完成时阻止正常启动。

在途记录带原操作归属或请求指纹。现有计划执行按完整输入校验摘要，互动回执只有摘要和结果（`living/body/room.ts:339–349,636–665,1103–1106`），迁移保持原输入和指纹，回执长期可按旧写法查询和重放。

| 引用及消费者 | 迁移与读回 |
| --- | --- |
| 身体当前站位、默认站位及命令 | 未在途的 `room/spot` 换成交互点，`freePos`、`freeTarget` 保留原坐标并补地区。存在路线或停留时原样保留相关字段，解除引用后由 Body 写新格式。 |
| 路线、停留、睡眠和执行记录 | 保留路径点、绝对时间、目标、效果、姿态、到达期限、操作 ID、执行及互动回执。到达比较前双方走同一个别名解析，睡眠判定用提供睡觉活动的交互点。相关现行判定见 `living/body/room.ts:790–798,839–841,944–955`。 |
| 计划的准入、回执与后续步骤 | 已派发、待准入或待回执的原操作 ID、截止、状态和原始输入保留；确认未派发也无潜在提交的普通后续步骤改成交互点 ID。计划工具和执行入口兼收旧 `room/spot`。 |
| 菜园和 Economy | 菜畦 ID、任务、作物代次、结算回执、原存储及采用凭证保留。新任务在执行时把目标转成固定交互点。 |
| 呈现与历史 | 保留已开始的播放身份、历史 `room_state` 概览兼容、原事实 ID、确认状态与文字、访客记录。新播放和新工具结果用新字段，热点从家具实例派生；设置页继续转发 Room 请求。 |

合成存档覆盖走路、停留、睡眠、去床、计划暂停与待准入／待回执、园艺待结算、活动结束仍占家具、坏档、两条身体路径及钱包已采用／未采用。演练跑正常迁移后的续行和重试、换包或恢复后的旧版读回，以及两个文件写入之间崩溃后重跑。每种中间态核对原操作无丢失、无重复，也未被重放校验拒绝。

各单位按[回退粒度决定](decisions.md#room-extension-decisions)分别演练。1b 需要恢复是因为旧读取器对未知站位会回到默认值或丢弃路线（`vendor/feiyu-room-template/home-state.js:514–519,549–569`）。离线恢复会把备份覆盖的布局、聊天、生活记录、钱包、背包和菜园还原到备份时刻。恢复器保留规定的渠道日志、部分 Core 记录和生活实际支出（`scripts/lib/offline-backup.mjs:389–423`）。恢复之后看不到的新版聊天仍留在恢复前的安全备份里，再次升级以恢复出的旧数据生成布局。

<a id="74-第一次迁移的定位"></a>

### 7.3 完成凭证与盘点

工作区的生命周期清单和历史完成日志位于 `.chatpet/data/storage-manifest.json` 和 `.chatpet/data/migrations.jsonl`，随 Repo 和备份保存。恢复在仓库外用 SQLite 互斥，并检查历史备份带回的 `.chatpet/data/migration.lock` 是否仍有存活持有者。盘点入口见[合成副本与盘点](development.md#migration-inventory)。

## 8. 生命周期规则

1. 所有定时器、订阅、在途请求通过模块的**作用域助手**登记（包装 `ctx.effect` 和 `AbortController`），不允许裸 `setTimeout`。
2. 关闭顺序：停接收新请求 → 取消在途请求 → 等已提交的写完成 → 释放资源。
3. **每个模块一条通用测试**：启动 → 触发活动 → 关闭 → 断言无残留。除假时钟外，还要断言在途 I/O 已结束、子进程已退出，并保留少量使用真实时钟的冒烟测试（假时钟证明不了 I/O 和子进程）。
4. 切换工作区或重载后，旧作用域的回调不得写新绑定的数据：绑定校验带**实例代次**（见第 3 节）。
5. **写入已完成但响应被取消**要有专门用例。
6. 生活三区和 Room 对 Core 的可见性、Desktop 和 Channels 登记的生活出口、Desktop 读 Life 启用意图时取的 Plan，都只在入口挂载时按隔离标签判定。改某个入口的 Cordis `isolate` 配置后，要重挂该入口才生效。

---

## 9. 特殊情况

- **首次安装 / 空状态**：没有绑定资料目录时，第一层只开聊天，不创建上层数据。主人明确初始化时，Core 一次建好全部技术容器，可选服务既不打开也不启用（`core/initialization.ts:16`）；Economy、Memory Bank、近期账本经 `registerInitializer` 登记自己的初始化。沿用现状。
- **存储准入失败**：保留原资料并显示原因码。需历史升级时，从第 7 节进入对应版本的操作说明。
- **外围模块关闭**：关掉 Desktop、Room、Channels、Voice 任一个，聊天、记忆、身体、计划都不受影响（R7）。

<a id="individual-plan"></a>

## 10. 计划：独立个体

[独立个体](product.md#独立个体)重构项目的结构增量。现有三层、R0–R8、存储准入照常，本节只写增量；选型和取舍见[立项决定](decisions.md#individual-decisions)，阶段和每个发行单位要过的检查见[产品阶段规划](product.md#每个单位必须通过的检查)。路径写法：`DSH:` 指 DeepSeek Harness 0.2.2-rc.5 安装包里对应的包；仓库开发依赖锁在 rc.1。

### 10.1 DSH 能定制到哪里

| 机制 | 能做什么 | 出处 | 用处 |
| --- | --- | --- | --- |
| 对话预设 | 一组子插件，会话创建时选定，记在会话上。空白会话可以换预设，第一轮开始后锁定；恢复时，如果原预设的定义已经缺失，会拒绝绑定 | `DSH:dsh-agent-preset`、`DSH:dsh-agent-preset-registry` | 伙伴预设，写法照 `src/channels/guest.ts:10-32` |
| 内置模式 | `standard`（标准）和 `cordis`（创造），出厂人设都以 coding agent 开头 | `dsh-web-app` 的 `presets/standard.patch.yml:8-32`、`presets/cordis.patch.yml:5-17` | 背景二第 1 条 |
| 系统提示词 | 固定开场白是 `harness:identity` 段，可以在预设作用域里用同名空段遮蔽；`dsh-persona` 的 `prefix` 用来换人设；`complete: true` 会把其他段一起挡掉，不用它 | `DSH:dsh-system-prompt/src/index.ts:289-301,456-462`、`DSH:dsh-persona` | 去掉编程身份 |
| 工具 | 自定义工具、允许名单、按步骤开关、拦截 | `DSH:dsh-tools` | 工具清单保持固定 |
| 压缩 | 继承 `BasicCompactionEngine` 只能改 `summarize()`，可以不调模型、直接返回现成文字。`compactNow` 在空闲时自己选范围，保留预算为 0；`compactRegion` 可以指定起止，但要求有一个正在进行的轮次。基础实现会在正文外加一段英文前导。压缩的提供方和使用方要在同一个隔离组里 | `DSH:dsh-compaction-basic/src/index.ts:270-278,380-434`、`DSH:dsh-agent-preset-registry/README.zh.md:56-60` | 伙伴压缩 |
| 收件箱和钩子 | `followup`、`steer`、`inject`、`agent/pre-step`、`agent/turn-stopping`；`cancel()` 默认会清空待处理的输入 | `DSH:dsh-agent` 第 58、80、208 行 | 注意力 |
| 会话日志 | 只追加；插件记录只给 DSH 自己的实验包用 | `DSH:dsh-session` | 状态存在 Her World 自己那边 |

### 10.2 现状和缺口

已证实的问题：

1. **她跑在出厂的编程人设里。** 选预设的顺序是 Life 传入 → `composedPreset` → `standard`（`src/core/companion-foundation.ts:117-129`、`src/living/plan/plugin.ts:765-767`）。复用旧 home 时不检查预设（`src/core/companion-foundation.ts:88-106`）；Room、Desktop 新建会话时不传预设（`src/room/chat.ts:126-143`、`src/desktop/conversation.ts:138-165`）。只有 guest 换了人设。主人本机的 profile 有没有覆盖过 `standard`，目前不知道。
2. **原生摘要用的是编程模板。** 批处理默认在满 10 轮或闲置 10 分钟时触发，另外还有最小间隔、重试、空闲和回顾请求等条件（`src/core/companion-settings.ts:26-41`、`src/memory/batch.ts:93-108`）。它调用当前预设的压缩（`src/memory/batch.ts:34-52`），用的是 `compaction-basic` 的英文编程模板；来源校验通过后，摘要就进记忆库（`src/memory/batch.ts:79-84`）。
3. **缺少「理解」这一层。** 规则合并只是截取对话观察的前 400 字（其他分支最多 500 字）（`vendor/mnemosyne/service/src/cognitive_memory/cognition/consolidate.py:70-101`）。有证据的用户事实只能靠她主动调工具写入；Body、Economy 已经能用程序登记实际发生的事（`src/core/native/conversation.ts:214-229,413-415`）。没有人物、约定，也没有按事件做的提炼。
4. **日记和自述在记忆体系之外。** 它们归 Core 记录库管（`src/core/companion-writing.ts:32`、`arch/storage.json:45-46`），由原生文件工具写入。回顾通过 Memory 读原话（`src/living/plan/review.ts:25-35`），记录搜索同时搜对话和日记（`src/core/records.ts:133-143`），但日记里的经历不会成为记忆条目，事实也不会进日记。
5. **自述被当成长期记忆在用。** records 段让她「按需阅读和更新」（`src/core/companion-foundation.ts:191-195`）；回顾提示词第 6 行在有长期变化时改自述（`locale/life/review-alarm.md:6`）。注入时截到 5000 字（`vendor/dsh-world/lib/self.js:3-24`），Console 保存上限是 64 KiB（`src/core/records.ts:79-90`）。
6. **短期记忆靠检索。** 每轮第一步按输入去召回，默认最多 8 条，插在新输入前面（`src/core/native/agent.ts:264-289`）；旧的召回在请求里被替换成空（`src/core/native/recall.ts:26-45`）。
7. **没有注意力。** 主人身份必须是私聊（`src/channels/sessions.ts:125`）；主人在群里发言走 guest。guest 能召回主人的事实（`tests/behavior-list/policy-qq.test.mjs:64-95`）。
8. **人称可能有两个来源。** 一个是编程模板摘要；另一个是回顾工具的说明写「user 是伙伴说的话」（`src/living/plan/review.ts:20`），可实际上主人的话被映射成了 `user`（`src/core/review-dialogue.ts:29-39`）。

**假设，待阶段 0 验证**：第 3 到第 7 条有共同的根因，就是她「记得什么」分散在好几处，没有一个模块统一负责。

<a id="individual-presets"></a>

### 10.3 会话、预设和伙伴资格

| 预设 | 用在哪里 | 人设和段 | 工具 | 压缩 |
| --- | --- | --- | --- | --- |
| 生活（新） | 主意识：Life、回顾、处理 2 级消息、回家人群 | 伙伴人设；遮蔽 `harness:identity`；`SOUL`、`USER`、`COMPANION.md`、自述 | 生活、记忆、看手机、回消息；回顾用的、按日期授权的读写，到「真源切换」才移除 | 伙伴压缩 |
| 当面（新） | DSH 原生对话、Room 私聊、Room 电视、Desktop | 同上 | 聊天、记忆、表达 | 伙伴压缩 |
| `chatpet-channel-guest`（已有） | 外人的私聊；家人群只用来读上下文和送达 | 公开角色卡 | 继承工具全部屏蔽；渠道自带的本地工具不变 | 伙伴压缩（新增） |

**伙伴资格只在一个地方判定**：看当前生效的预设和绑定。提示词段、工具、记忆观察、请求钩子都看这一个结果。阶段 1 的方案要把每个入口的五条路径列全，包括原生、home、Room 私聊、Room 电视、Desktop、guest，每个入口要写新建、复用、空白会话切换、升级到新版、降级回旧版五种情况。

<a id="individual-attention"></a>

### 10.4 注意力和四级消息

**定级。** 渠道先通过账号和白名单的校验，再交出三样东西：平台事实（私聊还是群聊、是否 @ 她、是否回复或引用她）、可信的发言人、已有的唤醒判定。Core 根据这些定级。「说话的是主人」和「这一轮有主人权限」分开判断。

| 情况 | 级别 |
| --- | --- |
| 主人在 DSH 或 Room 直接对话 | 1 |
| 主人的 QQ、微信私聊 | 2 |
| 主人在家人群 @ 她，或者回复她 | 2 |
| 主人在家人群里普通发言 | 4（她看手机时能看到） |
| 别人 @ 她，或者回复、引用她 | 3 |
| 外人私聊 | 3 |
| 普通群聊 | 4 |

渠道已有的关闭、静默、额度和队列上限照常生效。

**裁决规则。**

- Core 用串行方式决定下一次注意力给谁。Life 在步骤边界确认暂停。Body 按原来的操作号，把已经接受的动作做完。不用 `cancel()`。
- 两个 1 级输入同时到达时，按准入的先后处理；生活恢复的时间，从最后一次有效准入开始往后推。
- 2 级的时限、起点、暂停条件和终点见 [数值表](product.md#数值表)。系统分别记录三个时刻：到期、获准处理、实际送达。
- 体验块带注意力次序和预期版本，过期那一轮的结果不能覆盖已经被接管之后的状态。

**看手机、回消息。** 未读来自原话层，已读水位复用渠道现有的群展示和已读确认（`src/channels/group-social.ts:85-99`）。正文由主意识写；实际送达时，仍然核验账号、群、原消息和这一轮的授权。

<a id="individual-memory"></a>

### 10.5 记忆系统：一个模块

**范围和真源。** Memory 模块负责她记得的一切，Core 记录库里的日记和自述职责并入 Memory。相册、活动日期、通用文件守卫留在 Core。`SOUL`、`USER` 留在 Core，通过现有的读取口提供（`src/core/native/conversation.ts:426-433`）。记忆库是唯一真源，导出文件只读。

存储引擎继续用 Mnemosyne，不改 vendor。Her World 的适配层要补齐下面这些操作：

| 内容 | 存放 | 适配层要补的操作 |
| --- | --- | --- |
| 原话、未读、第一眼 | 观察及其 metadata | 标注、条件更新、原子认领、读水位；按「发言人 + 场合 + 起止时间 + 分页」查询原话，复用撤回、绑定、可见性校验；分清平台发送时间、收到时间、入库时间 |
| 情节、日记 | 情节记忆，加独立的派生观察 | 情节边界；日记日期唯一；多来源证据；补写规则 |
| 人物 | 语义记忆，加稳定的人物键 | 同名区分、跨账号关联、版本并发；和现有的 QQ 成员印象合并（`src/channels/group-material.ts:73-94`、`src/channels/group-social.ts:30-60`），不能出现两份 |
| 事实 | 语义记忆 | 区分本人断言、转述、提问和她的推断；证据不足的先作候选 |
| 约定 | 语义记忆 | 履行、取消、重约、提醒、送达、幂等 |
| 自述 | 语义记忆，用 `expected_version` 和版本快照 | 读历史正文；撤销即生成一个新版本；Console 和回顾并发写入 |

聚合出来的结果（情节、日记）挂在独立的派生观察上，不直接关联原始观察，以免旧的启动修复把来源改窄（`vendor/.../cognition/consolidate.py:51-62`、`src/memory/provider.py:44-59`）。纠正她自己的推断时，只更新派生条目的版本，不让原证据失效。

**写入流水线。**

1. **入库。** 所有窗口里她在场时的消息都要记，包括没唤醒她的群消息。保留来源、原始时间和是否截断。复用 Channels 的收件去重和原消息凭证。
2. **第一眼。** 范围是 1 到 3 级，加上她正在说话的群在窗口内的消息（[数值表](product.md#数值表)）。
3. **成段提炼。** 安静到阈值（[数值表](product.md#数值表)），或者话题换了、聊天的人换了，就提炼。
4. **核验。** 程序能核的是发言人、引文和权限；「是不是复述」「是不是只是在问」这类语义判断由提炼模型给出，再用合成的标准样例检查准确率。
5. **对账。**
6. **每日回顾。** 读当天的情节，写日记，有长期变化时出自述新版本，纠正她自己推断错的条目，更新人物印象。漏写的日记沿用上游按原日期逐个补写的做法（`vendor/dsh-world/lib/life/runtime.js:665-695`）。

「我已经说过」要以实际投递回执和最终发出的正文为准：没发出去、发送失败，或者群工具最后选了另一段正文，都按实际情况记。

第一眼和提炼的模型调用放在宿主侧，要带用途、预留预算、可以取消、记录用量；Python 适配层只负责短事务的核验和落库（`src/memory/client.ts:50-58`）。失败分四类：技术失败、输出被截断、没有有效证据、额度用完。截断后对半拆开重试，拆分有下限，重试有上限。

**四种状态。**

| 状态 | 聊天 | 原话 | 日记和自述 |
| --- | --- | --- | --- |
| 关闭后台模型 | 照常 | 照常记 | 照常；回顾读原话来写 |
| 没配置记忆库 | 照常 | 不记 | 读写导出文件，等配置好后再导入 |
| 记忆库故障 | 照常 | 先排队 | 只读最近一次导出 |
| 插件卸载 | 普通 DSH | 不记 | 导出文件留在工作区 |

旧版本里关掉了 Memory 的安装，升级后不追溯回填此前的聊天。

**想起。** 前缀放 `SOUL`、`USER`、`COMPANION.md` 和当前自述。动态尾部每轮放一行状态。开新段时只追加一次：体验块、眼前这个人的工作记忆和人物卡、相关的事实和情节。其余的靠工具主动去想。

现有的生活状态段会准备并确认真实发生的互动事实（`src/living/prompt-context.ts:58-88`），这条确认链要保留，不能因为把状态压缩成一行而丢掉。

「前缀一天最多换一次」是 Her World 自己的策略，有三个例外：主人改设定立即生效；撤回和换绑定立即清理；主人在 Console 改自述立即生效。

**伙伴压缩：先落盘，再压缩。**

- 压缩前先冻结会话的事件区间和来源版本，提炼成功后才提交。替换之前，复核有效历史和撤回资格。同一个区间被多个触发同时要求压缩时，复用同一份结果。
- 生活会话在回顾写完日记后替换，复用回顾后压缩的开关和请求（`src/living/plan/plugin.ts:271-275`）。
- 当面会话和 guest 会话闲置以后，在下一个轮次开始时用 `compactRegion` 精确保留最近 K 轮。
- 压力兜底：先提炼，再替换。如果后台模型不可用、材料还没准备好，或者替换后还是太长，就退回 DSH 原生的溢出恢复，但改用中文模板。
- 基础实现的英文前导如果去不掉，就自己写压缩引擎，实现三个操作，不再继承基础类。

### 10.6 特殊情况

- **当面和生活并行**：按注意力次序处理，过期的那一轮不能覆盖新状态。
- **撤回和压缩赛跑**：在冻结的区间上复核；下一次请求时清理迟到或已失效的结果。
- **提炼中撤回、日记写好了但替换还没落地、替换时有新消息到达、遇到超大的不可分单元**：每一种都要有验收用例。
- **后台模型不工作**：原话照常记，也能按人、按时间找回；第一眼和提炼先停，修好后补做，3 级消息按 4 级处理。
- **两条约定同一时刻到期、一条改期、一条撤回、停机后重启**：都要验收。
- **跨午夜延迟入库**：按平台的发送时间归日。
- **同名的两个群友**：靠人物键区分。
- **旧数据**：
  - 编程模板摘要和规则片段保留作证据，不参与回想；来源无法识别的，标为来源未知。
  - 旧 home 先按资格判定，再决定交接还是新建。
- **主人没选伙伴预设**：普通 DSH 助手，不进记忆；设置页提示可以把「当面」设为默认。
- **打包**：从 npm 原包安装（`scripts/install-dsh.mjs:259-262`）后，预设和压缩依赖都能解析。

<a id="individual-boundary"></a>

### 10.7 边界与依赖方向

层次和方向都不变：第三层 → 第二层 → 第一层；向下是调用，向上用事件和登记（`arch/layers.json`）。

| 模块 | 层 | 新增或改变的职责 | 读哪些服务 | 不能做的事 |
| --- | --- | --- | --- | --- |
| Core | 1 | 伙伴资格（唯一判定点）；伙伴预设的声明表；消息定级；顺序号（每个绑定单调递增）；跨会话的注意力裁决。相册、活动日历、通用文件守卫、`SOUL`、`USER`、`COMPANION.md` 留在 Core | 现有服务，加上 `petMemory` 的新接口 | 不直接调用 Life 或 Channels；不写记忆条目 |
| Memory | 1 | 日记、自述（从 Core 记录库并过来）；原话层的未读和第一眼标注；情节、人物、事实、约定；体验块；写入流水线；导出；伙伴压缩（落盘替换这一路）；迁移进度 | `petCore`；`petEmotion` 只在子作用域里读，缺席时照常工作 | 不改 vendor；不把 `petEmotion` 列为顶层必需注入；不读 `petChannels`，也不订阅第三层的事件（会违反 R2、R3，见 `scripts/arch/lib/rules.mjs:75-80`） |
| Life | 2 | 接管每日回顾：把上游回顾时间设成无效值，停掉上游的日回顾（`vendor/dsh-world/lib/life/runtime.js:411-424`）；先清空上游已有的 `pendingReviews` 和 `reviewWake`，再由 Her World 发起回顾；用一份持久的回顾凭证续做导出和压缩（现在回顾后压缩的请求只存在内存的 `Set` 里，重启就丢，见 `src/memory/batch.ts:12-16`）。通过 `companionPorts` 登记暂停确认和设唤醒 | 通过登记提供能力 | 不直接写日记和自述 |
| Body | 2 | 登记「在步骤边界暂停」；已经接受的动作按原操作号做完 | — | — |
| Channels | 3 | 交出定级要用的平台事实、可信发言人和唤醒判定；**持久保存实际发出的分段和确认进度**，然后向下幂等调用 Memory，提交已确认的部分；退役渠道分支里「轮次一结束就写观察」的旧做法（`src/core/native/conversation.ts:239-250`、`src/channels/sessions.ts:58-72`）；群未读水位和成员印象仍归 Channels | 现有服务 | 不把本地回复历史当送达凭证 |
| Room、Desktop | 3 | 新建和复用会话时，调用 Core 的伙伴资格判定和预设选择 | 现有服务 | 不自己决定用哪个预设 |

`arch/layers.json` 要改两处：Memory 的 `reads` 加上 `petEmotion`；新增的 `src/core/attention/` 归 core 模块。

**预设声明表**：Core 维护一份伙伴预设的声明，C1、C2 的检查和提示词段都从这一份枚举。`registerWorldPrompt` 现在没有预设字段（`src/core/native/prompt.ts:99-104`），要加一个「出现在哪些预设下」的声明。

<a id="individual-ownership"></a>

### 10.8 拥有者

只列这次新增或改变了拥有者的数据。容器、选择器、写入点要逐项补进 `arch/storage.json`；每个 Core kind 照现有做法，都要有一条写者测试（`tests/arch/storage-locations.test.mjs:86-93`）。

| 数据 | 物理容器 | 拥有者 | 唯一写入方式 | 停写条件 |
| --- | --- | --- | --- | --- |
| 日记、自述的条目和版本 | Bank | Memory | Memory 的记录写入接口，回顾、Console、迁移器都走它；Console 保留并发版本检查（`src/core/records.ts:73-112`） | 换绑；迁移进行中 |
| 正式路径的导出文件 `.chatpet/{diary/*.md, self.md, self.history/*.md}` | 工作区 | 「真源切换」之前归 Core，之后归 Memory | Bank 已配置：由导出器写，是只读副本；Bank 没配置：由 Memory 的文件回退写入器直接写，等配置好 Bank 再导入 | 同上 |
| 旧 Life 路径 `.chatpet/data/life/{self.md, diary/**}` | 工作区 | 只留档，不动 | 无 | — |
| 换包安全点标记（带 Bank 版本号） | Memory 的元数据 | Memory | 主人在 Console 执行「准备换包」，导出器补完导出后写入；`dafeiyu-setup` 换包前核对标记和 Bank 版本，对不上就拒绝换包 | — |
| 撤回日志（Bank 之外的副本） | Core 新 kind，加进离线恢复器的保留名单 | Memory | 撤回时同步写入；恢复旧备份后，把备份之后的撤回重新应用一次 | — |
| 原话的未读、第一眼标注 | Bank 观察的 metadata | Memory | 标注接口（条件更新、原子认领） | 换绑 |
| 派生观察、情节、人物、事实、约定 | Bank | Memory | 写入流水线（提炼 → 核验 → 对账）；她自己做的纠正只更新派生条目 | 换绑；后台模型停用时不写 |
| 来源可见性（「只给主人」等） | Bank 条目的 metadata | Memory | 写入流水线，以及主人的操作 | — |
| 体验块 | Memory 的记录 | Memory | 条件写入：带注意力顺序号和预期版本 | 换绑 |
| 提炼游标和重试 | Memory 的记录 | Memory | 写入流水线 | — |
| 回顾凭证（日期、状态、导出和压缩进度） | Living 的记录 | Life | 回顾驱动器 | Life 暂停或卸载 |
| 约定唤醒 | Living 的记录（复用计划的唤醒） | Life | 重算接口 | — |
| 迁移进度 | Memory 的元数据 | Memory | 迁移器 | — |
| 新设置（后台模型、上限、注意力时限） | 新的独立记录，不进 `companion` 对象 | Memory 和 Core 各管自己那部分 | 设置接口 | — |
| 伙伴会话指针 | Core 的新 kind；旧的 `companion-home` 保留不覆盖 | Core | 伙伴资格判定 | 换绑 |
| 注意力状态：持有者、顺序号、到期、获准、送达 | Core 的新 kind | Core | 注意力裁决器 | 换绑 |
| 渠道待确认分段、送达回执 | Core 的新 kind（物理容器在 Core，归 Channels，同现有的 `channel-*`） | Channels | 渠道送达路径 | 渠道关闭 |
| `memory-batch`、`native-summary-memory` | Core | 伙伴压缩接管后改归 Memory，旧行保留只读 | — | — |

<a id="individual-checks"></a>

### 10.9 检查清单

现有的 R0–R8、行为清单门禁、存储准入照常执行。下表的「建立阶段」只到阶段这一级；每个发行单位具体要通过哪几项检查，以 [产品阶段规划「每个单位必须通过的检查」](product.md#每个单位必须通过的检查) 为准。R5 只出报告；现有的棘轮只管 R1–R4 和 R8 两份基线。所以下面每条检查都写明了落在哪里：

| 检查 | 检查什么 | 怎么查（落在哪里） | 建立阶段 | 门禁 |
| --- | --- | --- | --- | --- |
| C1 伙伴资格 | 从预设声明表里枚举所有预设。原生、home、Room 私聊、Room 电视、Desktop、guest 六种入口，各自的新建、复用、空白切换、升级、降级都走同一个判定；判定不通过的会话，不挂段、不挂工具、不写观察；首步的工具清单和实际执行的拒绝要一致 | 契约测试，进行为清单 | 1 | 行为清单 |
| C2 伙伴请求快照 | 伙伴预设下，最终请求里没有 coding agent、没有 `harness:identity`、没有编程工具；普通预设的请求保持原样 | 两份合成 profile（默认的、覆盖过 `standard` 的），进行为清单 | 1 | 行为清单 |
| C3 压缩完整性 | 伙伴会话只用自己预设组合里的压缩服务（通过 `agentPresets.serviceFor`），`memory-batch` 去掉回退到全局压缩的逻辑；空闲时的维护、取消和刷盘、工具调用配对、日志锁内只替换一次、失败只闭锁一次、步前压力、溢出重试、换模型，这些都照常工作 | 假模型契约测试 | 1 | 行为清单 |
| C4 降级往返 | 存储版本表不变；在原指纹的 0.6.0 上逐个核对各入口打开的**原会话 ID**（home、Room 按前缀取最大序号、Desktop 保存的指针），分三种结果：旧会话能继续；新预设缺定义不能继续；原生日志仍在。另外核对：旧设置能解析、导出文件能读、撤回仍有效；再升级时，降级期间的修改只导入一次 | 隔离安装演练脚本，进发行门禁 | 0 搭骨架；每个发行单位都要跑 | 发行门禁 |
| C5 迁移四类演练 | 切换前放弃；入库后、导出前崩溃；切换后有新数据再降级；降级后改过再升级。四类都核对文件字节、目标版本、其他记忆的来源资格 | 合成副本演练脚本，进 「真源切换」的发行门禁 | 0 搭骨架，3 完成 | 发行门禁 |
| C6 回顾只完成一次 | 上游日回顾已经停掉，旧的积压已接管；已入库、还没导出时中断，重启后只补导出；原日期、主人打断、重启都不会重复写；`keepSelfCopy` 没有再覆盖文件 | 行为测试 | 3 | 行为清单 |
| C7 送达凭证 | 「我说过」只来自 Channels 持久化的已确认分段；分段发送、发送异常、结果不明、群工具换了正文，都按实际情况记；结果不明时不重发。分三个时点重启验证：排队后、准入后、网关已发出但确认丢失 | 行为测试 | 2 | 行为清单 |
| C8 设置兼容 | 不往 `companion` 对象写未知的键；新设置放在独立记录里 | 单元测试，加上 C4 | 2 | 行为清单 |
| C9 归属准确率 | 用合成的标准样例（复述、反问、同意、同名群友）测归属准确率 | 评测脚本，只出报告 | 2 | 否（作为止损依据） |
| C10 过期写入 | 体验块和注意力状态不会被晚到的旧轮覆盖 | 行为测试：生活先开始、当面先完成、生活后返回、重启后再问 | 2（顺序号）、4（体验块）、5（跨会话暂停） | 行为清单 |
| C11 派生不改原证据 | 两条来源生成一段情节，重启后撤回其中一条，再核对另一条原话、独立事实、人物卡各自的结果；「真源切换」起把导出也加进核对。派生观察的类型、和原始证据的关系、旧版读到的结果，都要写清楚并验证（启动修复按 `source_kind`、`pet_scope` 挑观察，见 `src/memory/provider.py:48-59`，独立 ID 不代表能豁免） | 行为测试 | 2 | 行为清单 |
| C12 撤回先于替换 | 按 `compactionId`、精确区间、来源版本和替换是否成功来对账（rc.5 先记摘要、再写替换、最后记结束，崩在中间会让「已有摘要」和「已替换」对不上，见 `DSH:dsh-compaction-basic/src/region.ts:233-245,491-509`）；替换前后发生撤回，下一次实际请求里都不能带上失效的内容 | 行为测试 | 1（压缩框架）、3（日记压缩） | 行为清单 |
| C13 可见性 | 用同一条「只给主人」的材料，分别核对：主人私聊、家人群最终发出的正文、外人私聊，以及**降级后的 0.6.0 guest**；第一眼还没完成或额度用完时也要核对。0.6.0 按同一个 Bank 去召回语义记忆（`src/memory/provider.py:462-475`），所以私密条目写入时就要让旧版的召回过滤选不到它（**不确定**，C13 来验证） | 行为测试，加上 C4 | 2 | 行为清单 |

<a id="individual-migration"></a>

### 10.10 迁移与回退

**格式版本：存储版本表一律不升。**

- 0.6.0 会逐项匹配整份模块版本表和迁移步骤（`src/core/workspace.ts:206-220`）。只要升了 Core、Living 或共享清单里的版本，旧包就会报 `migration-required`，旧 home 也就打不开了。
- 所以这次的新格式全部放进新的记录 kind、Bank 条目的 metadata，或者 Memory 自己的元数据。Memory 的记录格式版本也只记在 Memory 自己的元数据里，不进存储清单。
- 写进工作区清单的文件必须存在，类型也要对，新增文件不登记进清单。
- 0.6.0 读 Core 记录时按 kind 精确查询（`src/core/storage.ts:169-181`），所以新增的 kind 对旧包没有影响。

**迁移日记和自述（真源切换）：**

1. 停写，前提沿用离线备份那一套；做一份完整副本。
2. 逐个文件记录进度：原路径、类型（当前文件、日期快照、空文件）、原始字节的散列 → 目标条目和版本 → 导出散列核验 → 切换读写方。续做时要复核载荷。
3. 只承诺迁移现存的文件和快照（[拍板点 13](decisions.md#individual-decisions)）。
4. 切换后，导出文件保持 0.6.0 的格式。每次 Bank 提交之后，先导出，再写「换包安全点」标记。

**回退：**

- **切换前**：直接放弃。原文件没动过。
- **切换后降级**：只允许在换包安全点降级。降级后，旧包读导出文件；旧 home 的指针一直保留，按原会话 ID 打开。新预设下建的会话，旧包打不开。这些会话的原生日志还在；已经整理进 Bank 并且导出过的部分，在导出文件里。没配置 Bank 或者还没整理的轮次，就不在导出文件里了，C4 要把这几种情况区分开来核对。
- **降级后再升级**：按散列找出降级期间被改过的导出文件，作为新版本导入，只导入一次。降级期间被删掉的文件，**不**当作撤回处理，保留 Bank 里的版本，在 Console 里提示主人。Console 的并发版本检查照常生效。
- **离线恢复**：沿用现有的恢复器，要求同机、同绑定、同一个安装包指纹（`scripts/lib/offline-backup.mjs:85-130,268-296`）。现有恢复器按一份固定名单保留渠道记录（`:309-312,347-360`），新增的送达回执 kind 要加进这份名单。两种情况分别给出预期：备份之后才送达的消息，恢复后不重发；备份之后才撤回的内容，恢复后仍然保持撤回（撤回墓碑在 Bank 里，跟着 Bank 一起恢复，需要演练确认）。

**合成副本**：按真实布局生成，不含任何主人的内容，覆盖这些情况：当前文件、日期快照、同一天的重复快照、空文件、BOM、CRLF、末尾空行、Console 改过的自述、规则片段、原生摘要、没配置 Bank 的工作区。真实副本只在两个检查点用（阶段 0 只读盘点、真源切换的迁移回退），见 [产品阶段规划「真实数据怎么用」](product.md#真实数据怎么用)。

<a id="individual-extension"></a>

### 10.11 扩展路径

| 要新增 | 在哪里声明 | 由它派生出来的 |
| --- | --- | --- |
| 一种记忆条目（例如以后的「经验」） | Memory 的条目种类表（唯一的声明处），并映射到上游的四大类之一 | 适配层的写入校验、导出格式、Console 的筛选、R8 词表 |
| 一条消息定级规则 | Core 的定级规则表 | 注意力裁决、看手机的筛选 |
| 一个渠道 | 来源适配器，加上平台事实、已确认分段的提交 | 定级、原话入库、「我说过」 |
| 一个伙伴提示词段 | `registerWorldPrompt`，并声明出现在哪些预设下（新增字段） | C1、C2 从预设声明表枚举 |
| 一种后台模型用途 | 宿主侧的用途表，带预算和上限 | 账本按用途记账、Console 花费页、额度耗尽时的降级 |
| 一个伙伴预设 | Core 的预设声明表，加上 bundle 补丁里一行，挂在已有入口的预设配置分支上 | 伙伴资格、C1、C2、C4 |

<a id="individual-upstream"></a>

### 10.12 上游代码的边界

| 来源 | 许可 | 这次的边界 |
| --- | --- | --- |
| `vendor/mnemosyne`（canyueY/dsh-mnemosyne 2.0.0） | Apache-2.0 | 不动。规则合并和 Her World provider 启动时的修复，都会碰到同一批观察。聚合情节用独立的派生观察，纠正时只动派生项 |
| `vendor/dsh-world`（chenkezhen480/dsh-world 0.7.4） | MIT | 不动，但 **Her World 要接管回顾的发起、快照和完成判定**（见 10.12 回顾一行）；`plan_next` 承担不了多条提醒 |
| `vendor/dsh-pet` | 代码 MIT，素材各自有条款 | 不用碰。Desktop 的会话选择和预设归属在 Her World 侧改 |
| `vendor/feiyu-room-template` | 代码 MIT；二维美术 CC BY-NC-SA 4.0；模型仅限个人非商业 | 不用碰。群唤醒的判定可以复用 |
| `node_modules/@deepseek-ai/*` | MIT | 新服务和作用域由 Her World 自己注册 |
