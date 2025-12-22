/**
 * Dew Finance SDK - Dew Vault (NEAR) Client
 * @packageDocumentation
 */

import { transactions } from "near-api-js";
import type { DewClient } from "./client.js";
import type {
  Asset,
  BasisPoints,
  ChainEnvironment,
  Deposit,
  DepositWithId,
  FungibleTokenMetadata,
  NearCallOptions,
  NearViewOptions,
  NearProposalResult,
  Policy,
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

export type DewVaultSharePriceRate = [Asset, U128String];
export type DewVaultOperationSharePrice = [number, U128String];
export type DewVaultSharePriceList = Array<[Asset, U128String]>;
export type DewVaultAssetAmountList = Array<[Asset, U128String]>;
export type DewVaultCrystallizationInfo = [U128String, U128String, U128String];
export type DewVaultCurrentFlow = [U128String, U128String | null, number | null];
export type DewVaultFlowWindowInfo = [number, number, number] | null;
export type DewVaultAccountantData = Record<string, unknown>;

export interface DewVaultCallOptions {
  /** Override policy ID for this call */
  policyId?: string;
  /** Gas (in TGas) for the vault function call */
  vaultGasTgas?: number;
  /** Deposit (in yoctoNEAR) for the vault function call */
  vaultDepositYocto?: string;
  /** Options for the kernel proposal call */
  callOptions?: NearCallOptions;
}

export interface DewNearVaultClientConfig {
  /** Bound DewClient instance */
  dewClient: DewClient;
  /** Dew Vault contract account ID */
  vaultId: string;
  /** Per-method policy ID overrides */
  policyIds?: DewVaultPolicyIdMap;
  /** Prefix used when generating policy IDs */
  policyIdPrefix?: string;
}

export interface DewVaultPolicyListParams {
  requiredRole: string;
  requiredVoteCount: number;
  policyIds?: DewVaultPolicyIdMap;
  policyIdPrefix?: string;
  descriptionPrefix?: string;
  restrictions?: PolicyRestriction[];
  chainEnvironment?: ChainEnvironment;
  activationTime?: string;
  proposalExpiryTimeNanosec?: string;
  requiredPendingActions?: string[];
}

export function createDewVaultPolicyIdMap(
  params: {
    policyIds?: DewVaultPolicyIdMap;
    policyIdPrefix?: string;
  } = {}
): Record<DewVaultMethod, string> {
  const map = {} as Record<DewVaultMethod, string>;
  for (const method of DEW_VAULT_METHODS) {
    const explicit = params.policyIds?.[method];
    if (explicit) {
      map[method] = explicit;
      continue;
    }
    if (params.policyIdPrefix) {
      map[method] = `${params.policyIdPrefix}${method}`;
      continue;
    }
    map[method] = method;
  }
  return map;
}

export function createDewVaultPolicyList(
  params: DewVaultPolicyListParams
): Array<[string, Policy]> {
  const policyIds = createDewVaultPolicyIdMap({
    policyIds: params.policyIds,
    policyIdPrefix: params.policyIdPrefix,
  });
  const descriptionPrefix = params.descriptionPrefix ?? "Dew Vault policy for";
  const restrictions = params.restrictions ?? [];
  const chainEnvironment = params.chainEnvironment ?? "NearWasm";
  const activationTime = params.activationTime ?? "0";
  const proposalExpiryTimeNanosec = params.proposalExpiryTimeNanosec ?? "0";
  const requiredPendingActions = params.requiredPendingActions ?? [];

  return DEW_VAULT_METHODS.map((method) => {
    const policyId = policyIds[method];
    const policy: Policy = {
      id: policyId,
      description: `${descriptionPrefix} ${method}`,
      requiredRole: params.requiredRole,
      requiredVoteCount: params.requiredVoteCount,
      policyType: "NearNativeTransaction",
      policyDetails: {
        type: "NearNativeTransaction",
        config: {
          chainEnvironment,
          restrictions,
        },
      },
      activationTime,
      proposalExpiryTimeNanosec,
      requiredPendingActions,
    };
    return [policyId, policy];
  });
}

export class DewNearVaultClient {
  private readonly dewClient: DewClient;
  private readonly vaultId: string;
  private readonly policyIds: Record<DewVaultMethod, string>;

  constructor(config: DewNearVaultClientConfig) {
    this.dewClient = config.dewClient;
    this.vaultId = config.vaultId;
    this.policyIds = createDewVaultPolicyIdMap({
      policyIds: config.policyIds,
      policyIdPrefix: config.policyIdPrefix,
    });
  }

  getVaultId(): string {
    return this.vaultId;
  }

  private resolvePolicyId(method: DewVaultMethod, override?: string): string {
    if (override) {
      return override;
    }
    const policyId = this.policyIds[method];
    if (!policyId) {
      throw new Error(`No policy ID configured for ${method}`);
    }
    return policyId;
  }

  private buildVaultFunctionCall(
    method: DewVaultMethod,
    args: Record<string, unknown>,
    options?: DewVaultCallOptions
  ): transactions.Action {
    const gasTgas = options?.vaultGasTgas ?? DEFAULT_VAULT_CALL_GAS_TGAS;
    const gas = BigInt(Math.floor(gasTgas * TGAS_TO_GAS));
    const depositYocto = options?.vaultDepositYocto ?? DEFAULT_VAULT_CALL_DEPOSIT_YOCTO;
    const deposit = BigInt(depositYocto);
    return transactions.functionCall(method, Buffer.from(JSON.stringify(args)), gas, deposit);
  }

  private async proposeVaultCall(
    method: DewVaultMethod,
    args: Record<string, unknown>,
    options?: DewVaultCallOptions
  ): Promise<NearProposalResult> {
    const policyId = this.resolvePolicyId(method, options?.policyId);
    const action = this.buildVaultFunctionCall(method, args, options);
    return this.dewClient.proposeNearActions(
      policyId,
      this.vaultId,
      [action],
      options?.callOptions
    );
  }

  private async viewVault<T>(
    method: string,
    args: Record<string, unknown>,
    options?: NearViewOptions
  ): Promise<T> {
    return this.dewClient.viewFunction<T>(this.vaultId, method, args, options);
  }

  // ---------------------------------------------------------------------------
  // Dew Vault Methods (owner-only, called via kernel policy)
  // ---------------------------------------------------------------------------

  async dewVaultUpdateSharePrices(
    rates: DewVaultSharePriceRate[],
    options?: DewVaultCallOptions
  ): Promise<NearProposalResult> {
    return this.proposeVaultCall("dew_vault_update_share_prices", { rates }, options);
  }

  async dewVaultUpdateConfig(
    newConfig: VaultConfig,
    options?: DewVaultCallOptions
  ): Promise<NearProposalResult> {
    return this.proposeVaultCall("dew_vault_update_config", { new_config: newConfig }, options);
  }

  async dewVaultConfirmPendingRedeems(
    requests: DewVaultOperationSharePrice[],
    options?: DewVaultCallOptions
  ): Promise<NearProposalResult> {
    return this.proposeVaultCall("dew_vault_confirm_pending_redeems", { requests }, options);
  }

  async dewVaultProcessPendingDeposits(
    requests: DewVaultOperationSharePrice[],
    options?: DewVaultCallOptions
  ): Promise<NearProposalResult> {
    return this.proposeVaultCall("dew_vault_process_pending_deposits", { requests }, options);
  }

  async dewVaultAssetTransfer(
    asset: Asset,
    amount: U128String,
    receiverId: string,
    memo?: string,
    options?: DewVaultCallOptions
  ): Promise<NearProposalResult> {
    return this.proposeVaultCall(
      "dew_vault_asset_transfer",
      {
        asset,
        amount,
        receiver_id: receiverId,
        memo: memo ?? null,
      },
      options
    );
  }

  async dewVaultUpdateMetadata(
    newMetadata: FungibleTokenMetadata,
    options?: DewVaultCallOptions
  ): Promise<NearProposalResult> {
    return this.proposeVaultCall(
      "dew_vault_update_metadata",
      { new_metadata: newMetadata },
      options
    );
  }

  async dewVaultAddToWhitelist(
    accountId: string,
    options?: DewVaultCallOptions
  ): Promise<NearProposalResult> {
    return this.proposeVaultCall("dew_vault_add_to_whitelist", { account_id: accountId }, options);
  }

  async dewVaultRemoveFromWhitelist(
    accountId: string,
    options?: DewVaultCallOptions
  ): Promise<NearProposalResult> {
    return this.proposeVaultCall(
      "dew_vault_remove_from_whitelist",
      { account_id: accountId },
      options
    );
  }

  async dewVaultAddToBlacklist(
    accountId: string,
    options?: DewVaultCallOptions
  ): Promise<NearProposalResult> {
    return this.proposeVaultCall("dew_vault_add_to_blacklist", { account_id: accountId }, options);
  }

  async dewVaultRemoveFromBlacklist(
    accountId: string,
    options?: DewVaultCallOptions
  ): Promise<NearProposalResult> {
    return this.proposeVaultCall(
      "dew_vault_remove_from_blacklist",
      { account_id: accountId },
      options
    );
  }

  async dewVaultEmergencyPause(options?: DewVaultCallOptions): Promise<NearProposalResult> {
    return this.proposeVaultCall("dew_vault_emergency_pause", {}, options);
  }

  async dewVaultEmergencyUnpause(options?: DewVaultCallOptions): Promise<NearProposalResult> {
    return this.proposeVaultCall("dew_vault_emergency_unpause", {}, options);
  }

  async dewVaultRejectPendingDeposits(
    requestIds: number[],
    reason: string,
    options?: DewVaultCallOptions
  ): Promise<NearProposalResult> {
    return this.proposeVaultCall(
      "dew_vault_reject_pending_deposits",
      { request_ids: requestIds, reason },
      options
    );
  }

  async dewVaultRejectPendingRedeems(
    requestIds: number[],
    reason: string,
    options?: DewVaultCallOptions
  ): Promise<NearProposalResult> {
    return this.proposeVaultCall(
      "dew_vault_reject_pending_redeems",
      { request_ids: requestIds, reason },
      options
    );
  }

  async dewVaultForceResetFlowCap(
    isDeposit: boolean,
    options?: DewVaultCallOptions
  ): Promise<NearProposalResult> {
    return this.proposeVaultCall(
      "dew_vault_force_reset_flow_cap",
      { is_deposit: isDeposit },
      options
    );
  }

  async dewVaultSetAssetFees(
    asset: Asset,
    depositFeeBps?: BasisPoints,
    withdrawalFeeBps?: BasisPoints,
    options?: DewVaultCallOptions
  ): Promise<NearProposalResult> {
    return this.proposeVaultCall(
      "dew_vault_set_asset_fees",
      {
        asset,
        deposit_fee_bps: depositFeeBps ?? null,
        withdrawal_fee_bps: withdrawalFeeBps ?? null,
      },
      options
    );
  }

  async dewVaultSetProtocolFeeCuts(
    asset: Asset,
    depositCutBps?: BasisPoints,
    withdrawalCutBps?: BasisPoints,
    options?: DewVaultCallOptions
  ): Promise<NearProposalResult> {
    return this.proposeVaultCall(
      "dew_vault_set_protocol_fee_cuts",
      {
        asset,
        deposit_cut_bps: depositCutBps ?? null,
        withdrawal_cut_bps: withdrawalCutBps ?? null,
      },
      options
    );
  }

  async dewVaultSetFeeRecipient(
    feeRecipient: string,
    options?: DewVaultCallOptions
  ): Promise<NearProposalResult> {
    return this.proposeVaultCall(
      "dew_vault_set_fee_recipient",
      { fee_recipient: feeRecipient },
      options
    );
  }

  async dewVaultClaimFees(
    asset: Asset,
    options?: DewVaultCallOptions
  ): Promise<NearProposalResult> {
    return this.proposeVaultCall("dew_vault_claim_fees", { asset }, options);
  }

  async dewVaultClaimProtocolFees(
    asset: Asset,
    options?: DewVaultCallOptions
  ): Promise<NearProposalResult> {
    return this.proposeVaultCall("dew_vault_claim_protocol_fees", { asset }, options);
  }

  async dewVaultUnpauseAccountant(options?: DewVaultCallOptions): Promise<NearProposalResult> {
    return this.proposeVaultCall("dew_vault_unpause_accountant", {}, options);
  }

  async dewVaultCrystallizePerformanceFee(
    options?: DewVaultCallOptions
  ): Promise<NearProposalResult> {
    return this.proposeVaultCall("dew_vault_crystallize_performance_fee", {}, options);
  }

  async dewVaultStartVault(options?: DewVaultCallOptions): Promise<NearProposalResult> {
    return this.proposeVaultCall("dew_vault_start_vault", {}, options);
  }

  async dewVaultTransferOwnership(
    newOwner: string,
    options?: DewVaultCallOptions
  ): Promise<NearProposalResult> {
    return this.proposeVaultCall("dew_vault_transfer_ownership", { new_owner: newOwner }, options);
  }

  // ---------------------------------------------------------------------------
  // Dew Vault View Methods
  // ---------------------------------------------------------------------------

  async getMetadata(options?: NearViewOptions): Promise<FungibleTokenMetadata> {
    return this.viewVault("get_metadata", {}, options);
  }

  async getOwnerAccountId(options?: NearViewOptions): Promise<string> {
    return this.viewVault("get_owner_account_id", {}, options);
  }

  async isVaultLive(options?: NearViewOptions): Promise<boolean> {
    return this.viewVault("is_vault_live", {}, options);
  }

  async getLiveAt(options?: NearViewOptions): Promise<U128String> {
    return this.viewVault("get_live_at", {}, options);
  }

  async getAcceptedDepositAssets(options?: NearViewOptions): Promise<Asset[]> {
    return this.viewVault("get_accepted_deposit_assets", {}, options);
  }

  async getAvailableRedeemAssets(options?: NearViewOptions): Promise<Asset[]> {
    return this.viewVault("get_available_redeem_assets", {}, options);
  }

  async getAssetUnion(options?: NearViewOptions): Promise<Asset[]> {
    return this.viewVault("get_asset_union", {}, options);
  }

  async getVaultConfig(options?: NearViewOptions): Promise<VaultConfig> {
    return this.viewVault("get_vault_config", {}, options);
  }

  async getBaseAsset(options?: NearViewOptions): Promise<Asset> {
    return this.viewVault("get_base_asset", {}, options);
  }

  async getProtocolConfig(options?: NearViewOptions): Promise<ProtocolConfig> {
    return this.viewVault("get_protocol_config", {}, options);
  }

  async getAllPendingDeposits(options?: NearViewOptions): Promise<DepositWithId[]> {
    return this.viewVault("get_all_pending_deposits", {}, options);
  }

  async getAllPendingRedeems(options?: NearViewOptions): Promise<WithdrawWithId[]> {
    return this.viewVault("get_all_pending_redeems", {}, options);
  }

  async getAccountPendingRedeems(
    accountId: string,
    options?: NearViewOptions
  ): Promise<TellerOperationWithId[]> {
    return this.viewVault("get_account_pending_redeems", { account_id: accountId }, options);
  }

  async getAccountantData(
    assets: Asset[],
    options?: NearViewOptions
  ): Promise<DewVaultAccountantData> {
    return this.viewVault("get_accountant_data", { assets }, options);
  }

  async getTotalConfirmedPendingRedeemAssets(
    options?: NearViewOptions
  ): Promise<DewVaultAssetAmountList> {
    return this.viewVault("get_total_confirmed_pending_redeem_assets", {}, options);
  }

  async getTotalUnconfirmedPendingRedeemShares(
    options?: NearViewOptions
  ): Promise<U128String> {
    return this.viewVault("get_total_unconfirmed_pending_redeem_shares", {}, options);
  }

  async getSharePriceInAsset(asset: Asset, options?: NearViewOptions): Promise<U128String> {
    return this.viewVault("get_share_price_in_asset", { asset }, options);
  }

  async getAssetBalance(asset: Asset, options?: NearViewOptions): Promise<VaultBalance> {
    return this.viewVault("get_asset_balance", { asset }, options);
  }

  async isAssetAcceptedForDeposit(asset: Asset, options?: NearViewOptions): Promise<boolean> {
    return this.viewVault("is_asset_accepted_for_deposit", { asset }, options);
  }

  async isAssetAvailableForRedeem(asset: Asset, options?: NearViewOptions): Promise<boolean> {
    return this.viewVault("is_asset_available_for_redeem", { asset }, options);
  }

  async getSharePriceScale(options?: NearViewOptions): Promise<U128String> {
    return this.viewVault("get_share_price_scale", {}, options);
  }

  async getExtraDecimalScale(options?: NearViewOptions): Promise<U128String> {
    return this.viewVault("get_extra_decimal_scale", {}, options);
  }

  async getTvlInBaseAsset(options?: NearViewOptions): Promise<U128String> {
    return this.viewVault("get_tvl_in_base_asset", {}, options);
  }

  async getTvlCapacityRemaining(options?: NearViewOptions): Promise<U128String | null> {
    return this.viewVault("get_tvl_capacity_remaining", {}, options);
  }

  async convertToShares(
    asset: Asset,
    assetAmount: U128String,
    options?: NearViewOptions
  ): Promise<U128String> {
    return this.viewVault("convert_to_shares", { asset, asset_amount: assetAmount }, options);
  }

  async convertToAssetAmount(
    asset: Asset,
    shares: U128String,
    options?: NearViewOptions
  ): Promise<U128String> {
    return this.viewVault("convert_to_asset_amount", { asset, shares }, options);
  }

  async getVaultBalance(asset: Asset, options?: NearViewOptions): Promise<VaultBalance> {
    return this.viewVault("get_vault_balance", { asset }, options);
  }

  async previewDepositShares(
    asset: Asset,
    depositAmount: U128String,
    options?: NearViewOptions
  ): Promise<U128String> {
    return this.viewVault("preview_deposit_shares", { asset, deposit_amount: depositAmount }, options);
  }

  async previewRedeemAssetAmount(
    asset: Asset,
    shares: U128String,
    options?: NearViewOptions
  ): Promise<U128String> {
    return this.viewVault("preview_redeem_asset_amount", { asset, shares }, options);
  }

  async maxRedeemShares(ownerId: string, options?: NearViewOptions): Promise<U128String> {
    return this.viewVault("max_redeem_shares", { owner_id: ownerId }, options);
  }

  async maxDepositAmount(asset: Asset, options?: NearViewOptions): Promise<U128String> {
    return this.viewVault("max_deposit_amount", { asset }, options);
  }

  async getUnconfirmedWithdraws(options?: NearViewOptions): Promise<WithdrawWithId[]> {
    return this.viewVault("get_unconfirmed_withdraws", {}, options);
  }

  async getConfirmedWithdraws(options?: NearViewOptions): Promise<WithdrawWithId[]> {
    return this.viewVault("get_confirmed_withdraws", {}, options);
  }

  async isWithdrawConfirmed(operationId: number, options?: NearViewOptions): Promise<boolean> {
    return this.viewVault("is_withdraw_confirmed", { operation_id: operationId }, options);
  }

  async getConfirmedSharePrice(
    operationId: number,
    options?: NearViewOptions
  ): Promise<U128String | null> {
    return this.viewVault("get_confirmed_share_price", { operation_id: operationId }, options);
  }

  async getWithdrawInfo(
    operationId: number,
    options?: NearViewOptions
  ): Promise<Withdraw | null> {
    return this.viewVault("get_withdraw_info", { operation_id: operationId }, options);
  }

  async getDepositInfo(
    operationId: number,
    options?: NearViewOptions
  ): Promise<Deposit | null> {
    return this.viewVault("get_deposit_info", { operation_id: operationId }, options);
  }

  async isEmergencyPaused(options?: NearViewOptions): Promise<boolean> {
    return this.viewVault("is_emergency_paused", {}, options);
  }

  async getDepositFeeByAsset(asset: Asset, options?: NearViewOptions): Promise<BasisPoints> {
    return this.viewVault("get_deposit_fee_by_asset", { asset }, options);
  }

  async getWithdrawalFeeByAsset(asset: Asset, options?: NearViewOptions): Promise<BasisPoints> {
    return this.viewVault("get_withdrawal_fee_by_asset", { asset }, options);
  }

  async getProtocolDepositFeeCut(asset: Asset, options?: NearViewOptions): Promise<BasisPoints> {
    return this.viewVault("get_protocol_deposit_fee_cut", { asset }, options);
  }

  async getProtocolWithdrawalFeeCut(asset: Asset, options?: NearViewOptions): Promise<BasisPoints> {
    return this.viewVault("get_protocol_withdrawal_fee_cut", { asset }, options);
  }

  async getFeesOwedForAsset(asset: Asset, options?: NearViewOptions): Promise<U128String> {
    return this.viewVault("get_fees_owed_for_asset", { asset }, options);
  }

  async getAllFeesOwed(options?: NearViewOptions): Promise<DewVaultAssetAmountList> {
    return this.viewVault("get_all_fees_owed", {}, options);
  }

  async getProtocolFeesOwedForAsset(
    asset: Asset,
    options?: NearViewOptions
  ): Promise<U128String> {
    return this.viewVault("get_protocol_fees_owed_for_asset", { asset }, options);
  }

  async getAllProtocolFeesOwed(options?: NearViewOptions): Promise<DewVaultAssetAmountList> {
    return this.viewVault("get_all_protocol_fees_owed", {}, options);
  }

  async getFeeRecipient(options?: NearViewOptions): Promise<string> {
    return this.viewVault("get_fee_recipient", {}, options);
  }

  async getProtocolAccount(options?: NearViewOptions): Promise<string> {
    return this.viewVault("get_protocol_account", {}, options);
  }

  async getLastSharePriceUpdate(options?: NearViewOptions): Promise<U128String> {
    return this.viewVault("get_last_share_price_update", {}, options);
  }

  async isWhitelistEnabled(options?: NearViewOptions): Promise<boolean> {
    return this.viewVault("is_whitelist_enabled", {}, options);
  }

  async isBlacklistEnabled(options?: NearViewOptions): Promise<boolean> {
    return this.viewVault("is_blacklist_enabled", {}, options);
  }

  async isWhitelisted(accountId: string, options?: NearViewOptions): Promise<boolean> {
    return this.viewVault("is_whitelisted", { account_id: accountId }, options);
  }

  async isBlacklisted(accountId: string, options?: NearViewOptions): Promise<boolean> {
    return this.viewVault("is_blacklisted", { account_id: accountId }, options);
  }

  async getDepositFlowAccumulated(options?: NearViewOptions): Promise<U128String> {
    return this.viewVault("get_deposit_flow_accumulated", {}, options);
  }

  async getDepositFlowWindowStart(options?: NearViewOptions): Promise<number> {
    return this.viewVault("get_deposit_flow_window_start", {}, options);
  }

  async getWithdrawalFlowAccumulated(options?: NearViewOptions): Promise<U128String> {
    return this.viewVault("get_withdrawal_flow_accumulated", {}, options);
  }

  async getWithdrawalFlowWindowStart(options?: NearViewOptions): Promise<number> {
    return this.viewVault("get_withdrawal_flow_window_start", {}, options);
  }

  async getClaimableAssetAmount(
    accountId: string,
    asset: Asset,
    options?: NearViewOptions
  ): Promise<U128String> {
    return this.viewVault("get_claimable_asset_amount", { account_id: accountId, asset }, options);
  }

  async getAllClaimableAssetAmounts(
    accountId: string,
    options?: NearViewOptions
  ): Promise<DewVaultAssetAmountList> {
    return this.viewVault("get_all_claimable_asset_amounts", { account_id: accountId }, options);
  }

  async getAllSharePrices(options?: NearViewOptions): Promise<DewVaultSharePriceList> {
    return this.viewVault("get_all_share_prices", {}, options);
  }

  async getPreviousSharePriceUpdateTimestamp(options?: NearViewOptions): Promise<U128String> {
    return this.viewVault("get_previous_share_price_update_timestamp", {}, options);
  }

  async getTotalShares(options?: NearViewOptions): Promise<U128String> {
    return this.viewVault("get_total_shares", {}, options);
  }

  async getTimeSinceLastRateUpdate(options?: NearViewOptions): Promise<U128String> {
    return this.viewVault("get_time_since_last_rate_update", {}, options);
  }

  async isAccountantPaused(options?: NearViewOptions): Promise<boolean> {
    return this.viewVault("is_accountant_paused", {}, options);
  }

  async getCrystallizationInfo(
    options?: NearViewOptions
  ): Promise<DewVaultCrystallizationInfo> {
    return this.viewVault("get_crystallization_info", {}, options);
  }

  async isCrystallizationDue(options?: NearViewOptions): Promise<boolean> {
    return this.viewVault("is_crystallization_due", {}, options);
  }

  async getHighwatermarkRate(options?: NearViewOptions): Promise<U128String> {
    return this.viewVault("get_highwatermark_rate", {}, options);
  }

  async getCurrentManagementFeePreview(options?: NearViewOptions): Promise<U128String> {
    return this.viewVault("get_current_management_fee_preview", {}, options);
  }

  async getCurrentPerformanceFeePreview(options?: NearViewOptions): Promise<U128String> {
    return this.viewVault("get_current_performance_fee_preview", {}, options);
  }

  async hasAnyFeesOwed(options?: NearViewOptions): Promise<boolean> {
    return this.viewVault("has_any_fees_owed", {}, options);
  }

  async getCurrentDepositFlow(options?: NearViewOptions): Promise<DewVaultCurrentFlow> {
    return this.viewVault("get_current_deposit_flow", {}, options);
  }

  async getCurrentWithdrawalFlow(options?: NearViewOptions): Promise<DewVaultCurrentFlow> {
    return this.viewVault("get_current_withdrawal_flow", {}, options);
  }

  async getFlowWindowInfo(
    isDeposit: boolean,
    options?: NearViewOptions
  ): Promise<DewVaultFlowWindowInfo> {
    return this.viewVault("get_flow_window_info", { is_deposit: isDeposit }, options);
  }

  async protocolGetManagementFeeCut(options?: NearViewOptions): Promise<BasisPoints> {
    return this.viewVault("protocol_get_management_fee_cut", {}, options);
  }

  async protocolGetPerformanceFeeCut(options?: NearViewOptions): Promise<BasisPoints> {
    return this.viewVault("protocol_get_performance_fee_cut", {}, options);
  }

  async protocolGetFeeRecipient(options?: NearViewOptions): Promise<string> {
    return this.viewVault("protocol_get_fee_recipient", {}, options);
  }

  async protocolGetConfig(options?: NearViewOptions): Promise<ProtocolConfig> {
    return this.viewVault("protocol_get_config", {}, options);
  }

  async protocolGetFeeSummary(options?: NearViewOptions): Promise<Record<string, unknown>> {
    return this.viewVault("protocol_get_fee_summary", {}, options);
  }

  async protocolHasFeeConfiguration(options?: NearViewOptions): Promise<boolean> {
    return this.viewVault("protocol_has_fee_configuration", {}, options);
  }

  async ftTotalSupply(options?: NearViewOptions): Promise<U128String> {
    return this.viewVault("ft_total_supply", {}, options);
  }

  async ftBalanceOf(accountId: string, options?: NearViewOptions): Promise<U128String> {
    return this.viewVault("ft_balance_of", { account_id: accountId }, options);
  }

  async ftMetadata(options?: NearViewOptions): Promise<FungibleTokenMetadata> {
    return this.viewVault("ft_metadata", {}, options);
  }

  async storageBalanceBounds(options?: NearViewOptions): Promise<StorageBalanceBounds> {
    return this.viewVault("storage_balance_bounds", {}, options);
  }

  async storageBalanceOf(
    accountId: string,
    options?: NearViewOptions
  ): Promise<StorageBalance | null> {
    return this.viewVault("storage_balance_of", { account_id: accountId }, options);
  }
}
