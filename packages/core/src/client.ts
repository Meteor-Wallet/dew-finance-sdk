/**
 * Dew Finance SDK - Core Client
 * @packageDocumentation
 */

import type {
  DewClientConfig,
  NearWallet,
  NearTransactionData,
  Proposal,
  ChainSigTransactionProposalResult,
  ChainSigTransactionExecuteResult,
  NearProposalResult,
  KernelCoreProposalResult,
  Policy,
  PolicySpecMap,
  PolicyExecutionPayload,
  NearNativeExecutionPayload,
  NearTransactionBuildParams,
  NearTransactionBuildResult,
  NearTransactionSigner,
  RoleTarget,
  ChangeControl,
  VoteProposalResult,
  ChainEnvironment,
  NearCallOptions,
  NearRpcOptions,
  NearViewOptions,
  NearTransactionResult,
  ChainSigEncoding,
  ChainSigProposeOptions,
  ChainSigExecuteOptions,
  ChainSigTransactionAdapter,
} from "./types.js";
import { sendNearTransaction, getNearProvider, tgasToGas } from "./near.js";
import { arePoliciesEqual } from "./policy.js";
import {
  extractMPCSignatures,
  extractMPCSignaturesFromResultValue,
  extractProposalId,
  hasReceiptsOutcome,
  pickEd25519Signature,
  wasProposalExecuted,
} from "./utils/proposals.js";
import {
  actionCreators,
  createTransaction,
  encodeTransaction,
  Signature,
  SignedTransaction,
  Transaction,
} from "@near-js/transactions";
import type { Action } from "@near-js/transactions";
import { KeyType, PublicKey } from "@near-js/crypto";
import { baseDecode } from "@near-js/utils";
import type { JsonRpcProvider } from "@near-js/providers";
import type { FinalExecutionOutcome } from "@near-js/types";
import { retry } from "./utils/retry.js";

const DEFAULT_GAS_TGAS = 150; // sensible default
const DEFAULT_DEPOSIT_YOCTO = "0";

type ExecuteOptionsFor<TPolicy> = TPolicy extends { policy_type: "ChainSigTransaction" }
  ? ChainSigExecuteOptions
  : NearCallOptions;

type ExecuteParams<
  TPolicies extends PolicySpecMap,
  P extends keyof TPolicies,
> = TPolicies[P] extends { builder?: (...args: infer A) => PolicyExecutionPayload }
  ? {
      id: P;
      options?: ExecuteOptionsFor<TPolicies[P]>;
    } & ({ args: A; prebuilt?: never } | { prebuilt: true; args?: never })
  : never;

type ExecuteParamUnion<TPolicies extends PolicySpecMap> = {
  [P in keyof TPolicies]: ExecuteParams<TPolicies, P>;
}[keyof TPolicies];

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
 * // Propose a ChainSig transaction under a policy
 * const result = await dew.proposeChainSigTransaction({
 *   policyId: "chainsig_policy",
 *   encodedTx: serializedTx,
 * });
 * ```
 */
export class DewClient<TPolicies extends PolicySpecMap> {
  /** NEAR account */
  private readonly nearAccount?: NearWallet;
  /** NEAR JSON-RPC provider for views and broadcasts */
  private readonly nearProvider?: JsonRpcProvider;
  /** NEAR RPC URL fallback */
  private readonly nearRpcUrl?: string;

  /** Bound kernel ID for this client */
  private readonly kernelId: string;

  private readonly policies: TPolicies;

  // Flattened client: no sub-clients.

  constructor(config: DewClientConfig<TPolicies>) {
    this.kernelId = config.kernelId;
    this.nearAccount = config.nearWallet;
    this.nearProvider = config.nearProvider;
    this.nearRpcUrl = config.nearRpcUrl;
    this.policies = config.policies;
    for (const [key, policy] of Object.entries(this.policies)) {
      if (policy.id !== key) {
        throw new Error(`Policy map key "${key}" must match policy.id "${policy.id}".`);
      }
    }
  }

  async execute(
    params: ExecuteParamUnion<TPolicies>
  ): Promise<ChainSigTransactionExecuteResult | NearProposalResult | FinalExecutionOutcome> {
    const id = params.id;
    const policy = this.policies[id];
    if (!policy) {
      throw new Error(`Policy ${String(id)} not found in client policies.`);
    }

    console.info("[DewClient] execute: start", {
      policyId: String(id),
      policyType: policy.policy_type,
    });

    const declaredBuilder = policy.builder;
    if (!declaredBuilder) {
      throw new Error(`Policy ${String(id)} does not define a builder for execute().`);
    }

    let payload: PolicyExecutionPayload | undefined;

    if ("args" in params && params.args !== undefined) {
      payload = declaredBuilder(...params.args) as PolicyExecutionPayload;
    } else if ("prebuilt" in params) {
      payload = declaredBuilder() as PolicyExecutionPayload;
    }

    if (payload === undefined) {
      throw new Error(`Policy ${String(id)} execution payload is missing.`);
    }

    const buildParams = isNearTransactionBuildParams(payload) ? payload : undefined;

    switch (policy.policy_type) {
      case "ChainSigTransaction": {
        let encodedTx: string | Uint8Array;
        let builtTx: NearTransactionBuildResult | undefined;
        if (buildParams) {
          builtTx = await this.buildNearTransaction(buildParams);
          encodedTx = builtTx.encodedTx;
        } else if (typeof payload === "string" || payload instanceof Uint8Array) {
          console.info("[DewClient] execute: using pre-encoded ChainSig transaction payload");
          encodedTx = payload;
        } else {
          throw new Error(
            `Policy ${String(id)} expects a serialized transaction (string or Uint8Array).`
          );
        }
        const chainSigOptions = params.options as ChainSigExecuteOptions | undefined;
        const chainSigDetails =
          typeof policy.policy_details === "string"
            ? undefined
            : "ChainSigTransaction" in policy.policy_details
              ? policy.policy_details.ChainSigTransaction
              : undefined;
        const chainEnvironment = chainSigDetails?.chain_environment;
        const defaultEncoding: ChainSigEncoding | undefined =
          chainEnvironment === "NearWasm" ? "base64" : undefined;
        const resolvedOptions =
          defaultEncoding && !chainSigOptions?.encoding
            ? { ...chainSigOptions, encoding: defaultEncoding }
            : chainSigOptions;
        const proposeOptions = resolvedOptions
          ? (({ chainSig: _chainSig, ...rest }) => rest)(resolvedOptions)
          : undefined;

        console.info("[DewClient] execute: proposing ChainSig transaction");
        const proposal = await this.proposeChainSigTransaction({
          policyId: String(id),
          encodedTx,
          options: proposeOptions,
        });

        console.info("[DewClient] execute: proposal result", {
          executed: proposal.executed,
          proposalId: proposal.proposalId,
          signatures: proposal.executed ? proposal.signatures.length : 0,
        });
        if (!proposal.executed) {
          return proposal;
        }

        const shouldDefaultNearBroadcast = chainEnvironment === "NearWasm";
        const broadcastDisabled = chainSigOptions?.chainSig?.broadcast === false;
        const defaultNearAdapter = shouldDefaultNearBroadcast
          ? createNearWasmChainSigAdapter({
              provider: this.resolveNearProvider({ options: chainSigOptions }),
            })
          : undefined;
        const adapter = chainSigOptions?.chainSig?.adapter ?? defaultNearAdapter;

        if (!adapter) {
          console.warn(
            "[DewClient] ChainSig proposal executed but no adapter is available for broadcasting."
          );
          return proposal;
        }

        const unsignedTx =
          chainSigOptions?.chainSig?.unsignedTx ??
          builtTx?.transaction ??
          (shouldDefaultNearBroadcast
            ? decodeNearUnsignedTx(encodedTx, resolvedOptions?.encoding)
            : undefined);

        if (!unsignedTx) {
          console.warn(
            "[DewClient] ChainSig proposal executed but unsigned transaction is missing."
          );
          return proposal;
        }

        const resolvedAdapter = adapter as ChainSigTransactionAdapter<unknown, string>;
        const signedTx = resolvedAdapter.finalizeTransactionSigning({
          transaction: unsignedTx as unknown,
          signatures: proposal.signatures,
        });

        if (broadcastDisabled) {
          console.info("[DewClient] ChainSig broadcast disabled; returning signed tx only.");
          return { ...proposal, signedTx };
        }

        console.info("[DewClient] Broadcasting ChainSig transaction...");
        const broadcastResult = await resolvedAdapter.broadcastTx(signedTx);
        console.info("[DewClient] ChainSig broadcast complete:", broadcastResult.txHash);
        return {
          ...proposal,
          signedTx,
          broadcastTxHash: broadcastResult.txHash,
          broadcastOutcome: broadcastResult.outcome,
        };
      }
      case "NearNativeTransaction": {
        let encodedTx: string | Uint8Array;
        if (buildParams) {
          console.info("[DewClient] execute: building Near transaction for NearNative");
          const built = await this.buildNearTransaction(buildParams);
          encodedTx = built.encodedTx;
        } else if (typeof payload === "string" || payload instanceof Uint8Array) {
          console.info("[DewClient] execute: using pre-encoded NearNative transaction payload");
          encodedTx = payload;
        } else {
          throw new Error(
            `Policy ${String(id)} expects a serialized NEAR transaction (string or Uint8Array).`
          );
        }
        const normalizedTx = normalizeNearEncodedTx(encodedTx as NearNativeExecutionPayload);
        console.info("[DewClient] execute: proposing NearNative transaction");
        return this.proposeExecution({
          policyId: String(id),
          functionArgs: normalizedTx,
          options: params.options as NearCallOptions | undefined,
        });
      }
      case "KernelConfiguration": {
        if (buildParams) {
          throw new Error(
            `Policy ${String(
              id
            )} expects function args (object or string), not a transaction builder payload.`
          );
        }
        if (!(typeof payload === "string" || typeof payload === "object")) {
          throw new Error(
            `Policy ${String(id)} expects function args (object or string) for KernelConfiguration.`
          );
        }
        console.info("[DewClient] execute: proposing KernelConfiguration update");
        return this.proposeExecution({
          policyId: String(id),
          functionArgs: payload as Record<string, unknown> | string,
          options: params.options as NearCallOptions | undefined,
        });
      }
      case "ChainSigMessage": {
        throw new Error(
          `Policy ${String(
            id
          )} is a ChainSigMessage policy. execute() currently only supports transaction policies.`
        );
      }
      default: {
        throw new Error(`Unsupported policy type for ${String(id)}.`);
      }
    }
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
  async sendNearTx({
    data,
    options,
  }: {
    data: NearTransactionData;
    options?: NearCallOptions;
  }): Promise<NearTransactionResult> {
    const account = this.resolveNearWallet({ options });
    return sendNearTransaction({ account, data });
  }

  /**
   * Broadcast a signed NEAR transaction (waits for FINAL execution).
   * Use this after manually signing a transaction (e.g., via hardware wallet or offline signing).
   *
   * @param signedTx - Base64-encoded signed transaction
   * @returns Transaction outcome
   */
  async broadcastNearTx({
    signedTx,
    options,
  }: {
    signedTx: string | Uint8Array;
    options?: NearRpcOptions;
  }): Promise<FinalExecutionOutcome> {
    const { broadcastNearTransaction } = await import("./utils/broadcast.js");
    const provider = this.resolveNearProvider({ options });
    return broadcastNearTransaction({ rpcUrlOrProvider: provider, signedTx });
  }

  // ===========================================================================
  // Kernel + Policy Methods (Flattened)
  // ===========================================================================

  /**
   * Build a serialized NEAR transaction suitable for NearNative/ChainSig execution.
   */
  async buildNearTransaction({
    receiverId,
    actions,
    signer,
    finality,
    options,
  }: NearTransactionBuildParams): Promise<NearTransactionBuildResult> {
    const provider = this.resolveNearProvider({ options });
    const { signerId, publicKey, nonce } = await this.resolveNearTransactionSigner({
      signer,
      receiverId,
      actions,
      provider,
      options,
    });

    const block = (await provider.block({
      finality: finality ?? "final",
    })) as { header: { hash: string } };
    const blockHash = baseDecode(block.header.hash);

    const publicKeyObj = PublicKey.fromString(publicKey);
    const transaction = createTransaction(
      signerId,
      publicKeyObj,
      receiverId,
      nonce + 1n,
      actions,
      blockHash
    );
    const encodedTx = Buffer.from(encodeTransaction(transaction)).toString("base64");

    return { encodedTx, transaction, signerId, publicKey, nonce };
  }

  private async callKernel({
    method,
    args,
    options,
  }: {
    method: string;
    args: Record<string, unknown>;
    options?: NearCallOptions;
  }): Promise<FinalExecutionOutcome> {
    const gas = tgasToGas(options?.gasTgas ?? DEFAULT_GAS_TGAS);
    const depositStr = options?.depositYocto ?? DEFAULT_DEPOSIT_YOCTO;
    const deposit = BigInt(depositStr);
    if (options?.agent) {
      const result = await options.agent.call({
        methodName: method,
        args,
        contractId: this.kernelId,
        gas: gas.toString(),
        deposit: deposit.toString(),
      });
      return result as FinalExecutionOutcome;
    }
    const account = this.resolveNearWallet({ options });
    return sendNearTransaction({
      account,
      data: {
        receiverId: this.kernelId,
        actions: [
          actionCreators.functionCall(method, Buffer.from(JSON.stringify(args)), gas, deposit),
        ],
      },
    });
  }

  private async viewKernel<T>({
    method,
    args,
    options,
  }: {
    method: string;
    args: Record<string, unknown>;
    options?: NearViewOptions;
  }): Promise<T> {
    return this.viewFunction({ accountId: this.kernelId, method, args, options });
  }

  /**
   * View any NEAR contract method via JSON-RPC
   */
  async viewFunction<T>({
    accountId,
    method,
    args,
    options,
  }: {
    accountId: string;
    method: string;
    args: Record<string, unknown>;
    options?: NearViewOptions;
  }): Promise<T> {
    const provider = this.resolveNearProvider({ options });
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
  async deriveChainSigAccount({
    chain,
    derivationPath,
    nearNetwork,
    options,
  }: {
    chain: ChainEnvironment;
    derivationPath: string;
    nearNetwork?: "Mainnet" | "Testnet";
    options?: NearViewOptions;
  }): Promise<{ public_key: string; address: string }> {
    const resolvedNetwork = nearNetwork ?? "Mainnet";
    return this.viewFunction({
      accountId: this.kernelId,
      method: "derive_address_and_public_key",
      args: {
        path: derivationPath,
        chain,
        near_network: resolvedNetwork,
      },
      options,
    });
  }

  async proposeExecution({
    policyId,
    functionArgs,
    options,
  }: {
    policyId: string;
    functionArgs: Record<string, unknown> | string;
    options?: NearCallOptions;
  }): Promise<FinalExecutionOutcome> {
    return this.callKernel({
      method: "propose_execution",
      args: { policy_id: policyId, function_args: functionArgs },
      options,
    });
  }

  private async proposeExecutionKernelCoreFunction({
    method,
    functionArgs,
    options,
  }: {
    method: string;
    functionArgs: Record<string, unknown>;
    options?: NearCallOptions;
  }): Promise<KernelCoreProposalResult> {
    const outcome = await this.proposeExecution({ policyId: method, functionArgs, options });
    if (!hasReceiptsOutcome(outcome)) {
      const proposalId = await this.getLatestProposalId({ options });
      const proposal = await this.getProposal({ proposalId, options });
      if (!proposal) {
        return { executed: true, proposalId };
      }
      return { executed: false, proposalId, proposal };
    }
    const executed = wasProposalExecuted({ outcome });
    const proposalId = extractProposalId({ outcome });
    if (executed) {
      return { executed: true, proposalId };
    }
    const proposal = await this.getProposal({ proposalId, options });
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found after creation.`);
    }
    return { executed: false, proposalId, proposal };
  }

  async proposeNearActions({
    policyId,
    receiverId,
    actions,
    signer,
    options,
  }: {
    policyId: string;
    receiverId: string;
    actions: Action[];
    signer?: NearTransactionSigner;
    options?: NearCallOptions;
  }): Promise<NearProposalResult> {
    const resolvedSigner =
      signer ??
      ({
        type: "Account",
        nearWallet: options?.nearWallet,
      } satisfies NearTransactionSigner);
    const { encodedTx } = await this.buildNearTransaction({
      receiverId,
      actions,
      signer: resolvedSigner,
      options,
    });
    const outcome = await this.callKernel({
      method: "propose_execution",
      args: { policy_id: policyId, function_args: encodedTx },
      options,
    });

    if (!hasReceiptsOutcome(outcome)) {
      const proposalId = await this.getLatestProposalId({ options });
      const proposal = await this.getProposal({ proposalId, options });
      const executed = !proposal;
      return { executed, proposalId, outcome: outcome as FinalExecutionOutcome };
    }

    const executed = wasProposalExecuted({ outcome });
    const proposalId = extractProposalId({ outcome });

    if (executed) {
      return { executed: true, proposalId, outcome };
    }
    return { executed: false, proposalId, outcome };
  }

  async proposeChainSigTransaction({
    policyId,
    encodedTx,
    options,
  }: {
    policyId: string;
    encodedTx: string | Uint8Array;
    options?: ChainSigProposeOptions;
  }): Promise<ChainSigTransactionProposalResult> {
    const txData = normalizeChainSigEncodedTx({
      encodedTx,
      encoding: options?.encoding,
    });

    const outcome = await retry(async () => {
      const result = await this.callKernel({
        method: "propose_execution",
        args: { policy_id: policyId, function_args: txData },
        options,
      });
      return result
    })

    if (!hasReceiptsOutcome(outcome)) {

      const proposalId = await this.getLatestProposalId({ options });
      const proposal = await this.getProposal({ proposalId, options });
      const signatures = extractMPCSignaturesFromResultValue(outcome);
      const executed = !proposal || signatures.length > 0;
      if (executed) {
        return {
          executed: true,
          proposalId,
          signatures,
          outcome: outcome as FinalExecutionOutcome,
        };
      }
      return { executed: false, proposalId, outcome: outcome as FinalExecutionOutcome };
    }

    const executed = wasProposalExecuted({ outcome });
    const proposalId = extractProposalId({ outcome });

    if (executed) {
      const signatures = extractMPCSignatures({ result: outcome });
      return { executed: true, proposalId, signatures, outcome };
    }
    return { executed: false, proposalId, outcome };
  }

  async voteOnProposal({
    proposalId,
    options,
  }: {
    proposalId: number;
    options?: NearCallOptions;
  }): Promise<VoteProposalResult> {
    const outcome = await this.callKernel({
      method: "vote_on_proposal",
      args: { proposal_id: proposalId },
      options,
    });
    if (!hasReceiptsOutcome(outcome)) {
      const signatures = extractMPCSignaturesFromResultValue(outcome);
      if (signatures.length) {
        return { executed: true, proposalId, signatures };
      }
      const proposal = await this.getProposal({ proposalId, options });
      if (!proposal) {
        return { executed: true, proposalId };
      }
      return { executed: false, proposalId, proposal };
    }
    const executed = wasProposalExecuted({ outcome });
    if (executed) {
      const signatures = extractMPCSignatures({ result: outcome });
      if (signatures.length) {
        return { executed: true, proposalId, signatures };
      }
      return { executed: true, proposalId };
    }
    const proposal = await this.getProposal({ proposalId, options });
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found after vote.`);
    }
    return { executed: false, proposalId, proposal };
  }

  async cancelProposal({
    proposalId,
    options,
  }: {
    proposalId: number;
    options?: NearCallOptions;
  }): Promise<FinalExecutionOutcome> {
    return this.callKernel({
      method: "cancel_proposal",
      args: { proposal_id: proposalId },
      options,
    });
  }

  async getProposal({
    proposalId,
    options,
  }: {
    proposalId: number;
    options?: NearViewOptions;
  }): Promise<Proposal | null> {
    return this.viewKernel({ method: "get_proposal", args: { proposal_id: proposalId }, options });
  }

  async getLatestProposalId({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<number> {
    return this.viewKernel({ method: "get_latest_proposal_id", args: {}, options });
  }

  async getProposalCount({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<[number, number]> {
    return this.viewKernel({ method: "get_proposal_count", args: {}, options });
  }

  async getActiveProposals({
    fromIndex,
    limit,
    options,
  }: {
    fromIndex?: number;
    limit?: number;
    options?: NearViewOptions;
  } = {}): Promise<Proposal[]> {
    return this.viewKernel({
      method: "get_active_proposals",
      args: { from_index: fromIndex, limit },
      options,
    });
  }

  async getUserActiveProposals({
    accountId,
    options,
  }: {
    accountId: string;
    options?: NearViewOptions;
  }): Promise<Proposal[]> {
    return this.viewKernel({
      method: "get_user_active_proposals",
      args: { account_id: accountId },
      options,
    });
  }

  async getLockHolder({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<string | null> {
    return this.viewKernel({ method: "get_lock_holder", args: {}, options });
  }

  async canReleaseLock({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<boolean> {
    return this.viewKernel({ method: "can_release_lock", args: {}, options });
  }

  async getPendingActionsCount({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<number> {
    return this.viewKernel({ method: "get_pending_actions_count", args: {}, options });
  }

  async ensureLock({
    policyId,
    options,
  }: {
    policyId?: string;
    options?: NearCallOptions;
  } = {}): Promise<{ acquired: boolean; accountId: string }> {
    const holder = await this.getLockHolder({ options });
    const accountId = await this.resolveCallerId({ options });

    if (holder && holder !== accountId) {
      throw new Error(`Global lock held by ${holder}`);
    }

    if (!holder) {
      if (policyId) {
        await this.proposeExecution({ policyId, functionArgs: {}, options });
      } else {
        await this.acquireLock({ options });
      }
      return { acquired: true, accountId };
    }

    return { acquired: false, accountId };
  }

  async propose({
    policyId,
    functionArgs,
    options,
  }: {
    policyId: string;
    functionArgs: Record<string, unknown>;
    options?: NearCallOptions;
  }): Promise<FinalExecutionOutcome> {
    return this.proposeExecution({ policyId, functionArgs, options });
  }

  async grantRole({
    roleId,
    target,
    options,
  }: {
    roleId: string;
    target: RoleTarget;
    options?: NearCallOptions;
  }): Promise<KernelCoreProposalResult> {
    return this.proposeExecutionKernelCoreFunction({
      method: "grant_role",
      functionArgs: { role_id: roleId, target },
      options,
    });
  }

  async revokeRole({
    roleId,
    target,
    options,
  }: {
    roleId: string;
    target: RoleTarget;
    options?: NearCallOptions;
  }): Promise<KernelCoreProposalResult> {
    return this.proposeExecutionKernelCoreFunction({
      method: "revoke_role",
      functionArgs: { role_id: roleId, target },
      options,
    });
  }

  async upsertPolicy({
    targetPolicyId,
    policy,
    options,
  }: {
    targetPolicyId: string;
    policy: Policy;
    options?: NearCallOptions;
  }): Promise<KernelCoreProposalResult> {
    return this.proposeExecutionKernelCoreFunction({
      method: "upsert_policy",
      functionArgs: { target_policy_id: targetPolicyId, policy },
      options,
    });
  }

  async updatePolicyChangeControl({
    changeControl,
    options,
  }: {
    changeControl: ChangeControl;
    options?: NearCallOptions;
  }): Promise<KernelCoreProposalResult> {
    return this.proposeExecutionKernelCoreFunction({
      method: "update_policy_change_control",
      functionArgs: { change_control: changeControl },
      options,
    });
  }

  async cancelPendingPolicy({
    policyId,
    options,
  }: {
    policyId: string;
    options?: NearCallOptions;
  }): Promise<KernelCoreProposalResult> {
    return this.proposeExecutionKernelCoreFunction({
      method: "cancel_pending_policy",
      functionArgs: { policy_id: policyId },
      options,
    });
  }

  async forceActivatePolicy({
    policyId,
    options,
  }: {
    policyId: string;
    options?: NearCallOptions;
  }): Promise<KernelCoreProposalResult> {
    return this.proposeExecutionKernelCoreFunction({
      method: "force_activate_policy",
      functionArgs: { policy_id: policyId },
      options,
    });
  }

  async acquireLock({
    options,
  }: {
    options?: NearCallOptions;
  } = {}): Promise<KernelCoreProposalResult> {
    return this.proposeExecutionKernelCoreFunction({
      method: "acquire_lock",
      functionArgs: {},
      options,
    });
  }

  async releaseLock({
    options,
  }: {
    options?: NearCallOptions;
  } = {}): Promise<KernelCoreProposalResult> {
    return this.proposeExecutionKernelCoreFunction({
      method: "release_lock",
      functionArgs: {},
      options,
    });
  }

  async forceReleaseLock({
    options,
  }: {
    options?: NearCallOptions;
  } = {}): Promise<KernelCoreProposalResult> {
    return this.proposeExecutionKernelCoreFunction({
      method: "force_release_lock",
      functionArgs: {},
      options,
    });
  }

  async forceCompletePendingAction({
    policyId,
    options,
  }: {
    policyId: string;
    options?: NearCallOptions;
  }): Promise<KernelCoreProposalResult> {
    return this.proposeExecutionKernelCoreFunction({
      method: "force_complete_pending_action",
      functionArgs: { policy_id: policyId },
      options,
    });
  }

  async batchUpdatePolicies({
    policies,
    options,
  }: {
    policies: Policy[];
    options?: NearCallOptions;
  }): Promise<KernelCoreProposalResult> {
    return this.proposeExecutionKernelCoreFunction({
      method: "batch_update_policies",
      functionArgs: { policies },
      options,
    });
  }

  /**
   * Sync client policy definitions to the kernel.
   * Fetches all kernel policies, compares them to client policies, and batches updates for
   * missing or changed policies.
   */
  async syncPolicies({
    options,
  }: {
    options?: NearCallOptions;
  } = {}): Promise<{ updatedPolicies: Policy[]; result?: KernelCoreProposalResult }> {
    const totalPolicies = await this.getPolicyCount({ options });
    const pageSize = 100;
    const existingPolicies: Array<[string, Policy]> = [];

    for (let fromIndex = 0; fromIndex < totalPolicies; fromIndex += pageSize) {
      const batch = await this.getAllPolicies({
        fromIndex,
        limit: pageSize,
        options,
      });
      existingPolicies.push(...batch);
      if (batch.length < pageSize) {
        break;
      }
    }

    const existingPolicyMap = new Map(existingPolicies);
    const updates: Policy[] = [];

    for (const policySpec of Object.values(this.policies)) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { builder: _builder, ...policy } = policySpec as Policy & { builder?: unknown };
      const existing = existingPolicyMap.get(policy.id);
      if (!existing || !arePoliciesEqual(policy, existing)) {
        updates.push(policy as Policy);
      }
    }

    if (updates.length === 0) {
      return { updatedPolicies: [] };
    }

    const result = await this.batchUpdatePolicies({ policies: updates, options });
    return { updatedPolicies: updates, result };
  }

  async storeData({
    key,
    value,
    options,
  }: {
    key: string;
    value: string;
    options?: NearCallOptions;
  }): Promise<KernelCoreProposalResult> {
    return this.proposeExecutionKernelCoreFunction({
      method: "store_data",
      functionArgs: { key, value },
      options,
    });
  }

  async batchStoreData({
    keys,
    values,
    options,
  }: {
    keys: string[];
    values: string[];
    options?: NearCallOptions;
  }): Promise<KernelCoreProposalResult> {
    return this.proposeExecutionKernelCoreFunction({
      method: "batch_store_data",
      functionArgs: { keys, values },
      options,
    });
  }

  async getPolicyById({
    policyId,
    options,
  }: {
    policyId: string;
    options?: NearViewOptions;
  }): Promise<Policy | null> {
    return this.viewKernel({
      method: "get_policy_by_id",
      args: { policy_id: policyId },
      options,
    });
  }

  async getAllPolicies({
    fromIndex,
    limit,
    options,
  }: {
    fromIndex?: number;
    limit?: number;
    options?: NearViewOptions;
  } = {}): Promise<Array<[string, Policy]>> {
    return this.viewKernel({
      method: "get_all_policies",
      args: { from_index: fromIndex, limit },
      options,
    });
  }

  async getPendingPolicy({
    policyId,
    options,
  }: {
    policyId: string;
    options?: NearViewOptions;
  }): Promise<Policy | null> {
    return this.viewKernel({
      method: "get_pending_policy",
      args: { policy_id: policyId },
      options,
    });
  }

  async getAllPendingPolicies({
    fromIndex,
    limit,
    options,
  }: {
    fromIndex?: number;
    limit?: number;
    options?: NearViewOptions;
  } = {}): Promise<Array<[string, Policy]>> {
    return this.viewKernel({
      method: "get_all_pending_policies",
      args: { from_index: fromIndex, limit },
      options,
    });
  }

  async getPolicyCount({
    options,
  }: {
    options?: NearViewOptions;
  } = {}): Promise<number> {
    return this.viewKernel({ method: "get_policy_count", args: {}, options });
  }

  private resolveNearProvider({
    options,
  }: {
    options?: NearRpcOptions;
  } = {}): JsonRpcProvider {
    if (options?.nearProvider) {
      return options.nearProvider;
    }
    if (options?.nearRpcUrl) {
      return getNearProvider({ rpcUrl: options.nearRpcUrl });
    }
    if (this.nearProvider) {
      return this.nearProvider;
    }
    if (this.nearRpcUrl) {
      return getNearProvider({ rpcUrl: this.nearRpcUrl });
    }
    const rpcUrl = this.nearRpcUrl ?? "https://rpc.mainnet.near.org";
    return getNearProvider({ rpcUrl });
  }

  private resolveNearWallet({
    options,
  }: {
    options?: NearCallOptions;
  } = {}): NearWallet {
    if (options?.nearWallet) {
      return options.nearWallet;
    }
    return this.getNearAccount();
  }

  private async resolveCallerId({
    options,
  }: {
    options?: NearCallOptions;
  } = {}): Promise<string> {
    if (options?.agent) {
      return options.agent.accountId();
    }
    const account = this.resolveNearWallet({ options });
    return account.accountId;
  }

  private async resolveNearTransactionSigner({
    signer,
    receiverId,
    actions,
    provider,
    options,
  }: {
    signer: NearTransactionSigner;
    receiverId: string;
    actions: Action[];
    provider: JsonRpcProvider;
    options?: NearViewOptions;
  }): Promise<{ signerId: string; publicKey: string; nonce: bigint }> {
    if (signer.type === "Account") {
      const account = signer.nearWallet ?? this.getNearAccount();
      const { publicKey, accessKey } = await account.findAccessKey(receiverId, actions);
      return {
        signerId: account.accountId,
        publicKey: publicKey.toString(),
        nonce: BigInt(accessKey.nonce),
      };
    }

    if (signer.type === "ChainSig") {
      const derived = await this.deriveChainSigAccount({
        chain: "NearWasm",
        derivationPath: signer.derivationPath,
        nearNetwork: signer.nearNetwork,
        options,
      });
      const accessKey = (await provider.query({
        request_type: "view_access_key",
        account_id: derived.address,
        public_key: derived.public_key,
        finality: "final",
      })) as unknown as { nonce: number | string };
      return {
        signerId: derived.address,
        publicKey: derived.public_key,
        nonce: BigInt(accessKey.nonce),
      };
    }

    return {
      signerId: signer.signerId,
      publicKey: signer.publicKey,
      nonce: BigInt(signer.nonce),
    };
  }
}

function isNearTransactionBuildParams(payload: unknown): payload is NearTransactionBuildParams {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const candidate = payload as NearTransactionBuildParams;
  return (
    typeof candidate.receiverId === "string" &&
    Array.isArray(candidate.actions) &&
    typeof candidate.signer === "object" &&
    candidate.signer !== null &&
    "type" in candidate.signer
  );
}

function normalizeNearEncodedTx(encodedTx: string | Uint8Array): string {
  return encodedTx instanceof Uint8Array ? Buffer.from(encodedTx).toString("base64") : encodedTx;
}

function normalizeChainSigEncodedTx({
  encodedTx,
  encoding,
}: {
  encodedTx: string | Uint8Array;
  encoding?: "hex" | "base64";
}): string {
  if (encodedTx instanceof Uint8Array) {
    if (encoding === "base64") {
      return Buffer.from(encodedTx).toString("base64");
    }
    const hex = Buffer.from(encodedTx).toString("hex");
    return `0x${hex}`;
  }

  if (encoding === "base64") {
    return encodedTx;
  }

  if (encoding === "hex") {
    return encodedTx.startsWith("0x") ? encodedTx : `0x${encodedTx}`;
  }

  if (encodedTx.startsWith("0x")) {
    return encodedTx;
  }

  if (isLikelyHex({ value: encodedTx })) {
    return `0x${encodedTx}`;
  }

  return encodedTx;
}

// Decode an encoded NEAR transaction (base64 or hex string / bytes) into a Transaction.
function decodeNearUnsignedTx(
  encodedTx: string | Uint8Array,
  encoding?: ChainSigEncoding
): Transaction {
  const bytes =
    encodedTx instanceof Uint8Array ? encodedTx : decodeNearUnsignedTxString(encodedTx, encoding);
  return Transaction.decode(bytes);
}

function decodeNearUnsignedTxString(encodedTx: string, encoding?: ChainSigEncoding): Uint8Array {
  if (encoding === "hex") {
    const normalized = encodedTx.startsWith("0x") ? encodedTx.slice(2) : encodedTx;
    return Buffer.from(normalized, "hex");
  }
  if (encoding === "base64") {
    return Buffer.from(encodedTx, "base64");
  }
  const normalized = encodedTx.startsWith("0x") ? encodedTx.slice(2) : encodedTx;
  if (encodedTx.startsWith("0x") || isLikelyHex({ value: encodedTx })) {
    return Buffer.from(normalized, "hex");
  }
  return Buffer.from(encodedTx, "base64");
}

function createNearWasmChainSigAdapter({
  provider,
}: {
  provider: JsonRpcProvider;
}): ChainSigTransactionAdapter<Transaction, string> {
  return {
    finalizeTransactionSigning({ transaction, signatures }) {
      const signature = pickEd25519Signature(signatures);
      if (!signature) {
        throw new Error("No Ed25519 signature found for NearWasm ChainSig transaction.");
      }

      const signedTx = new SignedTransaction({
        transaction,
        signature: new Signature({
          keyType: KeyType.ED25519,
          data: Uint8Array.from(signature.signature),
        }),
      });

      return Buffer.from(signedTx.encode()).toString("base64");
    },
    async broadcastTx(signedTx) {
      const { broadcastNearTransaction } = await import("./utils/broadcast.js");
      const outcome = await broadcastNearTransaction({
        rpcUrlOrProvider: provider,
        signedTx,
      });
      return { txHash: outcome.transaction.hash, outcome };
    },
  };
}

function isLikelyHex({ value }: { value: string }): boolean {
  return /^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0;
}

/**
 * Create a new DewClient instance
 */
export function createDewClient<T extends PolicySpecMap>(config: DewClientConfig<T>) {
  return new DewClient(config);
}
