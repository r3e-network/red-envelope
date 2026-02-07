/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONTRACT_HASH?: string;
  readonly VITE_NETWORK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

/** neo-dapi global injected by wallet extension */
interface NeoDapi {
  request(params: { method: string; params?: Record<string, unknown> }): Promise<unknown>;
}

interface Window {
  neo?: NeoDapi;
  OneGate?: NeoDapi;
}
