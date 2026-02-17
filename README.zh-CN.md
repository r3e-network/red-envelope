# 红包

在 Neo N3 上发送 GAS 红包给好友

## 概述

| 属性        | 值                    |
| ----------- | --------------------- |
| **应用 ID** | `miniapp-redenvelope` |
| **分类**    | 社交                  |
| **版本**    | 1.0.0                 |
| **框架**    | Vue 3 + Vite          |
| **标准**    | NEP-11 (NFT)          |
| **网络**    | Neo N3 主网           |

## 功能特性

- 基于链上随机数的 GAS 红包
- 双模式：红包池（多人领取）与幸运 NFT（单个传播）
- NEO 加权幸运加成 — 持有更多 NEO 可提升中奖概率
- Claim NFT 铸造、持续可转让与打开领取机制
- 可升级合约，支持管理员暂停/恢复熔断开关
- 双语界面（English / 中文）

## 网络配置

| 属性           | 值                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------- |
| **合约地址**   | `0x215099698349ba405400b3b2fe97bb96941c0f9b`                                              |
| **RPC 节点**   | `https://mainnet1.neo.coz.io:443`                                                         |
| **区块浏览器** | [在 NeoTube 查看](https://neotube.io/contract/0x215099698349ba405400b3b2fe97bb96941c0f9b) |
| **网络魔数**   | `860833102`                                                                               |

## 平台合约

| 合约                | 地址                                         |
| ------------------- | -------------------------------------------- |
| PaymentHub          | `0xc700fa6001a654efcd63e15a3833fbea7baaa3a3` |
| Governance          | `0x705615e903d92abf8f6f459086b83f51096aa413` |
| PriceFeed           | `0x9e889922d2f64fa0c06a28d179c60fe1af915d27` |
| RandomnessLog       | `0x66493b8a2dee9f9b74a16cf01e443c3fe7452c25` |
| AppRegistry         | `0x583cabba8beff13e036230de844c2fb4118ee38c` |
| AutomationAnchor    | `0x0fd51557facee54178a5d48181dcfa1b61956144` |
| ServiceLayerGateway | `0x7f73ae3036c1ca57cad0d4e4291788653b0fa7d7` |

## 开发指南

```bash
# 安装前端依赖
cd frontend && npm install

# 配置前端（默认主网）
cp .env.example .env

# 开发服务器
cd .. && npm run dev

# 构建前端
npm run build

# 构建 Neo N3 合约（.nef + .manifest）
npm run contract:build

# 通过 neo-llvm 构建 Rust 版 Neo N3 合约
npm run contract:build:rust

# 通过 neo-solidity 构建 Solidity 版 Neo N3 合约
npm run contract:build:solidity

# 一次性构建全部版本（C# + Rust + Solidity）
npm run contract:build:all
```

合约产物输出路径：

- `contracts/bin/sc/RedEnvelope.nef`
- `contracts/bin/sc/RedEnvelope.manifest.json`
- `contracts-rust/red-envelope-neo/build/RedEnvelopeRust.nef`
- `contracts-rust/red-envelope-neo/build/RedEnvelopeRust.manifest.json`
- `contracts-solidity/build/RedEnvelope.nef`
- `contracts-solidity/build/RedEnvelope.manifest.json`

## 多语言合约版本

- `contracts/`：C# Neo N3 主合约实现
- `contracts-rust/red-envelope-neo/`：Rust Neo N3 合约（基于 `neo-llvm`）
- `contracts-solidity/RedEnvelope.sol`：Solidity Neo N3 合约（基于 `neo-solidity`）

### 部署脚本

| 脚本                        | 用途               |
| --------------------------- | ------------------ |
| `scripts/deploy-mainnet.js` | 部署全新合约到主网 |
| `scripts/deploy-update.js`  | 原地升级现有合约   |
| `scripts/test-e2e.js`       | 完整端到端流程验证 |

```bash
# 部署新合约
DEPLOYER_WIF=... node scripts/deploy-mainnet.js

# 升级现有合约
KEY1_WIF=... KEY2_WIF=... node scripts/deploy-update.js

# 运行端到端测试
KEY1_WIF=... KEY2_WIF=... node scripts/test-e2e.js
```

## 玩法说明

### 红包池（多人领取）

1. 创建者发送 GAS，并设置红包数量、NEO 门槛与过期时间。
2. 用户从红包池领取一个名额后，会铸造一个 **Claim NFT**。
3. **领取名额不等于拿到 GAS**：必须执行 `OpenClaim` 才能拿到奖励。
4. Claim NFT 在打开前后都可以继续转给其他用户。
5. 若用户在过期前一直不打开，该用户实际获得 **0 GAS**。
6. 过期后，仅红包发行者可回收红包池未领取余额与未打开 Claim 的余额。

### 幸运 NFT（单个传播红包）

1. 创建者发送 GAS 后只铸造 **一个 Lucky NFT**，并设置可打开次数与过期时间。
2. 当前持有者可先打开一次领取随机 GAS，再转给下一位持有者继续打开。
3. 若持有者只转发不打开，则该持有者 **不会获得奖励**。
4. 同一地址对同一个红包仅可打开一次。
5. 当可打开次数用完后，仅奖励耗尽，NFT 仍可继续转让。
6. 过期后，仅原发行者可以回收剩余 GAS。

### NEO 加权幸运加成

随机 GAS 分配采用基于打开者 NEO 余额的「择优 N 次」掷骰机制：

| NEO 余额 | 掷骰次数 | 效果              |
| -------- | -------- | ----------------- |
| 0–99     | 1        | 基准均匀随机      |
| 100–999  | 2        | 取 2 次中较优结果 |
| 1000+    | 3        | 取 3 次中最优结果 |

持有更多 NEO 可提升获得更大奖励的概率，但不保证获得最大值。所有掷骰均从单次 `Runtime.GetRandom()` 调用中通过位移除法提取。

为避免极端金额，单次打开/领取金额增加上限机制：
- 基础上限为红包总额的 `20%`。
- 当红包份数较少时，会自动抬升到至少 `ceil(总额 / 份数)`，以保证整个分配过程可完成。

## 核心规则

- **仅真实用户可打开/领取**：合约账户不能执行打开或领取动作。
- **必须打开才会到账**：仅持有或领取 NFT 不会自动转出 GAS。
- **过期严格生效**：红包过期后不能再打开或领取。
- **过期上限**：创建红包时过期时长最多 `7 天`（`604800000 ms`）。
- **打开/回收流程不会销毁 NFT**：已结算红包仍可作为收藏品持续转让。
- **最小金额限制**：每个红包总额至少 `1 GAS`，每个份额至少 `0.1 GAS`。
- **防暴击上限**：单次打开/领取不会超过该红包的单次上限（默认 20%，低份数场景会自动做可行性调整）。

## 合约 API

以下所有函数已在 Neo N3 主网验证通过。
运行端到端测试请设置 `KEY1_WIF` 和 `KEY2_WIF`，然后执行 `node scripts/test-e2e.js`。

### 入口

| 方法             | 参数                     | 返回值 | 说明                                                                                                       |
| ---------------- | ------------------------ | ------ | ---------------------------------------------------------------------------------------------------------- |
| `OnNEP17Payment` | `from`, `amount`, `data` | —      | 接收 GAS 并创建红包。`data` 为数组：`[packetCount, expiryMs, message, minNeo, minHoldSec, envelopeType]`。 |

### 传播红包（Lucky NFT）

| 方法               | 参数                               | 返回值                   | 说明                         |
| ------------------ | ---------------------------------- | ------------------------ | ---------------------------- |
| `OpenEnvelope`     | `envelopeId`, `opener`             | `BigInteger`（GAS 金额） | 当前持有者打开领取随机 GAS。 |
| `TransferEnvelope` | `envelopeId`, `from`, `to`, `data` | —                        | 将 Lucky NFT 转给其他用户。  |
| `ReclaimEnvelope`  | `envelopeId`, `creator`            | `BigInteger`（退款）     | 过期后创建者回收剩余 GAS。   |

### 红包池

| 方法            | 参数                    | 返回值                       | 说明                         |
| --------------- | ----------------------- | ---------------------------- | ---------------------------- |
| `ClaimFromPool` | `poolId`, `claimer`     | `BigInteger`（Claim NFT id） | 领取名额，铸造 Claim NFT。   |
| `OpenClaim`     | `claimId`, `opener`     | `BigInteger`（GAS 金额）     | 打开 Claim NFT 领取 GAS。    |
| `TransferClaim` | `claimId`, `from`, `to` | —                            | 转让 Claim NFT（可已打开）。 |
| `ReclaimPool`   | `poolId`, `creator`     | `BigInteger`（退款）         | 过期后创建者回收未领取 GAS。 |

### 查询（只读）

| 方法                      | 参数                   | 返回值       | 说明                      |
| ------------------------- | ---------------------- | ------------ | ------------------------- |
| `GetEnvelopeState`        | `envelopeId`           | `Map`        | 红包完整元数据。          |
| `GetClaimState`           | `claimId`              | `Map`        | Claim NFT 元数据。        |
| `CheckEligibility`        | `envelopeId`, `user`   | `Map`        | 仅校验 NEO 门槛（余额/持有时长）。 |
| `CheckOpenEligibility`    | `envelopeId`, `user`   | `Map`        | 包含持有者与状态校验的完整打开/领取资格。 |
| `HasOpened`               | `envelopeId`, `opener` | `bool`       | 地址是否已打开。          |
| `GetOpenedAmount`         | `envelopeId`, `opener` | `BigInteger` | 打开者获得的 GAS。        |
| `HasClaimedFromPool`      | `poolId`, `claimer`    | `bool`       | 地址是否已领取。          |
| `GetPoolClaimedAmount`    | `poolId`, `claimer`    | `BigInteger` | 领取的 GAS 金额。         |
| `GetPoolClaimIdByIndex`   | `poolId`, `claimIndex` | `BigInteger` | 按索引获取 Claim NFT id。 |
| `GetTotalEnvelopes`       | —                      | `BigInteger` | 全局红包计数器。          |
| `GetTotalDistributed`     | —                      | `BigInteger` | 已分发 GAS 总量。         |
| `GetCalculationConstants` | —                      | `Map`        | 最小金额、最大上限。      |

### 管理

| 方法               | 参数              | 返回值    | 说明                     |
| ------------------ | ----------------- | --------- | ------------------------ |
| `GetOwner`         | —                 | `UInt160` | 当前合约所有者。         |
| `SetOwner`         | `newOwner`        | —         | 转移所有权。             |
| `IsOwner`          | —                 | `bool`    | 检查调用者是否为所有者。 |
| `Pause` / `Resume` | —                 | —         | 紧急熔断开关。           |
| `IsPaused`         | —                 | `bool`    | 暂停状态。               |
| `Update`           | `nef`, `manifest` | —         | 链上升级合约。           |
| `Destroy`          | —                 | —         | 永久销毁合约。           |

### 事件

| 事件               | 字段                                     | 触发条件              |
| ------------------ | ---------------------------------------- | --------------------- |
| `EnvelopeCreated`  | `id, creator, amount, packetCount, type` | 红包或 Claim NFT 铸造 |
| `EnvelopeOpened`   | `id, opener, amount`                     | GAS 分发给打开者      |
| `EnvelopeRefunded` | `id, creator, amount`                    | 过期后创建者回收      |

## 工作原理

1. **文化传统**：基于中国红包（压岁钱/利是）传统
2. **智能合约托管**：发行者的 GAS 存放在合约中，直到用户打开领取
3. **NEO 加权随机**：红包金额使用 Neo 运行时随机数，并为 NEO 持有者提供择优 N 次幸运加成
4. **双模式**：红包池模式（每个名额一个 Claim NFT）与幸运 NFT 模式（单个可转让红包）
5. **打开即领取**：用户仅在执行打开操作时才会收到 GAS
6. **过期 + 回收**：过期后仅发行者可回收未打开/剩余的 GAS
7. **NFT 持久化**：打开或领完后 NFT 不会销毁，仍可持续转让
8. **可升级**：合约所有者可通过 `Update(nef, manifest)` 推送更新，无需重新部署

## 资产配置

- **允许的资产**: GAS
- **单笔最大**: 100 GAS
- **每日上限**: 500 GAS

## 许可证

MIT License - R3E Network
