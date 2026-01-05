/**
 * Dew Finance SDK - Dew Vault (NEAR) Client
 * @packageDocumentation
 */

import { actionCreators, type Action } from "@near-js/transactions";
import type { DewClient } from "./client.js";
import { DEFAULT_POLICY_ACTIVATION_TIME, DEFAULT_POLICY_EXPIRY_NS } from "./policy.js";
import { buildRestrictionSchema, buildChainSigTransactionPolicy } from "./policy-builders.js";
import type {
  Asset,
  BasisPoints,
  ChainEnvironment,
  ChainSigPolicySpecWithBuilder,
  ChainSigTransactionProposalResult,
  Deposit,
  DepositWithId,
  FungibleTokenMetadata,
  NearCallOptions,
  NearViewOptions,
  Policy,
  PolicySpecMap,
  PolicyRestriction,
  ProtocolConfig,
  StorageBalance,
  StorageBalanceBounds,
  TellerOperationWithId,
  U128String,
  VaultConfig,
  VaultBalance,
  Withdraw,
  WithdrawWithId,
} from "./types.js";

const TGAS_TO_GAS = 1_000_000_000_000; // 1e12
const DEFAULT_VAULT_CALL_GAS_TGAS = 150;
const DEFAULT_VAULT_CALL_DEPOSIT_YOCTO = "0";
const DEFAULT_STRATEGIST_TRANSFER_GAS_TGAS = 30;
const DEFAULT_STRATEGIST_TRANSFER_DEPOSIT_YOCTO = "1";

type DewVaultCallOptions = {
  policyId?: string;
  vaultGasTgas?: number;
  vaultDepositYocto?: string;
  callOptions?: NearCallOptions;
  derivationPath?: string;
  nearNetwork?: "Mainnet" | "Testnet";
};

type DewVaultBuilderOptions = Omit<DewVaultCallOptions, "policyId">;
type DewVaultPolicyBuilderArgs = [Record<string, unknown>, DewVaultBuilderOptions?];
type DewVaultPolicySpec = ChainSigPolicySpecWithBuilder<DewVaultPolicyBuilderArgs>;
type DewVaultCallGasOptions = Pick<DewVaultCallOptions, "vaultGasTgas" | "vaultDepositYocto">;

export type DewVaultProposalResult = ChainSigTransactionProposalResult;

export const DEW_VAULT_METHODS = [
  "dew_vault_update_share_prices",
  "dew_vault_update_config",
  "dew_vault_confirm_pending_redeems",
  "dew_vault_process_pending_deposits",
  "dew_vault_asset_transfer",
  "dew_vault_update_metadata",
  "dew_vault_add_to_whitelist",
  "dew_vault_remove_from_whitelist",
  "dew_vault_add_to_blacklist",
  "dew_vault_remove_from_blacklist",
  "dew_vault_emergency_pause",
  "dew_vault_emergency_unpause",
  "dew_vault_reject_pending_deposits",
  "dew_vault_reject_pending_redeems",
  "dew_vault_force_reset_flow_cap",
  "dew_vault_set_asset_fees",
  "dew_vault_set_protocol_fee_cuts",
  "dew_vault_set_fee_recipient",
  "dew_vault_claim_fees",
  "dew_vault_claim_protocol_fees",
  "dew_vault_unpause_accountant",
  "dew_vault_crystallize_performance_fee",
  "dew_vault_start_vault",
  "dew_vault_transfer_ownership",
] as const;

export type DewVaultMethod = (typeof DEW_VAULT_METHODS)[number];

export type DewVaultPolicyIdMap = Partial<Record<DewVaultMethod, string>>;

function buildVaultFunctionCallAction({
  method,
  args,
  options,
}: {
  method: DewVaultMethod;
  args: Record<string, unknown>;
  options?: DewVaultCallGasOptions;
}): Action {
  const gasTgas = options?.vaultGasTgas ?? DEFAULT_VAULT_CALL_GAS_TGAS;
  const gas = BigInt(Math.floor(gasTgas * TGAS_TO_GAS));
  const depositYocto = options?.vaultDepositYocto ?? DEFAULT_VAULT_CALL_DEPOSIT_YOCTO;
  const deposit = BigInt(depositYocto);
  return actionCreators.functionCall(method, Buffer.from(JSON.stringify(args)), gas, deposit);
}

export type DewVaultSharePriceRate = [Asset, U128String];
export type DewVaultOperationSharePrice = [number, U128String];
export type DewVaultSharePriceList = Array<[Asset, U128String]>;
export type DewVaultAssetAmountList = Array<[Asset, U128String]>;
export type DewVaultCrystallizationInfo = [U128String, U128String, U128String];
export type DewVaultCurrentFlow = [U128String, U128String | null, number | null];
export type DewVaultFlowWindowInfo = [number, number, number] | null;
export type DewVaultAccountantData = Record<string, unknown>;


export function createDewVaultPolicyIdMap({
  policyIds,
  policyIdPrefix,
}: {
  policyIds?: DewVaultPolicyIdMap;
  policyIdPrefix?: string;
} = {}): Record<DewVaultMethod, string> {
  const map = {} as Record<DewVaultMethod, string>;
  for (const method of DEW_VAULT_METHODS) {
    const explicit = policyIds?.[method];
    if (explicit) {
      map[method] = explicit;
      continue;
    }
    if (policyIdPrefix) {
      map[method] = `${policyIdPrefix}${method}`;
      continue;
    }
    map[method] = method;
  }
  return map;
}

export function createDewVaultPolicyList({
  vaultId,
  derivationPath,
  requiredRole,
  requiredVoteCount,
  policyIds,
  policyIdPrefix,
  descriptionPrefix,
  chainEnvironment,
  activationTime,
  proposalExpiryTimeNanosec,
  requiredPendingActions,
}: {
  vaultId: string;
  derivationPath: string;
  requiredRole: string;
  requiredVoteCount: number;
  policyIds?: DewVaultPolicyIdMap;
  policyIdPrefix?: string;
  descriptionPrefix?: string;
  chainEnvironment?: ChainEnvironment;
  activationTime?: string;
  proposalExpiryTimeNanosec?: string;
  requiredPendingActions?: string[];
}): Array<[string, DewVaultPolicySpec]> {
  const policyIdMap = createDewVaultPolicyIdMap({ policyIds, policyIdPrefix });
  const resolvedDescriptionPrefix = descriptionPrefix ?? "Dew Vault policy for";
  const resolvedChainEnvironment = chainEnvironment ?? "NearWasm";
  const resolvedActivationTime = activationTime ?? DEFAULT_POLICY_ACTIVATION_TIME;
  const resolvedProposalExpiryTimeNanosec = proposalExpiryTimeNanosec ?? DEFAULT_POLICY_EXPIRY_NS;
  const resolvedPendingActions = requiredPendingActions ?? [];

  return DEW_VAULT_METHODS.map((method) => {
    const policyId = policyIdMap[method];
    const extraPredicates: string[] = [];
    if (method === "dew_vault_confirm_pending_redeems") {
      extraPredicates.push("$.args.requests.length().gte(1)");
    }
    if (method === "dew_vault_process_pending_deposits") {
      extraPredicates.push("$.args.requests.length().gte(1)");
    }
    if (method === "dew_vault_reject_pending_deposits") {
      extraPredicates.push("$.args.request_ids.length().gte(1)");
      extraPredicates.push("$.args.reason.length().gte(1)");
    }
    if (method === "dew_vault_reject_pending_redeems") {
      extraPredicates.push("$.args.request_ids.length().gte(1)");
      extraPredicates.push("$.args.reason.length().gte(1)");
    }
    if (method === "dew_vault_asset_transfer") {
      extraPredicates.push(
        `$.args.receiver_id.equal(chain_sig_address("${derivationPath}","NearWasm"))`
      );
    }

    const restrictions: PolicyRestriction[] = [
      {
        schema: buildRestrictionSchema({
          predicates: [
            `$.contract_id.equal("${vaultId}")`,
            `$.function_name.equal("${method}")`,
            ...extraPredicates,
          ],
        }),
        interface: "",
      },
    ];

    const policy = buildChainSigTransactionPolicy({
      policyId,
      description: `${resolvedDescriptionPrefix} ${method}`,
      requiredRole,
      requiredVoteCount,
      derivationPath,
      chainEnvironment: resolvedChainEnvironment,
      restrictions,
      activationTime: resolvedActivationTime,
      proposalExpiryTimeNanosec: resolvedProposalExpiryTimeNanosec,
      requiredPendingActions: resolvedPendingActions,
    });
    const builder: DewVaultPolicySpec["builder"] = (args, options) => {
      const action = buildVaultFunctionCallAction({ method, args, options });
      const resolvedDerivationPath = options?.derivationPath ?? derivationPath;
      return {
        receiverId: vaultId,
        actions: [action],
        signer: {
          type: "ChainSig",
          derivationPath: resolvedDerivationPath,
          nearNetwork: options?.nearNetwork,
        },
        options: options?.callOptions,
      };
    };
    return [policyId, { ...policy, builder }];
  });
}

export function createDewVaultStrategistTransferPolicy({
  vaultId,
  tokenId,
  derivationPath,
  requiredRole,
  requiredVoteCount,
  policyId,
  description,
  chainEnvironment,
  activationTime,
  proposalExpiryTimeNanosec,
  requiredPendingActions,
}: {
  vaultId: string;
  tokenId: string;
  derivationPath: string;
  requiredRole: string;
  requiredVoteCount: number;
  policyId?: string;
  description?: string;
  chainEnvironment?: ChainEnvironment;
  activationTime?: string;
  proposalExpiryTimeNanosec?: string;
  requiredPendingActions?: string[];
}): Policy {
  const resolvedPolicyId = policyId ?? "dew_vault_strategist_transfer";
  const resolvedDescription = description ?? "Deposit tokens into vault";
  const resolvedChainEnvironment = chainEnvironment ?? "NearWasm";
  const resolvedActivationTime = activationTime ?? DEFAULT_POLICY_ACTIVATION_TIME;
  const resolvedProposalExpiryTimeNanosec = proposalExpiryTimeNanosec ?? DEFAULT_POLICY_EXPIRY_NS;
  const resolvedPendingActions = requiredPendingActions ?? [];

  const restrictions: PolicyRestriction[] = [
    {
      schema: buildRestrictionSchema({
        predicates: [
          `$.contract_id.equal("${tokenId}")`,
          `$.function_name.equal("ft_transfer_call")`,
          `$.args.receiver_id.equal("${vaultId}")`,
          `$.args.msg.json().is_strategist_transfer.equal(true)`,
        ],
      }),
      interface: "",
    },
  ];

  return buildChainSigTransactionPolicy({
    policyId: resolvedPolicyId,
    description: resolvedDescription,
    requiredRole,
    requiredVoteCount,
    derivationPath,
    chainEnvironment: resolvedChainEnvironment,
    restrictions,
    activationTime: resolvedActivationTime,
    proposalExpiryTimeNanosec: resolvedProposalExpiryTimeNanosec,
    requiredPendingActions: resolvedPendingActions,
  });
}

export function createDewVaultStrategistTransferProcessRedeemPolicy({
  vaultId,
  tokenId,
  derivationPath,
  requiredRole,
  requiredVoteCount,
  policyId,
  description,
  chainEnvironment,
  activationTime,
  proposalExpiryTimeNanosec,
  requiredPendingActions,
}: {
  vaultId: string;
  tokenId: string;
  derivationPath: string;
  requiredRole: string;
  requiredVoteCount: number;
  policyId?: string;
  description?: string;
  chainEnvironment?: ChainEnvironment;
  activationTime?: string;
  proposalExpiryTimeNanosec?: string;
  requiredPendingActions?: string[];
}): Policy {
  const resolvedPolicyId = policyId ?? "dew_vault_strategist_transfer_process_redeem";
  const resolvedDescription = description ?? "Processes pending redeem requests";
  const resolvedChainEnvironment = chainEnvironment ?? "NearWasm";
  const resolvedActivationTime = activationTime ?? DEFAULT_POLICY_ACTIVATION_TIME;
  const resolvedProposalExpiryTimeNanosec = proposalExpiryTimeNanosec ?? DEFAULT_POLICY_EXPIRY_NS;
  const resolvedPendingActions = requiredPendingActions ?? [];

  const restrictions: PolicyRestriction[] = [
    {
      schema: buildRestrictionSchema({
        predicates: [
          `$.contract_id.equal("${tokenId}")`,
          `$.function_name.equal("ft_transfer_call")`,
          `$.args.receiver_id.equal("${vaultId}")`,
          `$.args.msg.json().process_redeems.length().gte(1)`,
        ],
      }),
      interface: "",
    },
  ];

  return buildChainSigTransactionPolicy({
    policyId: resolvedPolicyId,
    description: resolvedDescription,
    requiredRole,
    requiredVoteCount,
    derivationPath,
    chainEnvironment: resolvedChainEnvironment,
    restrictions,
    activationTime: resolvedActivationTime,
    proposalExpiryTimeNanosec: resolvedProposalExpiryTimeNanosec,
    requiredPendingActions: resolvedPendingActions,
  });
}

export class DewNearVaultClient<TPolicies extends PolicySpecMap> {
  private readonly dewClient: DewClient<TPolicies>;
  private readonly vaultId: string;
  private readonly policyIds: Record<DewVaultMethod, string>;
  private readonly derivationPath?: string;

  constructor({
    dewClient,
    vaultId,
    policyIds,
    policyIdPrefix,
    derivationPath,
  }: {
    dewClient: DewClient<TPolicies>;
    vaultId: string;
    policyIds?: DewVaultPolicyIdMap;
    policyIdPrefix?: string;
    derivationPath?: string;
  }) {
    this.dewClient = dewClient;
    this.vaultId = vaultId;
    this.policyIds = createDewVaultPolicyIdMap({
      policyIds,
      policyIdPrefix,
    });
    this.derivationPath = derivationPath;
  }

  getVaultId(): string {
    return this.vaultId;
  }

  private resolvePolicyId({
    method,
    override,
  }: {
    method: DewVaultMethod;
    override?: string;
  }): string {
    if (override) {
      return override;
    }
    const policyId = this.policyIds[method];
    if (!policyId) {
      throw new Error(`No policy ID configured for ${method}`);
    }
    return policyId;
  }

  private resolveDerivationPath({ override }: { override?: string }): string {
    if (override) {
      return override;
    }
    if (this.derivationPath) {
      return this.derivationPath;
    }
    throw new Error("No derivation path configured for DewNearVaultClient.");
  }

  private buildFtTransferCallAction({
    receiverId,
    amount,
    msg,
    memo,
    gasTgas,
    depositYocto,
  }: {
    receiverId: string;
    amount: U128String;
    msg: string;
    memo?: string;
    gasTgas?: number;
    depositYocto?: string;
  }): Action {
    const resolvedGasTgas = gasTgas ?? DEFAULT_STRATEGIST_TRANSFER_GAS_TGAS;
    const gas = BigInt(Math.floor(resolvedGasTgas * TGAS_TO_GAS));
    const resolvedDepositYocto = depositYocto ?? DEFAULT_STRATEGIST_TRANSFER_DEPOSIT_YOCTO;
    const deposit = BigInt(resolvedDepositYocto);
    return actionCreators.functionCall(
      "ft_transfer_call",
      Buffer.from(
        JSON.stringify({
          receiver_id: receiverId,
          amount,
          memo: memo ?? null,
          msg,
        })
      ),
      gas,
      deposit
    );
  }

  private async proposeVaultCall({
    method,
    args,
    options,
  }: {
    method: DewVaultMethod;
    args: Record<string, unknown>;
    options?: DewVaultCallOptions;
  }): Promise<DewVaultProposalResult> {
    const policyId = this.resolvePolicyId({ method, override: options?.policyId });
    const action = buildVaultFunctionCallAction({ method, args, options });
    const derivationPath = this.resolveDerivationPath({ override: options?.derivationPath });
    const { encodedTx } = await this.dewClient.buildNearTransaction({
      receiverId: this.vaultId,
      actions: [action],
      signer: {
        type: "ChainSig",
        derivationPath,
        nearNetwork: options?.nearNetwork,
      },
      options: options?.callOptions,
    });
    return this.dewClient.proposeChainSigTransaction({
      policyId,
      encodedTx,
      options: { ...options?.callOptions, encoding: "base64" },
    });
  }

  private async viewVault<T>({
    method,
    args,
    options,
  }: {
    method: string;
    args: Record<string, unknown>;
    options?: NearViewOptions;
  }): Promise<T> {
    return this.dewClient.viewFunction<T>({
      accountId: this.vaultId,
      method,
      args,
      options,
    });
  }

  // ---------------------------------------------------------------------------
  // Dew Vault Methods (owner-only, called via kernel policy)
  // ---------------------------------------------------------------------------

  async dewVaultUpdateSharePrices({
    rates,
    options,
  }: {
    rates: DewVaultSharePriceRate[];
    options?: DewVaultCallOptions;
  }): Promise<DewVaultProposalResult> {
    return this.proposeVaultCall({
      method: "dew_vault_update_share_prices",
      args: { rates },
      options,
    });
  }

  async dewVaultUpdateConfig({
    newConfig,
    options,
  }: {
    newConfig: VaultConfig;
    options?: DewVaultCallOptions;
  }): Promise<DewVaultProposalResult> {
    return this.proposeVaultCall({
      method: "dew_vault_update_config",
      args: { new_config: newConfig },
      options,
    });
  }

  async dewVaultConfirmPendingRedeems({
    requests,
    options,
  }: {
    requests: DewVaultOperationSharePrice[];
    options?: DewVaultCallOptions;
  }): Promise<DewVaultProposalResult> {
    return this.proposeVaultCall({
      method: "dew_vault_confirm_pending_redeems",
      args: { requests },
      options,
    });
  }

  async dewVaultProcessPendingDeposits({
    requests,
    options,
  }: {
    requests: DewVaultOperationSharePrice[];
    options?: DewVaultCallOptions;
  }): Promise<DewVaultProposalResult> {
    return this.proposeVaultCall({
      method: "dew_vault_process_pending_deposits",
      args: { requests },
      options,
    });
  }

  async dewVaultAssetTransfer({
    asset,
    amount,
    receiverId,
    memo,
    options,
  }: {
    asset: Asset;
    amount: U128String;
    receiverId: string;
    memo?: string;
    options?: DewVaultCallOptions;
  }): Promise<DewVaultProposalResult> {
    return this.proposeVaultCall({
      method: "dew_vault_asset_transfer",
      args: {
        asset,
        amount,
        receiver_id: receiverId,
        memo: memo ?? null,
      },
      options,
    });
  }

  async dewVaultUpdateMetadata({
    newMetadata,
    options,
  }: {
    newMetadata: FungibleTokenMetadata;
    options?: DewVaultCallOptions;
  }): Promise<DewVaultProposalResult> {
    return this.proposeVaultCall({
      method: "dew_vault_update_metadata",
      args: { new_metadata: newMetadata },
      options,
    });
  }

  async dewVaultAddToWhitelist({
    accountId,
    options,
  }: {
    accountId: string;
    options?: DewVaultCallOptions;
  }): Promise<DewVaultProposalResult> {
    return this.proposeVaultCall({
      method: "dew_vault_add_to_whitelist",
      args: { account_id: accountId },
      options,
    });
  }

  async dewVaultRemoveFromWhitelist({
    accountId,
    options,
  }: {
    accountId: string;
    options?: DewVaultCallOptions;
  }): Promise<DewVaultProposalResult> {
    return this.proposeVaultCall({
      method: "dew_vault_remove_from_whitelist",
      args: { account_id: accountId },
      options,
    });
  }

  async dewVaultAddToBlacklist({
    accountId,
    options,
  }: {
    accountId: string;
    options?: DewVaultCallOptions;
  }): Promise<DewVaultProposalResult> {
    return this.proposeVaultCall({
      method: "dew_vault_add_to_blacklist",
      args: { account_id: accountId },
      options,
    });
  }

  async dewVaultRemoveFromBlacklist({
    accountId,
    options,
  }: {
    accountId: string;
    options?: DewVaultCallOptions;
  }): Promise<DewVaultProposalResult> {
    return this.proposeVaultCall({
      method: "dew_vault_remove_from_blacklist",
      args: { account_id: accountId },
      options,
    });
  }

  async dewVaultEmergencyPause({
    options,
  }: {
    options?: DewVaultCallOptions;
  } = {}): Promise<DewVaultProposalResult> {
    return this.proposeVaultCall({
      method: "dew_vault_emergency_pause",
      args: {},
      options,
    });
  }

  async dewVaultEmergencyUnpause({
    options,
  }: {
    options?: DewVaultCallOptions;
  } = {}): Promise<DewVaultProposalResult> {
    return this.proposeVaultCall({
      method: "dew_vault_emergency_unpause",
      args: {},
      options,
    });
  }

  async dewVaultRejectPendingDeposits({
    requestIds,
    reason,
    options,
  }: {
    requestIds: number[];
    reason: string;
    options?: DewVaultCallOptions;
  }): Promise<DewVaultProposalResult> {
    return this.proposeVaultCall({
      method: "dew_vault_reject_pending_deposits",
      args: { request_ids: requestIds, reason },
      options,
    });
  }

  async dewVaultRejectPendingRedeems({
    requestIds,
    reason,
    options,
  }: {
    requestIds: number[];
    reason: string;
    options?: DewVaultCallOptions;
  }): Promise<DewVaultProposalResult> {
    return this.proposeVaultCall({
      method: "dew_vault_reject_pending_redeems",
      args: { request_ids: requestIds, reason },
      options,
    });
  }

  async dewVaultForceResetFlowCap({
    isDeposit,
    options,
  }: {
    isDeposit: boolean;
    options?: DewVaultCallOptions;
  }): Promise<DewVaultProposalResult> {
    return this.proposeVaultCall({
      method: "dew_vault_force_reset_flow_cap",
      args: { is_deposit: isDeposit },
      options,
    });
  }

  async dewVaultSetAssetFees({
    asset,
    depositFeeBps,
    withdrawalFeeBps,
    options,
  }: {
    asset: Asset;
    depositFeeBps?: BasisPoints;
    withdrawalFeeBps?: BasisPoints;
    options?: DewVaultCallOptions;
  }): Promise<DewVaultProposalResult> {
    return this.proposeVaultCall({
      method: "dew_vault_set_asset_fees",
      args: {
        asset,
        deposit_fee_bps: depositFeeBps ?? null,
        withdrawal_fee_bps: withdrawalFeeBps ?? null,
      },
      options,
    });
  }

  async dewVaultSetProtocolFeeCuts({
    asset,
    depositCutBps,
    withdrawalCutBps,
    options,
  }: {
    asset: Asset;
    depositCutBps?: BasisPoints;
    withdrawalCutBps?: BasisPoints;
    options?: DewVaultCallOptions;
  }): Promise<DewVaultProposalResult> {
    return this.proposeVaultCall({
      method: "dew_vault_set_protocol_fee_cuts",
      args: {
        asset,
        deposit_cut_bps: depositCutBps ?? null,
        withdrawal_cut_bps: withdrawalCutBps ?? null,
      },
      options,
    });
  }

  async dewVaultSetFeeRecipient({
    feeRecipient,
    options,
  }: {
    feeRecipient: string;
    options?: DewVaultCallOptions;
  }): Promise<DewVaultProposalResult> {
    return this.proposeVaultCall({
      method: "dew_vault_set_fee_recipient",
      args: { fee_recipient: feeRecipient },
      options,
    });
  }

  async dewVaultClaimFees({
    asset,
    options,
  }: {
    asset: Asset;
    options?: DewVaultCallOptions;
  }): Promise<DewVaultProposalResult> {
    return this.proposeVaultCall({
      method: "dew_vault_claim_fees",
      args: { asset },
      options,
    });
  }

  async dewVaultClaimProtocolFees({
    asset,
    options,
  }: {
    asset: Asset;
    options?: DewVaultCallOptions;
  }): Promise<DewVaultProposalResult> {
    return this.proposeVaultCall({
      method: "dew_vault_claim_protocol_fees",
      args: { asset },
      options,
    });
  }

  async dewVaultUnpauseAccountant({
    options,
  }: {
    options?: DewVaultCallOptions;
  } = {}): Promise<DewVaultProposalResult> {
    return this.proposeVaultCall({
      method: "dew_vault_unpause_accountant",
      args: {},
      options,
    });
  }

  async dewVaultCrystallizePerformanceFee({
    options,
  }: {
    options?: DewVaultCallOptions;
  } = {}): Promise<DewVaultProposalResult> {
    return this.proposeVaultCall({
      method: "dew_vault_crystallize_performance_fee",
      args: {},
      options,
    });
  }

  async dewVaultStartVault({
    options,
  }: {
    options?: DewVaultCallOptions;
  } = {}): Promise<DewVaultProposalResult> {
    return this.proposeVaultCall({
      method: "dew_vault_start_vault",
      args: {},
      options,
    });
  }

  async dewVaultTransferOwnership({
    newOwner,
    options,
  }: {
    newOwner: string;
    options?: DewVaultCallOptions;
  }): Promise<DewVaultProposalResult> {
    return this.proposeVaultCall({
      method: "dew_vault_transfer_ownership",
      args: { new_owner: newOwner },
      options,
    });
  }

  // ---------------------------------------------------------------------------
  // Strategist transfer helpers (ft_transfer_call into the vault)
  // ---------------------------------------------------------------------------

  async dewVaultStrategistTransfer({
    tokenId,
    amount,
    policyId,
    memo,
    isRequest,
    minShares,
    receiverId,
    gasTgas,
    depositYocto,
    derivationPath,
    nearNetwork,
    callOptions,
  }: {
    tokenId: string;
    amount: U128String;
    policyId: string;
    memo?: string;
    isRequest?: boolean;
    minShares?: U128String;
    receiverId?: string;
    gasTgas?: number;
    depositYocto?: string;
    derivationPath?: string;
    nearNetwork?: "Mainnet" | "Testnet";
    callOptions?: NearCallOptions;
  }): Promise<DewVaultProposalResult> {
    const msg = JSON.stringify({
      is_request: isRequest ?? false,
      min_shares: minShares ?? "0",
      is_strategist_transfer: true,
      ...(receiverId ? { receiver_id: receiverId } : {}),
    });

    const action = this.buildFtTransferCallAction({
      receiverId: this.vaultId,
      amount,
      msg,
      memo,
      gasTgas,
      depositYocto,
    });

    const resolvedDerivationPath = this.resolveDerivationPath({ override: derivationPath });
    const { encodedTx } = await this.dewClient.buildNearTransaction({
      receiverId: tokenId,
      actions: [action],
      signer: {
        type: "ChainSig",
        derivationPath: resolvedDerivationPath,
        nearNetwork,
      },
      options: callOptions,
    });
    return this.dewClient.proposeChainSigTransaction({
      policyId,
      encodedTx,
      options: { ...callOptions, encoding: "base64" },
    });
  }

  async dewVaultStrategistTransferProcessRedeem({
    tokenId,
    amount,
    requestIds,
    policyId,
    memo,
    isRequest,
    minShares,
    gasTgas,
    depositYocto,
    derivationPath,
    nearNetwork,
    callOptions,
  }: {
    tokenId: string;
    amount: U128String;
    requestIds: number[];
    policyId: string;
    memo?: string;
    isRequest?: boolean;
    minShares?: U128String;
    gasTgas?: number;
    depositYocto?: string;
    derivationPath?: string;
    nearNetwork?: "Mainnet" | "Testnet";
    callOptions?: NearCallOptions;
  }): Promise<DewVaultProposalResult> {
    const msg = JSON.stringify({
      is_request: isRequest ?? false,
      min_shares: minShares ?? "0",
      process_redeems: requestIds,
    });

    const action = this.buildFtTransferCallAction({
      receiverId: this.vaultId,
      amount,
      msg,
      memo,
      gasTgas,
      depositYocto,
    });

    const resolvedDerivationPath = this.resolveDerivationPath({ override: derivationPath });
    const { encodedTx } = await this.dewClient.buildNearTransaction({
      receiverId: tokenId,
      actions: [action],
      signer: {
        type: "ChainSig",
        derivationPath: resolvedDerivationPath,
        nearNetwork,
      },
      options: callOptions,
    });
    return this.dewClient.proposeChainSigTransaction({
      policyId,
      encodedTx,
      options: { ...callOptions, encoding: "base64" },
    });
  }

  // ---------------------------------------------------------------------------
  // Dew Vault View Methods
  // ---------------------------------------------------------------------------

  async getMetadata({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<FungibleTokenMetadata> {
    return this.viewVault({ method: "get_metadata", args: {}, options });
  }

  async getOwnerAccountId({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<string> {
    return this.viewVault({ method: "get_owner_account_id", args: {}, options });
  }

  async isVaultLive({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<boolean> {
    return this.viewVault({ method: "is_vault_live", args: {}, options });
  }

  async getLiveAt({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<U128String> {
    return this.viewVault({ method: "get_live_at", args: {}, options });
  }

  async getAcceptedDepositAssets({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<Asset[]> {
    return this.viewVault({ method: "get_accepted_deposit_assets", args: {}, options });
  }

  async getAvailableRedeemAssets({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<Asset[]> {
    return this.viewVault({ method: "get_available_redeem_assets", args: {}, options });
  }

  async getAssetUnion({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<Asset[]> {
    return this.viewVault({ method: "get_asset_union", args: {}, options });
  }

  async getVaultConfig({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<VaultConfig> {
    return this.viewVault({ method: "get_vault_config", args: {}, options });
  }

  async getBaseAsset({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<Asset> {
    return this.viewVault({ method: "get_base_asset", args: {}, options });
  }

  async getProtocolConfig({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<ProtocolConfig> {
    return this.viewVault({ method: "get_protocol_config", args: {}, options });
  }

  async getAllPendingDeposits({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<DepositWithId[]> {
    return this.viewVault({ method: "get_all_pending_deposits", args: {}, options });
  }

  async getAllPendingRedeems({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<WithdrawWithId[]> {
    return this.viewVault({ method: "get_all_pending_redeems", args: {}, options });
  }

  async getAccountPendingRedeems({
    accountId,
    options,
  }: {
    accountId: string;
    options?: NearViewOptions;
  }): Promise<TellerOperationWithId[]> {
    return this.viewVault({
      method: "get_account_pending_redeems",
      args: { account_id: accountId },
      options,
    });
  }

  async getAccountantData({
    assets,
    options,
  }: {
    assets: Asset[];
    options?: NearViewOptions;
  }): Promise<DewVaultAccountantData> {
    return this.viewVault({ method: "get_accountant_data", args: { assets }, options });
  }

  async getTotalConfirmedPendingRedeemAssets({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<DewVaultAssetAmountList> {
    return this.viewVault({
      method: "get_total_confirmed_pending_redeem_assets",
      args: {},
      options,
    });
  }

  async getTotalUnconfirmedPendingRedeemShares({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<U128String> {
    return this.viewVault({
      method: "get_total_unconfirmed_pending_redeem_shares",
      args: {},
      options,
    });
  }

  async getSharePriceInAsset({
    asset,
    options,
  }: {
    asset: Asset;
    options?: NearViewOptions;
  }): Promise<U128String> {
    return this.viewVault({ method: "get_share_price_in_asset", args: { asset }, options });
  }

  async getAssetBalance({
    asset,
    options,
  }: {
    asset: Asset;
    options?: NearViewOptions;
  }): Promise<VaultBalance> {
    return this.viewVault({ method: "get_asset_balance", args: { asset }, options });
  }

  async isAssetAcceptedForDeposit({
    asset,
    options,
  }: {
    asset: Asset;
    options?: NearViewOptions;
  }): Promise<boolean> {
    return this.viewVault({ method: "is_asset_accepted_for_deposit", args: { asset }, options });
  }

  async isAssetAvailableForRedeem({
    asset,
    options,
  }: {
    asset: Asset;
    options?: NearViewOptions;
  }): Promise<boolean> {
    return this.viewVault({ method: "is_asset_available_for_redeem", args: { asset }, options });
  }

  async getSharePriceScale({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<U128String> {
    return this.viewVault({ method: "get_share_price_scale", args: {}, options });
  }

  async getExtraDecimalScale({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<U128String> {
    return this.viewVault({ method: "get_extra_decimal_scale", args: {}, options });
  }

  async getTvlInBaseAsset({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<U128String> {
    return this.viewVault({ method: "get_tvl_in_base_asset", args: {}, options });
  }

  async getTvlCapacityRemaining({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<U128String | null> {
    return this.viewVault({ method: "get_tvl_capacity_remaining", args: {}, options });
  }

  async convertToShares({
    asset,
    assetAmount,
    options,
  }: {
    asset: Asset;
    assetAmount: U128String;
    options?: NearViewOptions;
  }): Promise<U128String> {
    return this.viewVault({
      method: "convert_to_shares",
      args: { asset, asset_amount: assetAmount },
      options,
    });
  }

  async convertToAssetAmount({
    asset,
    shares,
    options,
  }: {
    asset: Asset;
    shares: U128String;
    options?: NearViewOptions;
  }): Promise<U128String> {
    return this.viewVault({ method: "convert_to_asset_amount", args: { asset, shares }, options });
  }

  async getVaultBalance({
    asset,
    options,
  }: {
    asset: Asset;
    options?: NearViewOptions;
  }): Promise<VaultBalance> {
    return this.viewVault({ method: "get_vault_balance", args: { asset }, options });
  }

  async previewDepositShares({
    asset,
    depositAmount,
    options,
  }: {
    asset: Asset;
    depositAmount: U128String;
    options?: NearViewOptions;
  }): Promise<U128String> {
    return this.viewVault({
      method: "preview_deposit_shares",
      args: { asset, deposit_amount: depositAmount },
      options,
    });
  }

  async previewRedeemAssetAmount({
    asset,
    shares,
    options,
  }: {
    asset: Asset;
    shares: U128String;
    options?: NearViewOptions;
  }): Promise<U128String> {
    return this.viewVault({
      method: "preview_redeem_asset_amount",
      args: { asset, shares },
      options,
    });
  }

  async maxRedeemShares({
    ownerId,
    options,
  }: {
    ownerId: string;
    options?: NearViewOptions;
  }): Promise<U128String> {
    return this.viewVault({ method: "max_redeem_shares", args: { owner_id: ownerId }, options });
  }

  async maxDepositAmount({
    asset,
    options,
  }: {
    asset: Asset;
    options?: NearViewOptions;
  }): Promise<U128String> {
    return this.viewVault({ method: "max_deposit_amount", args: { asset }, options });
  }

  async getUnconfirmedWithdraws({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<WithdrawWithId[]> {
    return this.viewVault({ method: "get_unconfirmed_withdraws", args: {}, options });
  }

  async getConfirmedWithdraws({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<WithdrawWithId[]> {
    return this.viewVault({ method: "get_confirmed_withdraws", args: {}, options });
  }

  async isWithdrawConfirmed({
    operationId,
    options,
  }: {
    operationId: number;
    options?: NearViewOptions;
  }): Promise<boolean> {
    return this.viewVault({
      method: "is_withdraw_confirmed",
      args: { operation_id: operationId },
      options,
    });
  }

  async getConfirmedSharePrice({
    operationId,
    options,
  }: {
    operationId: number;
    options?: NearViewOptions;
  }): Promise<U128String | null> {
    return this.viewVault({
      method: "get_confirmed_share_price",
      args: { operation_id: operationId },
      options,
    });
  }

  async getWithdrawInfo({
    operationId,
    options,
  }: {
    operationId: number;
    options?: NearViewOptions;
  }): Promise<Withdraw | null> {
    return this.viewVault({
      method: "get_withdraw_info",
      args: { operation_id: operationId },
      options,
    });
  }

  async getDepositInfo({
    operationId,
    options,
  }: {
    operationId: number;
    options?: NearViewOptions;
  }): Promise<Deposit | null> {
    return this.viewVault({
      method: "get_deposit_info",
      args: { operation_id: operationId },
      options,
    });
  }

  async isEmergencyPaused({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<boolean> {
    return this.viewVault({ method: "is_emergency_paused", args: {}, options });
  }

  async getDepositFeeByAsset({
    asset,
    options,
  }: {
    asset: Asset;
    options?: NearViewOptions;
  }): Promise<BasisPoints> {
    return this.viewVault({ method: "get_deposit_fee_by_asset", args: { asset }, options });
  }

  async getWithdrawalFeeByAsset({
    asset,
    options,
  }: {
    asset: Asset;
    options?: NearViewOptions;
  }): Promise<BasisPoints> {
    return this.viewVault({ method: "get_withdrawal_fee_by_asset", args: { asset }, options });
  }

  async getProtocolDepositFeeCut({
    asset,
    options,
  }: {
    asset: Asset;
    options?: NearViewOptions;
  }): Promise<BasisPoints> {
    return this.viewVault({ method: "get_protocol_deposit_fee_cut", args: { asset }, options });
  }

  async getProtocolWithdrawalFeeCut({
    asset,
    options,
  }: {
    asset: Asset;
    options?: NearViewOptions;
  }): Promise<BasisPoints> {
    return this.viewVault({
      method: "get_protocol_withdrawal_fee_cut",
      args: { asset },
      options,
    });
  }

  async getFeesOwedForAsset({
    asset,
    options,
  }: {
    asset: Asset;
    options?: NearViewOptions;
  }): Promise<U128String> {
    return this.viewVault({ method: "get_fees_owed_for_asset", args: { asset }, options });
  }

  async getAllFeesOwed({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<DewVaultAssetAmountList> {
    return this.viewVault({ method: "get_all_fees_owed", args: {}, options });
  }

  async getProtocolFeesOwedForAsset({
    asset,
    options,
  }: {
    asset: Asset;
    options?: NearViewOptions;
  }): Promise<U128String> {
    return this.viewVault({ method: "get_protocol_fees_owed_for_asset", args: { asset }, options });
  }

  async getAllProtocolFeesOwed({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<DewVaultAssetAmountList> {
    return this.viewVault({ method: "get_all_protocol_fees_owed", args: {}, options });
  }

  async getFeeRecipient({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<string> {
    return this.viewVault({ method: "get_fee_recipient", args: {}, options });
  }

  async getProtocolAccount({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<string> {
    return this.viewVault({ method: "get_protocol_account", args: {}, options });
  }

  async getLastSharePriceUpdate({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<U128String> {
    return this.viewVault({ method: "get_last_share_price_update", args: {}, options });
  }

  async isWhitelistEnabled({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<boolean> {
    return this.viewVault({ method: "is_whitelist_enabled", args: {}, options });
  }

  async isBlacklistEnabled({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<boolean> {
    return this.viewVault({ method: "is_blacklist_enabled", args: {}, options });
  }

  async isWhitelisted({
    accountId,
    options,
  }: {
    accountId: string;
    options?: NearViewOptions;
  }): Promise<boolean> {
    return this.viewVault({ method: "is_whitelisted", args: { account_id: accountId }, options });
  }

  async isBlacklisted({
    accountId,
    options,
  }: {
    accountId: string;
    options?: NearViewOptions;
  }): Promise<boolean> {
    return this.viewVault({ method: "is_blacklisted", args: { account_id: accountId }, options });
  }

  async getDepositFlowAccumulated({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<U128String> {
    return this.viewVault({ method: "get_deposit_flow_accumulated", args: {}, options });
  }

  async getDepositFlowWindowStart({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<number> {
    return this.viewVault({ method: "get_deposit_flow_window_start", args: {}, options });
  }

  async getWithdrawalFlowAccumulated({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<U128String> {
    return this.viewVault({ method: "get_withdrawal_flow_accumulated", args: {}, options });
  }

  async getWithdrawalFlowWindowStart({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<number> {
    return this.viewVault({ method: "get_withdrawal_flow_window_start", args: {}, options });
  }

  async getClaimableAssetAmount({
    accountId,
    asset,
    options,
  }: {
    accountId: string;
    asset: Asset;
    options?: NearViewOptions;
  }): Promise<U128String> {
    return this.viewVault({
      method: "get_claimable_asset_amount",
      args: { account_id: accountId, asset },
      options,
    });
  }

  async getAllClaimableAssetAmounts({
    accountId,
    options,
  }: {
    accountId: string;
    options?: NearViewOptions;
  }): Promise<DewVaultAssetAmountList> {
    return this.viewVault({
      method: "get_all_claimable_asset_amounts",
      args: { account_id: accountId },
      options,
    });
  }

  async getAllSharePrices({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<DewVaultSharePriceList> {
    return this.viewVault({ method: "get_all_share_prices", args: {}, options });
  }

  async getPreviousSharePriceUpdateTimestamp({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<U128String> {
    return this.viewVault({
      method: "get_previous_share_price_update_timestamp",
      args: {},
      options,
    });
  }

  async getTotalShares({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<U128String> {
    return this.viewVault({ method: "get_total_shares", args: {}, options });
  }

  async getTimeSinceLastRateUpdate({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<U128String> {
    return this.viewVault({ method: "get_time_since_last_rate_update", args: {}, options });
  }

  async isAccountantPaused({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<boolean> {
    return this.viewVault({ method: "is_accountant_paused", args: {}, options });
  }

  async getCrystallizationInfo({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<DewVaultCrystallizationInfo> {
    return this.viewVault({ method: "get_crystallization_info", args: {}, options });
  }

  async isCrystallizationDue({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<boolean> {
    return this.viewVault({ method: "is_crystallization_due", args: {}, options });
  }

  async getHighwatermarkRate({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<U128String> {
    return this.viewVault({ method: "get_highwatermark_rate", args: {}, options });
  }

  async getCurrentManagementFeePreview({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<U128String> {
    return this.viewVault({ method: "get_current_management_fee_preview", args: {}, options });
  }

  async getCurrentPerformanceFeePreview({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<U128String> {
    return this.viewVault({ method: "get_current_performance_fee_preview", args: {}, options });
  }

  async hasAnyFeesOwed({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<boolean> {
    return this.viewVault({ method: "has_any_fees_owed", args: {}, options });
  }

  async getCurrentDepositFlow({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<DewVaultCurrentFlow> {
    return this.viewVault({ method: "get_current_deposit_flow", args: {}, options });
  }

  async getCurrentWithdrawalFlow({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<DewVaultCurrentFlow> {
    return this.viewVault({ method: "get_current_withdrawal_flow", args: {}, options });
  }

  async getFlowWindowInfo({
    isDeposit,
    options,
  }: {
    isDeposit: boolean;
    options?: NearViewOptions;
  }): Promise<DewVaultFlowWindowInfo> {
    return this.viewVault({
      method: "get_flow_window_info",
      args: { is_deposit: isDeposit },
      options,
    });
  }

  async protocolGetManagementFeeCut({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<BasisPoints> {
    return this.viewVault({ method: "protocol_get_management_fee_cut", args: {}, options });
  }

  async protocolGetPerformanceFeeCut({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<BasisPoints> {
    return this.viewVault({ method: "protocol_get_performance_fee_cut", args: {}, options });
  }

  async protocolGetFeeRecipient({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<string> {
    return this.viewVault({ method: "protocol_get_fee_recipient", args: {}, options });
  }

  async protocolGetConfig({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<ProtocolConfig> {
    return this.viewVault({ method: "protocol_get_config", args: {}, options });
  }

  async protocolGetFeeSummary({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<Record<string, unknown>> {
    return this.viewVault({ method: "protocol_get_fee_summary", args: {}, options });
  }

  async protocolHasFeeConfiguration({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<boolean> {
    return this.viewVault({ method: "protocol_has_fee_configuration", args: {}, options });
  }

  async ftTotalSupply({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<U128String> {
    return this.viewVault({ method: "ft_total_supply", args: {}, options });
  }

  async ftBalanceOf({
    accountId,
    options,
  }: {
    accountId: string;
    options?: NearViewOptions;
  }): Promise<U128String> {
    return this.viewVault({ method: "ft_balance_of", args: { account_id: accountId }, options });
  }

  async ftMetadata({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<FungibleTokenMetadata> {
    return this.viewVault({ method: "ft_metadata", args: {}, options });
  }

  async storageBalanceBounds({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<StorageBalanceBounds> {
    return this.viewVault({ method: "storage_balance_bounds", args: {}, options });
  }

  async storageBalanceOf({
    accountId,
    options,
  }: {
    accountId: string;
    options?: NearViewOptions;
  }): Promise<StorageBalance | null> {
    return this.viewVault({
      method: "storage_balance_of",
      args: { account_id: accountId },
      options,
    });
  }
}
