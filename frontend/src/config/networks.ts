export type NetworkConfig = {
  key: string;
  label: string;
  defaultRpc: string;
  explorerBase: string;
};

export const NETWORKS: Record<string, NetworkConfig> = {
  testnet: {
    key: "testnet",
    label: "Neo N3 TestNet",
    defaultRpc: "https://testnet1.neo.coz.io:443",
    explorerBase: "https://testnet.neotube.io",
  },
  mainnet: {
    key: "mainnet",
    label: "Neo N3 MainNet",
    defaultRpc: "https://mainnet1.neo.coz.io:443",
    explorerBase: "https://neotube.io",
  },
};

export const DEFAULT_NETWORK = "testnet";

export function resolveNetwork(value?: string): NetworkConfig {
  const key = (value ?? import.meta.env.VITE_NETWORK ?? DEFAULT_NETWORK).trim().toLowerCase();
  if (!(key in NETWORKS)) {
    return NETWORKS[DEFAULT_NETWORK];
  }
  return NETWORKS[key];
}
