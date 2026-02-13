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

        /// <summary>
        /// Validates NEO holding requirements and returns the account's NEO balance.
        /// </summary>
        private static BigInteger ValidateNeoHolding(UInt160 account, BigInteger minNeo, BigInteger minHoldSeconds)
        {
            BigInteger neoBalance = (BigInteger)NEO.BalanceOf(account);
            if (minNeo > 0)
            {
                ExecutionEngine.Assert(neoBalance >= minNeo, "insufficient NEO");
            }

            if (minHoldSeconds > 0)
            {
                object[] state = (object[])Neo.SmartContract.Framework.Services.Contract.Call(
                    NEO_HASH,
                    "getAccountState",
                    CallFlags.ReadOnly,
                    new object[] { account });
                ExecutionEngine.Assert(state != null, "no NEO state");

                BigInteger balanceHeight = (BigInteger)state[1];
                BigInteger blockTs = (BigInteger)Ledger.GetBlock((uint)balanceHeight).Timestamp;
                BigInteger holdDuration = (BigInteger)Runtime.Time - blockTs; // milliseconds
                ExecutionEngine.Assert(holdDuration >= minHoldSeconds * 1000, "hold duration not met");
            }

            return neoBalance;
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

            return CalculateRuntimeRandomPacketAmount(remainingAmount, remainingPackets, 0);
        }

        /// <summary>
        /// Random packet amount with NEO-weighted luck boost.
        /// Higher NEO balance → more rolls from the same entropy, keep the best.
        ///   0–99 NEO  → 1 roll  (baseline uniform)
        ///   100–999   → best of 2 rolls
        ///   1000+     → best of 3 rolls
        /// This is probabilistic: more NEO improves odds, never guarantees max.
        /// </summary>
        private static BigInteger CalculateRuntimeRandomPacketAmount(
            BigInteger remainingAmount,
            BigInteger packetsLeft,
            BigInteger neoBalance)
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

            // Base roll — uniform random within range
            BigInteger bestRoll = randomValue % range;

            // NEO luck boost: extract additional rolls from higher bits of the
            // same 256-bit random value and keep the best result.
            if (neoBalance >= 100)
            {
                BigInteger roll2 = (randomValue / range) % range;
                if (roll2 > bestRoll)
                    bestRoll = roll2;
            }
            if (neoBalance >= 1000)
            {
                BigInteger roll3 = (randomValue / range / range) % range;
                if (roll3 > bestRoll)
                    bestRoll = roll3;
            }

            return minPerPacket + bestRoll;
        }

        #endregion
    }
}
