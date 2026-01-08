/**
 * NEAR Intents utilities (deposit / withdraw / swap / policy builders)
 * @packageDocumentation
 */

import Big from "big.js";
import { randomBytes } from "crypto";
import { actionCreators, type Action } from "@near-js/transactions";
import { baseEncode } from "@near-js/utils";
import type {
  ChainEnvironment,
  ChainSigResponse,
  ChainSigSignMethod,
  ChainSigTransactionProposalResult,
  ChainSigProposeOptions,
  NearCallOptions,
  NearTransactionResult,
  NearTransactionBuildParams,
  NearTransactionBuildResult,
  Policy,
  PolicyRestriction,
} from "../types.js";
import { DEFAULT_POLICY_ACTIVATION_TIME, DEFAULT_POLICY_EXPIRY_NS } from "../policy.js";
import { tgasToGas } from "../near/gas.js";
import { waitUntil } from "./wait.js";

const DEFAULT_INTENTS_ACCOUNT = "intents.near";
const ONE_YOCTO = "1";
const DEFAULT_SOLVER_RPC = "https://solver-relay-v2.chaindefuser.com/rpc";
const DEFAULT_BRIDGE_RPC = "https://bridge.chaindefuser.com/rpc";
const DEFAULT_QUOTE_DEADLINE_MS = 120000;
const NONCE_BYTES = 32;
export const DEFAULT_INTENTS_POLICY_EXPIRY_NS = DEFAULT_POLICY_EXPIRY_NS;

export const INTENTS_POLICY_METHODS = [
  "ft_deposit",
  "ft_withdraw_to_near",
  "ft_withdraw_to_evm",
  "erc20_transfer_to_intents",
  "intents_swap",
] as const;

export type IntentsPolicyMethod = (typeof INTENTS_POLICY_METHODS)[number];

export type IntentsPolicyIdMap = Partial<Record<IntentsPolicyMethod, string>>;

export const DEFAULT_INTENTS_ERC20_TRANSFER_INTERFACE = Buffer.from(
  JSON.stringify([
    {
      type: "function",
      name: "transfer",
      stateMutability: "nonpayable",
      inputs: [
        { name: "to", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      outputs: [{ name: "", type: "bool" }],
    },
  ])
).toString("base64");

export function createIntentsPolicyIdMap({
  policyIds,
  policyIdPrefix,
}: {
  policyIds?: IntentsPolicyIdMap;
  policyIdPrefix?: string;
} = {}): Record<IntentsPolicyMethod, string> {
  const map = {} as Record<IntentsPolicyMethod, string>;
  for (const method of INTENTS_POLICY_METHODS) {
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

type Bigish = string | number;

type ProposeChainSigTransactionResult = ChainSigTransactionProposalResult;

type ViewOptions = { nearProvider?: unknown; nearRpcUrl?: string };

export type DepositToIntentsResult = ProposeChainSigTransactionResult & {
  amount: string;
  receiverId: string;
};

export type WithdrawFromIntentsResult = ProposeChainSigTransactionResult & {
  amount: string;
  intentsAccountId: string;
  destination: string;
  waitedBalance?: Big;
};

type IntentsSwapQuote = {
  amount_in: string;
  amount_out: string;
  defuse_asset_identifier_in: string;
  defuse_asset_identifier_out: string;
  expiration_time: string;
  quote_hash: string;
};

interface NearIntentsSwapMessage {
  signer_id: string;
  deadline: string;
  intents: Array<{
    intent: "token_diff";
    diff: Record<string, string>;
    referral?: string | null;
  }>;
}

type NearIntentsNEP413Payload = {
  nonce: number[];
  recipient: string;
  message: string;
  callback_url?: string | null;
};

export interface IntentsSwapResult {
  quote: {
    amount_in: string;
    amount_out: string;
    defuse_asset_identifier_in: string;
    defuse_asset_identifier_out: string;
    expiration_time: string;
    quote_hash: string;
  };
  intentHash: string;
  signature: string;
  intentPayload: {
    nonce: number[];
    recipient: string;
    message: string;
    callback_url?: string | null;
  };
  derivedAccount: { public_key: string; address: string };
  outcome: NearTransactionResult;
  amountIn: string;
  intentsAccountId: string;
  fromIntentsTokenId: string;
  toIntentsTokenId: string;
  swappedAmount?: string;
}

function resolvePolicyId({
  method,
  policyId,
  policyIdPrefix,
}: {
  method: IntentsPolicyMethod;
  policyId?: string;
  policyIdPrefix?: string;
}): string {
  if (policyId) {
    return policyId;
  }
  if (policyIdPrefix) {
    return `${policyIdPrefix}${method}`;
  }
  return method;
}

function resolvePolicyMeta({
  method,
  policyId,
  policyIdPrefix,
  description,
  activationTime,
  proposalExpiryTimeNanosec,
  requiredPendingActions,
}: {
  method: IntentsPolicyMethod;
  policyId?: string;
  policyIdPrefix?: string;
  description?: string;
  activationTime?: string;
  proposalExpiryTimeNanosec?: string;
  requiredPendingActions?: string[];
}): {
  policyId: string;
  description: string;
  activationTime: string;
  proposalExpiryTimeNanosec: string;
  requiredPendingActions: string[];
} {
  return {
    policyId: resolvePolicyId({ method, policyId, policyIdPrefix }),
    description: description ?? `Intents policy for ${method}`,
    activationTime: activationTime ?? DEFAULT_POLICY_ACTIVATION_TIME,
    proposalExpiryTimeNanosec: proposalExpiryTimeNanosec ?? DEFAULT_INTENTS_POLICY_EXPIRY_NS,
    requiredPendingActions: requiredPendingActions ?? [],
  };
}

function stripNep141Prefix({ tokenId }: { tokenId: string }): string {
  return tokenId.replace(/^nep141:/, "");
}

function buildChainSigTransactionPolicy(params: {
  policyId: string;
  description: string;
  requiredRole: string;
  requiredVoteCount: number;
  derivationPath: string;
  chainEnvironment: ChainEnvironment;
  restrictions: PolicyRestriction[];
  activationTime: string;
  proposalExpiryTimeNanosec: string;
  requiredPendingActions: string[];
}): Policy {
  return {
    id: params.policyId,
    description: params.description,
    required_role: params.requiredRole,
    required_vote_count: params.requiredVoteCount,
    policy_type: "ChainSigTransaction",
    policy_details: {
      ChainSigTransaction: {
        derivation_path: params.derivationPath,
        chain_environment: params.chainEnvironment,
        restrictions: params.restrictions,
      },
    },
    activation_time: params.activationTime,
    proposal_expiry_time_nanosec: params.proposalExpiryTimeNanosec,
    required_pending_actions: params.requiredPendingActions,
  };
}

function buildChainSigMessagePolicy(params: {
  policyId: string;
  description: string;
  requiredRole: string;
  requiredVoteCount: number;
  derivationPath: string;
  signMethod: ChainSigSignMethod;
  activationTime: string;
  proposalExpiryTimeNanosec: string;
  requiredPendingActions: string[];
}): Policy {
  return {
    id: params.policyId,
    description: params.description,
    required_role: params.requiredRole,
    required_vote_count: params.requiredVoteCount,
    policy_type: "ChainSigMessage",
    policy_details: {
      ChainSigMessage: {
        derivation_path: params.derivationPath,
        sign_method: params.signMethod,
      },
    },
    activation_time: params.activationTime,
    proposal_expiry_time_nanosec: params.proposalExpiryTimeNanosec,
    required_pending_actions: params.requiredPendingActions,
  };
}

export function createIntentsFtDepositPolicy({
  requiredRole,
  requiredVoteCount,
  derivationPath,
  policyId,
  policyIdPrefix,
  description,
  activationTime,
  proposalExpiryTimeNanosec,
  requiredPendingActions,
  tokenId,
  intentsAccountId,
  msg,
  chainEnvironment,
}: {
  requiredRole: string;
  requiredVoteCount: number;
  derivationPath: string;
  policyId?: string;
  policyIdPrefix?: string;
  description?: string;
  activationTime?: string;
  proposalExpiryTimeNanosec?: string;
  requiredPendingActions?: string[];
  tokenId: string;
  intentsAccountId?: string;
  msg?: string;
  chainEnvironment?: ChainEnvironment;
}): Policy {
  const method: IntentsPolicyMethod = "ft_deposit";
  const meta = resolvePolicyMeta({
    method,
    policyId,
    policyIdPrefix,
    description,
    activationTime,
    proposalExpiryTimeNanosec,
    requiredPendingActions,
  });
  const resolvedIntentsAccountId = intentsAccountId ?? DEFAULT_INTENTS_ACCOUNT;
  const resolvedTokenId = stripNep141Prefix({ tokenId });
  const resolvedMsg = msg ?? "";
  const resolvedChainEnvironment = chainEnvironment ?? "NearWasm";

  const restrictions: PolicyRestriction[] = [
    {
      schema: `and(
        $.contract_id.equal("${resolvedTokenId}"),
        $.function_name.equal("ft_transfer_call"),
        $.args.receiver_id.equal("${resolvedIntentsAccountId}"),
        $.args.msg.equal("${resolvedMsg}")
    )`,
      interface: "",
    },
  ];

  return buildChainSigTransactionPolicy({
    ...meta,
    requiredRole,
    requiredVoteCount,
    derivationPath,
    chainEnvironment: resolvedChainEnvironment,
    restrictions,
  });
}

export function createIntentsFtWithdrawToNearPolicy({
  requiredRole,
  requiredVoteCount,
  derivationPath,
  policyId,
  policyIdPrefix,
  description,
  activationTime,
  proposalExpiryTimeNanosec,
  requiredPendingActions,
  tokenId,
  intentsAccountId,
  chainEnvironment,
}: {
  requiredRole: string;
  requiredVoteCount: number;
  derivationPath: string;
  policyId?: string;
  policyIdPrefix?: string;
  description?: string;
  activationTime?: string;
  proposalExpiryTimeNanosec?: string;
  requiredPendingActions?: string[];
  tokenId: string;
  intentsAccountId?: string;
  chainEnvironment?: ChainEnvironment;
}): Policy {
  const method: IntentsPolicyMethod = "ft_withdraw_to_near";
  const meta = resolvePolicyMeta({
    method,
    policyId,
    policyIdPrefix,
    description,
    activationTime,
    proposalExpiryTimeNanosec,
    requiredPendingActions,
  });
  const resolvedIntentsAccountId = intentsAccountId ?? DEFAULT_INTENTS_ACCOUNT;
  const resolvedTokenId = stripNep141Prefix({ tokenId });
  const resolvedChainEnvironment = chainEnvironment ?? "NearWasm";

  const restrictions: PolicyRestriction[] = [
    {
      schema: `and(
        $.contract_id.equal("${resolvedIntentsAccountId}"),
        $.function_name.equal("ft_withdraw"),
        $.args.receiver_id.equal(chain_sig_address("${derivationPath}","NearWasm")),
        $.args.token.equal("${resolvedTokenId}"),
        $.args.memo.case_insensitive_equal(concat("WITHDRAW_TO:",chain_sig_address("${derivationPath}","NearWasm")))
    )`,
      interface: "",
    },
  ];

  return buildChainSigTransactionPolicy({
    ...meta,
    requiredRole,
    requiredVoteCount,
    derivationPath,
    chainEnvironment: resolvedChainEnvironment,
    restrictions,
  });
}

export function createIntentsFtWithdrawToEvmPolicy({
  requiredRole,
  requiredVoteCount,
  derivationPath,
  policyId,
  policyIdPrefix,
  description,
  activationTime,
  proposalExpiryTimeNanosec,
  requiredPendingActions,
  intentsTokenId,
  intentsAccountId,
  chainEnvironment,
}: {
  requiredRole: string;
  requiredVoteCount: number;
  derivationPath: string;
  policyId?: string;
  policyIdPrefix?: string;
  description?: string;
  activationTime?: string;
  proposalExpiryTimeNanosec?: string;
  requiredPendingActions?: string[];
  intentsTokenId: string;
  intentsAccountId?: string;
  chainEnvironment?: ChainEnvironment;
}): Policy {
  const method: IntentsPolicyMethod = "ft_withdraw_to_evm";
  const meta = resolvePolicyMeta({
    method,
    policyId,
    policyIdPrefix,
    description,
    activationTime,
    proposalExpiryTimeNanosec,
    requiredPendingActions,
  });
  const resolvedIntentsAccountId = intentsAccountId ?? DEFAULT_INTENTS_ACCOUNT;
  const resolvedIntentsTokenId = stripNep141Prefix({ tokenId: intentsTokenId });
  const resolvedChainEnvironment = chainEnvironment ?? "NearWasm";

  const restrictions: PolicyRestriction[] = [
    {
      schema: `and(
        $.contract_id.equal("${resolvedIntentsAccountId}"),
        $.function_name.equal("ft_withdraw"),
        $.args.receiver_id.equal("${resolvedIntentsTokenId}"),
        $.args.token.equal("${resolvedIntentsTokenId}"),
        $.args.memo.case_insensitive_equal(concat("WITHDRAW_TO:",chain_sig_address("${derivationPath}","EVM")))
    )`,
      interface: "",
    },
  ];

  return buildChainSigTransactionPolicy({
    ...meta,
    requiredRole,
    requiredVoteCount,
    derivationPath,
    chainEnvironment: resolvedChainEnvironment,
    restrictions,
  });
}

export function createIntentsErc20TransferToIntentsPolicy({
  requiredRole,
  requiredVoteCount,
  derivationPath,
  policyId,
  policyIdPrefix,
  description,
  activationTime,
  proposalExpiryTimeNanosec,
  requiredPendingActions,
  tokenAddress,
  intentsDepositAddress,
  chainEnvironment,
  interfaceBase64,
}: {
  requiredRole: string;
  requiredVoteCount: number;
  derivationPath: string;
  policyId?: string;
  policyIdPrefix?: string;
  description?: string;
  activationTime?: string;
  proposalExpiryTimeNanosec?: string;
  requiredPendingActions?: string[];
  tokenAddress: string;
  intentsDepositAddress: string;
  chainEnvironment?: ChainEnvironment;
  interfaceBase64?: string;
}): Policy {
  const method: IntentsPolicyMethod = "erc20_transfer_to_intents";
  const meta = resolvePolicyMeta({
    method,
    policyId,
    policyIdPrefix,
    description,
    activationTime,
    proposalExpiryTimeNanosec,
    requiredPendingActions,
  });
  const resolvedChainEnvironment = chainEnvironment ?? "EVM";
  const iface = interfaceBase64 ?? DEFAULT_INTENTS_ERC20_TRANSFER_INTERFACE;

  const restrictions: PolicyRestriction[] = [
    {
      schema: `and(
        $.contract_id.equal("${tokenAddress}"),
        $.function_name.equal("transfer"),
        $.args.to.case_insensitive_equal("${intentsDepositAddress}")
    )`,
      interface: iface,
    },
  ];

  return buildChainSigTransactionPolicy({
    ...meta,
    requiredRole,
    requiredVoteCount,
    derivationPath,
    chainEnvironment: resolvedChainEnvironment,
    restrictions,
  });
}

export function createIntentsSwapPolicy({
  requiredRole,
  requiredVoteCount,
  derivationPath,
  policyId,
  policyIdPrefix,
  description,
  activationTime,
  proposalExpiryTimeNanosec,
  requiredPendingActions,
  signMethod,
}: {
  requiredRole: string;
  requiredVoteCount: number;
  derivationPath: string;
  policyId?: string;
  policyIdPrefix?: string;
  description?: string;
  activationTime?: string;
  proposalExpiryTimeNanosec?: string;
  requiredPendingActions?: string[];
  signMethod?: ChainSigSignMethod;
}): Policy {
  const method: IntentsPolicyMethod = "intents_swap";
  const meta = resolvePolicyMeta({
    method,
    policyId,
    policyIdPrefix,
    description,
    activationTime,
    proposalExpiryTimeNanosec,
    requiredPendingActions,
  });
  const resolvedSignMethod = signMethod ?? "NearIntentsSwap";

  return buildChainSigMessagePolicy({
    ...meta,
    requiredRole,
    requiredVoteCount,
    derivationPath,
    signMethod: resolvedSignMethod,
  });
}

function toAmount({ value }: { value: Bigish }): string {
  return new Big(value).toString();
}

function buildFunctionCall({
  method,
  args,
  gasTgas,
  depositYocto,
}: {
  method: string;
  args: Record<string, unknown>;
  gasTgas: number;
  depositYocto: string;
}): Action {
  const gas = tgasToGas(gasTgas);
  const deposit = BigInt(depositYocto);
  return actionCreators.functionCall(method, Buffer.from(JSON.stringify(args)), gas, deposit);
}

function normalizeNonce({ nonce }: { nonce?: Uint8Array | number[] }): number[] {
  const bytes = nonce
    ? nonce instanceof Uint8Array
      ? Array.from(nonce)
      : [...nonce]
    : Array.from(randomBytes(NONCE_BYTES));
  if (bytes.length !== NONCE_BYTES) {
    throw new Error(`Nonce must be ${NONCE_BYTES} bytes`);
  }
  return bytes;
}

function buildIntentsSwapMessage({
  signerId,
  quote,
  referral,
}: {
  signerId: string;
  quote: IntentsSwapQuote;
  referral?: string | null;
}): NearIntentsSwapMessage {
  const diff: Record<string, string> = {
    [quote.defuse_asset_identifier_in]: `-${quote.amount_in}`,
    [quote.defuse_asset_identifier_out]: quote.amount_out,
  };
  const intent = {
    intent: "token_diff" as const,
    diff,
    ...(referral != null ? { referral } : {}),
  };
  return {
    signer_id: signerId,
    deadline: quote.expiration_time,
    intents: [intent],
  };
}

function buildIntentsNep413Payload({
  signerId,
  recipient,
  quote,
  nonce,
  referral,
  callbackUrl,
}: {
  signerId: string;
  recipient: string;
  quote: IntentsSwapQuote;
  nonce?: Uint8Array | number[];
  referral?: string | null;
  callbackUrl?: string | null;
}): NearIntentsNEP413Payload {
  const message = buildIntentsSwapMessage({
    signerId,
    quote,
    referral,
  });
  return {
    nonce: normalizeNonce({ nonce }),
    recipient,
    message: JSON.stringify(message),
    ...(callbackUrl != null ? { callback_url: callbackUrl } : {}),
  };
}

function isChainSigResponse({ value }: { value: unknown }): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const scheme = (value as { scheme?: unknown }).scheme;
  if (scheme === "Ed25519") {
    return Array.isArray((value as { signature?: unknown }).signature);
  }
  if (scheme === "Secp256k1") {
    const typed = value as {
      big_r?: { affine_point?: unknown };
      s?: { scalar?: unknown };
      recovery_id?: unknown;
    };
    return (
      typeof typed.big_r?.affine_point === "string" &&
      typeof typed.s?.scalar === "string" &&
      typeof typed.recovery_id === "number"
    );
  }
  return false;
}

function collectChainSigResponses({
  value,
  responses,
}: {
  value: unknown;
  responses: ChainSigResponse[];
}): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectChainSigResponses({ value: item, responses });
    }
    return;
  }
  if (isChainSigResponse({ value })) {
    responses.push(value as ChainSigResponse);
  }
}

function extractChainSigResponses({
  outcome,
}: {
  outcome: NearTransactionResult;
}): ChainSigResponse[] {
  const responses: ChainSigResponse[] = [];

  for (const receipt of outcome.receipts_outcome) {
    for (const log of receipt.outcome.logs) {
      try {
        const parsed = JSON.parse(log);
        collectChainSigResponses({ value: parsed, responses });
      } catch {
        // Ignore non-JSON logs
      }
    }

    const status = receipt.outcome.status as { SuccessValue?: string };
    if (status && typeof status.SuccessValue === "string") {
      try {
        const decoded = Buffer.from(status.SuccessValue, "base64").toString();
        if (decoded) {
          const parsed = JSON.parse(decoded);
          collectChainSigResponses({ value: parsed, responses });
        }
      } catch {
        // Ignore non-JSON return values
      }
    }
  }

  return responses;
}

function extractEd25519Signature({
  responses,
}: {
  responses: ChainSigResponse[];
}): number[] | null {
  for (const response of responses) {
    if (response.scheme === "Ed25519") {
      return response.signature;
    }
  }
  return null;
}

function formatEd25519Signature({
  signature,
}: {
  signature: Uint8Array | number[] | string;
}): string {
  if (typeof signature === "string") {
    return signature.startsWith("ed25519:") ? signature : `ed25519:${signature}`;
  }
  const bytes = signature instanceof Uint8Array ? signature : Uint8Array.from(signature);
  const encoded = baseEncode(bytes);
  return `ed25519:${encoded}`;
}

async function getIntentsMtBalance({
  client,
  intentsAccountId,
  accountId,
  tokenId,
  options,
}: {
  client: {
    viewFunction: <T>(params: {
      accountId: string;
      method: string;
      args: Record<string, unknown>;
      options?: ViewOptions;
    }) => Promise<T>;
  };
  intentsAccountId: string;
  accountId: string;
  tokenId: string;
  options?: ViewOptions;
}): Promise<bigint> {
  const result = await client.viewFunction<string>({
    accountId: intentsAccountId,
    method: "mt_balance_of",
    args: { account_id: accountId, token_id: tokenId },
    options,
  });
  return BigInt(result ?? "0");
}

/**
 * Deposit NEP-141 FT into intents.near via kernel proposal
 */
export async function depositToIntents({
  client,
  policyId,
  derivationPath,
  tokenId,
  amount,
  receiverId,
  msg,
  gasTgas,
  depositYocto,
  callOptions,
  nearNetwork,
}: {
  client: {
    buildNearTransaction: (
      params: NearTransactionBuildParams
    ) => Promise<NearTransactionBuildResult>;
    proposeChainSigTransaction: (params: {
      policyId: string;
      encodedTx: string | Uint8Array;
      options?: ChainSigProposeOptions;
    }) => Promise<ProposeChainSigTransactionResult>;
  };
  policyId: string;
  derivationPath: string;
  tokenId: string;
  amount: Bigish;
  receiverId?: string;
  msg?: string;
  gasTgas?: number;
  depositYocto?: string;
  callOptions?: ChainSigProposeOptions;
  nearNetwork?: "Mainnet" | "Testnet";
}): Promise<DepositToIntentsResult> {
  const resolvedReceiverId = receiverId ?? DEFAULT_INTENTS_ACCOUNT;
  const resolvedAmount = toAmount({ value: amount });
  const resolvedGasTgas = gasTgas ?? 50;
  const resolvedDepositYocto = depositYocto ?? ONE_YOCTO;
  const resolvedMsg = msg ?? "";

  const action = buildFunctionCall({
    method: "ft_transfer_call",
    args: { receiver_id: resolvedReceiverId, amount: resolvedAmount, msg: resolvedMsg },
    gasTgas: resolvedGasTgas,
    depositYocto: resolvedDepositYocto,
  });

  const { encodedTx } = await client.buildNearTransaction({
    receiverId: tokenId,
    actions: [action],
    signer: {
      type: "ChainSig",
      derivationPath,
      nearNetwork,
    },
    options: callOptions,
  });

  const result = await client.proposeChainSigTransaction({
    policyId,
    encodedTx,
    options: { ...callOptions, encoding: "base64" },
  });

  return { ...result, amount: resolvedAmount, receiverId: resolvedReceiverId };
}

/**
 * Withdraw NEP-141 FT from intents.near to a destination, optionally waiting for balance arrival
 */
export async function withdrawFromIntents({
  client,
  policyId,
  derivationPath,
  tokenId,
  amount,
  destination,
  intentsAccountId,
  memo,
  gasTgas,
  depositYocto,
  callOptions,
  waitForBalance,
  nearNetwork,
}: {
  client: {
    buildNearTransaction: (
      params: NearTransactionBuildParams
    ) => Promise<NearTransactionBuildResult>;
    proposeChainSigTransaction: (params: {
      policyId: string;
      encodedTx: string | Uint8Array;
      options?: ChainSigProposeOptions;
    }) => Promise<ProposeChainSigTransactionResult>;
  };
  policyId: string;
  derivationPath: string;
  tokenId: string;
  amount: Bigish;
  destination: string;
  intentsAccountId?: string;
  memo?: string;
  gasTgas?: number;
  depositYocto?: string;
  callOptions?: ChainSigProposeOptions;
  waitForBalance?: {
    getBalance: () => Promise<Big>;
    initialBalance?: Bigish;
    intervalMs?: number;
    timeoutMs?: number;
  };
  nearNetwork?: "Mainnet" | "Testnet";
}): Promise<WithdrawFromIntentsResult> {
  const resolvedIntentsAccountId = intentsAccountId ?? DEFAULT_INTENTS_ACCOUNT;
  const resolvedAmount = toAmount({ value: amount });
  const resolvedGasTgas = gasTgas ?? 30;
  const resolvedDepositYocto = depositYocto ?? ONE_YOCTO;
  const resolvedMemo = memo ?? `WITHDRAW_TO:${destination}`;
  const token = tokenId.replace(/^nep141:/, "");

  const action = buildFunctionCall({
    method: "ft_withdraw",
    args: {
      token,
      receiver_id: destination,
      amount: resolvedAmount,
      memo: resolvedMemo,
    },
    gasTgas: resolvedGasTgas,
    depositYocto: resolvedDepositYocto,
  });

  const { encodedTx } = await client.buildNearTransaction({
    receiverId: resolvedIntentsAccountId,
    actions: [action],
    signer: {
      type: "ChainSig",
      derivationPath,
      nearNetwork,
    },
    options: callOptions,
  });

  const result = await client.proposeChainSigTransaction({
    policyId,
    encodedTx,
    options: { ...callOptions, encoding: "base64" },
  });

  let waitedBalance: Big | undefined;

  if (waitForBalance) {
    const baseline = waitForBalance.initialBalance
      ? new Big(waitForBalance.initialBalance)
      : await waitForBalance.getBalance();

    const intervalMs = waitForBalance.intervalMs ?? 5000;
    const timeoutMs = waitForBalance.timeoutMs ?? 300000;

    await waitUntil({
      predicate: async () => {
        const current = await waitForBalance.getBalance();
        if (current.gt(baseline)) {
          waitedBalance = current;
          return true;
        }
        return false;
      },
      intervalMs,
      timeoutMs,
      timeoutMessage: "Withdraw did not arrive before timeout",
    });
  }

  return {
    ...result,
    amount: resolvedAmount,
    intentsAccountId: resolvedIntentsAccountId,
    destination,
    waitedBalance,
  };
}

/**
 * Get an intents bridge deposit address for a given chain
 */
export async function getBridgeDepositAddress({
  accountId,
  chainType,
  chainId,
  rpcUrl,
}: {
  accountId: string;
  chainType: string;
  chainId: number;
  rpcUrl?: string;
}): Promise<string> {
  const response = await fetch(rpcUrl ?? DEFAULT_BRIDGE_RPC, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "deposit_address",
      params: [
        {
          account_id: accountId,
          chain: `${chainType}:${chainId}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Bridge deposit address error: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { result?: { address: string }; error?: unknown };
  if (!data.result?.address) {
    throw new Error("Bridge deposit address response missing address");
  }

  return data.result.address;
}

/**
 * Get an intents swap quote from the solver relay
 */
async function getIntentsSwapQuote({
  assetIn,
  assetOut,
  exactAmountIn,
  minDeadlineMs,
  rpcUrl,
}: {
  assetIn: string;
  assetOut: string;
  exactAmountIn: Bigish;
  minDeadlineMs?: number;
  rpcUrl?: string;
}): Promise<IntentsSwapQuote> {
  const response = await fetch(rpcUrl ?? DEFAULT_SOLVER_RPC, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "quote",
      params: [
        {
          defuse_asset_identifier_in: assetIn,
          defuse_asset_identifier_out: assetOut,
          exact_amount_in: toAmount({ value: exactAmountIn }),
          min_deadline_ms: minDeadlineMs ?? DEFAULT_QUOTE_DEADLINE_MS,
        },
      ],
      id: 1,
    }),
  });

  if (!response.ok) {
    throw new Error(`Quote error: HTTP ${response.status}`);
  }

  const data = (await response.json()) as
    | { result: IntentsSwapQuote[] }
    | { error: { message?: string } | string };

  if ("error" in data) {
    const message = typeof data.error === "string" ? data.error : data.error?.message;
    throw new Error(message ? `Quote error: ${message}` : "Quote error");
  }

  const firstQuote = data.result[0];
  if (!firstQuote) {
    throw new Error("Unable to get any quote");
  }

  return firstQuote;
}

/**
 * Publish an intents swap message to the solver relay
 */
async function publishIntentsSwap({
  intentPayload,
  signature,
  publicKey,
  quoteHashes,
  rpcUrl,
}: {
  intentPayload: NearIntentsNEP413Payload;
  signature: Uint8Array | number[] | string;
  publicKey: string;
  quoteHashes: string[];
  rpcUrl?: string;
}): Promise<string> {
  const resolvedSignature = formatEd25519Signature({ signature });
  const response = await fetch(rpcUrl ?? DEFAULT_SOLVER_RPC, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "publish_intent",
      params: [
        {
          quote_hashes: quoteHashes,
          signed_data: {
            standard: "nep413",
            payload: {
              message: intentPayload.message,
              nonce: Buffer.from(intentPayload.nonce).toString("base64"),
              recipient: intentPayload.recipient,
              ...(intentPayload.callback_url != null
                ? { callback_url: intentPayload.callback_url }
                : {}),
            },
            signature: resolvedSignature,
            public_key: publicKey,
          },
        },
      ],
      id: 2,
    }),
  });

  if (!response.ok) {
    throw new Error(`Intent publishing error: HTTP ${response.status}`);
  }

  const data = (await response.json()) as
    | { result: { intent_hash: string } }
    | { error: { message?: string } };

  if ("error" in data) {
    throw new Error(data.error?.message ?? "Intent publishing failed");
  }

  return data.result.intent_hash;
}

/**
 * Execute an intents swap: quote -> sign -> publish -> optional balance wait
 */
export async function swapViaIntents({
  client,
  policyId,
  derivationPath,
  fromIntentsTokenId,
  toIntentsTokenId,
  amountIn,
  intentsAccountId,
  nearNetwork,
  minDeadlineMs,
  quote,
  nonce,
  referral,
  callbackUrl,
  callOptions,
  viewOptions,
  solverRpcUrl,
  waitForBalance,
}: {
  client: {
    proposeExecution: (params: {
      policyId: string;
      functionArgs: Record<string, unknown> | string;
      options?: NearCallOptions;
    }) => Promise<NearTransactionResult>;
    viewFunction: <T>(params: {
      accountId: string;
      method: string;
      args: Record<string, unknown>;
      options?: ViewOptions;
    }) => Promise<T>;
    deriveChainSigAccount: (params: {
      chain: "EVM" | "SVM" | "NearWasm";
      derivationPath: string;
      nearNetwork?: "Mainnet" | "Testnet";
      options?: ViewOptions;
    }) => Promise<{ public_key: string; address: string }>;
  };
  policyId: string;
  derivationPath: string;
  fromIntentsTokenId: string;
  toIntentsTokenId: string;
  amountIn: Bigish;
  intentsAccountId?: string;
  nearNetwork?: "Mainnet" | "Testnet";
  minDeadlineMs?: number;
  quote?: {
    amount_in: string;
    amount_out: string;
    defuse_asset_identifier_in: string;
    defuse_asset_identifier_out: string;
    expiration_time: string;
    quote_hash: string;
  };
  nonce?: Uint8Array | number[];
  referral?: string | null;
  callbackUrl?: string | null;
  callOptions?: NearCallOptions;
  viewOptions?: ViewOptions;
  solverRpcUrl?: string;
  waitForBalance?: {
    initialBalance?: Bigish;
    intervalMs?: number;
    timeoutMs?: number;
  };
}): Promise<IntentsSwapResult> {
  const resolvedIntentsAccountId = intentsAccountId ?? DEFAULT_INTENTS_ACCOUNT;
  const resolvedAmountIn = toAmount({ value: amountIn });

  const resolvedQuote =
    quote ??
    (await getIntentsSwapQuote({
      assetIn: fromIntentsTokenId,
      assetOut: toIntentsTokenId,
      exactAmountIn: resolvedAmountIn,
      minDeadlineMs,
      rpcUrl: solverRpcUrl,
    }));

  const derivedAccount = await client.deriveChainSigAccount({
    chain: "NearWasm",
    derivationPath,
    nearNetwork,
    options: viewOptions,
  });

  const intentPayload = buildIntentsNep413Payload({
    signerId: derivedAccount.address,
    recipient: resolvedIntentsAccountId,
    quote: resolvedQuote,
    nonce,
    referral: referral ?? null,
    callbackUrl: callbackUrl ?? null,
  });

  const outcome = await client.proposeExecution({
    policyId,
    functionArgs: JSON.stringify(intentPayload),
    options: callOptions,
  });

  const responses = extractChainSigResponses({ outcome });
  const signatureBytes = extractEd25519Signature({ responses });
  if (!signatureBytes) {
    throw new Error("No Ed25519 signature returned; proposal may require voting.");
  }

  const signature = baseEncode(Uint8Array.from(signatureBytes));

  const intentHash = await publishIntentsSwap({
    intentPayload,
    signature,
    publicKey: derivedAccount.public_key,
    quoteHashes: [resolvedQuote.quote_hash],
    rpcUrl: solverRpcUrl,
  });

  let swappedAmount: string | undefined;
  if (waitForBalance) {
    const baseline = waitForBalance.initialBalance
      ? BigInt(waitForBalance.initialBalance.toString())
      : await getIntentsMtBalance({
          client,
          intentsAccountId: resolvedIntentsAccountId,
          accountId: derivedAccount.address,
          tokenId: toIntentsTokenId,
          options: viewOptions,
        });

    const intervalMs = waitForBalance.intervalMs ?? 5000;
    const timeoutMs = waitForBalance.timeoutMs ?? 180000;

    await waitUntil({
      predicate: async () => {
        const current = await getIntentsMtBalance({
          client,
          intentsAccountId: resolvedIntentsAccountId,
          accountId: derivedAccount.address,
          tokenId: toIntentsTokenId,
          options: viewOptions,
        });
        if (current > baseline) {
          swappedAmount = (current - baseline).toString();
          return true;
        }
        return false;
      },
      intervalMs,
      timeoutMs,
      timeoutMessage: "Intents swap did not settle before timeout",
    });
  }

  return {
    quote: resolvedQuote,
    intentHash,
    signature,
    intentPayload,
    derivedAccount,
    outcome,
    amountIn: resolvedAmountIn,
    intentsAccountId: resolvedIntentsAccountId,
    fromIntentsTokenId,
    toIntentsTokenId,
    swappedAmount,
  };
}
