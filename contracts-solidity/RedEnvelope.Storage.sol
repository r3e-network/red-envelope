// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../.toolchains/neo-solidity/devpack/contracts/Syscalls.sol";
import "../.toolchains/neo-solidity/devpack/contracts/NativeCalls.sol";

abstract contract RedEnvelopeStorage {
    uint256 internal constant MIN_AMOUNT = 100_000_000;
    uint256 internal constant MAX_PACKETS = 100;
    uint256 internal constant MIN_PER_PACKET = 10_000_000;
    uint256 internal constant PERCENT_BASE = 10_000;
    uint256 internal constant MAX_SINGLE_PACKET_BPS = 2_000;
    uint256 internal constant MAX_SINGLE_PACKET_AVG_BPS = 18_000;
    uint256 internal constant DENSE_PACKET_THRESHOLD = 50;
    uint256 internal constant MEDIUM_PACKET_THRESHOLD = 20;
    uint256 internal constant DENSE_VOLATILITY_LOW_BPS = 7_000;
    uint256 internal constant DENSE_VOLATILITY_HIGH_BPS = 13_000;
    uint256 internal constant MEDIUM_VOLATILITY_LOW_BPS = 5_000;
    uint256 internal constant MEDIUM_VOLATILITY_HIGH_BPS = 17_000;
    uint256 internal constant SPARSE_VOLATILITY_LOW_BPS = 3_000;
    uint256 internal constant SPARSE_VOLATILITY_HIGH_BPS = 23_000;
    uint256 internal constant NEO_INT_MAX = 0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
    uint256 internal constant DEFAULT_EXPIRY_MS = 604_800_000;
    uint256 internal constant MAX_EXPIRY_MS = 604_800_000;
    uint256 internal constant DEFAULT_MIN_NEO = 0;
    uint256 internal constant DEFAULT_MIN_HOLD_SECONDS = 0;

    uint256 internal constant ENVELOPE_TYPE_SPREADING = 0;
    uint256 internal constant ENVELOPE_TYPE_POOL = 1;
    uint256 internal constant ENVELOPE_TYPE_CLAIM = 2;

    address internal constant GAS_HASH = 0xd2a4cff31913016155e38e474a2c06d08be276cf;

    address internal owner;
    bool internal paused;
    uint256 internal nextEnvelopeId;
    uint256 internal totalEnvelopes;
    uint256 internal totalDistributed;

    mapping(uint256 => address) internal envelopeCreator;
    mapping(uint256 => uint256) internal envelopeTotalAmount;
    mapping(uint256 => uint256) internal envelopePacketCount;
    mapping(uint256 => string) internal envelopeMessage;
    mapping(uint256 => uint256) internal envelopeType;
    mapping(uint256 => uint256) internal envelopeParentEnvelopeId;
    mapping(uint256 => uint256) internal envelopeOpenedCount;
    mapping(uint256 => uint256) internal envelopeRemainingAmount;
    mapping(uint256 => uint256) internal envelopeMinNeoRequired;
    mapping(uint256 => uint256) internal envelopeMinHoldSeconds;
    mapping(uint256 => bool) internal envelopeActive;
    mapping(uint256 => uint256) internal envelopeExpiryTime;

    mapping(uint256 => address) internal tokenOwner;
    mapping(uint256 => mapping(address => uint256)) internal openedAmount;
    mapping(uint256 => mapping(address => uint256)) internal poolClaimedAmount;
    mapping(uint256 => mapping(uint256 => uint256)) internal poolClaimIndex;

    uint256[] internal tokenIds;
    mapping(uint256 => uint256) internal tokenIndexPlusOne;
    mapping(address => uint256[]) internal ownerTokenIds;
    mapping(address => mapping(uint256 => uint256)) internal ownerTokenIndexPlusOne;

    struct EnvelopeStateView {
        uint256 id;
        address creator;
        uint256 totalAmount;
        uint256 packetCount;
        uint256 openedCount;
        uint256 claimedCount;
        uint256 remainingAmount;
        uint256 remainingPackets;
        uint256 minNeoRequired;
        uint256 minHoldSeconds;
        bool active;
        uint256 expiryTime;
        uint256 currentTime;
        bool isExpired;
        bool isDepleted;
        string message;
        uint256 envelopeType;
        uint256 parentEnvelopeId;
        address currentHolder;
    }

    struct ClaimStateView {
        uint256 id;
        uint256 poolId;
        address holder;
        uint256 amount;
        bool opened;
        string message;
        uint256 expiryTime;
    }

    struct EligibilityView {
        bool eligible;
        string reason;
        uint256 neoBalance;
        uint256 minNeoRequired;
        uint256 minHoldSeconds;
        uint256 holdDuration;
        uint256 holdDays;
    }

    struct CalculationConstantsView {
        uint256 minAmount;
        uint256 maxPackets;
        uint256 minPerPacket;
        uint256 maxSinglePacketBps;
        uint256 maxSinglePacketAvgBps;
        uint256 percentBase;
        uint256 maxSinglePacketPercent;
        uint256 densePacketThreshold;
        uint256 mediumPacketThreshold;
        uint256 denseVolatilityLowBps;
        uint256 denseVolatilityHighBps;
        uint256 mediumVolatilityLowBps;
        uint256 mediumVolatilityHighBps;
        uint256 sparseVolatilityLowBps;
        uint256 sparseVolatilityHighBps;
        uint256 defaultExpiryMs;
        uint256 maxExpiryMs;
        uint256 defaultMinNeo;
        uint256 defaultMinHoldSeconds;
        uint256 typeSpreading;
        uint256 typePool;
        uint256 typeClaim;
        uint256 currentTime;
    }

    struct TokenPropertiesView {
        string name;
        string description;
        string image;
        uint256 tokenId;
        address creator;
        uint256 envelopeType;
        uint256 totalAmount;
        uint256 packetCount;
        uint256 parentEnvelopeId;
        uint256 minNeoRequired;
        uint256 minHoldSeconds;
    }

    event Transfer(address indexed from, address indexed to, uint256 amount, bytes tokenId);
    event EnvelopeCreated(
        uint256 indexed envelopeId,
        address indexed creator,
        uint256 totalAmount,
        uint256 packetCount,
        uint256 envelopeType
    );
    event EnvelopeOpened(
        uint256 indexed envelopeId,
        address indexed opener,
        uint256 amount,
        uint256 remainingPackets
    );
    event EnvelopeRefunded(uint256 indexed envelopeId, address indexed creator, uint256 refundAmount);
    event OwnerChanged(address indexed oldOwner, address indexed newOwner);
    event ContractPaused();
    event ContractResumed();
}
