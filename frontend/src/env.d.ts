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

/** neo-dapi global injected by wallet extension (OneGate / generic) */
interface NeoDapi {
  request(params: { method: string; params?: Record<string, unknown> }): Promise<unknown>;
}

/** NeoLine N3 dAPI — uses direct method calls instead of request() */
interface NeoLineN3Instance {
  getAccount(): Promise<{ address: string; label: string }>;
  invoke(params: Record<string, unknown>): Promise<unknown>;
  invokeRead(params: Record<string, unknown>): Promise<unknown>;
  getBalance(params: Record<string, unknown>): Promise<unknown>;
}

interface NeoLineN3Constructor {
  Init: new () => NeoLineN3Instance;
}

interface Window {
  neo?: NeoDapi;
  OneGate?: NeoDapi;
  NEOLineN3?: NeoLineN3Constructor;
  NEOLine?: { N3?: NeoLineN3Constructor };
}
