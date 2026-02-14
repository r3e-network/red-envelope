#nullable disable
using System.Numerics;
using Neo;
using Neo.SmartContract.Framework;
using Neo.SmartContract.Framework.Native;
using Neo.SmartContract.Framework.Services;

namespace RedEnvelope.Contract
{
    public partial class RedEnvelope
    {
        #region Lucky Pool + Claim NFT

        /// <summary>
        /// Claim from a lucky pool; mint a claim NFT holding one random packet amount.
        /// </summary>
        public static BigInteger ClaimFromPool(BigInteger poolId, UInt160 claimer)
        {
            AssertNotPaused();
            AssertDirectUserInvocation();
            ExecutionEngine.Assert(Runtime.CheckWitness(claimer), "unauthorized");
            ExecutionEngine.Assert(!IsContractAccount(claimer), "contracts cannot claim");

            EnvelopeData pool = GetEnvelopeData(poolId);
            ExecutionEngine.Assert(EnvelopeExists(pool), "pool not found");
            ExecutionEngine.Assert(pool.EnvelopeType == ENVELOPE_TYPE_POOL, "not lucky pool");
            ExecutionEngine.Assert(pool.Active, "not active");
            ExecutionEngine.Assert(pool.OpenedCount < pool.PacketCount, "pool depleted");
            ExecutionEngine.Assert(Runtime.Time <= (ulong)pool.ExpiryTime, "expired");

            ByteString claimerKey = Helper.Concat(
                Helper.Concat((ByteString)PREFIX_POOL_CLAIMER, (ByteString)poolId.ToByteArray()),
                (ByteString)(byte[])claimer);
            ExecutionEngine.Assert(Storage.Get(Storage.CurrentContext, claimerKey) == null, "already claimed");

            BigInteger claimerNeo = ValidateNeoHolding(claimer, pool.MinNeoRequired, pool.MinHoldSeconds);

            BigInteger remainingPacketsBeforeClaim = pool.PacketCount - pool.OpenedCount;
            BigInteger amount = CalculateRuntimeRandomPacketAmount(
                pool.RemainingAmount,
                remainingPacketsBeforeClaim,
                claimerNeo);
            ExecutionEngine.Assert(amount > 0, "invalid amount");

            Storage.Put(Storage.CurrentContext, claimerKey, amount);

            pool.OpenedCount += 1;
            pool.RemainingAmount -= amount;
            BigInteger remainingPackets = pool.PacketCount - pool.OpenedCount;
            if (remainingPackets == 0)
            {
                pool.Active = false;
            }
            StoreEnvelopeData(poolId, pool);

            BigInteger claimId = AllocateEnvelopeId();
            EnvelopeData claim = new EnvelopeData
            {
                Creator = pool.Creator,
                TotalAmount = amount,
                PacketCount = 1,
                Message = pool.Message,
                EnvelopeType = ENVELOPE_TYPE_CLAIM,
                ParentEnvelopeId = poolId,
                OpenedCount = 0,
                RemainingAmount = amount,
                MinNeoRequired = pool.MinNeoRequired,
                MinHoldSeconds = pool.MinHoldSeconds,
                Active = true,
                ExpiryTime = pool.ExpiryTime
            };
            StoreEnvelopeData(claimId, claim);

            ByteString claimTokenId = (ByteString)claimId.ToByteArray();
            Mint(claimTokenId, new RedEnvelopeState
            {
                Owner = claimer,
                Name = "ClaimEnvelope #" + claimId.ToString(),
                EnvelopeId = claimId,
                Creator = pool.Creator,
                TotalAmount = amount,
                PacketCount = 1,
                Message = pool.Message,
                EnvelopeType = ENVELOPE_TYPE_CLAIM,
                ParentEnvelopeId = poolId
            });

            StorePoolClaimId(poolId, pool.OpenedCount, claimId);
            OnEnvelopeOpened(poolId, claimer, amount, remainingPackets);
            OnEnvelopeCreated(claimId, pool.Creator, amount, 1, ENVELOPE_TYPE_CLAIM);

            return claimId;
        }


        /// <summary>
        /// Open a claim NFT and claim all GAS in that claim.
        /// The NFT remains on-chain and transferable after opening.
        /// </summary>
        public static BigInteger OpenClaim(BigInteger claimId, UInt160 opener)
        {
            AssertNotPaused();
            AssertDirectUserInvocation();
            ExecutionEngine.Assert(Runtime.CheckWitness(opener), "unauthorized");
            ExecutionEngine.Assert(!IsContractAccount(opener), "contracts cannot open");

            ByteString tokenId = (ByteString)claimId.ToByteArray();
            RedEnvelopeState token = GetTokenState(tokenId);
            ExecutionEngine.Assert(token != null, "claim not found");
            ExecutionEngine.Assert(token.EnvelopeType == ENVELOPE_TYPE_CLAIM, "not claim NFT");

            UInt160 currentHolder = (UInt160)OwnerOf(tokenId);
            ExecutionEngine.Assert(currentHolder == opener, "not NFT holder");

            EnvelopeData claim = GetEnvelopeData(claimId);
            ExecutionEngine.Assert(EnvelopeExists(claim), "claim not found");
            ExecutionEngine.Assert(claim.EnvelopeType == ENVELOPE_TYPE_CLAIM, "not claim NFT");
            ExecutionEngine.Assert(claim.Active, "not active");
            ExecutionEngine.Assert(claim.OpenedCount == 0, "already opened");
            ExecutionEngine.Assert(claim.RemainingAmount > 0, "no GAS remaining");
            ExecutionEngine.Assert(Runtime.Time <= (ulong)claim.ExpiryTime, "expired");

            ValidateNeoHolding(opener, claim.MinNeoRequired, claim.MinHoldSeconds);

            BigInteger amount = claim.RemainingAmount;
            claim.OpenedCount = 1;
            claim.RemainingAmount = 0;
            claim.Active = false;
            StoreEnvelopeData(claimId, claim);

            ExecutionEngine.Assert(
                GAS.Transfer(Runtime.ExecutingScriptHash, opener, amount),
                "GAS transfer failed");
            OnEnvelopeOpened(claimId, opener, amount, 0);

            return amount;
        }


        /// <summary>
        /// Transfer claim NFT.
        /// Claim NFTs remain transferable after opening/expiry/reclaim as ownership collectibles.
        /// </summary>
        public static void TransferClaim(BigInteger claimId, UInt160 from, UInt160 to)
        {
            AssertNotPaused();
            AssertDirectUserInvocation();
            ExecutionEngine.Assert(Runtime.CheckWitness(from), "unauthorized");
            ExecutionEngine.Assert(to != null && to.IsValid, "invalid recipient");
            ExecutionEngine.Assert(!IsContractAccount(to), "contract recipient not allowed");

            ByteString tokenId = (ByteString)claimId.ToByteArray();
            RedEnvelopeState token = GetTokenState(tokenId);
            ExecutionEngine.Assert(token != null, "claim not found");
            ExecutionEngine.Assert(token.EnvelopeType == ENVELOPE_TYPE_CLAIM, "not claim NFT");

            UInt160 currentHolder = (UInt160)OwnerOf(tokenId);
            ExecutionEngine.Assert(currentHolder == from, "not NFT holder");

            EnvelopeData claim = GetEnvelopeData(claimId);
            ExecutionEngine.Assert(EnvelopeExists(claim), "claim not found");

            ExecutionEngine.Assert(Transfer(to, tokenId, null), "transfer failed");
        }


        /// <summary>
        /// Pool creator reclaims all unclaimed GAS:
        /// - remaining unclaimed pool balance
        /// - all unopened claim NFT balances
        /// </summary>
        public static BigInteger ReclaimPool(BigInteger poolId, UInt160 creator)
        {
            AssertNotPaused();
            AssertDirectUserInvocation();
            ExecutionEngine.Assert(Runtime.CheckWitness(creator), "unauthorized");

            EnvelopeData pool = GetEnvelopeData(poolId);
            ExecutionEngine.Assert(EnvelopeExists(pool), "pool not found");
            ExecutionEngine.Assert(pool.EnvelopeType == ENVELOPE_TYPE_POOL, "not lucky pool");
            ExecutionEngine.Assert(pool.Creator == creator, "not creator");
            ExecutionEngine.Assert(pool.Active, "already reclaimed");
            ExecutionEngine.Assert(Runtime.Time > (ulong)pool.ExpiryTime, "not expired");

            BigInteger refundAmount = pool.RemainingAmount;

            // NOTE: This loop iterates up to MAX_PACKETS (100) times, each with 2 storage reads.
            // Gas cost is bounded but significant. If MAX_PACKETS increases, consider batch reclaim.
            for (BigInteger i = 1; i <= pool.OpenedCount; i++)
            {
                BigInteger claimId = GetPoolClaimId(poolId, i);
                if (claimId <= 0) continue;

                EnvelopeData claim = GetEnvelopeData(claimId);
                if (!EnvelopeExists(claim)) continue;
                if (claim.EnvelopeType != ENVELOPE_TYPE_CLAIM) continue;

                if (claim.Active && claim.RemainingAmount > 0)
                {
                    refundAmount += claim.RemainingAmount;
                    claim.RemainingAmount = 0;
                    claim.Active = false;
                    StoreEnvelopeData(claimId, claim);
                }
            }

            ExecutionEngine.Assert(refundAmount > 0, "no GAS remaining");

            pool.RemainingAmount = 0;
            pool.Active = false;
            StoreEnvelopeData(poolId, pool);

            ExecutionEngine.Assert(
                GAS.Transfer(Runtime.ExecutingScriptHash, creator, refundAmount),
                "GAS transfer failed");
            OnEnvelopeRefunded(poolId, creator, refundAmount);

            return refundAmount;
        }


        #endregion
    }
}
