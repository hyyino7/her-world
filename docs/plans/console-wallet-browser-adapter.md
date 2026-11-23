# Console 钱包迁移：主人确认无浏览器待办

大改草案，主人 2026-11-23 拍板：三项按推荐。适用场景由主人确认：一直在 DSH 桌面主窗口 `dsh-app://app/` 打开设置页，从未用外部浏览器，0.4.0 钱包区看不到待确认请求。

## 推荐路线

- 主人在 0.4.0 当前绑定的设置页确认钱包已正常加载、无待确认或读取错误、无进行中的钱包操作，随后停止新写入、停 Life、退出 DSH。工具在 Repo 互斥内复用 `assertWalletBrowserOffline`，检查 DSH 主进程、原生会话锁、Core、Economy、Memory（含保留 Bank）及绑定。探测失败或仍有写入者即拒绝。（`scripts/migrate/runner.mjs:121–141`、`scripts/migrate/context.mjs:36–70`、`scripts/lib/offline-backup.mjs:145–161`）
- 拟增布尔参数 `--owner-attests-no-pending`。0.4.0 停写检查和旧备份核验通过后，`seal-wallet-rollback` 把「主人声明无待办」、来源 `dsh-app://app`、封锚时的 UTC 时间、完整钱包绑定、迁移轮次与版本对写进同一回退锚；换到 0.5.0 后校验锚和声明摘要，`0004` 将声明写入日志及持久导入证明，导入零条、无业务派发。钱包已采用时证明落钱包库，未采用时落独立文件。（`scripts/migrate/wallet-rollback.mjs:12–15,36–78`、`scripts/migrate/steps/0004-console-wallet.mjs:26–34,66–84`）
- 只准用于同一绑定从安装包 0.4.0 到 0.5.0 的未执行 `0004`，用安装包版本、旧备份指纹和换包后指纹、迁移状态共同校验。相同轮次中断后只凭原锚和日志 `--resume`，沿用原声明时间；完成后带参数的 `status` 只核对已落盘的证明。（`v0.4.0:package.json:1–4`、`v0.5.0:package.json:1–4`、`scripts/lib/offline-backup.mjs:209–218,239–256`、`scripts/migrate/runner.mjs:37–76,159–202`）
- 显式提供 `--wallet-export` 即拒绝与声明并用。本轮私有材料目录或已有日志、锚若显示存在钱包导出（含非空导出）或外部浏览器来源清单（含空待办来源），拒绝并保留原件。实施时在私有材料目录约定识别 `wallet-export.json` 和 `wallet-sources.json`；其他位置的材料由主人列入本轮，工具仅查本轮已知材料。无声明、无有效导出时，执行迁移仍拒绝。（现有导出自带 `sources`，执行要求导出和锚，见 `scripts/migrate/wallet-export.mjs:60–81`、`scripts/migrate/wallet-rollback.mjs:120–125`）
- 本场景以「声明和锚可核验、零条导入、升级与回退通过」闭环，取代原草案对 Electron 的直读、清源和回插。工具不读取 Electron 存储，不清源、不回插；双备份照旧。发现真实待办则停下，阶段 3 的「导出 → 导入核对 → 清除」标准继续适用。（`docs/product.md:424–432`、`docs/development.md:139–154`）

## 证据边界与残留键

- 0.4.0 从 `chatpet:economy:pending:<workspaceId>` 恢复并显示当前绑定的待办，读到无效记录也会标错并进入待确认状态。主人亲见页面正常且无待办，且没有外部浏览器使用史，足以接受这次零条导入。停写检查只验证宿主和写入者，声明无法证明物理存储没有旧键，也无法证明某笔旧业务的提交结果。（`v0.4.0:src/console/client.js:449–465,540–546`、`scripts/migrate/context.mjs:36–70`）
- 0.5.0 的钱包从 `economyPending` 取后端待办，重试入口来自后端待办或新版当前会话的请求状态。它不读这个旧键。未显示的旧键会留在 Electron 内，既不会迁入新版待办，也不会触发重试或拦住新写入；若键里确有未提交请求，新版无法从该键恢复这笔操作。已提交的效果由原账本保留，可核对流水。回退后若回到同一存储分区且键仍在，0.4.0 可能重新显示；交给主人在旧版核对流水，再决定是否按原号处理。（`src/console/client.js:447–476,511–545,557–563,579–602`、`src/living/economy/plugin.ts:312–331`、`v0.4.0:src/console/client.js:449–458,540–548`）

## 拟改文件

- **高风险 `scripts/migrate/`，拍板后再改。** `companion-migrate.mjs` 接参数；`runner.mjs` 接停写、预检、执行、续做及状态核验；`wallet-rollback.mjs` 封存和验证声明及旧备份；`steps/0004-console-wallet.mjs` 复用零条落盘；`errors.mjs` 提供固定拒绝原因。复用现有 Repo 互斥和双备份核验。（`AGENTS.md:60–61`、`scripts/migrate/companion-migrate.mjs:6–40`、`scripts/migrate/runner.mjs:92–112,159–202`、`scripts/migrate/wallet-rollback.mjs:93–125`、`scripts/migrate/errors.mjs:22–29`）
- 保持正式 0.5.0 可读取的证明形状。沿用 `mode: import` 和日志必填字段，将声明作为附加字段，`sourceCount: 1` 表示一处声明来源。摘要绑定声明，日志现有 `exportFile` 路径槽指向回退锚。禁止把声明编码成浏览器读到空键；现有浏览器导出校验继续独立使用。（`src/core/storage-migration.ts:33–45,80–104,142–153`、`scripts/migrate/wallet-export.mjs:24–36,60–81`）
- 更新 `tests/migrate/console-wallet.test.mjs`、`tests/migrate/wallet-rollback-040.mjs` 和 `docs/development.md`。从已构建源码检出交付离线工具，推荐沿用正式 0.5.0 页面与运行时。（`tests/migrate/console-wallet.test.mjs:16–56`、`tests/migrate/wallet-rollback-040.mjs:172–190`、`docs/development.md:68–70`、`package.json:41–83`）

## 合成验收

- 带声明放行，验证证明包含来源、时间及绑定，钱包已采用和未采用都导入零条且状态为 `settled`。缺声明且无导出仍拒；声明与非空导出冲突拒；发现外部浏览器来源清单即使待办为空也拒；DSH 未退出时封锚和执行均拒。拒绝后保留原材料和迁移状态。
- 用实际 0.4.0/0.5.0 包做隔离合成演练，覆盖错版本或错绑定拒绝、同轮续做、0.5.0 读取证明并激活、核验旧备份及换回 0.4.0 恢复。放入合成残留键，验证新版不读取、不修改、不据此展示或重试。（`tests/migrate/wallet-rollback-040.mjs:172–190,304–368`）
- 快测 `pnpm run build` 后跑 `node --test tests/migrate/console-wallet.test.mjs tests/migrate/browser-wallet.test.mjs`；另设 `HER_WORLD_040_ROOT` 指向已构建的 v0.4.0 检出，跑 `node --test tests/migrate/wallet-rollback-040.mjs`。合并前跑 `pnpm run verify`。（`package.json:92,128`、`tests/migrate/wallet-rollback-040.mjs:172–179`、`AGENTS.md:54–55`）

## 主人本机操作（先在隔离副本）

1. 在 0.4.0 桌面设置页确认当前绑定的钱包正常且无待办 → 停新写入、停 Life、完全退出 DSH。
2. 仍装着 0.4.0 时用 `companion-backup.mjs create/verify` 建并验旧备份；用拟议 `seal-wallet-rollback --owner-attests-no-pending --installation "$RECEIPT" --backup "$ROLLBACK" --output "$ANCHOR"` 封锚。
3. 换包期间保持业务停写，换到 0.5.0 后再退出 DSH。依次跑拟议的 `plan`、`run`、`status`，都带 `--installation "$RECEIPT" --wallet-rollback "$ANCHOR" --owner-attests-no-pending`；仅 `run` 加 `--backup "$RESUME_BACKUP"`。中断用同轮 `run --installation "$RECEIPT" --resume`。
4. 核对 `0004` 完成、零条与 `segment=settled`，再在隔离验收环境打开 0.5.0，核对钱包、余额、库存和 Body。需要回退时换回 0.4.0、退出 DSH、用拟议的 `verify-wallet-rollback --installation "$RECEIPT" --wallet-rollback "$ANCHOR"` 验锚、恢复旧备份并核对。保留两份备份到主人关闭回退窗口。（现有命令与顺序见 `scripts/migrate/companion-migrate.mjs:6–36`、`scripts/companion-backup.mjs:67–72`、`docs/development.md:111–116,141–154`）

## 拍板点与待核实

- **是否接受主人声明路线**。推荐接受，仅限本次 DSH 桌面场景。
- **参数名**。推荐 `--owner-attests-no-pending`，直接表明这是主人的声明。
- **0.5.0 是否提示残留旧键**。推荐不提示。提示会重新增加对旧键的访问，键存在也无法说明请求是否已生效。若回退后旧版显示待办，按上面的旧版核对流程处理。
- **待核实**。用合成安装在主人同型 DSH 环境验停写探测，尤其是完全退出后是否仍有可写的宿主进程，以及正式 0.5.0 包能否读取带声明的证明并激活。实机无法确认停写时继续拒绝。

## 执行结果

- `companion-migrate.mjs` 接入声明路线，`runner.mjs` 在 Repo 互斥内预检、执行和续做。`wallet-rollback.mjs` 封存并核对旧备份、来源、UTC 时间、完整绑定、轮次和版本对。`0004-console-wallet.mjs` 导入零条，将声明写入日志和钱包库或独立证明。`errors.mjs` 提供固定拒绝原因。
- `console-wallet.test.mjs` 覆盖独立证明、历史状态、冲突与停写拒绝。`wallet-rollback-040.mjs` 覆盖已采用钱包的零条导入、原锚续做、正式版激活、残留键隔离和回退。主人命令见 [开发说明](../development.md#console-wallet-migration)。
- **无需发 0.5.1。** 主人可将实现补丁应用到 `v0.5.0`（`f723ba1`）源码检出，构建后运行离线工具。原标签的迁移 CLI 缺少声明参数。原版 0.5.0 运行时按既有 `mode: import` 结构验日志和证明，附加的 `ownerAttestation` 由离线工具核验。用该标签原样打包后，合成副本已通过钱包激活与写入。见 [证明校验](../../src/core/storage-migration.ts#L80-L104)和[激活门禁](../../src/core/workspace.ts#L223-L241)。
- `pnpm run build`、钱包快测 20/20、`pnpm run check:arch` 均通过。`node --test tests/migrate/*.test.mjs` 重跑 212/212，首轮 211/212，失败发生在 `compatibility.test.mjs` 的 Memory 合成数据准备阶段，返回 HTTP 422。
- 从 `v0.4.0`（`4a46daa`）和 `v0.5.0` 构建并打包，设置 `HER_WORLD_040_ROOT` 与 `HER_WORLD_050_ROOT` 跑 `wallet-rollback-040.mjs`，4/4 通过。`pnpm run test:behavior-list` 的索引检查 11/11、行为 170/170 通过。
- 未验证主人同型 DSH 的实机停写探测、Electron 实际分区和真实副本验收。全量 `pnpm run verify` 留待合并前运行。

## 附录：未来需要时

A．离线直读扩到 Electron 存储，先验证 profile／分区、独占与原值保真；B．新包同源页用专用 RPC 暂存，再离线导入；C．主人用开发者工具手动导出，供本地取证。出现真实待办或外部来源时另行拍板。
