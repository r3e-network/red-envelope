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
        #region Envelope State

        [Safe]
        public static Map<string, object> GetEnvelopeState(BigInteger envelopeId)
        {
            Map<string, object> result = new Map<string, object>();
            EnvelopeData envelope = GetEnvelopeData(envelopeId);
            if (!EnvelopeExists(envelope)) return result;

            result["id"] = envelopeId;
            result["creator"] = envelope.Creator;
            result["totalAmount"] = envelope.TotalAmount;
            result["packetCount"] = envelope.PacketCount;
            result["openedCount"] = envelope.OpenedCount;
            result["claimedCount"] = envelope.OpenedCount;
            result["remainingAmount"] = envelope.RemainingAmount;
            result["remainingPackets"] = envelope.PacketCount - envelope.OpenedCount;
            result["minNeoRequired"] = envelope.MinNeoRequired;
            result["minHoldSeconds"] = envelope.MinHoldSeconds;
            result["active"] = envelope.Active;
            result["expiryTime"] = envelope.ExpiryTime;
            result["currentTime"] = Runtime.Time;
            result["isExpired"] = Runtime.Time > (ulong)envelope.ExpiryTime;
            result["isDepleted"] =
                envelope.OpenedCount >= envelope.PacketCount || envelope.RemainingAmount <= 0;
            result["message"] = envelope.Message;
            result["envelopeType"] = envelope.EnvelopeType;
            result["parentEnvelopeId"] = envelope.ParentEnvelopeId;

            if (envelope.EnvelopeType == ENVELOPE_TYPE_SPREADING || envelope.EnvelopeType == ENVELOPE_TYPE_CLAIM)
            {
                ByteString tokenId = (ByteString)envelopeId.ToByteArray();
                RedEnvelopeState token = GetTokenState(tokenId);
                if (token != null)
                {
                    result["currentHolder"] = (UInt160)OwnerOf(tokenId);
                }
                else
                {
                    result["currentHolder"] = UInt160.Zero;
                }
            }
            else
            {
                result["currentHolder"] = UInt160.Zero;
            }

            return result;
        }

        #endregion

        #region Claim NFT Query

        [Safe]
        public static Map<string, object> GetClaimState(BigInteger claimId)
        {
            Map<string, object> result = new Map<string, object>();
            EnvelopeData claim = GetEnvelopeData(claimId);
            if (!EnvelopeExists(claim)) return result;
            if (claim.EnvelopeType != ENVELOPE_TYPE_CLAIM) return result;

            ByteString tokenId = (ByteString)claimId.ToByteArray();
            RedEnvelopeState token = GetTokenState(tokenId);
            UInt160 holder = UInt160.Zero;
            if (token != null)
            {
                holder = (UInt160)OwnerOf(tokenId);
            }

            result["id"] = claimId;
            result["poolId"] = claim.ParentEnvelopeId;
            result["holder"] = holder;
            result["amount"] = claim.TotalAmount;
            result["opened"] = claim.OpenedCount > 0 || !claim.Active || claim.RemainingAmount == 0;
            result["message"] = claim.Message;
            result["expiryTime"] = claim.ExpiryTime;

            return result;
        }

        #endregion

        #region Eligibility Check

        [Safe]
        public static Map<string, object> CheckEligibility(BigInteger envelopeId, UInt160 user)
        {
            Map<string, object> result = new Map<string, object>();

            if (IsContractAccount(user))
            {
                result["eligible"] = false;
                result["reason"] = "contracts cannot open/claim";
                return result;
            }

            EnvelopeData envelope = GetEnvelopeData(envelopeId);

            if (!EnvelopeExists(envelope))
            {
                result["eligible"] = false;
                result["reason"] = "envelope not found";
                return result;
            }

            if (!envelope.Active)
            {
                result["eligible"] = false;
                result["reason"] = "not active";
                return result;
            }

            BigInteger neoBalance = (BigInteger)Neo.SmartContract.Framework.Services.Contract.Call(
                NEO_HASH,
                "balanceOf",
                CallFlags.ReadOnly,
                new object[] { user });
            result["neoBalance"] = neoBalance;
            result["minNeoRequired"] = envelope.MinNeoRequired;

            if (envelope.MinNeoRequired > 0 && neoBalance < envelope.MinNeoRequired)
            {
                result["eligible"] = false;
                result["reason"] = "insufficient NEO";
                return result;
            }

            result["minHoldSeconds"] = envelope.MinHoldSeconds;

            if (envelope.MinHoldSeconds <= 0)
            {
                result["holdDuration"] = 0;
                result["holdDays"] = 0;
                result["eligible"] = true;
                result["reason"] = "ok";
                return result;
            }

            object[] state = (object[])Neo.SmartContract.Framework.Services.Contract.Call(
                NEO_HASH,
                "getAccountState",
                CallFlags.ReadOnly,
                new object[] { user });

            if (state == null)
            {
                result["eligible"] = false;
                result["reason"] = "no NEO state";
                return result;
            }

            BigInteger balanceHeight = (BigInteger)state[1];
            BigInteger blockTs = (BigInteger)Ledger.GetBlock((uint)balanceHeight).Timestamp;
            BigInteger holdDuration = (BigInteger)Runtime.Time - blockTs; // milliseconds
            BigInteger holdDays = holdDuration / 86_400_000; // ms → days

            result["holdDuration"] = holdDuration;
            result["holdDays"] = holdDays;

            if (holdDuration < envelope.MinHoldSeconds * 1000)
            {
                result["eligible"] = false;
                result["reason"] = "hold duration not met";
                return result;
            }

            result["eligible"] = true;
            result["reason"] = "ok";
            return result;
        }

        #endregion

        #region Open/Claim Checks

        [Safe]
        public static bool HasOpened(BigInteger envelopeId, UInt160 opener)
        {
            ByteString key = Helper.Concat(
                Helper.Concat((ByteString)PREFIX_OPENER, (ByteString)envelopeId.ToByteArray()),
                (ByteString)(byte[])opener);
            return Storage.Get(Storage.CurrentContext, key) != null;
        }

        [Safe]
        public static BigInteger GetOpenedAmount(BigInteger envelopeId, UInt160 opener)
        {
            ByteString key = Helper.Concat(
                Helper.Concat((ByteString)PREFIX_OPENER, (ByteString)envelopeId.ToByteArray()),
                (ByteString)(byte[])opener);
            ByteString data = Storage.Get(Storage.CurrentContext, key);
            if (data == null) return 0;
            return (BigInteger)data;
        }

        [Safe]
        public static bool HasClaimedFromPool(BigInteger poolId, UInt160 claimer)
        {
            ByteString claimerKey = Helper.Concat(
                Helper.Concat((ByteString)PREFIX_POOL_CLAIMER, (ByteString)poolId.ToByteArray()),
                (ByteString)(byte[])claimer);
            return Storage.Get(Storage.CurrentContext, claimerKey) != null;
        }

        [Safe]
        public static BigInteger GetPoolClaimedAmount(BigInteger poolId, UInt160 claimer)
        {
            ByteString claimerKey = Helper.Concat(
                Helper.Concat((ByteString)PREFIX_POOL_CLAIMER, (ByteString)poolId.ToByteArray()),
                (ByteString)(byte[])claimer);
            ByteString data = Storage.Get(Storage.CurrentContext, claimerKey);
            if (data == null) return 0;
            return (BigInteger)data;
        }

        #endregion

        #region Constants + Stats

        [Safe]
        public static Map<string, object> GetCalculationConstants()
        {
            Map<string, object> c = new Map<string, object>();
            c["minAmount"] = MIN_AMOUNT;
            c["maxPackets"] = MAX_PACKETS;
            c["minPerPacket"] = MIN_PER_PACKET;
            c["maxSinglePacketBps"] = MAX_SINGLE_PACKET_BPS;
            c["percentBase"] = PERCENT_BASE;
            c["maxSinglePacketPercent"] = (MAX_SINGLE_PACKET_BPS * 100) / PERCENT_BASE;
            c["defaultExpiryMs"] = DEFAULT_EXPIRY_MS;
            c["defaultMinNeo"] = DEFAULT_MIN_NEO;
            c["defaultMinHoldSeconds"] = DEFAULT_MIN_HOLD_SECONDS;
            c["typeSpreading"] = ENVELOPE_TYPE_SPREADING;
            c["typePool"] = ENVELOPE_TYPE_POOL;
            c["typeClaim"] = ENVELOPE_TYPE_CLAIM;
            c["currentTime"] = Runtime.Time;
            return c;
        }

        [Safe]
        public static BigInteger GetTotalEnvelopes() =>
            (BigInteger)Storage.Get(Storage.CurrentContext, PREFIX_TOTAL_ENVELOPES);

        [Safe]
        public static BigInteger GetTotalDistributed() =>
            (BigInteger)Storage.Get(Storage.CurrentContext, PREFIX_TOTAL_DISTRIBUTED);

        #endregion

        #region Pool Claim Index

        [Safe]
        public static BigInteger GetPoolClaimIdByIndex(BigInteger poolId, BigInteger claimIndex)
        {
            return GetPoolClaimId(poolId, claimIndex);
        }

        #endregion
    }
}
