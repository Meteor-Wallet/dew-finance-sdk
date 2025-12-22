/**
 * NEAR Intents utilities (deposit / withdraw)
 * @packageDocumentation
 */

import Big from "big.js";
import { transactions } from "near-api-js";
import type { NearCallOptions, NearTransactionResult } from "../types.js";
import { waitUntil } from "./wait.js";

const TGAS_TO_GAS = 1_000_000_000_000n;
const DEFAULT_INTENTS_ACCOUNT = "intents.near";
const ONE_YOCTO = "1";

type Bigish = string | number;

type ProposeNearActionsResult = {
  executed: boolean;
  proposalId: number;
  outcome: NearTransactionResult;
};

/** Minimal Dew client shape we depend on */
export interface DewClientLike {
  proposeNearActions: (
    policyId: string,
    receiverId: string,
    actions: transactions.Action[],
    options?: NearCallOptions
  ) => Promise<ProposeNearActionsResult>;
}

export interface DepositToIntentsParams {
  client: DewClientLike;
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
  client: DewClientLike;
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

// Re-export for convenience
export type { NearCallOptions } from "../types.js";

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
