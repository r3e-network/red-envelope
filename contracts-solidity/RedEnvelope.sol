// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../.toolchains/neo-solidity/devpack/contracts/Syscalls.sol";
import "../.toolchains/neo-solidity/devpack/contracts/NativeCalls.sol";

contract RedEnvelope {
    uint256 private constant MIN_AMOUNT = 100_000_000;
    uint256 private constant MAX_PACKETS = 100;
    uint256 private constant MIN_PER_PACKET = 10_000_000;
    uint256 private constant PERCENT_BASE = 10_000;
    uint256 private constant MAX_SINGLE_PACKET_BPS = 2_000;
    uint256 private constant MAX_SINGLE_PACKET_AVG_BPS = 18_000;
    uint256 private constant DENSE_PACKET_THRESHOLD = 50;
    uint256 private constant MEDIUM_PACKET_THRESHOLD = 20;
    uint256 private constant DENSE_VOLATILITY_LOW_BPS = 7_000;
    uint256 private constant DENSE_VOLATILITY_HIGH_BPS = 13_000;
    uint256 private constant MEDIUM_VOLATILITY_LOW_BPS = 5_000;
    uint256 private constant MEDIUM_VOLATILITY_HIGH_BPS = 17_000;
    uint256 private constant SPARSE_VOLATILITY_LOW_BPS = 3_000;
    uint256 private constant SPARSE_VOLATILITY_HIGH_BPS = 23_000;
    uint256 private constant DEFAULT_EXPIRY_MS = 604_800_000;
    uint256 private constant MAX_EXPIRY_MS = 604_800_000;
    uint256 private constant DEFAULT_MIN_NEO = 0;
    uint256 private constant DEFAULT_MIN_HOLD_SECONDS = 0;

    uint256 private constant ENVELOPE_TYPE_SPREADING = 0;
    uint256 private constant ENVELOPE_TYPE_POOL = 1;
    uint256 private constant ENVELOPE_TYPE_CLAIM = 2;

    address private constant GAS_HASH = 0xd2a4cff31913016155e38e474a2c06d08be276cf;

    address private owner;
    bool private paused;
    uint256 private nextEnvelopeId;
    uint256 private totalEnvelopes;
    uint256 private totalDistributed;

    mapping(uint256 => address) private envelopeCreator;
    mapping(uint256 => uint256) private envelopeTotalAmount;
    mapping(uint256 => uint256) private envelopePacketCount;
    mapping(uint256 => string) private envelopeMessage;
    mapping(uint256 => uint256) private envelopeType;
    mapping(uint256 => uint256) private envelopeParentEnvelopeId;
    mapping(uint256 => uint256) private envelopeOpenedCount;
    mapping(uint256 => uint256) private envelopeRemainingAmount;
    mapping(uint256 => uint256) private envelopeMinNeoRequired;
    mapping(uint256 => uint256) private envelopeMinHoldSeconds;
    mapping(uint256 => bool) private envelopeActive;
    mapping(uint256 => uint256) private envelopeExpiryTime;

    mapping(uint256 => address) private tokenOwner;
    mapping(uint256 => mapping(address => uint256)) private openedAmount;
    mapping(uint256 => mapping(address => uint256)) private poolClaimedAmount;
    mapping(uint256 => mapping(uint256 => uint256)) private poolClaimIndex;

    uint256[] private tokenIds;
    mapping(uint256 => uint256) private tokenIndexPlusOne;
    mapping(address => uint256[]) private ownerTokenIds;
    mapping(address => mapping(uint256 => uint256)) private ownerTokenIndexPlusOne;

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

    function symbol() external pure returns (string memory) {
        return "RedEnvelope";
    }

    function decimals() external pure returns (uint8) {
        return 0;
    }

    function totalSupply() external view returns (uint256) {
        return tokenIds.length;
    }

    function balanceOf(address account) external view returns (uint256) {
        return ownerTokenIds[account].length;
    }

    function ownerOf(bytes calldata tokenIdBytes) external view returns (address) {
        uint256 tokenId = _tokenIdToEnvelopeId(tokenIdBytes);
        address holder = tokenOwner[tokenId];
        require(holder != address(0), "token not found");
        return holder;
    }

    function properties(bytes calldata tokenIdBytes) external view returns (TokenPropertiesView memory viewData) {
        uint256 tokenId = _tokenIdToEnvelopeId(tokenIdBytes);
        require(_tokenExists(tokenId), "token not found");

        viewData.name = _tokenName(tokenId);
        viewData.description = _buildTokenDescription(tokenId);
        viewData.image = "";
        viewData.tokenId = tokenId;
        viewData.creator = envelopeCreator[tokenId];
        viewData.envelopeType = envelopeType[tokenId];
        viewData.totalAmount = envelopeTotalAmount[tokenId];
        viewData.packetCount = envelopePacketCount[tokenId];
        viewData.parentEnvelopeId = envelopeParentEnvelopeId[tokenId];
        viewData.minNeoRequired = envelopeMinNeoRequired[tokenId];
        viewData.minHoldSeconds = envelopeMinHoldSeconds[tokenId];
    }

    function tokens() external view returns (uint256[] memory) {
        return tokenIds;
    }

    function tokensOf(address account) external view returns (uint256[] memory) {
        return ownerTokenIds[account];
    }

    function getOwner() external view returns (address) {
        return owner;
    }

    function setOwner(address newOwner) external {
        require(newOwner != address(0), "invalid address");

        // Compatibility shim: some neo-solidity deploy paths may not expose
        // transaction sender during _deploy, leaving owner unset.
        if (owner == address(0)) {
            require(Syscalls.checkWitness(newOwner), "bootstrap owner must self-set");
            address oldOwner = owner;
            owner = newOwner;
            emit OwnerChanged(oldOwner, newOwner);
            return;
        }

        _validateOwner();
        address oldOwner = owner;
        owner = newOwner;
        emit OwnerChanged(oldOwner, newOwner);
    }

    function isOwner() external view returns (bool) {
        return owner != address(0) && Syscalls.checkWitness(owner);
    }

    function verify() external returns (bool) {
        return owner != address(0) && Syscalls.checkWitness(owner);
    }

    function pause() external {
        _validateOwner();
        paused = true;
        emit ContractPaused();
    }

    function resume() external {
        _validateOwner();
        paused = false;
        emit ContractResumed();
    }

    function isPaused() external view returns (bool) {
        return paused;
    }

    function update(bytes calldata nef, string calldata manifest) external {
        _validateOwner();
        Syscalls.contractUpdate(nef, bytes(manifest));
    }

    function destroy() external {
        _validateOwner();
        Syscalls.contractDestroy();
    }

    function _deploy(bytes calldata data, bool update_) external {
        address sender = _txSender();
        if (sender == address(0)) {
            sender = _decodeAddressFromBytes(data);
        }

        if (update_) {
            if (owner == address(0)) {
                owner = sender;
            }
            return;
        }

        owner = sender;
        paused = false;
        nextEnvelopeId = 0;
        totalEnvelopes = 0;
        totalDistributed = 0;
    }

    function _initialize() external {
        // Kept for ABI parity with the C# NEP-11 base contract surface.
    }

    function onNEP17Payment(address from, uint256 amount, bytes[] calldata data) external {
        require(Syscalls.getCallingScriptHash() == GAS_HASH, "only GAS accepted");

        if (from == address(0)) {
            return;
        }

        _assertNotPaused();
        require(amount >= MIN_AMOUNT, "min 1 GAS");

        uint256 packetCount = 1;
        uint256 expiryMs = DEFAULT_EXPIRY_MS;
        string memory message = "";
        uint256 minNeoRequired = DEFAULT_MIN_NEO;
        uint256 minHoldSeconds = DEFAULT_MIN_HOLD_SECONDS;
        uint256 envelopeType_ = ENVELOPE_TYPE_SPREADING;

        (
            packetCount,
            expiryMs,
            message,
            minNeoRequired,
            minHoldSeconds,
            envelopeType_
        ) = _parseOnPaymentConfig(data);

        _createEnvelope(from, amount, packetCount, expiryMs, message, minNeoRequired, minHoldSeconds, envelopeType_);
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        if (!_tokenExists(tokenId)) {
            return "";
        }

        string memory imageData = _buildTokenSvgDataUri(tokenId);
        string memory json = string(
            abi.encodePacked(
                '{"name":"',
                _escapeJsonString(_tokenName(tokenId)),
                '","description":"',
                _escapeJsonString(_buildTokenDescription(tokenId)),
                '","image":"',
                imageData,
                '"}'
            )
        );
        return string(abi.encodePacked("data:application/json;base64,", Syscalls.base64Encode(bytes(json))));
    }

    function calculatePacketAmount(uint256 envelopeId, uint256 packetIndex) external view returns (uint256) {
        if (!_envelopeExists(envelopeId)) {
            return 0;
        }

        uint256 packetCount = envelopePacketCount[envelopeId];
        if (packetIndex >= packetCount) {
            return 0;
        }

        uint256 remainingPackets = packetCount - packetIndex;
        uint256 remainingAmount = envelopeRemainingAmount[envelopeId];
        if (remainingAmount == 0 || remainingPackets == 0) {
            return 0;
        }

        return _calculateRuntimeRandomPacketAmount(
            remainingAmount,
            remainingPackets,
            0,
            envelopeTotalAmount[envelopeId],
            packetCount
        );
    }

    function claimFromPool(uint256 poolId, address claimer) external returns (uint256) {
        _assertNotPaused();
        _assertDirectUserInvocation();

        require(Syscalls.checkWitness(claimer), "unauthorized");
        require(!_isContractAccount(claimer), "contracts cannot claim");

        require(_envelopeExists(poolId), "pool not found");
        require(envelopeType[poolId] == ENVELOPE_TYPE_POOL, "not lucky pool");
        require(envelopeActive[poolId], "not active");
        require(envelopeOpenedCount[poolId] < envelopePacketCount[poolId], "pool depleted");
        require(_now() <= envelopeExpiryTime[poolId], "expired");
        require(poolClaimedAmount[poolId][claimer] == 0, "already claimed");

        uint256 claimerNeo = _validateNeoHolding(
            claimer,
            envelopeMinNeoRequired[poolId],
            envelopeMinHoldSeconds[poolId]
        );

        uint256 poolOpenedCount = envelopeOpenedCount[poolId];
        uint256 poolPacketCount = envelopePacketCount[poolId];
        uint256 poolRemainingAmount = envelopeRemainingAmount[poolId];
        uint256 poolTotalAmount = envelopeTotalAmount[poolId];

        uint256 remainingPacketsBeforeClaim = poolPacketCount - poolOpenedCount;
        uint256 amount = _calculateRuntimeRandomPacketAmount(
            poolRemainingAmount,
            remainingPacketsBeforeClaim,
            claimerNeo,
            poolTotalAmount,
            poolPacketCount
        );
        require(amount > 0, "invalid amount");

        poolClaimedAmount[poolId][claimer] = amount;

        poolOpenedCount += 1;
        poolRemainingAmount -= amount;
        envelopeOpenedCount[poolId] = poolOpenedCount;
        envelopeRemainingAmount[poolId] = poolRemainingAmount;

        uint256 remainingPackets = poolPacketCount - poolOpenedCount;
        if (remainingPackets == 0) {
            envelopeActive[poolId] = false;
        }

        uint256 claimId = _allocateEnvelopeId();
        envelopeCreator[claimId] = envelopeCreator[poolId];
        envelopeTotalAmount[claimId] = amount;
        envelopePacketCount[claimId] = 1;
        envelopeMessage[claimId] = envelopeMessage[poolId];
        envelopeType[claimId] = ENVELOPE_TYPE_CLAIM;
        envelopeParentEnvelopeId[claimId] = poolId;
        envelopeOpenedCount[claimId] = 0;
        envelopeRemainingAmount[claimId] = amount;
        envelopeMinNeoRequired[claimId] = envelopeMinNeoRequired[poolId];
        envelopeMinHoldSeconds[claimId] = envelopeMinHoldSeconds[poolId];
        envelopeActive[claimId] = true;
        envelopeExpiryTime[claimId] = envelopeExpiryTime[poolId];

        _mintToken(claimId, claimer);

        poolClaimIndex[poolId][poolOpenedCount] = claimId;

        emit EnvelopeOpened(poolId, claimer, amount, remainingPackets);
        emit EnvelopeCreated(claimId, envelopeCreator[poolId], amount, 1, ENVELOPE_TYPE_CLAIM);

        return claimId;
    }

    function openClaim(uint256 claimId, address opener) external returns (uint256) {
        _assertNotPaused();
        _assertDirectUserInvocation();

        require(Syscalls.checkWitness(opener), "unauthorized");
        require(!_isContractAccount(opener), "contracts cannot open");

        require(_envelopeExists(claimId), "claim not found");
        require(envelopeType[claimId] == ENVELOPE_TYPE_CLAIM, "not claim NFT");
        require(_tokenExists(claimId), "claim not found");
        require(tokenOwner[claimId] == opener, "not NFT holder");

        require(envelopeActive[claimId], "not active");
        require(envelopeOpenedCount[claimId] == 0, "already opened");
        require(envelopeRemainingAmount[claimId] > 0, "no GAS remaining");
        require(_now() <= envelopeExpiryTime[claimId], "expired");

        _validateNeoHolding(opener, envelopeMinNeoRequired[claimId], envelopeMinHoldSeconds[claimId]);

        uint256 amount = envelopeRemainingAmount[claimId];
        envelopeOpenedCount[claimId] = 1;
        envelopeRemainingAmount[claimId] = 0;
        envelopeActive[claimId] = false;

        require(
            NativeCalls.gasTransfer(Syscalls.getExecutingScriptHash(), opener, amount, ""),
            "GAS transfer failed"
        );

        emit EnvelopeOpened(claimId, opener, amount, 0);

        return amount;
    }

    function transferClaim(uint256 claimId, address from, address to) external {
        _assertNotPaused();
        _assertDirectUserInvocation();

        require(Syscalls.checkWitness(from), "unauthorized");
        require(to != address(0), "invalid recipient");
        require(!_isContractAccount(to), "contract recipient not allowed");

        require(_envelopeExists(claimId), "claim not found");
        require(envelopeType[claimId] == ENVELOPE_TYPE_CLAIM, "not claim NFT");
        require(_tokenExists(claimId), "claim not found");
        require(tokenOwner[claimId] == from, "not NFT holder");

        require(transfer(to, _idToTokenId(claimId), bytes("")), "transfer failed");
    }

    function reclaimPool(uint256 poolId, address creator) external returns (uint256) {
        _assertNotPaused();
        _assertDirectUserInvocation();

        require(Syscalls.checkWitness(creator), "unauthorized");

        require(_envelopeExists(poolId), "pool not found");
        require(envelopeType[poolId] == ENVELOPE_TYPE_POOL, "not lucky pool");
        require(envelopeCreator[poolId] == creator, "not creator");
        require(_now() > envelopeExpiryTime[poolId], "not expired");

        uint256 refundAmount = envelopeRemainingAmount[poolId];
        uint256 openedCount = envelopeOpenedCount[poolId];

        for (uint256 i = 1; i <= openedCount; i++) {
            uint256 claimId = poolClaimIndex[poolId][i];
            if (claimId == 0) {
                continue;
            }
            if (!_envelopeExists(claimId)) {
                continue;
            }
            if (envelopeType[claimId] != ENVELOPE_TYPE_CLAIM) {
                continue;
            }

            if (envelopeActive[claimId] && envelopeRemainingAmount[claimId] > 0) {
                refundAmount += envelopeRemainingAmount[claimId];
                envelopeRemainingAmount[claimId] = 0;
                envelopeActive[claimId] = false;
            }
        }

        require(refundAmount > 0, "no GAS remaining");

        envelopeRemainingAmount[poolId] = 0;
        envelopeActive[poolId] = false;

        require(
            NativeCalls.gasTransfer(Syscalls.getExecutingScriptHash(), creator, refundAmount, ""),
            "GAS transfer failed"
        );

        emit EnvelopeRefunded(poolId, creator, refundAmount);

        return refundAmount;
    }

    function getEnvelopeState(uint256 envelopeId)
        external
        view
        returns (EnvelopeStateView memory viewData)
    {
        if (!_envelopeExists(envelopeId)) {
            return viewData;
        }

        uint256 packetCount = envelopePacketCount[envelopeId];
        uint256 openedCount = envelopeOpenedCount[envelopeId];
        uint256 remainingAmount = envelopeRemainingAmount[envelopeId];
        uint256 currentTime = _now();
        uint256 remainingPackets = packetCount > openedCount ? packetCount - openedCount : 0;

        viewData.id = envelopeId;
        viewData.creator = envelopeCreator[envelopeId];
        viewData.totalAmount = envelopeTotalAmount[envelopeId];
        viewData.packetCount = packetCount;
        viewData.openedCount = openedCount;
        viewData.claimedCount = openedCount;
        viewData.remainingAmount = remainingAmount;
        viewData.remainingPackets = remainingPackets;
        viewData.minNeoRequired = envelopeMinNeoRequired[envelopeId];
        viewData.minHoldSeconds = envelopeMinHoldSeconds[envelopeId];
        viewData.active = envelopeActive[envelopeId];
        viewData.expiryTime = envelopeExpiryTime[envelopeId];
        viewData.currentTime = currentTime;
        viewData.isExpired = currentTime > envelopeExpiryTime[envelopeId];
        viewData.isDepleted = openedCount >= packetCount || remainingAmount == 0;
        viewData.message = envelopeMessage[envelopeId];
        viewData.envelopeType = envelopeType[envelopeId];
        viewData.parentEnvelopeId = envelopeParentEnvelopeId[envelopeId];

        if (viewData.envelopeType == ENVELOPE_TYPE_SPREADING || viewData.envelopeType == ENVELOPE_TYPE_CLAIM) {
            viewData.currentHolder = tokenOwner[envelopeId];
        } else {
            viewData.currentHolder = address(0);
        }
    }

    function getClaimState(uint256 claimId)
        external
        view
        returns (ClaimStateView memory viewData)
    {
        if (!_envelopeExists(claimId)) {
            return viewData;
        }
        if (envelopeType[claimId] != ENVELOPE_TYPE_CLAIM) {
            return viewData;
        }

        viewData.id = claimId;
        viewData.poolId = envelopeParentEnvelopeId[claimId];
        viewData.holder = tokenOwner[claimId];
        viewData.amount = envelopeTotalAmount[claimId];
        viewData.opened = envelopeOpenedCount[claimId] > 0 || !envelopeActive[claimId] || envelopeRemainingAmount[claimId] == 0;
        viewData.message = envelopeMessage[claimId];
        viewData.expiryTime = envelopeExpiryTime[claimId];
    }

    function checkEligibility(uint256 envelopeId, address user)
        external
        view
        returns (EligibilityView memory)
    {
        return _checkEligibility(envelopeId, user, false);
    }

    function checkOpenEligibility(uint256 envelopeId, address user)
        external
        view
        returns (EligibilityView memory)
    {
        return _checkEligibility(envelopeId, user, true);
    }

    function hasOpened(uint256 envelopeId, address opener) external view returns (bool) {
        return openedAmount[envelopeId][opener] > 0;
    }

    function getOpenedAmount(uint256 envelopeId, address opener) external view returns (uint256) {
        return openedAmount[envelopeId][opener];
    }

    function hasClaimedFromPool(uint256 poolId, address claimer) external view returns (bool) {
        return poolClaimedAmount[poolId][claimer] > 0;
    }

    function getPoolClaimedAmount(uint256 poolId, address claimer) external view returns (uint256) {
        return poolClaimedAmount[poolId][claimer];
    }

    function getCalculationConstants() external view returns (CalculationConstantsView memory c) {
        c.minAmount = MIN_AMOUNT;
        c.maxPackets = MAX_PACKETS;
        c.minPerPacket = MIN_PER_PACKET;
        c.maxSinglePacketBps = MAX_SINGLE_PACKET_BPS;
        c.maxSinglePacketAvgBps = MAX_SINGLE_PACKET_AVG_BPS;
        c.percentBase = PERCENT_BASE;
        c.maxSinglePacketPercent = (MAX_SINGLE_PACKET_BPS * 100) / PERCENT_BASE;
        c.densePacketThreshold = DENSE_PACKET_THRESHOLD;
        c.mediumPacketThreshold = MEDIUM_PACKET_THRESHOLD;
        c.denseVolatilityLowBps = DENSE_VOLATILITY_LOW_BPS;
        c.denseVolatilityHighBps = DENSE_VOLATILITY_HIGH_BPS;
        c.mediumVolatilityLowBps = MEDIUM_VOLATILITY_LOW_BPS;
        c.mediumVolatilityHighBps = MEDIUM_VOLATILITY_HIGH_BPS;
        c.sparseVolatilityLowBps = SPARSE_VOLATILITY_LOW_BPS;
        c.sparseVolatilityHighBps = SPARSE_VOLATILITY_HIGH_BPS;
        c.defaultExpiryMs = DEFAULT_EXPIRY_MS;
        c.maxExpiryMs = MAX_EXPIRY_MS;
        c.defaultMinNeo = DEFAULT_MIN_NEO;
        c.defaultMinHoldSeconds = DEFAULT_MIN_HOLD_SECONDS;
        c.typeSpreading = ENVELOPE_TYPE_SPREADING;
        c.typePool = ENVELOPE_TYPE_POOL;
        c.typeClaim = ENVELOPE_TYPE_CLAIM;
        c.currentTime = _now();
    }

    function getTotalEnvelopes() external view returns (uint256) {
        return totalEnvelopes;
    }

    function getTotalDistributed() external view returns (uint256) {
        return totalDistributed;
    }

    function getPoolClaimIdByIndex(uint256 poolId, uint256 claimIndex) external view returns (uint256) {
        return poolClaimIndex[poolId][claimIndex];
    }

    function transfer(address to, bytes calldata tokenIdBytes, bytes calldata data) public returns (bool) {
        _assertNotPaused();
        _assertDirectUserInvocation();

        require(to != address(0), "invalid recipient");
        require(!_isContractAccount(to), "contract recipient not allowed");

        uint256 tokenId = _tokenIdToEnvelopeId(tokenIdBytes);
        require(_tokenExists(tokenId), "token not found");

        uint256 type_ = envelopeType[tokenId];
        require(type_ == ENVELOPE_TYPE_SPREADING || type_ == ENVELOPE_TYPE_CLAIM, "unsupported token type");

        address from = tokenOwner[tokenId];
        require(from != address(0), "owner not found");
        require(Syscalls.checkWitness(from), "unauthorized");

        _transferToken(tokenId, from, to);
        data;

        return true;
    }

    function openEnvelope(uint256 envelopeId, address opener) external returns (uint256) {
        _assertNotPaused();
        _assertDirectUserInvocation();

        require(Syscalls.checkWitness(opener), "unauthorized");
        require(!_isContractAccount(opener), "contracts cannot open");

        require(_tokenExists(envelopeId), "token not found");
        require(envelopeType[envelopeId] == ENVELOPE_TYPE_SPREADING, "not spreading envelope");
        require(tokenOwner[envelopeId] == opener, "not NFT holder");

        require(_envelopeExists(envelopeId), "envelope not found");
        require(envelopeType[envelopeId] == ENVELOPE_TYPE_SPREADING, "invalid envelope type");
        require(envelopeActive[envelopeId], "not active");
        require(envelopeOpenedCount[envelopeId] < envelopePacketCount[envelopeId], "depleted");
        require(_now() <= envelopeExpiryTime[envelopeId], "expired");
        require(openedAmount[envelopeId][opener] == 0, "already opened");

        uint256 openerNeo = _validateNeoHolding(
            opener,
            envelopeMinNeoRequired[envelopeId],
            envelopeMinHoldSeconds[envelopeId]
        );

        uint256 openedCount = envelopeOpenedCount[envelopeId];
        uint256 packetCount = envelopePacketCount[envelopeId];
        uint256 remainingAmount = envelopeRemainingAmount[envelopeId];
        uint256 totalAmount = envelopeTotalAmount[envelopeId];

        uint256 remainingPacketsBeforeOpen = packetCount - openedCount;
        uint256 amount = _calculateRuntimeRandomPacketAmount(
            remainingAmount,
            remainingPacketsBeforeOpen,
            openerNeo,
            totalAmount,
            packetCount
        );
        require(amount > 0, "invalid amount");

        openedAmount[envelopeId][opener] = amount;

        openedCount += 1;
        envelopeOpenedCount[envelopeId] = openedCount;
        envelopeRemainingAmount[envelopeId] = remainingAmount - amount;

        uint256 remainingPackets = packetCount - openedCount;
        if (remainingPackets == 0) {
            envelopeActive[envelopeId] = false;
        }

        require(
            NativeCalls.gasTransfer(Syscalls.getExecutingScriptHash(), opener, amount, ""),
            "GAS transfer failed"
        );

        emit EnvelopeOpened(envelopeId, opener, amount, remainingPackets);

        return amount;
    }

    function transferEnvelope(uint256 envelopeId, address from, address to, bytes calldata data) external {
        _assertNotPaused();
        _assertDirectUserInvocation();

        require(Syscalls.checkWitness(from), "unauthorized");
        require(to != address(0), "invalid recipient");
        require(!_isContractAccount(to), "contract recipient not allowed");

        require(_tokenExists(envelopeId), "token not found");
        require(envelopeType[envelopeId] == ENVELOPE_TYPE_SPREADING, "not spreading envelope");

        require(_envelopeExists(envelopeId), "envelope not found");
        require(tokenOwner[envelopeId] == from, "not NFT holder");

        require(transfer(to, _idToTokenId(envelopeId), data), "transfer failed");
    }

    function reclaimEnvelope(uint256 envelopeId, address creator) external returns (uint256) {
        _assertNotPaused();
        _assertDirectUserInvocation();

        require(Syscalls.checkWitness(creator), "unauthorized");

        require(_envelopeExists(envelopeId), "envelope not found");
        require(envelopeType[envelopeId] == ENVELOPE_TYPE_SPREADING, "not spreading envelope");
        require(envelopeCreator[envelopeId] == creator, "not creator");
        require(envelopeActive[envelopeId], "not active");
        require(_now() > envelopeExpiryTime[envelopeId], "not expired");
        require(envelopeRemainingAmount[envelopeId] > 0, "no GAS remaining");

        uint256 refundAmount = envelopeRemainingAmount[envelopeId];

        envelopeRemainingAmount[envelopeId] = 0;
        envelopeActive[envelopeId] = false;

        require(
            NativeCalls.gasTransfer(Syscalls.getExecutingScriptHash(), creator, refundAmount, ""),
            "GAS transfer failed"
        );

        emit EnvelopeRefunded(envelopeId, creator, refundAmount);

        return refundAmount;
    }

    function _createEnvelope(
        address from,
        uint256 amount,
        uint256 packetCount,
        uint256 expiryMs,
        string memory message,
        uint256 minNeoRequired,
        uint256 minHoldSeconds,
        uint256 envelopeType_
    ) internal returns (uint256) {
        require(packetCount > 0 && packetCount <= MAX_PACKETS, "1-100 packets");
        require(amount >= packetCount * MIN_PER_PACKET, "min 0.1 GAS/packet");
        require(bytes(message).length <= 256, "message too long (max 256 chars)");
        require(
            envelopeType_ == ENVELOPE_TYPE_SPREADING || envelopeType_ == ENVELOPE_TYPE_POOL,
            "invalid envelope type"
        );

        uint256 effectiveExpiry = expiryMs > 0 ? expiryMs : DEFAULT_EXPIRY_MS;
        require(effectiveExpiry > 0 && effectiveExpiry <= MAX_EXPIRY_MS, "expiry out of range");

        uint256 envelopeId = _allocateEnvelopeId();

        envelopeCreator[envelopeId] = from;
        envelopeTotalAmount[envelopeId] = amount;
        envelopePacketCount[envelopeId] = packetCount;
        envelopeMessage[envelopeId] = message;
        envelopeType[envelopeId] = envelopeType_;
        envelopeParentEnvelopeId[envelopeId] = 0;
        envelopeOpenedCount[envelopeId] = 0;
        envelopeRemainingAmount[envelopeId] = amount;
        envelopeMinNeoRequired[envelopeId] = minNeoRequired;
        envelopeMinHoldSeconds[envelopeId] = minHoldSeconds;
        envelopeActive[envelopeId] = true;
        envelopeExpiryTime[envelopeId] = _now() + effectiveExpiry;

        if (envelopeType_ == ENVELOPE_TYPE_SPREADING) {
            _mintToken(envelopeId, from);
        }

        totalEnvelopes += 1;
        totalDistributed += amount;

        emit EnvelopeCreated(envelopeId, from, amount, packetCount, envelopeType_);

        return envelopeId;
    }

    function _parseOnPaymentConfig(bytes[] calldata data)
        internal
        pure
        returns (
            uint256 packetCount,
            uint256 expiryMs,
            string memory message,
            uint256 minNeoRequired,
            uint256 minHoldSeconds,
            uint256 envelopeType_
        )
    {
        packetCount = 1;
        expiryMs = DEFAULT_EXPIRY_MS;
        message = "";
        minNeoRequired = DEFAULT_MIN_NEO;
        minHoldSeconds = DEFAULT_MIN_HOLD_SECONDS;
        envelopeType_ = ENVELOPE_TYPE_SPREADING;

        if (data.length == 0) {
            return (packetCount, expiryMs, message, minNeoRequired, minHoldSeconds, envelopeType_);
        }

        // C# onNEP17Payment object[] compatibility path:
        // [packetCount, expiryMs, message, minNeoRequired, minHoldSeconds, envelopeType]
        // When received through neo-solidity, each element is mapped into one bytes item.
        if (data.length == 6 && !_allSingleByteItems(data)) {
            uint256 parsedPacketCount = _bytesToUintLE(data[0]);
            uint256 parsedExpiryMs = _bytesToUintLE(data[1]);
            uint256 parsedMinNeoRequired = _bytesToUintLE(data[3]);
            uint256 parsedMinHoldSeconds = _bytesToUintLE(data[4]);
            uint256 parsedEnvelopeType = _bytesToUintLE(data[5]);

            // Preserve explicit input values so downstream validation mirrors C# Assert behavior.
            packetCount = parsedPacketCount;
            if (parsedExpiryMs > 0) {
                expiryMs = parsedExpiryMs;
            }
            message = string(data[2]);
            minNeoRequired = parsedMinNeoRequired;
            minHoldSeconds = parsedMinHoldSeconds;
            envelopeType_ = parsedEnvelopeType;

            return (packetCount, expiryMs, message, minNeoRequired, minHoldSeconds, envelopeType_);
        }

        // Byte payload compatibility path:
        // - ABI-encoded bytes config
        // - packed-integer bytes config
        // - Any->bytes[] bytewise bridge payload
        bytes memory raw = _flattenItems(data);
        return _parseOnPaymentConfigRaw(raw);
    }

    function _parseOnPaymentConfigRaw(bytes memory raw)
        internal
        pure
        returns (
            uint256 packetCount,
            uint256 expiryMs,
            string memory message,
            uint256 minNeoRequired,
            uint256 minHoldSeconds,
            uint256 envelopeType_
        )
    {
        packetCount = 1;
        expiryMs = DEFAULT_EXPIRY_MS;
        message = "";
        minNeoRequired = DEFAULT_MIN_NEO;
        minHoldSeconds = DEFAULT_MIN_HOLD_SECONDS;
        envelopeType_ = ENVELOPE_TYPE_SPREADING;

        if (raw.length == 0) {
            return (packetCount, expiryMs, message, minNeoRequired, minHoldSeconds, envelopeType_);
        }

        // ABI-encoded config:
        // [packetCount, expiryMs, messageOffset, minNeoRequired, minHoldSeconds, envelopeType, messageLength, message...]
        if (raw.length >= 192) {
            uint256 parsedPacketCount = _bytesToUintBE(raw, 0);
            uint256 parsedExpiryMs = _bytesToUintBE(raw, 32);
            uint256 messageOffset = _bytesToUintBE(raw, 64);
            uint256 parsedMinNeoRequired = _bytesToUintBE(raw, 96);
            uint256 parsedMinHoldSeconds = _bytesToUintBE(raw, 128);
            uint256 parsedEnvelopeType = _bytesToUintBE(raw, 160);

            // Preserve explicit input values so downstream validation mirrors C# Assert behavior.
            packetCount = parsedPacketCount;
            if (parsedExpiryMs > 0) {
                expiryMs = parsedExpiryMs;
            }
            minNeoRequired = parsedMinNeoRequired;
            minHoldSeconds = parsedMinHoldSeconds;
            envelopeType_ = parsedEnvelopeType;

            if (messageOffset + 32 <= raw.length) {
                uint256 messageLength = _bytesToUintBE(raw, messageOffset);
                if (messageOffset + 32 + messageLength <= raw.length) {
                    message = _bytesToString(raw, messageOffset + 32, messageLength);
                }
            }

            return (packetCount, expiryMs, message, minNeoRequired, minHoldSeconds, envelopeType_);
        }

        // Packed integer config:
        // dataConfig = packetCount * 1_000_000_000 + expiryMs * 10 + envelopeType
        uint256 dataConfig = _bytesToUintLE(raw);
        if (dataConfig > 0) {
            uint256 packedCount = dataConfig / 1_000_000_000;
            if (packedCount > 0) {
                packetCount = packedCount;
            }

            uint256 packedExpiryMs = (dataConfig / 10) % 100_000_000;
            if (packedExpiryMs > 0) {
                expiryMs = packedExpiryMs;
            }

            uint256 packedType = dataConfig % 10;
            if (packedType == ENVELOPE_TYPE_POOL) {
                envelopeType_ = ENVELOPE_TYPE_POOL;
            }
        }

        return (packetCount, expiryMs, message, minNeoRequired, minHoldSeconds, envelopeType_);
    }

    function _allSingleByteItems(bytes[] calldata items) internal pure returns (bool) {
        for (uint256 i = 0; i < items.length; i++) {
            if (items[i].length != 1) {
                return false;
            }
        }
        return true;
    }

    function _flattenItems(bytes[] calldata items) internal pure returns (bytes memory out) {
        uint256 total = 0;
        for (uint256 i = 0; i < items.length; i++) {
            total += items[i].length;
        }

        out = new bytes(total);
        uint256 offset = 0;
        for (uint256 i = 0; i < items.length; i++) {
            bytes calldata item = items[i];
            for (uint256 j = 0; j < item.length; j++) {
                out[offset++] = item[j];
            }
        }
    }

    function _bytesToUintBE(bytes memory raw, uint256 start) internal pure returns (uint256 value) {
        if (start + 32 > raw.length) {
            return 0;
        }

        for (uint256 i = 0; i < 32; i++) {
            value = (value << 8) | uint256(uint8(raw[start + i]));
        }
    }

    function _bytesToString(bytes memory raw, uint256 start, uint256 len) internal pure returns (string memory) {
        if (start + len > raw.length) {
            return "";
        }

        bytes memory out = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            out[i] = raw[start + i];
        }
        return string(out);
    }

    function _bytesToUintLE(bytes memory raw) internal pure returns (uint256 value) {
        uint256 len = raw.length;
        if (len > 32) {
            len = 32;
        }

        for (uint256 i = 0; i < len; i++) {
            value |= uint256(uint8(raw[i])) << (8 * i);
        }
    }

    function _bytesToUintLE(bytes calldata raw) internal pure returns (uint256 value) {
        uint256 len = raw.length;
        if (len > 32) {
            len = 32;
        }

        for (uint256 i = 0; i < len; i++) {
            value |= uint256(uint8(raw[i])) << (8 * i);
        }
    }

    function _mintToken(uint256 tokenId, address to) internal {
        tokenOwner[tokenId] = to;

        tokenIds.push(tokenId);
        tokenIndexPlusOne[tokenId] = tokenIds.length;

        ownerTokenIds[to].push(tokenId);
        ownerTokenIndexPlusOne[to][tokenId] = ownerTokenIds[to].length;

        emit Transfer(address(0), to, 1, _idToTokenId(tokenId));
    }

    function _transferToken(uint256 tokenId, address from, address to) internal {
        _removeTokenFromOwner(from, tokenId);

        ownerTokenIds[to].push(tokenId);
        ownerTokenIndexPlusOne[to][tokenId] = ownerTokenIds[to].length;

        tokenOwner[tokenId] = to;

        emit Transfer(from, to, 1, _idToTokenId(tokenId));
    }

    function _removeTokenFromOwner(address from, uint256 tokenId) internal {
        uint256 idxPlusOne = ownerTokenIndexPlusOne[from][tokenId];
        require(idxPlusOne > 0, "token owner index missing");

        uint256 idx = idxPlusOne - 1;
        uint256 lastIdx = ownerTokenIds[from].length - 1;

        if (idx != lastIdx) {
            uint256 moved = ownerTokenIds[from][lastIdx];
            ownerTokenIds[from][idx] = moved;
            ownerTokenIndexPlusOne[from][moved] = idx + 1;
        }

        ownerTokenIds[from].pop();
        delete ownerTokenIndexPlusOne[from][tokenId];
    }

    function _checkEligibility(uint256 envelopeId, address user, bool includeActionChecks)
        internal
        view
        returns (EligibilityView memory result)
    {
        if (_isContractAccount(user)) {
            result.eligible = false;
            result.reason = "contracts cannot open/claim";
            return result;
        }

        if (!_envelopeExists(envelopeId)) {
            result.eligible = false;
            result.reason = "envelope not found";
            return result;
        }

        result.minNeoRequired = envelopeMinNeoRequired[envelopeId];
        result.minHoldSeconds = envelopeMinHoldSeconds[envelopeId];

        if (!envelopeActive[envelopeId]) {
            result.eligible = false;
            result.reason = "not active";
            return result;
        }

        if (includeActionChecks) {
            if (_now() > envelopeExpiryTime[envelopeId]) {
                result.eligible = false;
                result.reason = "expired";
                return result;
            }

            bool isDepleted =
                envelopeOpenedCount[envelopeId] >= envelopePacketCount[envelopeId] ||
                envelopeRemainingAmount[envelopeId] == 0;
            if (isDepleted) {
                result.eligible = false;
                result.reason = "depleted";
                return result;
            }

            uint256 type_ = envelopeType[envelopeId];
            if (type_ == ENVELOPE_TYPE_POOL) {
                if (poolClaimedAmount[envelopeId][user] > 0) {
                    result.eligible = false;
                    result.reason = "already claimed";
                    return result;
                }
            } else if (type_ == ENVELOPE_TYPE_SPREADING || type_ == ENVELOPE_TYPE_CLAIM) {
                if (!_tokenExists(envelopeId)) {
                    result.eligible = false;
                    result.reason = "token not found";
                    return result;
                }

                if (tokenOwner[envelopeId] != user) {
                    result.eligible = false;
                    result.reason = "not NFT holder";
                    return result;
                }

                if (type_ == ENVELOPE_TYPE_SPREADING && openedAmount[envelopeId][user] > 0) {
                    result.eligible = false;
                    result.reason = "already opened";
                    return result;
                }

                if (type_ == ENVELOPE_TYPE_CLAIM && envelopeOpenedCount[envelopeId] > 0) {
                    result.eligible = false;
                    result.reason = "already opened";
                    return result;
                }
            } else {
                result.eligible = false;
                result.reason = "invalid envelope type";
                return result;
            }
        }

        result.neoBalance = NativeCalls.neoBalanceOf(user);
        if (result.minNeoRequired > 0 && result.neoBalance < result.minNeoRequired) {
            result.eligible = false;
            result.reason = "insufficient NEO";
            return result;
        }

        if (result.minHoldSeconds <= 0) {
            result.holdDuration = 0;
            result.holdDays = 0;
            result.eligible = true;
            result.reason = "ok";
            return result;
        }

        (bool hasState, uint256 holdDuration, uint256 holdDays) = _readHoldDuration(user);
        if (!hasState) {
            result.eligible = false;
            result.reason = "no NEO state";
            return result;
        }

        result.holdDuration = holdDuration;
        result.holdDays = holdDays;

        if (holdDuration < result.minHoldSeconds * 1000) {
            result.eligible = false;
            result.reason = "hold duration not met";
            return result;
        }

        result.eligible = true;
        result.reason = "ok";
        return result;
    }

    function _validateNeoHolding(address account, uint256 minNeo, uint256 minHoldSeconds) internal view returns (uint256) {
        uint256 neoBalance = NativeCalls.neoBalanceOf(account);
        if (minNeo > 0) {
            require(neoBalance >= minNeo, "insufficient NEO");
        }

        if (minHoldSeconds > 0) {
            (bool hasState, uint256 holdDuration, ) = _readHoldDuration(account);
            require(hasState, "no NEO state");
            require(holdDuration >= minHoldSeconds * 1000, "hold duration not met");
        }

        return neoBalance;
    }

    function _readHoldDuration(address account)
        internal
        view
        returns (bool hasState, uint256 holdDuration, uint256 holdDays)
    {
        NativeCalls.AccountState memory state = NativeCalls.getAccountState(account);
        if (state.balance == 0 && state.balanceHeight == 0 && state.voteTo.length == 0 && state.lastGasPerVote == 0) {
            return (false, 0, 0);
        }

        Syscalls.Block memory blockData = NativeCalls.getBlock(state.balanceHeight);
        uint256 currentTime = _now();
        if (currentTime > blockData.timestamp) {
            holdDuration = currentTime - blockData.timestamp;
        } else {
            holdDuration = 0;
        }
        holdDays = holdDuration / 86_400_000;

        return (true, holdDuration, holdDays);
    }

    function _allocateEnvelopeId() internal returns (uint256) {
        nextEnvelopeId += 1;
        return nextEnvelopeId;
    }

    function _envelopeExists(uint256 envelopeId) internal view returns (bool) {
        return envelopeCreator[envelopeId] != address(0);
    }

    function _tokenExists(uint256 tokenId) internal view returns (bool) {
        return tokenOwner[tokenId] != address(0);
    }

    function _isContractAccount(address account) internal view returns (bool) {
        if (account == address(0)) {
            return false;
        }
        return Syscalls.contractExists(account);
    }

    function _assertDirectUserInvocation() internal view {
        require(Syscalls.getCallingScriptHash() == Syscalls.getEntryScriptHash(), "contract caller not allowed");
    }

    function _assertNotPaused() internal view {
        require(!paused, "contract paused");
    }

    function _validateOwner() internal view {
        require(owner != address(0) && Syscalls.checkWitness(owner), "not owner");
    }

    function _tokenName(uint256 tokenId) internal view returns (string memory) {
        if (envelopeType[tokenId] == ENVELOPE_TYPE_CLAIM) {
            return "ClaimEnvelope";
        }
        return "RedEnvelope";
    }

    function _buildTokenDescription(uint256 tokenId) internal view returns (string memory) {
        string memory typeText = envelopeType[tokenId] == ENVELOPE_TYPE_CLAIM
            ? "Claim"
            : envelopeType[tokenId] == ENVELOPE_TYPE_POOL
                ? "Pool"
                : "Spreading";

        string memory flowText = envelopeType[tokenId] == ENVELOPE_TYPE_CLAIM
            ? "Flow: Claim NFT -> Open before expiry -> Transfer collectible"
            : "Flow: Hold NFT -> Open for GAS -> Share to next holder";

        return string(
            abi.encodePacked(
                "Red Envelope NFT (",
                typeText,
                "); Gate rules enforced by contract; ",
                flowText
            )
        );
    }

    function _buildTokenSvgDataUri(uint256 tokenId) internal pure returns (string memory) {
        tokenId;
        return "";
    }

    function _escapeXmlText(string memory value) internal pure returns (string memory) {
        return value;
    }

    function _escapeJsonString(string memory value) internal pure returns (string memory) {
        return value;
    }

    function _ceilingDiv(uint256 numerator, uint256 denominator) internal pure returns (uint256) {
        require(denominator > 0, "invalid denominator");
        if (numerator == 0) {
            return 0;
        }
        return (numerator + denominator - 1) / denominator;
    }

    function _getVolatilityLowerBps(uint256 totalPackets) internal pure returns (uint256) {
        if (totalPackets >= DENSE_PACKET_THRESHOLD) return DENSE_VOLATILITY_LOW_BPS;
        if (totalPackets >= MEDIUM_PACKET_THRESHOLD) return MEDIUM_VOLATILITY_LOW_BPS;
        return SPARSE_VOLATILITY_LOW_BPS;
    }

    function _getVolatilityUpperBps(uint256 totalPackets) internal pure returns (uint256) {
        if (totalPackets >= DENSE_PACKET_THRESHOLD) return DENSE_VOLATILITY_HIGH_BPS;
        if (totalPackets >= MEDIUM_PACKET_THRESHOLD) return MEDIUM_VOLATILITY_HIGH_BPS;
        return SPARSE_VOLATILITY_HIGH_BPS;
    }

    function _calculateRuntimeRandomPacketAmount(
        uint256 remainingAmount,
        uint256 packetsLeft,
        uint256 neoBalance,
        uint256 totalAmount,
        uint256 totalPackets
    ) internal view returns (uint256) {
        require(remainingAmount > 0, "no GAS remaining");
        require(packetsLeft > 0, "no packets left");
        require(totalAmount > 0, "invalid total amount");
        require(totalPackets > 0, "invalid total packets");

        if (packetsLeft == 1) {
            return remainingAmount;
        }

        uint256 minPerPacket = MIN_PER_PACKET;
        uint256 feasibleMax = remainingAmount - ((packetsLeft - 1) * minPerPacket);
        if (feasibleMax <= minPerPacket) {
            return minPerPacket;
        }

        uint256 dynamicAverage = _ceilingDiv(remainingAmount, packetsLeft);
        uint256 lowerBandBps = _getVolatilityLowerBps(totalPackets);
        uint256 upperBandBps = _getVolatilityUpperBps(totalPackets);

        uint256 minForThis = (dynamicAverage * lowerBandBps) / PERCENT_BASE;
        if (minForThis < minPerPacket) {
            minForThis = minPerPacket;
        }

        uint256 maxForThis = _ceilingDiv(dynamicAverage * upperBandBps, PERCENT_BASE);

        uint256 capByPercent = _ceilingDiv(totalAmount * MAX_SINGLE_PACKET_BPS, PERCENT_BASE);
        uint256 capByAverage = _ceilingDiv(dynamicAverage * MAX_SINGLE_PACKET_AVG_BPS, PERCENT_BASE);
        uint256 hardCap = capByPercent > capByAverage ? capByPercent : capByAverage;

        if (hardCap < minPerPacket) {
            hardCap = minPerPacket;
        }
        if (maxForThis > hardCap) {
            maxForThis = hardCap;
        }
        if (maxForThis > feasibleMax) {
            maxForThis = feasibleMax;
        }

        if (minForThis > maxForThis) {
            minForThis = minPerPacket;
            maxForThis = feasibleMax;
        }

        uint256 range = maxForThis - minForThis + 1;
        uint256 entropy = Syscalls.getCurrentRandom();
        if (entropy == 0) {
            entropy = 1;
        }
        uint256 divisor = 1;

        uint256 roll1;
        uint256 roll2;
        roll1 = (entropy / divisor) % range;
        unchecked {
            divisor = divisor * range;
        }
        if (divisor == 0) {
            divisor = 1;
        }
        roll2 = (entropy / divisor) % range;
        unchecked {
            divisor = divisor * range;
        }
        if (divisor == 0) {
            divisor = 1;
        }
        uint256 bestRoll = (roll1 + roll2) / 2;

        uint256 extraTrials = 0;
        if (neoBalance >= 1000) {
            extraTrials = 2;
        } else if (neoBalance >= 100) {
            extraTrials = 1;
        }

        for (uint256 i = 0; i < extraTrials; i++) {
            roll1 = (entropy / divisor) % range;
            unchecked {
                divisor = divisor * range;
            }
            if (divisor == 0) {
                divisor = 1;
            }
            roll2 = (entropy / divisor) % range;
            unchecked {
                divisor = divisor * range;
            }
            if (divisor == 0) {
                divisor = 1;
            }
            uint256 candidateRoll = (roll1 + roll2) / 2;
            if (candidateRoll > bestRoll) {
                bestRoll = candidateRoll;
            }
        }

        uint256 amount = minForThis + bestRoll;
        if (amount < minPerPacket) {
            amount = minPerPacket;
        }
        if (amount > feasibleMax) {
            amount = feasibleMax;
        }
        return amount;
    }

    function _tokenIdToEnvelopeId(bytes memory tokenIdBytes) internal pure returns (uint256 id) {
        uint256 len = tokenIdBytes.length;
        if (len > 32) {
            len = 32;
        }

        for (uint256 i = 0; i < len; i++) {
            id |= uint256(uint8(tokenIdBytes[i])) << (8 * i);
        }
    }

    function _idToTokenId(uint256 id) internal pure returns (bytes memory out) {
        if (id == 0) {
            out = new bytes(1);
            out[0] = 0x00;
            return out;
        }

        uint256 tmp = id;
        uint256 len = 0;
        while (tmp > 0) {
            len += 1;
            tmp >>= 8;
        }

        out = new bytes(len);
        tmp = id;
        for (uint256 i = 0; i < len; i++) {
            out[i] = bytes1(uint8(tmp));
            tmp >>= 8;
        }
    }

    function _toHexAddress(address account) internal pure returns (string memory) {
        bytes20 value = bytes20(account);
        bytes memory alphabet = "0123456789abcdef";
        bytes memory out = new bytes(42);

        out[0] = "0";
        out[1] = "x";

        for (uint256 i = 0; i < 20; i++) {
            uint8 b = uint8(value[i]);
            out[2 + (i * 2)] = alphabet[b >> 4];
            out[3 + (i * 2)] = alphabet[b & 0x0f];
        }
        return string(out);
    }

    function _now() internal view returns (uint256) {
        return Syscalls.getTime();
    }

    function _txSender() internal view returns (address) {
        Syscalls.Signer[] memory signers = Syscalls.getCurrentSigners();
        if (signers.length > 0 && signers[0].account != address(0)) {
            return signers[0].account;
        }

        Syscalls.Transaction memory txInfo = Syscalls.getScriptContainer();
        if (txInfo.sender != address(0)) {
            return txInfo.sender;
        }
        return msg.sender;
    }

    function _decodeAddressFromBytes(bytes calldata raw) internal pure returns (address decoded) {
        if (raw.length < 20) {
            return address(0);
        }

        uint160 value = 0;
        for (uint256 i = 0; i < 20; i++) {
            value = (value << 8) | uint160(uint8(raw[i]));
        }
        decoded = address(value);
    }
}
