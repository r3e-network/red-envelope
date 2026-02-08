# 红包

发送 GAS 红包给好友

## 概述

| 属性        | 值                    |
| ----------- | --------------------- |
| **应用 ID** | `miniapp-redenvelope` |
| **分类**    | 社交                  |
| **版本**    | 1.0.0                 |
| **框架**    | Vue 3 + Vite          |

## 功能特性

- Red-envelope
- Social
- Gift
- Lucky

## 权限要求

| 权限   | 是否需要 |
| ------ | -------- |
| 支付   | ✅ 是    |
| 随机数 | ✅ 是    |
| 数据源 | ❌ 否    |
| 治理   | ❌ 否    |

## 网络配置

### 测试网 (Testnet)

| 属性           | 值                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------- |
| **合约地址**   | `0xf2649c2b6312d8c7b4982c0c597c9772a2595b1e`                                                      |
| **RPC 节点**   | `https://testnet1.neo.coz.io:443`                                                                 |
| **区块浏览器** | [在 NeoTube 查看](https://testnet.neotube.io/contract/0xf2649c2b6312d8c7b4982c0c597c9772a2595b1e) |
| **网络魔数**   | `894710606`                                                                                       |

### 主网 (Mainnet)

| 属性           | 值                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------- |
| **合约地址**   | `0x5f371cc50116bb13d79554d96ccdd6e246cd5d59`                                              |
| **RPC 节点**   | `https://mainnet1.neo.coz.io:443`                                                         |
| **区块浏览器** | [在 NeoTube 查看](https://neotube.io/contract/0x5f371cc50116bb13d79554d96ccdd6e246cd5d59) |
| **网络魔数**   | `860833102`                                                                               |

## 平台合约

### 测试网 (Testnet)

| 合约                | 地址                                         |
| ------------------- | -------------------------------------------- |
| PaymentHub          | `0x0bb8f09e6d3611bc5c8adbd79ff8af1e34f73193` |
| Governance          | `0xc8f3bbe1c205c932aab00b28f7df99f9bc788a05` |
| PriceFeed           | `0xc5d9117d255054489d1cf59b2c1d188c01bc9954` |
| RandomnessLog       | `0x76dfee17f2f4b9fa8f32bd3f4da6406319ab7b39` |
| AppRegistry         | `0x79d16bee03122e992bb80c478ad4ed405f33bc7f` |
| AutomationAnchor    | `0x1c888d699ce76b0824028af310d90c3c18adeab5` |
| ServiceLayerGateway | `0x27b79cf631eff4b520dd9d95cd1425ec33025a53` |

### 主网 (Mainnet)

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
# 安装依赖
npm install

# 开发服务器
npm run dev

# 构建 H5 版本
npm run build

# 构建 Neo N3 合约（.nef + .manifest）
npm run contract:build
```

合约产物输出路径：

- `contracts/bin/sc/RedEnvelope.nef`
- `contracts/bin/sc/RedEnvelope.manifest.json`

## 玩法说明

### 红包池（多人领取）

1. 创建者发送 GAS，并设置红包数量、NEO 门槛与过期时间。
2. 用户从红包池领取一个名额后，会铸造一个 **Claim NFT**。
3. **领取名额不等于拿到 GAS**：必须执行 `OpenClaim` 才能拿到奖励。
4. 在打开前，Claim NFT 可以转给其他用户。
5. 若用户在过期前一直不打开，该用户实际获得 **0 GAS**。
6. 过期后，仅红包发行者可回收红包池未领取余额与未打开 Claim 的余额。

### 幸运 NFT（单个传播红包）

1. 创建者发送 GAS 后只铸造 **一个 Lucky NFT**，并设置可打开次数与过期时间。
2. 当前持有者可先打开一次领取随机 GAS，再转给下一位持有者继续打开。
3. 若持有者只转发不打开，则该持有者 **不会获得奖励**。
4. 同一地址对同一个红包仅可打开一次。
5. 当可打开次数用完后，NFT 自动销毁。
6. 过期后，仅原发行者可以回收剩余 GAS。

## 核心规则

- **仅真实用户可打开/领取**：合约账户不能执行打开或领取动作。
- **合约 Owner 不可参与红包流程**：Owner 不能创建/打开/领取/转让/回收红包。
- **必须打开才会到账**：仅持有或领取 NFT 不会自动转出 GAS。
- **过期严格生效**：红包过期后不能再打开或领取。
- **最小金额限制**：每个红包总额至少 `1 GAS`，每个份额至少 `0.1 GAS`。

## 资产配置

- **允许的资产**: GAS
- **单笔最大**: 100 GAS
- **每日上限**: 500 GAS

## 许可证

MIT License - R3E Network
