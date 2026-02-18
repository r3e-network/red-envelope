// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./RedEnvelope.Storage.sol";

abstract contract RedEnvelopeInternal is RedEnvelopeStorage {
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

    function _mulClampMax(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == 0 || b == 0) {
            return 0;
        }
        if (a > NEO_INT_MAX / b) {
            return NEO_INT_MAX;
        }
        return a * b;
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
        divisor = _mulClampMax(divisor, range);
        roll2 = (entropy / divisor) % range;
        divisor = _mulClampMax(divisor, range);
        uint256 bestRoll = (roll1 + roll2) / 2;

        uint256 extraTrials = 0;
        if (neoBalance >= 1000) {
            extraTrials = 2;
        } else if (neoBalance >= 100) {
            extraTrials = 1;
        }

        for (uint256 i = 0; i < extraTrials; i++) {
            roll1 = (entropy / divisor) % range;
            divisor = _mulClampMax(divisor, range);
            roll2 = (entropy / divisor) % range;
            divisor = _mulClampMax(divisor, range);
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
