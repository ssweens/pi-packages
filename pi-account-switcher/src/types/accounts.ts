import { ProviderId } from "./providers";

export type SecretSource =
  | string
  | { type: "literal"; value: string }
  | { type: "env"; name: string }
  | { type: "file"; path: string }
  | { type: "command"; command: string }
  | { type: "op"; reference: string };

export type PiAuthEntry =
  | { type: "api_key"; key: string }
  | ({
      type: "oauth";
      refresh: string;
      access: string;
      expires: number;
    } & Record<string, unknown>);

export interface AccountConfig {
  id: string;
  label: string;
  provider: ProviderId;
  /** API-key/env based account. */
  env?: Record<string, SecretSource>;
  /** Per-account override for a custom Pi model provider apiKey. */
  providerApiKey?: SecretSource;
  /** Uses apiKey from custom provider metadata. */
  usesProviderApiKey?: boolean;
  /** Optional model to switch to when this account is activated. */
  model?: string;
  /** Captured Pi /login credentials for built-in OAuth/subscription providers. */
  piAuth?: {
    provider: ProviderId;
    entry: PiAuthEntry;
  };
}
