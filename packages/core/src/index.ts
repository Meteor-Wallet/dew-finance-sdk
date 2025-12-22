/**
 * Dew Finance SDK - Core Package
 * @packageDocumentation
 */

// Client
export { DewClient, createDewClient } from "./client.js";

// Types
export * from "./types.js";

// NEAR utilities
export {
  sendNearTransaction,
  createNearAccount,
  getNearProvider,
  parseNearAmount,
  formatNearAmount,
} from "./near.js";

// Dew Vault (NEAR) client + helpers
export {
  DewNearVaultClient,
  DEW_VAULT_METHODS,
  createDewVaultPolicyIdMap,
  createDewVaultPolicyList,
} from "./near-vault.js";

export type {
  DewVaultMethod,
  DewVaultPolicyIdMap,
  DewVaultCallOptions,
  DewVaultSharePriceRate,
  DewVaultOperationSharePrice,
  DewVaultSharePriceList,
  DewVaultAssetAmountList,
  DewVaultCrystallizationInfo,
  DewVaultCurrentFlow,
  DewVaultFlowWindowInfo,
  DewVaultAccountantData,
  DewNearVaultClientConfig,
  DewVaultPolicyListParams,
} from "./near-vault.js";

// Shared utilities
export * from "./utils/index.js";
