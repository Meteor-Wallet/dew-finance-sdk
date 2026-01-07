/**
 * Dew Finance SDK - Core Types
 * @packageDocumentation
 */
import type { Account } from "@near-js/accounts";
import type { JsonRpcProvider } from "@near-js/providers";
import type { FinalExecutionOutcome } from "@near-js/types";
import type { Action, Transaction } from "@near-js/transactions";

// =============================================================================
// NEAR call defaults and options
// =============================================================================

/** Options to override NEAR call gas/deposit for kernel method calls */
export interface NearRpcOptions {
  /** Override NEAR JSON-RPC provider */
  nearProvider?: JsonRpcProvider;
  /** Override NEAR RPC URL (used if no provider is supplied) */
  nearRpcUrl?: string;
}

/** Minimal agent interface for proposing kernel executions without near-js Account */
export interface KernelAgent {
  call: (args: {
    methodName: string;
    args: Record<string, unknown>;
    contractId?: string;
    gas?: string;
    deposit?: string;
  }) => Promise<unknown>;
  accountId: () => Promise<string>;
}

/** Options to override NEAR call gas/deposit or RPC settings */
export interface NearCallOptions extends NearRpcOptions {
  /** Gas in TeraGas (1 TGas = 1e12 gas units) */
  gasTgas?: number;
  /** Attached deposit in yoctoNEAR (as string) */
  depositYocto?: string;
  /** Override signer account for this call */
  nearWallet?: NearWallet;
  /** Optional agent caller for kernel proposals */
  agent?: KernelAgent;
}

/** Options to override NEAR RPC settings for view calls */
export type NearViewOptions = NearRpcOptions;

/** Encoding format for ChainSig transaction payloads */
export type ChainSigEncoding = "hex" | "base64";

/** Options for proposing ChainSig transactions */
export interface ChainSigProposeOptions extends NearCallOptions {
  /** Encoding of the serialized transaction payload */
  encoding?: ChainSigEncoding;
}

export interface ChainSigExecutionOptions<UnsignedTx = unknown, SignedTx = string> {
  /** Adapter used to finalize and broadcast a ChainSig transaction */
  adapter: ChainSigTransactionAdapter<UnsignedTx, SignedTx>;
  /** Unsigned transaction object to attach signatures to */
  unsignedTx: UnsignedTx;
  /** Broadcast the signed transaction (defaults to true) */
  broadcast?: boolean;
}

export type ChainSigExecuteOptions<
  UnsignedTx = unknown,
  SignedTx = string,
> = ChainSigProposeOptions & {
  chainSig?: ChainSigExecutionOptions<UnsignedTx, SignedTx>;
};

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
export type ChainSigExecutionPayload = string | Uint8Array;

export type NearNativeExecutionPayload = string | Uint8Array;

export type NearTransactionFinality = "final" | "optimistic" | "near-final";

export type NearTransactionSigner =
  | {
      type: "Account";
      nearWallet?: NearWallet;
    }
  | {
      type: "ChainSig";
      derivationPath: string;
      nearNetwork?: "Mainnet" | "Testnet";
    }
  | {
      type: "Explicit";
      signerId: string;
      publicKey: string;
      nonce: bigint | number | string;
    };

export type NearTransactionBuildParams = {
  receiverId: string;
  actions: Action[];
  signer: NearTransactionSigner;
  finality?: NearTransactionFinality;
  options?: NearViewOptions;
};

export type NearTransactionBuildResult = {
  encodedTx: string;
  transaction: Transaction;
  signerId: string;
  publicKey: string;
  nonce: bigint;
};

export type KernelExecutionPayload = Record<string, unknown> | string;

export type PolicyExecutionPayload =
  | ChainSigExecutionPayload
  | NearNativeExecutionPayload
  | KernelExecutionPayload
  | NearTransactionBuildParams;

export type PolicyDetailsByType = {
  KernelConfiguration: KernelConfigPolicyDetails;
  ChainSigTransaction: ChainSigPolicyDetails;
  NearNativeTransaction: NearNativePolicyDetails;
  ChainSigMessage: ChainSigMessagePolicyDetails;
};

type PolicySpecBase<TType extends PolicyType = PolicyType> = Omit<
  Policy,
  "policy_type" | "policy_details"
> & {
  policy_type: TType;
  policy_details: PolicyDetailsByType[TType];
};

export type PolicyBuilder<TArgs extends unknown[], TPayload> = {
  bivarianceHack(...args: TArgs): TPayload;
}["bivarianceHack"];

export type PolicySpec<
  TType extends PolicyType = PolicyType,
  TPayload extends PolicyExecutionPayload = PolicyExecutionPayload,
  TArgs extends unknown[] = unknown[],
> = PolicySpecBase<TType> & {
  builder?: PolicyBuilder<TArgs, TPayload>;
};

export type PolicySpecWithBuilder<
  TType extends PolicyType,
  TPayload extends PolicyExecutionPayload,
  TArgs extends unknown[],
> = PolicySpecBase<TType> & {
  builder: PolicyBuilder<TArgs, TPayload>;
};

export type ChainSigPolicySpec<TArgs extends unknown[] = unknown[]> = PolicySpec<
  "ChainSigTransaction",
  ChainSigExecutionPayload | NearTransactionBuildParams,
  TArgs
>;

export type ChainSigPolicySpecWithBuilder<TArgs extends unknown[] = unknown[]> =
  PolicySpecWithBuilder<
    "ChainSigTransaction",
    ChainSigExecutionPayload | NearTransactionBuildParams,
    TArgs
  >;

export type NearNativePolicySpec<TArgs extends unknown[] = unknown[]> = PolicySpec<
  "NearNativeTransaction",
  NearNativeExecutionPayload | NearTransactionBuildParams,
  TArgs
>;

export type NearNativePolicySpecWithBuilder<TArgs extends unknown[] = unknown[]> =
  PolicySpecWithBuilder<
    "NearNativeTransaction",
    NearNativeExecutionPayload | NearTransactionBuildParams,
    TArgs
  >;

export type KernelConfigPolicySpec<TArgs extends unknown[] = unknown[]> = PolicySpec<
  "KernelConfiguration",
  KernelExecutionPayload,
  TArgs
>;

export type KernelConfigPolicySpecWithBuilder<TArgs extends unknown[] = unknown[]> =
  PolicySpecWithBuilder<"KernelConfiguration", KernelExecutionPayload, TArgs>;

export type ChainSigMessagePolicySpec<TArgs extends unknown[] = unknown[]> = PolicySpec<
  "ChainSigMessage",
  never,
  TArgs
>;

export type PolicySpecMap = Record<
  string,
  PolicySpec<PolicyType, PolicyExecutionPayload, unknown[]>
>;

export const definePolicies = <T extends PolicySpecMap>(policies: T): T => policies;

type PolicyTypeAndDetails = {
  [K in PolicyType]: { policy_type: K; policy_details: PolicyDetailsByType[K] };
}[PolicyType];

/** Policy definition */
export type Policy = {
  /** Policy ID */
  id: string;
  /** Policy description */
  description?: string;
  /** Role required to propose under this policy */
  required_role: string;
  /** Number of votes required to approve */
  required_vote_count: number;
  /** Nano timestamp when this policy becomes active (for activation delays) */
  activation_time: string;
  /** Proposal expiry duration in nanoseconds */
  proposal_expiry_time_nanosec: string;
  /** Follow-up actions that must be completed after this policy executes */
  required_pending_actions: string[];
} & PolicyTypeAndDetails;

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

type ChainSigPolicyDetails = {
  ChainSigTransaction: ChainSigTransactionConfig;
};

type NearNativePolicyDetails = {
  NearNativeTransaction: NearNativeTransactionConfig;
};

type ChainSigMessagePolicyDetails = {
  ChainSigMessage: ChainSigMessageConfig;
};

type KernelConfigPolicyDetails = "KernelConfiguration";

/** Policy-specific configuration details */
export type PolicyDetails =
  | ChainSigPolicyDetails
  | NearNativePolicyDetails
  | ChainSigMessagePolicyDetails
  | KernelConfigPolicyDetails;

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
  chain_environment: ChainEnvironment;
  /** Restrictions on transactions */
  restrictions: PolicyRestriction[];
}

/** Chain signature transaction configuration */
export interface ChainSigTransactionConfig {
  /** BIP32 derivation path */
  derivation_path: string;
  /** Chain environment where transactions can execute */
  chain_environment: ChainEnvironment;
  /** Restrictions on transactions */
  restrictions: PolicyRestriction[];
}

/** Chain signature message configuration */
export interface ChainSigMessageConfig {
  /** BIP32 derivation path */
  derivation_path: string;
  /** Signing method */
  sign_method: ChainSigSignMethod;
}

/** Chain signature signing method */
export type ChainSigSignMethod = "NearIntentsSwap";

/** Role target identifier (contract enum) */
export type RoleTarget = { AccountId: string } | { Codehash: string };

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

/** Chain signature response from chain-sig contract */
export type ChainSigResponse =
  | { scheme: "Ed25519"; signature: number[] }
  | {
      scheme: "Secp256k1";
      big_r: { affine_point: string };
      s: { scalar: string };
      recovery_id: number;
    };

/** MPC signature from chain signature contract */
export interface MPCSignature {
  big_r: string;
  s: string;
  recovery_id: number;
}

/** Adapter interface for finalizing and broadcasting ChainSig transactions */
export interface ChainSigTransactionAdapter<UnsignedTx = unknown, SignedTx = string> {
  /** Attach MPC signatures to an unsigned transaction */
  finalizeTransactionSigning(params: {
    transaction: UnsignedTx;
    signatures: MPCSignature[];
  }): SignedTx;
  /** Broadcast a signed transaction to the target chain */
  broadcastTx(signedTx: SignedTx): Promise<string>;
}

// =============================================================================
// Proposal Result Types
// =============================================================================

/** Result from proposing a ChainSig transaction */
export type ChainSigTransactionProposalResult =
  | { executed: false; proposalId: number; outcome: NearTransactionResult }
  | {
      executed: true;
      proposalId: number;
      signatures: MPCSignature[];
      outcome: NearTransactionResult;
    };

export type ChainSigTransactionExecuteResult<SignedTx = string> =
  ChainSigTransactionProposalResult & {
    signedTx?: SignedTx;
    broadcastTxHash?: string;
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
// NEAR Transaction Types
// =============================================================================

/** NEAR transaction data */
export interface NearTransactionData {
  /** Receiver account ID */
  receiverId: string;
  /** Actions to execute */
  actions: Action[];
}

/** NEAR-specific transaction result */
export type NearTransactionResult = FinalExecutionOutcome;

// =============================================================================
// Wallet Types
// =============================================================================

/** NEAR account */
export type NearWallet = Account;

// =============================================================================
// Client Configuration Types
// =============================================================================

/** Dew client configuration */
export interface DewClientConfig<T extends PolicySpecMap> {
  /** Kernel account ID */
  kernelId: string;
  /** NEAR wallet for signing */
  nearWallet?: NearWallet;
  /** NEAR JSON-RPC provider for view calls and broadcasts */
  nearProvider?: JsonRpcProvider;
  /** NEAR RPC URL (used if no provider is supplied) */
  nearRpcUrl?: string;
  policies: T;
}