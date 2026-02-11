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
    contractHash: "0x36a46aa95413029e340e57365cdadd3ae29244ff",
  },
  mainnet: {
    key: "mainnet",
    label: "Neo N3 MainNet",
    defaultRpc: "https://mainnet1.neo.coz.io:443",
    explorerBase: "https://neotube.io",
    contractHash: "0x5f371cc50116bb13d79554d96ccdd6e246cd5d59",
  },
};

export const DEFAULT_NETWORK = "testnet";

export function resolveNetwork(value?: string): NetworkConfig {
  const key = (value ?? import.meta.env.VITE_NETWORK ?? DEFAULT_NETWORK).trim().toLowerCase();
  if (!(key in NETWORKS)) {
    console.warn(`[networks] Unknown network "${key}", falling back to "${DEFAULT_NETWORK}"`);
    return NETWORKS[DEFAULT_NETWORK];
  }
  return NETWORKS[key];
}
