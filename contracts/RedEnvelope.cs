#nullable disable
using System;
using System.ComponentModel;
using System.Numerics;
using Neo;
using Neo.SmartContract.Framework;
using Neo.SmartContract.Framework.Attributes;
using Neo.SmartContract.Framework.Native;
using Neo.SmartContract.Framework.Services;

namespace RedEnvelope.Contract
{
    /// <summary>
    /// Standalone Red Envelope NFT contract.
    ///
    /// Envelope types:
    /// 0 = Spreading (single NFT passed along, each holder opens once for random GAS)
    /// 1 = Lucky Pool (pool can be claimed by many users; each claim mints a claim NFT)
    /// 2 = Claim NFT (minted from lucky pool claim; can transfer before opening)
    /// </summary>
    [DisplayName("RedEnvelope")]
    [ContractAuthor("R3E Network", "dev@r3e.network")]
    [ContractDescription("Standalone dual-type red envelope NFT with random GAS distribution and reclaimable unclaimed balance.")]
    [ManifestExtra("Version", "1.0.0")]
    [SupportedStandards(NepStandard.Nep11)]
    [ContractPermission("0xd2a4cff31913016155e38e474a2c06d08be276cf", "*")]  // GAS
    [ContractPermission("0xef4073a0f2b305a38ec4050e4d3d28bc40ea63f5", "*")]  // NEO
    [ContractPermission(Permission.Any, Method.OnNEP11Payment)]
    [ContractSourceCode("https://github.com/r3e-network/red-envelope")]
    public partial class RedEnvelope : Nep11Token<RedEnvelopeState>
    {
        [Safe]
        public override string Symbol => "RDE";

        #region Constants

        private const long MIN_AMOUNT = 100_000_000;            // 1 GAS
        private const int MAX_PACKETS = 100;
        private const long MIN_PER_PACKET = 10_000_000;         // 0.1 GAS
        private const long DEFAULT_EXPIRY_MS = 604_800_000;      // 7 days in ms
        private const long DEFAULT_MIN_NEO = 100;
        private const long DEFAULT_MIN_HOLD_SECONDS = 172_800;  // 2 days

        internal const int ENVELOPE_TYPE_SPREADING = 0;
        internal const int ENVELOPE_TYPE_POOL = 1;
        internal const int ENVELOPE_TYPE_CLAIM = 2;

        private static readonly UInt160 GAS_HASH =
            Neo.SmartContract.Framework.Native.GAS.Hash;
        private static readonly UInt160 NEO_HASH =
            Neo.SmartContract.Framework.Native.NEO.Hash;

        #endregion

        #region Storage Prefixes (0x10+ to avoid Nep11Token base 0x00-0x04)

        private static readonly byte[] PREFIX_OWNER = new byte[] { 0x10 };
        private static readonly byte[] PREFIX_PAUSED = new byte[] { 0x11 };
        private static readonly byte[] PREFIX_ENVELOPE_ID = new byte[] { 0x12 };
        private static readonly byte[] PREFIX_ENVELOPE_DATA = new byte[] { 0x13 };
        private static readonly byte[] PREFIX_OPENER = new byte[] { 0x14 };
        private static readonly byte[] PREFIX_TOTAL_ENVELOPES = new byte[] { 0x16 };
        private static readonly byte[] PREFIX_TOTAL_DISTRIBUTED = new byte[] { 0x17 };
        private static readonly byte[] PREFIX_POOL_CLAIMER = new byte[] { 0x18 };
        private static readonly byte[] PREFIX_POOL_CLAIM_INDEX = new byte[] { 0x19 };

        #endregion

        #region Envelope Data

        /// <summary>
        /// Mutable and queryable per-envelope state.
        /// For pool envelopes (type=1), no NFT token is minted.
        /// </summary>
        public struct EnvelopeData
        {
            public UInt160 Creator;
            public BigInteger TotalAmount;
            public BigInteger PacketCount;
            public string Message;
            public BigInteger EnvelopeType;
            public BigInteger ParentEnvelopeId;
            public BigInteger OpenedCount;
            public BigInteger RemainingAmount;
            public BigInteger MinNeoRequired;
            public BigInteger MinHoldSeconds;
            public bool Active;
            public BigInteger ExpiryTime;
        }

        #endregion

        #region Event Delegates

        public delegate void EnvelopeCreatedHandler(
            BigInteger envelopeId,
            UInt160 creator,
            BigInteger totalAmount,
            BigInteger packetCount,
            BigInteger envelopeType);

        public delegate void EnvelopeOpenedHandler(
            BigInteger envelopeId,
            UInt160 opener,
            BigInteger amount,
            BigInteger remainingPackets);

        public delegate void EnvelopeBurnedHandler(
            BigInteger envelopeId,
            UInt160 lastHolder);

        public delegate void EnvelopeRefundedHandler(
            BigInteger envelopeId,
            UInt160 creator,
            BigInteger refundAmount);

        #endregion

        #region Events

        [DisplayName("EnvelopeCreated")]
        public static event EnvelopeCreatedHandler OnEnvelopeCreated;

        [DisplayName("EnvelopeOpened")]
        public static event EnvelopeOpenedHandler OnEnvelopeOpened;

        [DisplayName("EnvelopeBurned")]
        public static event EnvelopeBurnedHandler OnEnvelopeBurned;

        [DisplayName("EnvelopeRefunded")]
        public static event EnvelopeRefundedHandler OnEnvelopeRefunded;

        #endregion

        #region Lifecycle

        public static void _deploy(object data, bool update)
        {
            var ctx = Storage.CurrentContext;

            if (update)
            {
                // Migration safety: restore owner if storage was lost during upgrade
                // (e.g. storage prefix changed between versions)
                UInt160 existingOwner = (UInt160)Storage.Get(ctx, PREFIX_OWNER);
                if (existingOwner == null)
                {
                    Storage.Put(ctx, PREFIX_OWNER, Runtime.Transaction.Sender);
                }
                return;
            }

            // Fresh deploy — initialize all storage
            Storage.Put(ctx, PREFIX_OWNER, Runtime.Transaction.Sender);
            Storage.Put(ctx, PREFIX_ENVELOPE_ID, 0);
            Storage.Put(ctx, PREFIX_TOTAL_ENVELOPES, 0);
            Storage.Put(ctx, PREFIX_TOTAL_DISTRIBUTED, 0);
        }

        #endregion

        #region Envelope Creation

        /// <summary>
        /// Receives GAS and creates either:
        /// - spreading envelope NFT (type=0), or
        /// - lucky pool envelope (type=1)
        ///
        /// data format:
        /// object[] { packetCount, expiryMs, message, minNeoRequired, minHoldSeconds, envelopeType }
        /// envelopeType defaults to 0 (spreading).
        /// </summary>
        public static void OnNEP17Payment(UInt160 from, BigInteger amount, object data)
        {
            ExecutionEngine.Assert(Runtime.CallingScriptHash == GAS_HASH, "only GAS accepted");
            if (from == null || !from.IsValid) return;

            AssertNotPaused();
            AssertNotEnvelopeOwnerActor(from);
            ExecutionEngine.Assert(amount >= MIN_AMOUNT, "min 1 GAS");

            object[] config = data == null ? new object[0] : (object[])data;
            BigInteger packetCount = config.Length > 0 ? (BigInteger)config[0] : 1;
            BigInteger expiryMs = config.Length > 1 ? (BigInteger)config[1] : DEFAULT_EXPIRY_MS;
            string message = config.Length > 2 ? (string)config[2] : "";
            BigInteger minNeo = config.Length > 3 ? (BigInteger)config[3] : DEFAULT_MIN_NEO;
            BigInteger minHold = config.Length > 4 ? (BigInteger)config[4] : DEFAULT_MIN_HOLD_SECONDS;
            BigInteger envelopeType = config.Length > 5 ? (BigInteger)config[5] : ENVELOPE_TYPE_SPREADING;

            ExecutionEngine.Assert(packetCount > 0 && packetCount <= MAX_PACKETS, "1-100 packets");
            ExecutionEngine.Assert(amount >= packetCount * MIN_PER_PACKET, "min 0.1 GAS/packet");
            ExecutionEngine.Assert(
                envelopeType == ENVELOPE_TYPE_SPREADING || envelopeType == ENVELOPE_TYPE_POOL,
                "invalid envelope type");

            BigInteger envelopeId = AllocateEnvelopeId();
            BigInteger effectiveExpiry = expiryMs > 0 ? expiryMs : DEFAULT_EXPIRY_MS;
            BigInteger effectiveMinNeo = minNeo > 0 ? minNeo : DEFAULT_MIN_NEO;
            BigInteger effectiveMinHold = minHold > 0 ? minHold : DEFAULT_MIN_HOLD_SECONDS;

            EnvelopeData envelope = new EnvelopeData
            {
                Creator = from,
                TotalAmount = amount,
                PacketCount = packetCount,
                Message = message,
                EnvelopeType = envelopeType,
                ParentEnvelopeId = 0,
                OpenedCount = 0,
                RemainingAmount = amount,
                MinNeoRequired = effectiveMinNeo,
                MinHoldSeconds = effectiveMinHold,
                Active = true,
                ExpiryTime = (BigInteger)Runtime.Time + effectiveExpiry
            };
            StoreEnvelopeData(envelopeId, envelope);

            // Spreading type mints one NFT immediately; pool type does not.
            if (envelopeType == ENVELOPE_TYPE_SPREADING)
            {
                ByteString tokenId = (ByteString)envelopeId.ToByteArray();
                Mint(tokenId, new RedEnvelopeState
                {
                    Owner = from,
                    Name = "RedEnvelope #" + envelopeId.ToString(),
                    EnvelopeId = envelopeId,
                    Creator = from,
                    TotalAmount = amount,
                    PacketCount = packetCount,
                    Message = message,
                    EnvelopeType = envelopeType,
                    ParentEnvelopeId = 0
                });
            }

            var ctx = Storage.CurrentContext;
            BigInteger totalEnv = (BigInteger)Storage.Get(ctx, PREFIX_TOTAL_ENVELOPES);
            Storage.Put(ctx, PREFIX_TOTAL_ENVELOPES, totalEnv + 1);

            BigInteger totalDist = (BigInteger)Storage.Get(ctx, PREFIX_TOTAL_DISTRIBUTED);
            Storage.Put(ctx, PREFIX_TOTAL_DISTRIBUTED, totalDist + amount);

            OnEnvelopeCreated(envelopeId, from, amount, packetCount, envelopeType);
        }

        #endregion

        #region Internal Helpers

        private static BigInteger AllocateEnvelopeId()
        {
            var ctx = Storage.CurrentContext;
            BigInteger envelopeId = (BigInteger)Storage.Get(ctx, PREFIX_ENVELOPE_ID) + 1;
            Storage.Put(ctx, PREFIX_ENVELOPE_ID, envelopeId);
            return envelopeId;
        }

        private static void StoreEnvelopeData(BigInteger envelopeId, EnvelopeData envelope)
        {
            Storage.Put(
                Storage.CurrentContext,
                Helper.Concat((ByteString)PREFIX_ENVELOPE_DATA, (ByteString)envelopeId.ToByteArray()),
                StdLib.Serialize(envelope));
        }

        internal static EnvelopeData GetEnvelopeData(BigInteger envelopeId)
        {
            ByteString raw = Storage.Get(
                Storage.CurrentContext,
                Helper.Concat((ByteString)PREFIX_ENVELOPE_DATA, (ByteString)envelopeId.ToByteArray()));
            if (raw == null) return new EnvelopeData();
            return (EnvelopeData)StdLib.Deserialize(raw);
        }

        internal static bool EnvelopeExists(EnvelopeData envelope)
        {
            return envelope.Creator != null && envelope.Creator.IsValid;
        }

        internal static void StorePoolClaimId(BigInteger poolId, BigInteger claimIndex, BigInteger claimId)
        {
            ByteString key = Helper.Concat(
                Helper.Concat((ByteString)PREFIX_POOL_CLAIM_INDEX, (ByteString)poolId.ToByteArray()),
                (ByteString)claimIndex.ToByteArray());
            Storage.Put(Storage.CurrentContext, key, claimId);
        }

        internal static BigInteger GetPoolClaimId(BigInteger poolId, BigInteger claimIndex)
        {
            ByteString key = Helper.Concat(
                Helper.Concat((ByteString)PREFIX_POOL_CLAIM_INDEX, (ByteString)poolId.ToByteArray()),
                (ByteString)claimIndex.ToByteArray());
            ByteString val = Storage.Get(Storage.CurrentContext, key);
            if (val == null) return 0;
            return (BigInteger)val;
        }

        internal static bool IsContractAccount(UInt160 account)
        {
            if (account == null || !account.IsValid) return false;
            return ContractManagement.GetContract(account) != null;
        }

        internal static void AssertDirectUserInvocation()
        {
            ExecutionEngine.Assert(
                Runtime.CallingScriptHash == Runtime.EntryScriptHash,
                "contract caller not allowed");
        }

        internal static void AssertNotEnvelopeOwnerActor(UInt160 account)
        {
            UInt160 owner = GetOwner();
            if (owner == null || !owner.IsValid) return;
            ExecutionEngine.Assert(account != owner, "owner cannot touch envelopes");
        }

        internal static void AssertNotPaused()
        {
            ByteString paused = Storage.Get(Storage.CurrentContext, PREFIX_PAUSED);
            ExecutionEngine.Assert(paused == null || (BigInteger)paused == 0, "contract paused");
        }

        internal static RedEnvelopeState GetTokenState(ByteString tokenId)
        {
            object token = new StorageMap(Storage.CurrentContext, Prefix_Token).GetObject(tokenId);
            if (token == null) return null;
            return (RedEnvelopeState)token;
        }

        [Safe]
        public override Map<string, object> Properties(ByteString tokenId)
        {
            ExecutionEngine.Assert(Runtime.EntryScriptHash == Runtime.CallingScriptHash);

            RedEnvelopeState token = GetTokenState(tokenId);
            ExecutionEngine.Assert(token != null, "token not found");

            Map<string, object> map = new Map<string, object>();
            map["name"] = token.Name;
            map["description"] = BuildTokenDescription(token);
            map["image"] = BuildTokenSvgDataUri(token);
            map["tokenId"] = token.EnvelopeId;
            map["creator"] = token.Creator;
            map["envelopeType"] = token.EnvelopeType;
            map["totalAmount"] = token.TotalAmount;
            map["packetCount"] = token.PacketCount;
            map["parentEnvelopeId"] = token.ParentEnvelopeId;
            return map;
        }

        [Safe]
        public static string TokenURI(BigInteger tokenId)
        {
            RedEnvelopeState token = GetTokenState((ByteString)tokenId.ToByteArray());
            if (token == null) return "";

            string svg = BuildTokenSvg(token);
            string imageData = "data:image/svg+xml;base64," + StdLib.Base64Encode((ByteString)svg);
            string name = EscapeJsonString(token.Name);
            string description = EscapeJsonString(BuildTokenDescription(token));

            string json = "{" +
                "\"name\":\"" + name + "\"," +
                "\"description\":\"" + description + "\"," +
                "\"image\":\"" + imageData + "\"" +
                "}";

            return "data:application/json;base64," + StdLib.Base64Encode((ByteString)json);
        }

        [Safe]
        private static string BuildTokenSvgDataUri(RedEnvelopeState token)
        {
            string svg = BuildTokenSvg(token);
            return "data:image/svg+xml;base64," + StdLib.Base64Encode((ByteString)svg);
        }

        [Safe]
        private static string BuildTokenDescription(RedEnvelopeState token)
        {
            string envelopeType = token.EnvelopeType == ENVELOPE_TYPE_CLAIM
                ? "Claim"
                : token.EnvelopeType == ENVELOPE_TYPE_POOL
                    ? "Pool"
                    : "Spreading";

            return "Red Envelope NFT #" + token.EnvelopeId.ToString() + " (" + envelopeType + ")";
        }

        [Safe]
        private static string BuildTokenSvg(RedEnvelopeState token)
        {
            string envelopeType = token.EnvelopeType == ENVELOPE_TYPE_CLAIM
                ? "Claim"
                : token.EnvelopeType == ENVELOPE_TYPE_POOL
                    ? "Pool"
                    : "Spreading";

            string totalGas = Fixed8ToGasString(token.TotalAmount);
            string creator = EscapeXmlText(token.Creator.ToString());
            string message = token.Message == null ? "" : token.Message;
            if (message.Length > 40)
            {
                message = message.Substring(0, 40) + "...";
            }
            message = EscapeXmlText(message);

            return "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 420 260\" preserveAspectRatio=\"xMidYMid meet\">" +
                "<defs><linearGradient id=\"bg\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0%\" stop-color=\"#7a0000\"/><stop offset=\"100%\" stop-color=\"#2b0000\"/></linearGradient></defs>" +
                "<rect width=\"420\" height=\"260\" rx=\"18\" fill=\"url(#bg)\"/>" +
                "<rect x=\"10\" y=\"10\" width=\"400\" height=\"240\" rx=\"14\" fill=\"none\" stroke=\"#ffd35a\" stroke-width=\"2\"/>" +
                "<text x=\"24\" y=\"40\" fill=\"#ffd35a\" font-size=\"20\" font-family=\"sans-serif\" font-weight=\"700\">Neo Red Envelope NFT</text>" +
                "<text x=\"24\" y=\"70\" fill=\"#ffffff\" font-size=\"14\" font-family=\"sans-serif\">ID: #" + token.EnvelopeId.ToString() + "</text>" +
                "<text x=\"24\" y=\"94\" fill=\"#ffffff\" font-size=\"14\" font-family=\"sans-serif\">Type: " + envelopeType + "</text>" +
                "<text x=\"24\" y=\"118\" fill=\"#ffffff\" font-size=\"14\" font-family=\"sans-serif\">Total: " + totalGas + " GAS</text>" +
                "<text x=\"24\" y=\"142\" fill=\"#ffffff\" font-size=\"14\" font-family=\"sans-serif\">Packets: " + token.PacketCount.ToString() + "</text>" +
                "<text x=\"24\" y=\"166\" fill=\"#ffd9a0\" font-size=\"12\" font-family=\"monospace\">Creator: " + creator + "</text>" +
                "<text x=\"24\" y=\"194\" fill=\"#ffe8c2\" font-size=\"12\" font-family=\"sans-serif\">Msg: " + message + "</text>" +
                "<text x=\"24\" y=\"228\" fill=\"#ffd35a\" font-size=\"12\" font-family=\"sans-serif\">on-chain SVG metadata</text>" +
                "</svg>";
        }

        [Safe]
        private static string EscapeXmlText(string value)
        {
            if (value == null) return "";

            string escaped = value.Replace("&", "&amp;");
            escaped = escaped.Replace("<", "&lt;");
            escaped = escaped.Replace(">", "&gt;");
            escaped = escaped.Replace("\"", "&quot;");
            escaped = escaped.Replace("'", "&apos;");
            return escaped;
        }

        [Safe]
        private static string EscapeJsonString(string value)
        {
            if (value == null) return "";

            string escaped = value.Replace("\\", "\\\\");
            escaped = escaped.Replace("\"", "\\\"");
            escaped = escaped.Replace("\n", "\\n");
            escaped = escaped.Replace("\r", "\\r");
            escaped = escaped.Replace("\t", "\\t");
            return escaped;
        }

        [Safe]
        private static string Fixed8ToGasString(BigInteger value)
        {
            BigInteger integer = value / 100_000_000;
            BigInteger fraction = value % 100_000_000;
            if (fraction == 0) return integer.ToString();

            string f = fraction.ToString();
            while (f.Length < 8) f = "0" + f;
            while (f.Length > 0 && f[f.Length - 1] == '0')
            {
                f = f.Substring(0, f.Length - 1);
            }

            return integer.ToString() + "." + f;
        }

        #endregion
    }
}
