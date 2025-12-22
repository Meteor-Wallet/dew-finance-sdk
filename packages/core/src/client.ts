/**
 * Dew Finance SDK - Core Client
 * @packageDocumentation
 */

import type {
  DewClientConfig,
  NearWallet,
  NearTransactionData,
  Proposal,
  MPCSignature,
  EvmProposalResult,
  NearProposalResult,
  KernelCoreProposalResult,
  Policy,
  RoleTarget,
  ChangeControl,
  VoteProposalResult,
  ChainEnvironment,
  NearCallOptions,
  NearRpcOptions,
  NearViewOptions,
  NearTransactionResult,
} from "./types.js";
import { sendNearTransaction, getNearProvider } from "./near.js";
import { providers, transactions } from "near-api-js";
import type { transactions as txType } from "near-api-js";

const TGAS_TO_GAS = 1_000_000_000_000; // 1e12
const DEFAULT_GAS_TGAS = 150; // sensible default
const ONE_YOCTO = "1";
const DEFAULT_DEPOSIT_YOCTO = ONE_YOCTO;

/**
 * Main Dew Finance SDK client
 *
 * @example
 * ```typescript
 * import { DewClient } from '@dew-finance/core';
 *
 * const dew = new DewClient({
 *   kernelId: "kernel.near",
 *   nearWallet: myNearWallet,
 * });
 *
 * // Propose an EVM transaction under a policy
 * const result = await dew.proposeEvmTransaction('evm_policy', serializedTx);
 * ```
 */
export class DewClient {
  /** NEAR account (near-api-js Account) */
  private readonly nearAccount?: NearWallet;
  /** NEAR JSON-RPC provider for views and broadcasts */
  private readonly nearProvider?: providers.JsonRpcProvider;
  /** NEAR RPC URL fallback */
  private readonly nearRpcUrl?: string;

  /** Bound kernel ID for this client */
  private readonly kernelId: string;

  // Flattened client: no sub-clients.

  constructor(config: DewClientConfig) {
    this.kernelId = config.kernelId;
    this.nearAccount = config.nearWallet;
    this.nearProvider = config.nearProvider;
    this.nearRpcUrl = config.nearRpcUrl;
  }

  /**
   * Get the NEAR account
   * @throws Error if no NEAR account is configured
   */
  getNearAccount(): NearWallet {
    if (!this.nearAccount) {
      throw new Error("No NEAR account connected.");
    }
    return this.nearAccount;
  }

  /**
   * Check if a NEAR account is connected
   */
  hasNearAccount(): boolean {
    return !!this.nearAccount;
  }

  /**
   * Get the default kernel ID
   */
  getKernelId(): string {
    return this.kernelId;
  }

  // ===========================================================================
  // Transaction Broadcasting Helpers
  // ===========================================================================

  /**
   * Send a NEAR transaction through the connected account
   */
  async sendNearTx(
    data: NearTransactionData,
    options?: NearCallOptions
  ): Promise<NearTransactionResult> {
    const account = this.resolveNearWallet(options);
    return sendNearTransaction(account, data);
  }

  /**
   * Broadcast a signed NEAR transaction.
   * Use this after manually signing a transaction (e.g., via hardware wallet or offline signing).
   *
   * @param signedTx - Base64-encoded signed transaction
   * @returns Transaction outcome
   */
  async broadcastNearTx(
    signedTx: string | Uint8Array,
    options?: NearRpcOptions
  ): Promise<providers.FinalExecutionOutcome> {
    const { broadcastNearTransaction } = await import("./utils/broadcast.js");
    const provider = this.resolveNearProvider(options);
    return broadcastNearTransaction(provider, signedTx);
  }

  // ===========================================================================
  // Kernel + Policy Methods (Flattened)
  // ===========================================================================

  private async callKernel(
    method: string,
    args: Record<string, unknown>,
    options?: NearCallOptions
  ): Promise<providers.FinalExecutionOutcome> {
    const gasNumber = (options?.gasTgas ?? DEFAULT_GAS_TGAS) * TGAS_TO_GAS;
    const gas = BigInt(Math.floor(gasNumber));
    const depositStr = options?.depositYocto ?? DEFAULT_DEPOSIT_YOCTO;
    const deposit = BigInt(depositStr);
    const account = this.resolveNearWallet(options);
    return sendNearTransaction(account, {
      receiverId: this.kernelId,
      actions: [transactions.functionCall(method, Buffer.from(JSON.stringify(args)), gas, deposit)],
    });
  }

  private async viewKernel<T>(
    method: string,
    args: Record<string, unknown>,
    options?: NearViewOptions
  ): Promise<T> {
    return this.viewFunction(this.kernelId, method, args, options);
  }

  /**
   * View any NEAR contract method via JSON-RPC
   */
  async viewFunction<T>(
    accountId: string,
    method: string,
    args: Record<string, unknown>,
    options?: NearViewOptions
  ): Promise<T> {
    const provider = this.resolveNearProvider(options);
    const res = (await provider.query({
      request_type: "call_function",
      account_id: accountId,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      finality: "optimistic",
    })) as { result?: Uint8Array; body?: Uint8Array };
    const raw: Uint8Array = res.result ?? res.body ?? new Uint8Array();
    const text = Buffer.from(raw).toString();
    return text ? (JSON.parse(text) as T) : (null as unknown as T);
  }

  /**
   * Derive chain signature public key + address for a derivation path
   */
  async deriveChainSigAccount(
    params: {
      chain: ChainEnvironment;
      derivationPath: string;
      nearNetwork?: "Mainnet" | "Testnet";
    },
    options?: NearViewOptions
  ): Promise<{ public_key: string; address: string }> {
    const nearNetwork = params.nearNetwork ?? "Mainnet";
    return this.viewFunction(
      this.kernelId,
      "derive_address_and_public_key",
      {
        path: params.derivationPath,
        chain: params.chain,
        near_network: nearNetwork,
      },
      options
    );
  }

  async proposeExecution(
    policyId: string,
    functionArgs: Record<string, unknown> | string,
    options?: NearCallOptions
  ): Promise<providers.FinalExecutionOutcome> {
    return this.callKernel(
      "propose_execution",
      { policy_id: policyId, function_args: functionArgs },
      options
    );
  }

  private async proposeExecutionKernelCoreFunction(
    method: string,
    functionArgs: Record<string, unknown>,
    options?: NearCallOptions
  ): Promise<KernelCoreProposalResult> {
    const outcome = await this.proposeExecution(method, functionArgs, options);
    const executed = wasProposalExecuted(outcome);
    const proposalId = extractProposalId(outcome);
    if (executed) {
      return { executed: true, proposalId };
    }
    const proposal = await this.getProposal(proposalId, options);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found after creation.`);
    }
    return { executed: false, proposalId, proposal };
  }

  async proposeNearActions(
    policyId: string,
    receiverId: string,
    actions: txType.Action[],
    options?: NearCallOptions
  ): Promise<NearProposalResult> {
    const serializedActions = actions.map((action) => {
      const actionAny = action as {
        type?: string;
        methodName?: string;
        args?: Buffer | string;
        gas?: bigint;
        deposit?: bigint;
      };
      if (actionAny.type === "FunctionCall") {
        return {
          type: "FunctionCall",
          method_name: actionAny.methodName,
          args:
            actionAny.args instanceof Buffer ? actionAny.args.toString("base64") : actionAny.args,
          gas: actionAny.gas?.toString?.() ?? actionAny.gas,
          deposit: actionAny.deposit?.toString?.() ?? actionAny.deposit,
        };
      }
      return action;
    });
    const args = {
      receiver_id: receiverId,
      actions: serializedActions,
    };
    const outcome = await this.callKernel(
      "propose_execution",
      { policy_id: policyId, function_args: args },
      options
    );

    const executed = wasProposalExecuted(outcome);
    const proposalId = extractProposalId(outcome);

    if (executed) {
      return { executed: true, proposalId, outcome };
    }
    return { executed: false, proposalId, outcome };
  }

  async proposeEvmTransaction(
    policyId: string,
    serializedTx: string | Uint8Array,
    options?: NearCallOptions
  ): Promise<EvmProposalResult> {
    const txHex =
      typeof serializedTx === "string" ? serializedTx : Buffer.from(serializedTx).toString("hex");
    const txData = txHex.startsWith("0x") ? txHex : `0x${txHex}`;
    const outcome = await this.callKernel(
      "propose_execution",
      { policy_id: policyId, function_args: txData },
      options
    );

    const executed = wasProposalExecuted(outcome);
    const proposalId = extractProposalId(outcome);

    if (executed) {
      const signatures = extractMPCSignatures(outcome);
      return { executed: true, proposalId, signatures, outcome };
    }
    return { executed: false, proposalId, outcome };
  }

  async voteOnProposal(proposalId: number, options?: NearCallOptions): Promise<VoteProposalResult> {
    const outcome = await this.callKernel(
      "vote_on_proposal",
      { proposal_id: proposalId },
      options ?? { depositYocto: ONE_YOCTO }
    );
    const executed = wasProposalExecuted(outcome);
    if (executed) {
      const signatures = extractMPCSignatures(outcome);
      if (signatures.length) {
        return { executed: true, proposalId, signatures };
      }
      return { executed: true, proposalId };
    }
    const proposal = await this.getProposal(proposalId, options);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found after vote.`);
    }
    return { executed: false, proposalId, proposal };
  }

  async cancelProposal(
    proposalId: number,
    options?: NearCallOptions
  ): Promise<providers.FinalExecutionOutcome> {
    return this.callKernel(
      "cancel_proposal",
      { proposal_id: proposalId },
      options ?? { depositYocto: ONE_YOCTO }
    );
  }

  async getProposal(proposalId: number, options?: NearViewOptions): Promise<Proposal | null> {
    return this.viewKernel("get_proposal", { proposal_id: proposalId }, options);
  }

  async getLatestProposalId(options?: NearViewOptions): Promise<number> {
    return this.viewKernel("get_latest_proposal_id", {}, options);
  }

  async getProposalCount(options?: NearViewOptions): Promise<[number, number]> {
    return this.viewKernel("get_proposal_count", {}, options);
  }

  async getActiveProposals(
    fromIndex?: number,
    limit?: number,
    options?: NearViewOptions
  ): Promise<Proposal[]> {
    return this.viewKernel("get_active_proposals", { from_index: fromIndex, limit }, options);
  }

  async getUserActiveProposals(accountId: string, options?: NearViewOptions): Promise<Proposal[]> {
    return this.viewKernel("get_user_active_proposals", { account_id: accountId }, options);
  }

  async canReleaseLock(options?: NearViewOptions): Promise<boolean> {
    return this.viewKernel("can_release_lock", {}, options);
  }

  async getPendingActionsCount(options?: NearViewOptions): Promise<number> {
    return this.viewKernel("get_pending_actions_count", {}, options);
  }

  async propose(
    policyId: string,
    functionArgs: Record<string, unknown>,
    options?: NearCallOptions
  ): Promise<providers.FinalExecutionOutcome> {
    return this.proposeExecution(policyId, functionArgs, options);
  }

  async grantRole(
    roleId: string,
    target: RoleTarget,
    options?: NearCallOptions
  ): Promise<KernelCoreProposalResult> {
    return this.proposeExecutionKernelCoreFunction(
      "grant_role",
      { role_id: roleId, target },
      options
    );
  }

  async revokeRole(
    roleId: string,
    target: RoleTarget,
    options?: NearCallOptions
  ): Promise<KernelCoreProposalResult> {
    return this.proposeExecutionKernelCoreFunction(
      "revoke_role",
      { role_id: roleId, target },
      options
    );
  }

  async upsertPolicy(
    targetPolicyId: string,
    policy: Policy,
    options?: NearCallOptions
  ): Promise<KernelCoreProposalResult> {
    return this.proposeExecutionKernelCoreFunction(
      "upsert_policy",
      { target_policy_id: targetPolicyId, policy },
      options
    );
  }

  async updatePolicyChangeControl(
    changeControl: ChangeControl,
    options?: NearCallOptions
  ): Promise<KernelCoreProposalResult> {
    return this.proposeExecutionKernelCoreFunction(
      "update_policy_change_control",
      { change_control: changeControl },
      options
    );
  }

  async cancelPendingPolicy(
    policyId: string,
    options?: NearCallOptions
  ): Promise<KernelCoreProposalResult> {
    return this.proposeExecutionKernelCoreFunction(
      "cancel_pending_policy",
      { policy_id: policyId },
      options
    );
  }

  async forceActivatePolicy(
    policyId: string,
    options?: NearCallOptions
  ): Promise<KernelCoreProposalResult> {
    return this.proposeExecutionKernelCoreFunction(
      "force_activate_policy",
      { policy_id: policyId },
      options
    );
  }

  async acquireLock(options?: NearCallOptions): Promise<KernelCoreProposalResult> {
    return this.proposeExecutionKernelCoreFunction("acquire_lock", {}, options);
  }

  async releaseLock(options?: NearCallOptions): Promise<KernelCoreProposalResult> {
    return this.proposeExecutionKernelCoreFunction("release_lock", {}, options);
  }

  async forceReleaseLock(options?: NearCallOptions): Promise<KernelCoreProposalResult> {
    return this.proposeExecutionKernelCoreFunction("force_release_lock", {}, options);
  }

  async forceCompletePendingAction(
    policyId: string,
    options?: NearCallOptions
  ): Promise<KernelCoreProposalResult> {
    return this.proposeExecutionKernelCoreFunction(
      "force_complete_pending_action",
      { policy_id: policyId },
      options
    );
  }

  async batchUpdatePolicies(
    policies: Policy[],
    options?: NearCallOptions
  ): Promise<KernelCoreProposalResult> {
    return this.proposeExecutionKernelCoreFunction("batch_update_policies", { policies }, options);
  }

  async storeData(
    key: string,
    value: string,
    options?: NearCallOptions
  ): Promise<KernelCoreProposalResult> {
    return this.proposeExecutionKernelCoreFunction("store_data", { key, value }, options);
  }

  async batchStoreData(
    keys: string[],
    values: string[],
    options?: NearCallOptions
  ): Promise<KernelCoreProposalResult> {
    return this.proposeExecutionKernelCoreFunction("batch_store_data", { keys, values }, options);
  }

  async getPolicyById(policyId: string, options?: NearViewOptions): Promise<Policy | null> {
    return this.viewKernel("get_policy_by_id", { policy_id: policyId }, options);
  }

  async getAllPolicies(
    fromIndex?: number,
    limit?: number,
    options?: NearViewOptions
  ): Promise<Array<[string, Policy]>> {
    return this.viewKernel("get_all_policies", { from_index: fromIndex, limit }, options);
  }

  async getPendingPolicy(policyId: string, options?: NearViewOptions): Promise<Policy | null> {
    return this.viewKernel("get_pending_policy", { policy_id: policyId }, options);
  }

  async getAllPendingPolicies(
    fromIndex?: number,
    limit?: number,
    options?: NearViewOptions
  ): Promise<Array<[string, Policy]>> {
    return this.viewKernel("get_all_pending_policies", { from_index: fromIndex, limit }, options);
  }

  async getPolicyCount(options?: NearViewOptions): Promise<number> {
    return this.viewKernel("get_policy_count", {}, options);
  }

  private resolveNearProvider(options?: NearRpcOptions): providers.JsonRpcProvider {
    if (options?.nearProvider) {
      return options.nearProvider;
    }
    if (options?.nearRpcUrl) {
      return getNearProvider(options.nearRpcUrl);
    }
    if (this.nearProvider) {
      return this.nearProvider;
    }
    if (this.nearRpcUrl) {
      return getNearProvider(this.nearRpcUrl);
    }
    const rpcUrl = this.nearRpcUrl ?? "https://rpc.mainnet.near.org";
    return getNearProvider(rpcUrl);
  }

  private resolveNearWallet(options?: NearCallOptions): NearWallet {
    if (options?.nearWallet) {
      return options.nearWallet;
    }
    return this.getNearAccount();
  }
}

/**
 * Check if a proposal was executed immediately by inspecting the transaction outcome.
 * Looks for execution events/logs in the receipts.
 */
function wasProposalExecuted(outcome: providers.FinalExecutionOutcome): boolean {
  // Check for execution indicators in logs
  for (const receipt of outcome.receipts_outcome) {
    const logs = receipt.outcome.logs;
    for (const log of logs) {
      // Look for ProposalExecuted event by name
      if (log.includes("ProposalExecuted")) {
        return true;
      }

      // Check for MPC signature logs (indicates EVM tx was signed/executed)
      if (log.includes('"big_r"') || log.includes('"signature"')) {
        return true;
      }
    }

    // Check if there's a successful return value with execution data
    const status = receipt.outcome.status as Record<string, unknown>;
    if (status && typeof status === "object" && "SuccessValue" in status && status.SuccessValue) {
      try {
        const decoded = Buffer.from(status.SuccessValue as string, "base64").toString();
        // Empty string or null means just proposal created
        if (decoded && decoded !== "null" && decoded !== '""') {
          const parsed = JSON.parse(decoded);
          // If we got structured data back (signatures, results), it executed
          if (parsed && typeof parsed === "object") {
            return true;
          }
        }
      } catch {
        // Continue checking
      }
    }
  }

  return false;
}

/**
 * Extract proposal ID from transaction outcome.
 * The kernel emits the proposal ID in logs when a proposal is created.
 */
function extractProposalId(outcome: providers.FinalExecutionOutcome): number {
  // Look for proposal_id in logs
  for (const receipt of outcome.receipts_outcome) {
    const logs = receipt.outcome.logs;
    for (const log of logs) {
      // Look for EVENT_JSON with proposal_id
      if (log.includes("EVENT_JSON")) {
        try {
          const match = log.match(/\{[^}]*"proposal_id"\s*:\s*(\d+)[^}]*\}/);
          if (match && match[1]) {
            return parseInt(match[1], 10);
          }
        } catch {
          // Continue
        }
      }
      // Direct proposal_id mention
      const match = log.match(/proposal[_\s]id[:\s]+(\d+)/i);
      if (match && match[1]) {
        return parseInt(match[1], 10);
      }
    }
  }

  throw new Error("Failed to extract proposal ID from kernel logs.");
}

/**
 * Extract MPC signatures from a NEAR transaction result.
 * Used when a proposal auto-executes and returns chain signatures.
 */
export function extractMPCSignatures(result: providers.FinalExecutionOutcome): MPCSignature[] {
  const signatures: MPCSignature[] = [];

  // Scan through all receipts and their outcomes for signature data
  for (const receipt of result.receipts_outcome) {
    const logs = receipt.outcome.logs;
    for (const log of logs) {
      // Chain signature contract logs signatures in a specific format
      // Look for signature data in logs
      try {
        if (log.includes('"big_r"') || log.includes("big_r")) {
          const parsed = JSON.parse(log);
          if (parsed.big_r && parsed.s !== undefined && parsed.recovery_id !== undefined) {
            signatures.push(parsed as MPCSignature);
          }
        }
      } catch {
        // Not JSON or not a signature log, continue
      }
    }

    // Also check the return value if available
    const returnValue = receipt.outcome.status as Record<string, unknown>;
    if (returnValue && typeof returnValue === "object" && "SuccessValue" in returnValue) {
      try {
        const decoded = Buffer.from(returnValue.SuccessValue as string, "base64").toString();
        const parsed = JSON.parse(decoded);
        // Handle both single signature and array of signatures
        if (Array.isArray(parsed)) {
          for (const sig of parsed) {
            if (sig.big_r && sig.s !== undefined && sig.recovery_id !== undefined) {
              signatures.push(sig as MPCSignature);
            }
          }
        } else if (parsed.big_r && parsed.s !== undefined && parsed.recovery_id !== undefined) {
          signatures.push(parsed as MPCSignature);
        }
      } catch {
        // Not valid signature data
      }
    }
  }

  return signatures;
}

/**
 * Create a new DewClient instance
 */
export function createDewClient(config: DewClientConfig): DewClient {
  return new DewClient(config);
}
