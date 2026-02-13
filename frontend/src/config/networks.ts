export type NetworkConfig = {
  key: string;
  label: string;
  defaultRpc: string;
  explorerBase: string;
  contractHash: string;
};

export const NETWORKS: Record<string, NetworkConfig> = {
  testnet: {
    key: "testnet",
    label: "Neo N3 TestNet",
    defaultRpc: "https://testnet1.neo.coz.io:443",
    explorerBase: "https://testnet.neotube.io",
    contractHash: "0x116b5217bf0916e5c7069770cf40ceee7917d349",
  },
  mainnet: {
    key: "mainnet",
    label: "Neo N3 MainNet",
    defaultRpc: "https://mainnet1.neo.coz.io:443",
    explorerBase: "https://neotube.io",
    contractHash: "0x215099698349ba405400b3b2fe97bb96941c0f9b",
  },
};

export const DEFAULT_NETWORK = "mainnet";

export function resolveNetwork(value?: string): NetworkConfig {
  const key = (value ?? import.meta.env.VITE_NETWORK ?? DEFAULT_NETWORK).trim().toLowerCase();
  if (!(key in NETWORKS)) {
    console.warn(`[networks] Unknown network "${key}", falling back to "${DEFAULT_NETWORK}"`);
    return NETWORKS[DEFAULT_NETWORK];
  }
  return NETWORKS[key];
}
