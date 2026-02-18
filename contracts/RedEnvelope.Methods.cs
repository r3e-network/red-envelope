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

            return CalculateRuntimeRandomPacketAmount(
                remainingAmount,
                remainingPackets,
                0,
                envelope.TotalAmount,
                envelope.PacketCount);
        }

        /// <summary>
        /// Random packet amount with multi-layer probability control:
        /// 1) Feasibility bounds guarantee the envelope can always complete.
        /// 2) Dynamic volatility band keeps allocation near current average.
        /// 3) Triangular-like sampling reduces tail risk vs. flat uniform.
        /// 4) NEO luck boost uses best-of-N centered rolls, still bounded by the same band.
        /// </summary>
        private static BigInteger CalculateRuntimeRandomPacketAmount(
            BigInteger remainingAmount,
            BigInteger packetsLeft,
            BigInteger neoBalance,
            BigInteger totalAmount,
            BigInteger totalPackets)
        {
            ExecutionEngine.Assert(remainingAmount > 0, "no GAS remaining");
            ExecutionEngine.Assert(packetsLeft > 0, "no packets left");
            ExecutionEngine.Assert(totalAmount > 0, "invalid total amount");
            ExecutionEngine.Assert(totalPackets > 0, "invalid total packets");

            if (packetsLeft == 1)
                return remainingAmount;

            BigInteger minPerPacket = MIN_PER_PACKET;
            BigInteger feasibleMax = remainingAmount - (packetsLeft - 1) * minPerPacket;

            if (feasibleMax <= minPerPacket)
                return minPerPacket;

            BigInteger dynamicAverage = CeilingDiv(remainingAmount, packetsLeft);
            BigInteger lowerBandBps = GetVolatilityLowerBps(totalPackets);
            BigInteger upperBandBps = GetVolatilityUpperBps(totalPackets);

            BigInteger minForThis = (dynamicAverage * lowerBandBps) / PERCENT_BASE;
            if (minForThis < minPerPacket)
                minForThis = minPerPacket;

            BigInteger maxForThis = CeilingDiv(dynamicAverage * upperBandBps, PERCENT_BASE);

            // Hard safety cap: still keep a legacy total-based ceiling, but also guard by
            // dynamic average to avoid large outliers when packets are dense.
            BigInteger capByPercent = CeilingDiv(totalAmount * MAX_SINGLE_PACKET_BPS, PERCENT_BASE);
            BigInteger capByAverage = CeilingDiv(dynamicAverage * MAX_SINGLE_PACKET_AVG_BPS, PERCENT_BASE);
            BigInteger hardCap = capByPercent > capByAverage ? capByPercent : capByAverage;
            if (hardCap < minPerPacket)
                hardCap = minPerPacket;
            if (maxForThis > hardCap)
                maxForThis = hardCap;

            if (maxForThis > feasibleMax)
                maxForThis = feasibleMax;

            // Fallback to pure feasibility window if volatility window becomes too tight.
            if (minForThis > maxForThis)
            {
                minForThis = minPerPacket;
                maxForThis = feasibleMax;
            }

            BigInteger range = maxForThis - minForThis + 1;
            BigInteger entropy = Runtime.GetRandom();
            if (entropy < 0)
                entropy = -entropy;
            if (entropy == 0)
                entropy = 1;

            BigInteger divisor = 1;
            BigInteger roll1 = (entropy / divisor) % range;
            divisor = divisor * range;
            BigInteger roll2 = (entropy / divisor) % range;
            divisor = divisor * range;
            BigInteger bestRoll = (roll1 + roll2) / 2;
            int extraTrials = 0;
            if (neoBalance >= 1000)
                extraTrials = 2;
            else if (neoBalance >= 100)
                extraTrials = 1;

            for (int i = 0; i < extraTrials; i++)
            {
                roll1 = (entropy / divisor) % range;
                divisor = divisor * range;
                roll2 = (entropy / divisor) % range;
                divisor = divisor * range;
                BigInteger candidateRoll = (roll1 + roll2) / 2;
                if (candidateRoll > bestRoll)
                    bestRoll = candidateRoll;
            }

            return minForThis + bestRoll;
        }

        private static BigInteger GetVolatilityLowerBps(BigInteger totalPackets)
        {
            if (totalPackets >= DENSE_PACKET_THRESHOLD) return DENSE_VOLATILITY_LOW_BPS;
            if (totalPackets >= MEDIUM_PACKET_THRESHOLD) return MEDIUM_VOLATILITY_LOW_BPS;
            return SPARSE_VOLATILITY_LOW_BPS;
        }

        private static BigInteger GetVolatilityUpperBps(BigInteger totalPackets)
        {
            if (totalPackets >= DENSE_PACKET_THRESHOLD) return DENSE_VOLATILITY_HIGH_BPS;
            if (totalPackets >= MEDIUM_PACKET_THRESHOLD) return MEDIUM_VOLATILITY_HIGH_BPS;
            return SPARSE_VOLATILITY_HIGH_BPS;
        }

        private static BigInteger CeilingDiv(BigInteger numerator, BigInteger denominator)
        {
            ExecutionEngine.Assert(denominator > 0, "invalid denominator");
            if (numerator <= 0) return 0;
            return (numerator + denominator - 1) / denominator;
        }

        #endregion
    }
}
