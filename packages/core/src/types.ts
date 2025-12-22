/**
 * Dew Finance SDK - Core Types
 * @packageDocumentation
 */
import type { Account, providers, transactions } from "near-api-js";
import type { PublicClient } from "viem";

// =============================================================================
// NEAR call defaults and options
// =============================================================================

/** Options to override NEAR call gas/deposit for kernel method calls */
export interface NearRpcOptions {
  /** Override NEAR JSON-RPC provider */
  nearProvider?: providers.JsonRpcProvider;
  /** Override NEAR RPC URL (used if no provider is supplied) */
  nearRpcUrl?: string;
}

/** Options to override NEAR call gas/deposit or RPC settings */
export interface NearCallOptions extends NearRpcOptions {
  /** Gas in TeraGas (1 TGas = 1e12 gas units) */
  gasTgas?: number;
  /** Attached deposit in yoctoNEAR (as string) */
  depositYocto?: string;
  /** Override signer account for this call */
  nearWallet?: NearWallet;
}

/** Options to override NEAR RPC settings for view calls */
export type NearViewOptions = NearRpcOptions;

/** Options to override EVM broadcast client */
export interface EvmBroadcastOptions {
  /** Override viem public client */
  evmClient?: PublicClient;
}

// =============================================================================
// Kernel Contract Types
// =============================================================================

/** Asset type (on-chain JSON shape) */
export type Asset =
  | {
      FungibleToken: {
        contract_id: string;
      };
    }
  | {
      MultiToken: {
        contract_id: string;
        token_id: string;
      };
    };

/** Change control activation windows */
export interface ChangeControl {
  /** Delay from proposal to automatic activation (nanoseconds) */
  activationDelayNanosec: string;
  /** Minimum interval before another update is allowed (nanoseconds) */
  minIntervalBetweenUpdatesNanosec: string;
}

/** Vault configuration (on-chain JSON shape) */
export interface VaultConfig {
  /** Hard limit on TVL cap (optional, U128) */
  tvl_cap?: U128String | null;
  /** Max deposit amount processed synchronously (U128) */
  max_sync_deposit: U128String;
  /** Max percentage redeemable synchronously (basis points, 10000 = 100%) */
  max_sync_redeem_ratio: number;
  /** Decimals for share price precision */
  share_price_decimals: number;
  /** Extra decimals for internal precision */
  extra_decimals: number;
  /** Minimum per-deposit amount (U128) */
  min_deposit: U128String;
  /** Minimum per-withdrawal amount (U128) */
  min_withdraw: U128String;
  /** Minimum delay from redeem request (nanoseconds, U128) */
  redeem_delay_nanosec: U128String;
  /** Whether vault is private (requires whitelist) */
  is_private: boolean;
  /** Whether blacklist is enabled */
  blacklist_enabled: boolean;
  /** Deposit flow cap (optional) */
  deposit_flow_cap?: FlowCap | null;
  /** Withdrawal flow cap (optional) */
  withdrawal_flow_cap?: FlowCap | null;
  /** Whether redeem confirmation is required */
  redeem_confirmation: boolean;
  /** Whether emergency pause is enabled */
  emergency_pause_enabled: boolean;
  /** Whether ownership transfer is enabled */
  ownership_transfer_enabled: boolean;
  /** Max share price staleness in nanoseconds (U128) */
  max_share_price_staleness_ns: U128String;
  // -------------------- Fee Configuration --------------------
  /** Continuous management fee (bps annualized) */
  management_fee_bps: BasisPoints;
  /** Performance/incentive fee on profits above HWM (bps) */
  performance_fee_bps: BasisPoints;
  /** Interval between crystallizations (nanoseconds, U128) */
  crystallization_interval_nanosec: U128String;
  /** Optional baseline APY hurdle (bps) */
  performance_hurdle_bps?: BasisPoints | null;
  // -------------------- Price Validation --------------------
  /** Minimum price deviation (nano percent) */
  new_price_min_deviation_nanopercent: NanoPercent;
  /** Maximum price deviation (nano percent) */
  new_price_max_deviation_nanopercent: NanoPercent;
  /** Minimum time between price updates (nanoseconds, U128) */
  new_price_min_interval_nanosec: U128String;
  /** Maximum time between price updates (nanoseconds, U128) */
  new_price_max_interval_nanosec: U128String;
}

/** Basis points numeric type (u16 on-chain, 0-65535) */
export type BasisPoints = number;

/** Nano percent (1e-9 precision), maps to u64 on-chain */
export type NanoPercent = number;

/** U128 encoded as a base-10 string */
export type U128String = string;

/** Flow cap configuration */
export interface FlowCap {
  /** Maximum amount allowed in the period (base units, U128) */
  amount: U128String;
  /** Time period in nanoseconds (u64) */
  period_nanosec: number;
}

/** Protocol fee configuration (on-chain JSON shape) */
export interface ProtocolConfig {
  protocol_management_fee_cut_bps: BasisPoints;
  protocol_performance_fee_cut_bps: BasisPoints;
  protocol_fee_recipient: string;
}

/** Vault balance tracking for each asset */
export interface VaultBalance {
  pending_deposit: U128String;
  available_amount: U128String;
}

/** Pending deposit request */
export interface Deposit {
  asset: Asset;
  deposit_amount: U128String;
  min_shares: U128String;
  owner_id: string;
  receiver_id: string;
  memo: string | null;
  created_at: U128String;
}

/** Pending withdrawal request */
export interface Withdraw {
  asset: Asset;
  shares: U128String;
  min_asset_amount: U128String;
  owner_id: string;
  receiver_id: string;
  memo: string | null;
  activation_timestamp_nanosec: U128String;
  confirmed: boolean;
  confirmed_share_price: U128String | null;
  confirmed_at_timestamp: U128String | null;
}

export type TellerOperation = { Deposit: Deposit } | { Withdraw: Withdraw };

export interface TellerOperationWithId {
  operation: TellerOperation;
  operation_id: number;
}

export type DepositWithId = [number, Deposit];
export type WithdrawWithId = [number, Withdraw];

export interface StorageBalance {
  total: U128String;
  available: U128String;
}

export interface StorageBalanceBounds {
  min: U128String;
  max: U128String;
}

/** Policy type */
export type PolicyType =
  | "KernelConfiguration"
  | "ChainSigTransaction"
  | "NearNativeTransaction"
  | "ChainSigMessage";

/** Policy definition */
export interface Policy {
  /** Policy ID */
  id: string;
  /** Policy description */
  description?: string;
  /** Role required to propose under this policy */
  requiredRole: string;
  /** Number of votes required to approve */
  requiredVoteCount: number;
  /** Policy type */
  policyType: PolicyType;
  /** Policy-specific details */
  policyDetails: PolicyDetails;
  /** Nano timestamp when this policy becomes active (for activation delays) */
  activationTime: string;
  /** Proposal expiry duration in nanoseconds */
  proposalExpiryTimeNanosec: string;
  /** Follow-up actions that must be completed after this policy executes */
  requiredPendingActions: string[];
}

/** Emergency configuration */
export interface EmergencyConfig {
  /** Inactive duration before emergency can activate (nanoseconds) */
  emergencyInactiveDurationNs: string;
  /** Accounts with emergency permissions */
  emergencyAccounts: string[];
  /** Votes required to trigger emergency */
  emergencyVoteThreshold: number;
  /** Valid duration for emergency votes (nanoseconds) */
  emergencyVoteDurationNs: string;
}

/** Policy-specific configuration details */
export type PolicyDetails =
  | {
      type: "ChainSigTransaction";
      config: ChainSigTransactionConfig;
    }
  | {
      type: "NearNativeTransaction";
      config: NearNativeTransactionConfig;
    }
  | {
      type: "ChainSigMessage";
      config: ChainSigMessageConfig;
    }
  | {
      type: "KernelConfiguration";
    };

/** Chain environment specification */
export type ChainEnvironment = "SVM" | "EVM" | "NearWasm";

/** Policy restriction schema reference */
export type PolicyRestriction = {
  /** Schema identifier or URI */
  schema: string;
  /** Interface name implementing the schema */
  interface: string;
};

/** NEAR native transaction configuration */
export interface NearNativeTransactionConfig {
  /** Chain environment where transactions can execute */
  chainEnvironment: ChainEnvironment;
  /** Restrictions on transactions */
  restrictions: PolicyRestriction[];
}

/** Chain signature transaction configuration */
export interface ChainSigTransactionConfig {
  /** BIP32 derivation path */
  derivationPath: string;
  /** Chain environment where transactions can execute */
  chainEnvironment: ChainEnvironment;
  /** Restrictions on transactions */
  restrictions: PolicyRestriction[];
}

/** Chain signature message configuration */
export interface ChainSigMessageConfig {
  /** BIP32 derivation path */
  derivationPath: string;
  /** Signing method */
  signMethod: ChainSigSignMethod;
}

/** Chain signature signing method */
export type ChainSigSignMethod = "NearIntentsSwap";

/** Role target identifier */
export type RoleTarget =
  | { type: "AccountId"; accountId: string }
  | { type: "Codehash"; codehash: string };

/** Proposal */
export interface Proposal {
  /** Proposal ID (u64 on-chain) */
  id: number;
  /** Policy this proposal is under */
  policyId: string;
  /** Function args payload (JSON string) */
  functionArgs: string;
  /** Proposer account */
  proposer: string;
  /** Creation time (nanoseconds, U128) */
  creationTime: string;
  /** Proposal deadline (nanoseconds, U128) */
  deadline: string;
  /** Required votes to execute */
  executionThreshold: number;
}

/** List of supported core policy IDs */
export const POLICY_IDS: string[] = [
  "grant_role",
  "revoke_role",
  "upsert_policy",
  "update_policy_change_control",
  "cancel_pending_policy",
  "force_activate_policy",
  "acquire_lock",
  "release_lock",
  "force_release_lock",
  "force_complete_pending_action",
  "batch_update_policies",
  "store_data",
  "batch_store_data",
];

// =============================================================================
// End of Kernel Contract Types
// =============================================================================

// =============================================================================
// MPC Signature Types
// =============================================================================

/** MPC signature from chain signature contract */
export interface MPCSignature {
  big_r: string;
  s: string;
  recovery_id: number;
}

// =============================================================================
// Proposal Result Types
// =============================================================================

/** Result from proposing an EVM transaction */
export type EvmProposalResult =
  | { executed: false; proposalId: number; outcome: NearTransactionResult }
  | {
      executed: true;
      proposalId: number;
      signatures: MPCSignature[];
      outcome: NearTransactionResult;
    };

/** Result from proposing NEAR actions */
export type NearProposalResult =
  | { executed: false; proposalId: number; outcome: NearTransactionResult }
  | { executed: true; proposalId: number; outcome: NearTransactionResult };

/** Result from proposing a kernel core function */
export type KernelCoreProposalResult =
  | { executed: false; proposalId: number; proposal: Proposal }
  | { executed: true; proposalId: number };

/** Result from voting on a proposal */
export type VoteProposalResult =
  | { executed: false; proposalId: number; proposal: Proposal }
  | { executed: true; proposalId: number; signatures?: MPCSignature[] };

// =============================================================================
// Token Types
// =============================================================================

/** Token representation */
export interface Token {
  /** Token symbol (e.g., 'NEAR', 'USDC') */
  symbol: string;
  /** Token name */
  name?: string;
  /** Decimal places */
  decimals: number;
  /** Contract address (account ID for NEAR) */
  address: string;
}

/** Token amount with associated token info */
export interface TokenAmount {
  /** The token */
  token: Token;
  /** Amount in base units (as string to preserve precision) */
  amount: string;
}

/** NEP-141 fungible token metadata */
export interface FungibleTokenMetadata {
  /** Metadata spec version (e.g. "ft-1.0.0") */
  spec: string;
  /** Token name */
  name: string;
  /** Token symbol */
  symbol: string;
  /** Icon URL (optional) */
  icon?: string | null;
  /** Reference URL (optional) */
  reference?: string | null;
  /** Reference hash (optional) */
  reference_hash?: string | null;
  /** Decimal places */
  decimals: number;
}

// =============================================================================
// Wallet Types
// =============================================================================

/** Wallet interface for signing transactions */
export interface Wallet {
  /** Get the wallet address */
  getAddress(): Promise<string>;
  /** Sign and send a transaction */
  signAndSend(transaction: Transaction): Promise<TransactionResult>;
  /** Sign a message */
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

/** NEAR account (direct near-api-js dependency) */
export type NearWallet = Account;

/** EVM-specific wallet interface */
export interface EvmWallet extends Wallet {
  /** Sign typed data (EIP-712) */
  signTypedData(data: Record<string, unknown>): Promise<string>;
}

// =============================================================================
// Transaction Types
// =============================================================================

/** Generic transaction */
export interface Transaction {
  /** Transaction type */
  type: "near" | "evm";
  /** Transaction data */
  data: NearTransactionData | EvmTransactionData;
}

/** NEAR transaction data (using near-api-js actions) */
export interface NearTransactionData {
  /** Receiver account ID */
  receiverId: string;
  /** Actions to execute */
  actions: transactions.Action[];
}

/** NEAR action alias (near-api-js) */
export type NearAction = transactions.Action;

/** EVM transaction data */
export interface EvmTransactionData {
  /** Target contract address */
  to: string;
  /** Value in wei */
  value?: string;
  /** Calldata */
  data?: string;
  /** Gas limit */
  gasLimit?: string;
  /** Gas price (legacy) */
  gasPrice?: string;
  /** Max fee per gas (EIP-1559) */
  maxFeePerGas?: string;
  /** Max priority fee per gas (EIP-1559) */
  maxPriorityFeePerGas?: string;
  /** Nonce */
  nonce?: number;
}

/** Transaction result */
export interface TransactionResult {
  /** Transaction hash */
  hash: string;
  /** Whether the transaction succeeded */
  success: boolean;
  /** Block number/height */
  blockNumber?: number;
  /** Gas used */
  gasUsed?: string;
  /** Transaction events/logs */
  events: TransactionEvent[];
  /** Raw result data */
  raw?: Record<string, unknown> | string | number | boolean | null;
}

/** NEAR-specific transaction result (near-api-js outcome) */
export type NearTransactionResult = providers.FinalExecutionOutcome;

/** Transaction event/log */
export interface TransactionEvent {
  /** Event name */
  name: string;
  /** Contract/account that emitted the event */
  address: string;
  /** Event data */
  data: Record<string, unknown>;
  /** Log index */
  logIndex?: number;
}

/** Asset balance in a position */
export interface AssetBalance {
  /** The token */
  token: Token;
  /** Balance amount */
  balance: string;
  /** USD value */
  valueUsd?: string;
  /** APY (positive for supply, negative for borrow) */
  apy?: number;
}

// =============================================================================
// Client Configuration Types
// =============================================================================

/** Dew client configuration */
export interface DewClientConfig {
  /** Kernel account ID */
  kernelId: string;
  /** NEAR wallet for signing */
  nearWallet?: NearWallet;
  /** NEAR JSON-RPC provider for view calls and broadcasts */
  nearProvider?: providers.JsonRpcProvider;
  /** NEAR RPC URL (used if no provider is supplied) */
  nearRpcUrl?: string;
}

/** Role definition */
export interface Role {
  /** Role ID */
  id: string;
  /** Role description */
  description?: string;
}
