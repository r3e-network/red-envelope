// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./RedEnvelope.Internal.sol";

abstract contract RedEnvelopeAdmin is RedEnvelopeInternal {
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
}
