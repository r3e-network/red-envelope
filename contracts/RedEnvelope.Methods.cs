#nullable disable
using System.Numerics;
using Neo;
using Neo.SmartContract.Framework;
using Neo.SmartContract.Framework.Attributes;
using Neo.SmartContract.Framework.Native;
using Neo.SmartContract.Framework.Services;

namespace RedEnvelope.Contract
{
    public partial class RedEnvelope
    {
        #region NEO Holding Validation

        private static void ValidateNeoHolding(UInt160 account, BigInteger minNeo, BigInteger minHoldSeconds)
        {
            BigInteger neoBalance = (BigInteger)NEO.BalanceOf(account);
            ExecutionEngine.Assert(neoBalance >= minNeo, "insufficient NEO");

            object[] state = (object[])Neo.SmartContract.Framework.Services.Contract.Call(
                NEO_HASH,
                "getAccountState",
                CallFlags.ReadOnly,
                new object[] { account });
            ExecutionEngine.Assert(state != null, "no NEO state");

            BigInteger balanceHeight = (BigInteger)state[1];
            BigInteger blockTs = (BigInteger)Ledger.GetBlock((uint)balanceHeight).Timestamp;
            BigInteger holdDuration = (BigInteger)Runtime.Time - blockTs;
            ExecutionEngine.Assert(holdDuration >= minHoldSeconds, "hold duration not met");
        }

        #endregion

        #region Random Distribution

        [Safe]
        public static BigInteger CalculatePacketAmount(BigInteger envelopeId, BigInteger packetIndex)
        {
            EnvelopeData envelope = GetEnvelopeData(envelopeId);
            if (!EnvelopeExists(envelope)) return 0;

            BigInteger remainingPackets = envelope.PacketCount - packetIndex;
            if (remainingPackets <= 0) return 0;

            BigInteger remainingAmount = envelope.RemainingAmount;
            if (remainingAmount <= 0) return 0;

            return CalculateRuntimeRandomPacketAmount(remainingAmount, remainingPackets);
        }

        private static BigInteger CalculateRuntimeRandomPacketAmount(
            BigInteger remainingAmount,
            BigInteger packetsLeft)
        {
            ExecutionEngine.Assert(remainingAmount > 0, "no GAS remaining");
            ExecutionEngine.Assert(packetsLeft > 0, "no packets left");

            if (packetsLeft == 1)
                return remainingAmount;

            BigInteger minPerPacket = MIN_PER_PACKET;
            BigInteger maxForThis = remainingAmount - (packetsLeft - 1) * minPerPacket;

            if (maxForThis <= minPerPacket)
                return minPerPacket;

            BigInteger range = maxForThis - minPerPacket + 1;
            BigInteger randomValue = Runtime.GetRandom();
            if (randomValue < 0)
                randomValue = -randomValue;

            return minPerPacket + (randomValue % range);
        }

        #endregion
    }
}
