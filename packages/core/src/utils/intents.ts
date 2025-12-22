/**
 * NEAR Intents utilities (deposit / withdraw / swap / policy builders)
 * @packageDocumentation
 */

import Big from "big.js";
import { randomBytes } from "crypto";
import { transactions, utils } from "near-api-js";
import type {
  ChainEnvironment,
  ChainSigResponse,
  ChainSigSignMethod,
  NearCallOptions,
  NearTransactionResult,
  Policy,
  PolicyRestriction,
} from "../types.js";
import { DEFAULT_POLICY_ACTIVATION_TIME, DEFAULT_POLICY_EXPIRY_NS } from "../policy.js";
import { waitUntil } from "./wait.js";

const TGAS_TO_GAS = 1_000_000_000_000n;
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

export interface IntentsPolicyIdMapParams {
  policyIds?: IntentsPolicyIdMap;
  policyIdPrefix?: string;
}

export function createIntentsPolicyIdMap(
  params: IntentsPolicyIdMapParams = {}
): Record<IntentsPolicyMethod, string> {
  const map = {} as Record<IntentsPolicyMethod, string>;
  for (const method of INTENTS_POLICY_METHODS) {
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

interface IntentsPolicyBaseParams {
  requiredRole: string;
  requiredVoteCount: number;
  derivationPath: string;
  policyId?: string;
  policyIdPrefix?: string;
  description?: string;
  activationTime?: string;
  proposalExpiryTimeNanosec?: string;
  requiredPendingActions?: string[];
}

export interface IntentsFtDepositPolicyParams extends IntentsPolicyBaseParams {
  tokenId: string;
  intentsAccountId?: string;
  msg?: string;
  chainEnvironment?: ChainEnvironment;
}

export interface IntentsFtWithdrawToNearPolicyParams extends IntentsPolicyBaseParams {
  tokenId: string;
  intentsAccountId?: string;
  chainEnvironment?: ChainEnvironment;
}

export interface IntentsFtWithdrawToEvmPolicyParams extends IntentsPolicyBaseParams {
  intentsTokenId: string;
  intentsAccountId?: string;
  chainEnvironment?: ChainEnvironment;
}

export interface IntentsErc20TransferToIntentsPolicyParams extends IntentsPolicyBaseParams {
  tokenAddress: string;
  intentsDepositAddress: string;
  chainEnvironment?: ChainEnvironment;
  interfaceBase64?: string;
}

export interface IntentsSwapPolicyParams extends IntentsPolicyBaseParams {
  signMethod?: ChainSigSignMethod;
}

type Bigish = string | number;

type ProposeNearActionsResult = {
  executed: boolean;
  proposalId: number;
  outcome: NearTransactionResult;
};

type ViewOptions = { nearProvider?: unknown; nearRpcUrl?: string };

export interface DepositToIntentsParams {
  client: {
    proposeNearActions: (
      policyId: string,
      receiverId: string,
      actions: transactions.Action[],
      options?: NearCallOptions
    ) => Promise<ProposeNearActionsResult>;
  };
  policyId: string;
  tokenId: string;
  amount: Bigish;
  receiverId?: string;
  msg?: string;
  gasTgas?: number;
  depositYocto?: string;
  callOptions?: NearCallOptions;
}

export interface DepositToIntentsResult extends ProposeNearActionsResult {
  amount: string;
  receiverId: string;
}

export interface WithdrawFromIntentsParams {
  client: {
    proposeNearActions: (
      policyId: string,
      receiverId: string,
      actions: transactions.Action[],
      options?: NearCallOptions
    ) => Promise<ProposeNearActionsResult>;
  };
  policyId: string;
  tokenId: string;
  amount: Bigish;
  destination: string;
  intentsAccountId?: string;
  memo?: string;
  gasTgas?: number;
  depositYocto?: string;
  callOptions?: NearCallOptions;
  waitForBalance?: {
    getBalance: () => Promise<Big>;
    initialBalance?: Bigish;
    intervalMs?: number;
    timeoutMs?: number;
  };
}

export interface WithdrawFromIntentsResult extends ProposeNearActionsResult {
  amount: string;
  intentsAccountId: string;
  destination: string;
  waitedBalance?: Big;
}

type IntentsSwapQuote = {
  amount_in: string;
  amount_out: string;
  defuse_asset_identifier_in: string;
  defuse_asset_identifier_out: string;
  expiration_time: string;
  quote_hash: string;
};

interface IntentsSwapQuoteParams {
  assetIn: string;
  assetOut: string;
  exactAmountIn: Bigish;
  minDeadlineMs?: number;
  rpcUrl?: string;
}

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

interface PublishIntentsSwapParams {
  intentPayload: NearIntentsNEP413Payload;
  signature: Uint8Array | number[] | string;
  publicKey: string;
  quoteHashes: string[];
  rpcUrl?: string;
}

export interface IntentsSwapParams {
  client: {
    proposeExecution: (
      policyId: string,
      functionArgs: Record<string, unknown> | string,
      options?: NearCallOptions
    ) => Promise<NearTransactionResult>;
    viewFunction: <T>(
      accountId: string,
      method: string,
      args: Record<string, unknown>,
      options?: { nearProvider?: unknown; nearRpcUrl?: string }
    ) => Promise<T>;
    deriveChainSigAccount: (
      params: {
        chain: "EVM" | "SVM" | "NearWasm";
        derivationPath: string;
        nearNetwork?: "Mainnet" | "Testnet";
      },
      options?: { nearProvider?: unknown; nearRpcUrl?: string }
    ) => Promise<{ public_key: string; address: string }>;
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
  viewOptions?: { nearProvider?: unknown; nearRpcUrl?: string };
  solverRpcUrl?: string;
  waitForBalance?: {
    initialBalance?: Bigish;
    intervalMs?: number;
    timeoutMs?: number;
  };
}

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

function resolvePolicyId(
  method: IntentsPolicyMethod,
  policyId?: string,
  policyIdPrefix?: string
): string {
  if (policyId) {
    return policyId;
  }
  if (policyIdPrefix) {
    return `${policyIdPrefix}${method}`;
  }
  return method;
}

function resolvePolicyMeta(
  params: IntentsPolicyBaseParams,
  method: IntentsPolicyMethod
): {
  policyId: string;
  description: string;
  activationTime: string;
  proposalExpiryTimeNanosec: string;
  requiredPendingActions: string[];
} {
  return {
    policyId: resolvePolicyId(method, params.policyId, params.policyIdPrefix),
    description: params.description ?? `Intents policy for ${method}`,
    activationTime: params.activationTime ?? DEFAULT_POLICY_ACTIVATION_TIME,
    proposalExpiryTimeNanosec: params.proposalExpiryTimeNanosec ?? DEFAULT_INTENTS_POLICY_EXPIRY_NS,
    requiredPendingActions: params.requiredPendingActions ?? [],
  };
}

function stripNep141Prefix(tokenId: string): string {
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
    requiredRole: params.requiredRole,
    requiredVoteCount: params.requiredVoteCount,
    policyType: "ChainSigTransaction",
    policyDetails: {
      type: "ChainSigTransaction",
      config: {
        derivationPath: params.derivationPath,
        chainEnvironment: params.chainEnvironment,
        restrictions: params.restrictions,
      },
    },
    activationTime: params.activationTime,
    proposalExpiryTimeNanosec: params.proposalExpiryTimeNanosec,
    requiredPendingActions: params.requiredPendingActions,
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
    requiredRole: params.requiredRole,
    requiredVoteCount: params.requiredVoteCount,
    policyType: "ChainSigMessage",
    policyDetails: {
      type: "ChainSigMessage",
      config: {
        derivationPath: params.derivationPath,
        signMethod: params.signMethod,
      },
    },
    activationTime: params.activationTime,
    proposalExpiryTimeNanosec: params.proposalExpiryTimeNanosec,
    requiredPendingActions: params.requiredPendingActions,
  };
}

export function createIntentsFtDepositPolicy(params: IntentsFtDepositPolicyParams): Policy {
  const method: IntentsPolicyMethod = "ft_deposit";
  const meta = resolvePolicyMeta(params, method);
  const intentsAccountId = params.intentsAccountId ?? DEFAULT_INTENTS_ACCOUNT;
  const tokenId = stripNep141Prefix(params.tokenId);
  const msg = params.msg ?? "";
  const chainEnvironment = params.chainEnvironment ?? "NearWasm";

  const restrictions: PolicyRestriction[] = [
    {
      schema: `and(
        $.contract_id.equal("${tokenId}"),
        $.function_name.equal("ft_transfer_call"),
        $.args.receiver_id.equal("${intentsAccountId}"),
        $.args.msg.equal("${msg}")
    )`,
      interface: "",
    },
  ];

  return buildChainSigTransactionPolicy({
    ...meta,
    requiredRole: params.requiredRole,
    requiredVoteCount: params.requiredVoteCount,
    derivationPath: params.derivationPath,
    chainEnvironment,
    restrictions,
  });
}

export function createIntentsFtWithdrawToNearPolicy(
  params: IntentsFtWithdrawToNearPolicyParams
): Policy {
  const method: IntentsPolicyMethod = "ft_withdraw_to_near";
  const meta = resolvePolicyMeta(params, method);
  const intentsAccountId = params.intentsAccountId ?? DEFAULT_INTENTS_ACCOUNT;
  const tokenId = stripNep141Prefix(params.tokenId);
  const chainEnvironment = params.chainEnvironment ?? "NearWasm";

  const restrictions: PolicyRestriction[] = [
    {
      schema: `and(
        $.contract_id.equal("${intentsAccountId}"),
        $.function_name.equal("ft_withdraw"),
        $.args.receiver_id.equal(chain_sig_address("${params.derivationPath}","NearWasm")),
        $.args.token.equal("${tokenId}"),
        $.args.memo.case_insensitive_equal(concat("WITHDRAW_TO:",chain_sig_address("${params.derivationPath}","NearWasm")))
    )`,
      interface: "",
    },
  ];

  return buildChainSigTransactionPolicy({
    ...meta,
    requiredRole: params.requiredRole,
    requiredVoteCount: params.requiredVoteCount,
    derivationPath: params.derivationPath,
    chainEnvironment,
    restrictions,
  });
}

export function createIntentsFtWithdrawToEvmPolicy(
  params: IntentsFtWithdrawToEvmPolicyParams
): Policy {
  const method: IntentsPolicyMethod = "ft_withdraw_to_evm";
  const meta = resolvePolicyMeta(params, method);
  const intentsAccountId = params.intentsAccountId ?? DEFAULT_INTENTS_ACCOUNT;
  const intentsTokenId = stripNep141Prefix(params.intentsTokenId);
  const chainEnvironment = params.chainEnvironment ?? "NearWasm";

  const restrictions: PolicyRestriction[] = [
    {
      schema: `and(
        $.contract_id.equal("${intentsAccountId}"),
        $.function_name.equal("ft_withdraw"),
        $.args.receiver_id.equal("${intentsTokenId}"),
        $.args.token.equal("${intentsTokenId}"),
        $.args.memo.case_insensitive_equal(concat("WITHDRAW_TO:",chain_sig_address("${params.derivationPath}","EVM")))
    )`,
      interface: "",
    },
  ];

  return buildChainSigTransactionPolicy({
    ...meta,
    requiredRole: params.requiredRole,
    requiredVoteCount: params.requiredVoteCount,
    derivationPath: params.derivationPath,
    chainEnvironment,
    restrictions,
  });
}

export function createIntentsErc20TransferToIntentsPolicy(
  params: IntentsErc20TransferToIntentsPolicyParams
): Policy {
  const method: IntentsPolicyMethod = "erc20_transfer_to_intents";
  const meta = resolvePolicyMeta(params, method);
  const chainEnvironment = params.chainEnvironment ?? "EVM";
  const iface = params.interfaceBase64 ?? DEFAULT_INTENTS_ERC20_TRANSFER_INTERFACE;

  const restrictions: PolicyRestriction[] = [
    {
      schema: `and(
        $.contract_id.equal("${params.tokenAddress}"),
        $.function_name.equal("transfer"),
        $.args.to.case_insensitive_equal("${params.intentsDepositAddress}")
    )`,
      interface: iface,
    },
  ];

  return buildChainSigTransactionPolicy({
    ...meta,
    requiredRole: params.requiredRole,
    requiredVoteCount: params.requiredVoteCount,
    derivationPath: params.derivationPath,
    chainEnvironment,
    restrictions,
  });
}

export function createIntentsSwapPolicy(params: IntentsSwapPolicyParams): Policy {
  const method: IntentsPolicyMethod = "intents_swap";
  const meta = resolvePolicyMeta(params, method);
  const signMethod = params.signMethod ?? "NearIntentsSwap";

  return buildChainSigMessagePolicy({
    ...meta,
    requiredRole: params.requiredRole,
    requiredVoteCount: params.requiredVoteCount,
    derivationPath: params.derivationPath,
    signMethod,
  });
}

function toAmount(value: Bigish): string {
  return new Big(value).toString();
}

function tgasToGas(tgas: number): bigint {
  return BigInt(Math.floor(tgas * Number(TGAS_TO_GAS)));
}

function buildFunctionCall(
  method: string,
  args: Record<string, unknown>,
  gasTgas: number,
  depositYocto: string
): transactions.Action {
  const gas = tgasToGas(gasTgas);
  const deposit = BigInt(depositYocto);
  return transactions.functionCall(method, Buffer.from(JSON.stringify(args)), gas, deposit);
}

function normalizeNonce(nonce?: Uint8Array | number[]): number[] {
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

function buildIntentsSwapMessage(params: {
  signerId: string;
  quote: IntentsSwapQuote;
  referral?: string | null;
}): NearIntentsSwapMessage {
  const diff: Record<string, string> = {
    [params.quote.defuse_asset_identifier_in]: `-${params.quote.amount_in}`,
    [params.quote.defuse_asset_identifier_out]: params.quote.amount_out,
  };
  const intent = {
    intent: "token_diff" as const,
    diff,
    ...(params.referral != null ? { referral: params.referral } : {}),
  };
  return {
    signer_id: params.signerId,
    deadline: params.quote.expiration_time,
    intents: [intent],
  };
}

function buildIntentsNep413Payload(params: {
  signerId: string;
  recipient: string;
  quote: IntentsSwapQuote;
  nonce?: Uint8Array | number[];
  referral?: string | null;
  callbackUrl?: string | null;
}): NearIntentsNEP413Payload {
  const message = buildIntentsSwapMessage({
    signerId: params.signerId,
    quote: params.quote,
    referral: params.referral,
  });
  return {
    nonce: normalizeNonce(params.nonce),
    recipient: params.recipient,
    message: JSON.stringify(message),
    ...(params.callbackUrl != null ? { callback_url: params.callbackUrl } : {}),
  };
}

function isChainSigResponse(value: unknown): value is ChainSigResponse {
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

function collectChainSigResponses(value: unknown, responses: ChainSigResponse[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectChainSigResponses(item, responses);
    }
    return;
  }
  if (isChainSigResponse(value)) {
    responses.push(value);
  }
}

function extractChainSigResponses(outcome: NearTransactionResult): ChainSigResponse[] {
  const responses: ChainSigResponse[] = [];

  for (const receipt of outcome.receipts_outcome) {
    for (const log of receipt.outcome.logs) {
      try {
        const parsed = JSON.parse(log);
        collectChainSigResponses(parsed, responses);
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
          collectChainSigResponses(parsed, responses);
        }
      } catch {
        // Ignore non-JSON return values
      }
    }
  }

  return responses;
}

function extractEd25519Signature(responses: ChainSigResponse[]): number[] | null {
  for (const response of responses) {
    if (response.scheme === "Ed25519") {
      return response.signature;
    }
  }
  return null;
}

function formatEd25519Signature(signature: Uint8Array | number[] | string): string {
  if (typeof signature === "string") {
    return signature.startsWith("ed25519:") ? signature : `ed25519:${signature}`;
  }
  const bytes = signature instanceof Uint8Array ? signature : Uint8Array.from(signature);
  const encoded = utils.serialize.base_encode(bytes);
  return `ed25519:${encoded}`;
}

async function getIntentsMtBalance(
  client: IntentsSwapParams["client"],
  intentsAccountId: string,
  accountId: string,
  tokenId: string,
  options?: ViewOptions
): Promise<bigint> {
  const result = await client.viewFunction<string>(
    intentsAccountId,
    "mt_balance_of",
    { account_id: accountId, token_id: tokenId },
    options
  );
  return BigInt(result ?? "0");
}

/**
 * Deposit NEP-141 FT into intents.near via kernel proposal
 */
export async function depositToIntents(
  params: DepositToIntentsParams
): Promise<DepositToIntentsResult> {
  const receiverId = params.receiverId ?? DEFAULT_INTENTS_ACCOUNT;
  const amount = toAmount(params.amount);
  const gasTgas = params.gasTgas ?? 50;
  const depositYocto = params.depositYocto ?? ONE_YOCTO;
  const msg = params.msg ?? "";

  const action = buildFunctionCall(
    "ft_transfer_call",
    { receiver_id: receiverId, amount, msg },
    gasTgas,
    depositYocto
  );

  const result = await params.client.proposeNearActions(
    params.policyId,
    params.tokenId,
    [action],
    params.callOptions
  );

  return { ...result, amount, receiverId };
}

/**
 * Withdraw NEP-141 FT from intents.near to a destination, optionally waiting for balance arrival
 */
export async function withdrawFromIntents(
  params: WithdrawFromIntentsParams
): Promise<WithdrawFromIntentsResult> {
  const intentsAccountId = params.intentsAccountId ?? DEFAULT_INTENTS_ACCOUNT;
  const amount = toAmount(params.amount);
  const gasTgas = params.gasTgas ?? 30;
  const depositYocto = params.depositYocto ?? ONE_YOCTO;
  const memo = params.memo ?? `WITHDRAW_TO:${params.destination}`;
  const token = params.tokenId.replace(/^nep141:/, "");

  const action = buildFunctionCall(
    "ft_withdraw",
    {
      token,
      receiver_id: params.destination,
      amount,
      memo,
    },
    gasTgas,
    depositYocto
  );

  const result = await params.client.proposeNearActions(
    params.policyId,
    intentsAccountId,
    [action],
    params.callOptions
  );

  let waitedBalance: Big | undefined;

  if (params.waitForBalance) {
    const baseline = params.waitForBalance.initialBalance
      ? new Big(params.waitForBalance.initialBalance)
      : await params.waitForBalance.getBalance();

    const intervalMs = params.waitForBalance.intervalMs ?? 5000;
    const timeoutMs = params.waitForBalance.timeoutMs ?? 300000;

    await waitUntil(
      async () => {
        const current = await params.waitForBalance!.getBalance();
        if (current.gt(baseline)) {
          waitedBalance = current;
          return true;
        }
        return false;
      },
      {
        intervalMs,
        timeoutMs,
        timeoutMessage: "Withdraw did not arrive before timeout",
      }
    );
  }

  return {
    ...result,
    amount,
    intentsAccountId,
    destination: params.destination,
    waitedBalance,
  };
}

/**
 * Get an intents bridge deposit address for a given chain
 */
export async function getBridgeDepositAddress(params: {
  accountId: string;
  chainType: string;
  chainId: number;
  rpcUrl?: string;
}): Promise<string> {
  const response = await fetch(params.rpcUrl ?? DEFAULT_BRIDGE_RPC, {
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
          account_id: params.accountId,
          chain: `${params.chainType}:${params.chainId}`,
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
async function getIntentsSwapQuote(params: IntentsSwapQuoteParams): Promise<IntentsSwapQuote> {
  const response = await fetch(params.rpcUrl ?? DEFAULT_SOLVER_RPC, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "quote",
      params: [
        {
          defuse_asset_identifier_in: params.assetIn,
          defuse_asset_identifier_out: params.assetOut,
          exact_amount_in: toAmount(params.exactAmountIn),
          min_deadline_ms: params.minDeadlineMs ?? DEFAULT_QUOTE_DEADLINE_MS,
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
async function publishIntentsSwap(params: PublishIntentsSwapParams): Promise<string> {
  const signature = formatEd25519Signature(params.signature);
  const response = await fetch(params.rpcUrl ?? DEFAULT_SOLVER_RPC, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "publish_intent",
      params: [
        {
          quote_hashes: params.quoteHashes,
          signed_data: {
            standard: "nep413",
            payload: {
              message: params.intentPayload.message,
              nonce: Buffer.from(params.intentPayload.nonce).toString("base64"),
              recipient: params.intentPayload.recipient,
              ...(params.intentPayload.callback_url != null
                ? { callback_url: params.intentPayload.callback_url }
                : {}),
            },
            signature,
            public_key: params.publicKey,
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
export async function swapViaIntents(params: IntentsSwapParams): Promise<IntentsSwapResult> {
  const intentsAccountId = params.intentsAccountId ?? DEFAULT_INTENTS_ACCOUNT;
  const amountIn = toAmount(params.amountIn);

  const quote =
    params.quote ??
    (await getIntentsSwapQuote({
      assetIn: params.fromIntentsTokenId,
      assetOut: params.toIntentsTokenId,
      exactAmountIn: amountIn,
      minDeadlineMs: params.minDeadlineMs,
      rpcUrl: params.solverRpcUrl,
    }));

  const derivedAccount = await params.client.deriveChainSigAccount(
    {
      chain: "NearWasm",
      derivationPath: params.derivationPath,
      nearNetwork: params.nearNetwork,
    },
    params.viewOptions
  );

  const intentPayload = buildIntentsNep413Payload({
    signerId: derivedAccount.address,
    recipient: intentsAccountId,
    quote,
    nonce: params.nonce,
    referral: params.referral ?? null,
    callbackUrl: params.callbackUrl ?? null,
  });

  const outcome = await params.client.proposeExecution(
    params.policyId,
    JSON.stringify(intentPayload),
    params.callOptions
  );

  const responses = extractChainSigResponses(outcome);
  const signatureBytes = extractEd25519Signature(responses);
  if (!signatureBytes) {
    throw new Error("No Ed25519 signature returned; proposal may require voting.");
  }

  const signature = utils.serialize.base_encode(Uint8Array.from(signatureBytes));

  const intentHash = await publishIntentsSwap({
    intentPayload,
    signature,
    publicKey: derivedAccount.public_key,
    quoteHashes: [quote.quote_hash],
    rpcUrl: params.solverRpcUrl,
  });

  let swappedAmount: string | undefined;
  if (params.waitForBalance) {
    const baseline = params.waitForBalance.initialBalance
      ? BigInt(params.waitForBalance.initialBalance.toString())
      : await getIntentsMtBalance(
          params.client,
          intentsAccountId,
          derivedAccount.address,
          params.toIntentsTokenId,
          params.viewOptions
        );

    const intervalMs = params.waitForBalance.intervalMs ?? 5000;
    const timeoutMs = params.waitForBalance.timeoutMs ?? 180000;

    await waitUntil(
      async () => {
        const current = await getIntentsMtBalance(
          params.client,
          intentsAccountId,
          derivedAccount.address,
          params.toIntentsTokenId,
          params.viewOptions
        );
        if (current > baseline) {
          swappedAmount = (current - baseline).toString();
          return true;
        }
        return false;
      },
      {
        intervalMs,
        timeoutMs,
        timeoutMessage: "Intents swap did not settle before timeout",
      }
    );
  }

  return {
    quote,
    intentHash,
    signature,
    intentPayload,
    derivedAccount,
    outcome,
    amountIn,
    intentsAccountId,
    fromIntentsTokenId: params.fromIntentsTokenId,
    toIntentsTokenId: params.toIntentsTokenId,
    swappedAmount,
  };
}
