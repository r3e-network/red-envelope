// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./RedEnvelope.Admin.sol";

abstract contract RedEnvelopeQuery is RedEnvelopeAdmin {
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
}
