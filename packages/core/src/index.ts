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
  createDewVaultStrategistTransferPolicy,
  createDewVaultStrategistTransferProcessRedeemPolicy,
} from "./near-vault.js";

export type {
  DewVaultMethod,
  DewVaultPolicyIdMap,
  DewVaultProposalResult,
  DewVaultSharePriceRate,
  DewVaultOperationSharePrice,
  DewVaultSharePriceList,
  DewVaultAssetAmountList,
  DewVaultCrystallizationInfo,
  DewVaultCurrentFlow,
  DewVaultFlowWindowInfo,
  DewVaultAccountantData,
} from "./near-vault.js";

// Policy defaults
export { DEFAULT_POLICY_ACTIVATION_TIME, DEFAULT_POLICY_EXPIRY_NS } from "./policy.js";

// Shared utilities
export * from "./utils/index.js";
