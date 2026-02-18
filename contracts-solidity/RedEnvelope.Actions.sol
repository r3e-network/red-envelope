// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./RedEnvelope.Query.sol";

abstract contract RedEnvelopeActions is RedEnvelopeQuery {
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
}
