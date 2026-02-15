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
        #region Spreading Envelope

        /// <summary>
        /// Open a spreading envelope NFT. Caller must be current NFT holder.
        /// </summary>
        public static BigInteger OpenEnvelope(BigInteger envelopeId, UInt160 opener)
        {
            AssertNotPaused();
            AssertDirectUserInvocation();
            ExecutionEngine.Assert(Runtime.CheckWitness(opener), "unauthorized");
            ExecutionEngine.Assert(!IsContractAccount(opener), "contracts cannot open");

            ByteString tokenId = (ByteString)envelopeId.ToByteArray();
            RedEnvelopeState token = GetTokenState(tokenId);
            ExecutionEngine.Assert(token != null, "token not found");
            ExecutionEngine.Assert(token.EnvelopeType == ENVELOPE_TYPE_SPREADING, "not spreading envelope");

            UInt160 currentHolder = (UInt160)OwnerOf(tokenId);
            ExecutionEngine.Assert(currentHolder == opener, "not NFT holder");

            EnvelopeData envelope = GetEnvelopeData(envelopeId);
            ExecutionEngine.Assert(EnvelopeExists(envelope), "envelope not found");
            ExecutionEngine.Assert(envelope.EnvelopeType == ENVELOPE_TYPE_SPREADING, "invalid envelope type");
            ExecutionEngine.Assert(envelope.Active, "not active");
            ExecutionEngine.Assert(envelope.OpenedCount < envelope.PacketCount, "depleted");
            ExecutionEngine.Assert(Runtime.Time <= (ulong)envelope.ExpiryTime, "expired");

            ByteString openerKey = Helper.Concat(
                Helper.Concat((ByteString)PREFIX_OPENER, (ByteString)envelopeId.ToByteArray()),
                (ByteString)(byte[])opener);
            ExecutionEngine.Assert(Storage.Get(Storage.CurrentContext, openerKey) == null, "already opened");

            BigInteger openerNeo = ValidateNeoHolding(opener, envelope.MinNeoRequired, envelope.MinHoldSeconds);

            BigInteger remainingPacketsBeforeOpen = envelope.PacketCount - envelope.OpenedCount;
            BigInteger amount = CalculateRuntimeRandomPacketAmount(
                envelope.RemainingAmount,
                remainingPacketsBeforeOpen,
                openerNeo,
                envelope.TotalAmount,
                envelope.PacketCount);
            ExecutionEngine.Assert(amount > 0, "invalid amount");

            Storage.Put(Storage.CurrentContext, openerKey, amount);

            envelope.OpenedCount += 1;
            envelope.RemainingAmount -= amount;
            BigInteger remainingPackets = envelope.PacketCount - envelope.OpenedCount;
            if (remainingPackets == 0)
            {
                envelope.Active = false;
            }
            StoreEnvelopeData(envelopeId, envelope);

            ExecutionEngine.Assert(
                GAS.Transfer(Runtime.ExecutingScriptHash, opener, amount),
                "GAS transfer failed");

            OnEnvelopeOpened(envelopeId, opener, amount, remainingPackets);

            return amount;
        }


        /// <summary>
        /// Transfer spreading envelope NFT.
        /// NFT ownership can continue circulating even after all reward packets are opened
        /// or after expiry/reclaim.
        /// </summary>
        public static void TransferEnvelope(BigInteger envelopeId, UInt160 from, UInt160 to, object data)
        {
            AssertNotPaused();
            AssertDirectUserInvocation();
            ExecutionEngine.Assert(Runtime.CheckWitness(from), "unauthorized");
            ExecutionEngine.Assert(to != null && to.IsValid, "invalid recipient");
            ExecutionEngine.Assert(!IsContractAccount(to), "contract recipient not allowed");

            ByteString tokenId = (ByteString)envelopeId.ToByteArray();
            RedEnvelopeState token = GetTokenState(tokenId);
            ExecutionEngine.Assert(token != null, "token not found");
            ExecutionEngine.Assert(token.EnvelopeType == ENVELOPE_TYPE_SPREADING, "not spreading envelope");

            EnvelopeData envelope = GetEnvelopeData(envelopeId);
            ExecutionEngine.Assert(EnvelopeExists(envelope), "envelope not found");

            ExecutionEngine.Assert(Transfer(to, tokenId, data), "transfer failed");
        }


        /// <summary>
        /// Creator reclaims unclaimed GAS from an expired spreading envelope.
        /// </summary>
        public static BigInteger ReclaimEnvelope(BigInteger envelopeId, UInt160 creator)
        {
            AssertNotPaused();
            AssertDirectUserInvocation();
            ExecutionEngine.Assert(Runtime.CheckWitness(creator), "unauthorized");

            EnvelopeData envelope = GetEnvelopeData(envelopeId);
            ExecutionEngine.Assert(EnvelopeExists(envelope), "envelope not found");
            ExecutionEngine.Assert(envelope.EnvelopeType == ENVELOPE_TYPE_SPREADING, "not spreading envelope");
            ExecutionEngine.Assert(envelope.Creator == creator, "not creator");
            ExecutionEngine.Assert(envelope.Active, "not active");
            ExecutionEngine.Assert(Runtime.Time > (ulong)envelope.ExpiryTime, "not expired");
            ExecutionEngine.Assert(envelope.RemainingAmount > 0, "no GAS remaining");

            BigInteger refundAmount = envelope.RemainingAmount;

            envelope.RemainingAmount = 0;
            envelope.Active = false;
            StoreEnvelopeData(envelopeId, envelope);

            ExecutionEngine.Assert(
                GAS.Transfer(Runtime.ExecutingScriptHash, creator, refundAmount),
                "GAS transfer failed");

            OnEnvelopeRefunded(envelopeId, creator, refundAmount);

            return refundAmount;
        }


        #endregion
    }
}
