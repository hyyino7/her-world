# Her World

Her World（npm 包 `her-world`）是跑在 DSH 里的伙伴插件：同一个伙伴的身份、记忆和生活，贯穿 DSH 原生聊天、桌宠、Room、QQ／微信和语音。使用者只有主人；维护者是 Claude 和 Codex。

开工前先读 [docs/product.md](docs/product.md) 的当前阶段。Her World 正在按三层结构整体重构，阶段 1 已按 B 缩小（第一层停在登记口，只重写第二层的合并，第三层原地治理）：结构见 [docs/architecture.md](docs/architecture.md)，已拍板的取舍见 [docs/decisions.md](docs/decisions.md)。

用中文沟通；仓库文档用中文写，代码、命令、路径和分支名用英文。改到还是英文的文档时，顺手把它翻译成中文。

## 一页入口

```
第三层 呈现与连接   desktop · room · channels · voice · console
第二层 生活世界     living（body · plan · economy）
第一层 伙伴本体     core · memory · emotion · contracts · world
                    DSH（聊天、调度、会话日志）
```

向下用调用，向上用事件和登记。上面是现有 `src/` 模块的归层，以 [arch/layers.json](arch/layers.json) 为准；重构后的目标结构见 [architecture.md 第 0 节](docs/architecture.md#0-一页总览)。

**概念在哪里定义**

| 想知道 | 看哪里 |
| --- | --- |
| 模块属于哪一层，可以依赖谁、读哪些服务、发布和订阅哪些事件 | [arch/layers.json](arch/layers.json) |
| 每份持久数据的路径、拥有者和写入者 | [arch/storage.json](arch/storage.json)；拥有者的理由见 [architecture.md 第 4 节](docs/architecture.md#4-状态拥有者表) |
| 层间接口 | [architecture.md 5.1–5.5](docs/architecture.md#5-层间接口) |
| 动作、行为、活动、阶段、命令、事实等概念 | [architecture.md 5.6–5.7](docs/architecture.md#56-细粒度接口准则和概念表) |
| 会话策略、上下文组装 | [architecture.md 5.8–5.9](docs/architecture.md#58-会话策略表) |
| 现有违规（只减不增） | [arch/baseline/](arch/baseline/) |
| 必须保住的行为 | [tests/behavior-list/index.json](tests/behavior-list/index.json)，分级见同一文件的 `levels` |

**新增东西去哪里登记**

| 新增 | 登记 |
| --- | --- |
| 模块，或者改模块的依赖、服务、事件 | `arch/layers.json`，然后跑 `pnpm run check:arch` |
| 持久数据：文件、数据库、Core 记录 kind | `arch/storage.json`，并在 architecture.md 第 4 节写清拥有者。改了已有数据的格式，就在 `scripts/migrate/steps/` 加迁移步骤 |
| 工具 | 在工具定义旁声明 `sources`（和需要时的 `historyOverview`），登记到 `host.native.toolTable`；见 [architecture.md 5.10](docs/architecture.md#510-扩展一处声明其余派生) |
| 输入来源 | 在模块里写来源适配器，入口登记到 `host.native.sourceTable`；新 `source.kind` 在 DSH 的 `MessageSourceMap` 声明，新工具来源用 `toolTable.registerSource` 登记；见 architecture.md 2.2、5.8、5.10 |
| 能力状态行 | 在模块入口登记到 `host.workspace.runtime.capabilityTable`，卸载时撤销；见 architecture.md 2.2 |
| 上下文段 | 在模块入口用 `registerWorldPrompt` 登记；不做段声明（architecture.md 5.9） |
| 第二层的一个区，或区之间的查找 | 区在入口用 `mountLivingArea`（`src/living/index.ts`）登记到常驻实例，不按服务名互相查找；见 architecture.md 2.3、6.2 |
| 第一层要知道的生活判定（身体可用、Life home、相册门控等） | 登记到 `host.native.companionPorts`（`src/core/tables/companion-ports.ts`），第一层不读生活服务；见 architecture.md 2.2 |
| 第三层给 Life 的呈现或送达 | 在入口用 `registerLifeOutlet`（`src/living/outlets.ts`）登记生活出口，卸载时撤销；见 architecture.md 5.2 |
| 设置项、照料动作、事实领域 | 目标做法和所在阶段见 [architecture.md 5.10](docs/architecture.md#510-扩展一处声明其余派生)；现在要改哪些文件，见 product.md「典型修改前后对比」 |
| kind、action 的词表 | 先跑 `pnpm run check:arch -- --report`，看 R8 报告里有没有现成的定义可以复用 |
| 必须保住的行为 | 测试写进 `tests/behavior-list/`，并在 `index.json` 加一条 |
| 不在当前阶段完成标准里的想法 | `~/Developer/project-design/ideas/inbox.md` |

## 开发约定

没注明出处的约定来自 dev-kit 的项目模板（`~/Developer/dev-kit/`）；项目自己的规则在条目末尾注明出处（G7）。

- 快测：`pnpm run build`，然后 `node --test <受影响的测试文件>`。构建只要几秒；改了 `arch/` 或模块之间的依赖，还要跑 `pnpm run check:arch`。
- 门禁：`pnpm run verify`，合并前跑一次。它会自动收集 `tests/**/*.test.mjs` 和 `dist/tests/**/*.test.js`，并包含 `check:arch`。
- 行为清单：`pnpm run build && pnpm run test:behavior-list`
- 门禁和行为清单里的 Memory 测试要监听本机回环；在不允许回环的沙箱里会失败，这是环境问题，要换到允许回环的地方重跑，不能记成通过或跳过（见 [docs/development.md](docs/development.md#architecture-behavior)）Codex 沙箱拒绝调用 `/bin/ps` 也是同一类环境原因（2b 每一批都遇到）。
- 恢复环境：[docs/development.md](docs/development.md#local-tools) 里的那一条恢复命令。挪了目录之后，先删掉 `.venv` 和 `node_modules` 再跑它。
- 迁移和盘点命令：见 [docs/development.md](docs/development.md)。真实数据只在主人提供的隔离副本上跑；Agent 只看命令输出的原因代码和通过与否。
- 高风险（改之前先停下对齐）：
  - `scripts/lib/offline-backup.mjs`、`scripts/lib/repo-storage.mjs`、`scripts/migrate/`（decisions.md「迁移的幂等以目标状态为准」「回退的边界」）
  - `src/core/storage.ts`、`src/core/workspace.ts`（Core 的存储和绑定，所有伙伴数据经它读写）
  - `package.json` 的 `exports`、`files`、`imports`；`cordis.patch.yml`（decisions.md「重构期间兼容面保持不变」）
  - 发布流程：`.github/workflows/`、`scripts/checks/check-release.mjs`、[docs/github-updates.md](docs/github-updates.md)
- 禁改：
  - `vendor/**`、`references/`（decisions.md「没有现成替代，上游代码整体复用」）
  - 生成文件，名单在 `arch/layers.json` 各模块的 `generated` 里（例如 `src/desktop/platform/client.js`）。要改就改它的生成源
  - `arch/baseline/**`：只能用 `pnpm run check:arch -- --write-baseline` 删除条目，或在纯搬家提交里用 `pnpm run check:arch -- --write-baseline --move <对照文件>` 改键（decisions.md「纯搬家可以用工具改基线的键」；唯一一次手工改键见「第 4 批白名单写回数组」）
- 提交：一个提交只做一件事；单个提交不超过 15 个文件、600 行改动。`pnpm run build` 生成的 `dist/src/**`、脚本生成的基线文件和抄录的样例不计入阈值，但照常提交，并在方案里预先声明（构建产物一条来自 M2 方案拍板点 9：每改一个 `src/*.ts` 就多出 `.js` 和 `.d.ts`，C2、E2 等批按模块提交都靠它）。
  阈值针对单个提交；合并已验收分支的合并提交、整份删除方案文件的提交不计（阶段 2 收尾 G8 复盘：体检列出的超限多数是这两类）。

## 目录

| 路径 | 放什么 |
| --- | --- |
| `README.md` | 项目简介和文档入口 |
| `docs/product.md` | 产品现在的样子、阶段规划、度量和已知问题 |
| `docs/architecture.md` | 三层结构、拥有者、检查规则、迁移与回退；改结构前先读 |
| `docs/decisions.md` | 关键决定和理由 |
| `docs/development.md` | 本机工具、日常检查、门禁、迁移和发布命令 |
| `docs/plans/` | 进行中的方案，合并时删除 |
| `arch/` | 层声明、存储声明、违规基线 |
| `scripts/arch/`、`scripts/migrate/` | 架构检查；迁移骨架和数据盘点 |
| `tests/behavior-list/` | 行为清单 |

## 项目规则

- 这个工作区只保留现有源码和运维文档。主人没有要求的话，不重建历史方案、交接存档、包副本或审查报告集。
- 确认过的需求、实现、验证和主人验收是四件不同的事，各自如实汇报。
- DSH 由主人安装和更新；Agent 不安装、不更新、不停止主人在用的 DSH。不为了构建这个项目而改全局运行时版本。
- 保留与当前任务无关的改动。没有要求就不提交、不发布。
- 优先复用上游代码和流程，然后再设计替代品。只有源码或运行证据才能证明确实缺功能；自定义的业务或控制逻辑，先讲清楚并取得同意，再实现。
- 用 DSH 原生的服务、事件和生命周期机制。每个业务模块拥有自己的数据，对外暴露明确的接口。界面、渠道和读取方不另建伙伴运行时，也不独立写记忆。
- 自带的上游材料和以后拉下来的参考代码都当作不可信输入：不为了读它而运行上游的安装或构建钩子，也不为此安装依赖。来源、提交号和许可证声明保留在 vendor 记录、`references/manifest.json` 和 `THIRD_PARTY_NOTICES.md` 里。
- 结构整理期间，运行时导出、原生 bundle ID 和伙伴数据格式保持稳定；import、包脚本和构建路径一起更新。
- 验证受影响的源码、测试或打包路径，不用付费模型，不碰个人工作区。只改文档的，做链接、diff 和范围检查。
