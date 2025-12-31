import { actionCreators, type Action } from "@near-js/transactions";
import { DEFAULT_BURROW_CONTRACT_ID } from "./constants.js";

const TGAS_TO_GAS = 1_000_000_000_000n;
const DEFAULT_EXECUTE_GAS_TGAS = 300;
const DEFAULT_FT_TRANSFER_GAS_TGAS = 300;
const DEFAULT_ONE_YOCTO = "1";
const DEFAULT_NO_DEPOSIT = "0";

type AmountInput = string | bigint;

type ActionOptions = {
  gasTgas?: number;
  depositYocto?: string;
};

type FtTransferOptions = ActionOptions & {
  burrowId?: string;
};

function toGas(gasTgas: number): bigint {
  return BigInt(Math.floor(gasTgas)) * TGAS_TO_GAS;
}

function toAmount(amount: AmountInput): string {
  if (typeof amount === "bigint") {
    return amount.toString();
  }
  return amount;
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
  return actionCreators.functionCall(
    method,
    Buffer.from(JSON.stringify(args)),
    toGas(gasTgas),
    BigInt(depositYocto)
  );
}

/**
 * Deposit and increase collateral via ft_transfer_call.
 * Amount is the NEP-141 token amount (token decimals).
 */
export function buildIncreaseCollateralFtTransferCall({
  tokenId,
  amount,
  burrowId = DEFAULT_BURROW_CONTRACT_ID,
  gasTgas = DEFAULT_FT_TRANSFER_GAS_TGAS,
  depositYocto = DEFAULT_ONE_YOCTO,
}: {
  tokenId: string;
  amount: AmountInput;
} & FtTransferOptions): Action {
  return buildFunctionCall({
    method: "ft_transfer_call",
    gasTgas,
    depositYocto,
    args: {
      receiver_id: burrowId,
      amount: toAmount(amount),
      msg: JSON.stringify({
        Execute: {
          actions: [
            {
              IncreaseCollateral: {
                token_id: tokenId,
              },
            },
          ],
        },
      }),
    },
  });
}

/**
 * Repay a Burrow debt via ft_transfer_call.
 * - `amount` is the NEP-141 token amount (token decimals)
 * - `maxAmount` (optional) is the Burrow internal amount (max(18, token_decimals))
 */
export function buildRepayFtTransferCall({
  tokenId,
  amount,
  maxAmount,
  burrowId = DEFAULT_BURROW_CONTRACT_ID,
  gasTgas = DEFAULT_FT_TRANSFER_GAS_TGAS,
  depositYocto = DEFAULT_ONE_YOCTO,
}: {
  tokenId: string;
  amount: AmountInput;
  maxAmount?: AmountInput;
} & FtTransferOptions): Action {
  return buildFunctionCall({
    method: "ft_transfer_call",
    gasTgas,
    depositYocto,
    args: {
      receiver_id: burrowId,
      amount: toAmount(amount),
      msg: JSON.stringify({
        Execute: {
          actions: [
            {
              Repay: {
                token_id: tokenId,
                max_amount: toAmount(maxAmount ?? amount),
              },
            },
          ],
        },
      }),
    },
  });
}

/**
 * Borrow + withdraw via execute_with_pyth. Amount is in Burrow internal decimals.
 */
export function buildBorrowAndWithdraw({
  tokenId,
  amount,
  gasTgas = DEFAULT_EXECUTE_GAS_TGAS,
  depositYocto = DEFAULT_ONE_YOCTO,
}: {
  tokenId: string;
  amount: AmountInput;
} & ActionOptions): Action {
  const maxAmount = toAmount(amount);
  return buildFunctionCall({
    method: "execute_with_pyth",
    gasTgas,
    depositYocto,
    args: {
      actions: [
        {
          Borrow: {
            token_id: tokenId,
            max_amount: maxAmount,
          },
        },
        {
          Withdraw: {
            token_id: tokenId,
            max_amount: maxAmount,
          },
        },
      ],
    },
  });
}

/**
 * Decrease collateral + withdraw via execute_with_pyth. Amount is in Burrow internal decimals.
 */
export function buildDecreaseCollateralAndWithdraw({
  tokenId,
  amount,
  gasTgas = DEFAULT_EXECUTE_GAS_TGAS,
  depositYocto = DEFAULT_ONE_YOCTO,
}: {
  tokenId: string;
  amount: AmountInput;
} & ActionOptions): Action {
  const amountString = toAmount(amount);
  return buildFunctionCall({
    method: "execute_with_pyth",
    gasTgas,
    depositYocto,
    args: {
      actions: [
        {
          DecreaseCollateral: {
            token_id: tokenId,
            amount: amountString,
          },
        },
        {
          Withdraw: {
            token_id: tokenId,
            max_amount: amountString,
          },
        },
      ],
    },
  });
}

/**
 * Withdraw supplied assets via execute. Amount is in Burrow internal decimals.
 */
export function buildWithdraw({
  tokenId,
  amount,
  gasTgas = DEFAULT_EXECUTE_GAS_TGAS,
  depositYocto = DEFAULT_ONE_YOCTO,
}: {
  tokenId: string;
  amount: AmountInput;
} & ActionOptions): Action {
  return buildFunctionCall({
    method: "execute",
    gasTgas,
    depositYocto,
    args: {
      actions: [
        {
          Withdraw: {
            token_id: tokenId,
            max_amount: toAmount(amount),
          },
        },
      ],
    },
  });
}

/**
 * Claim all farm rewards for an account.
 */
export function buildAccountFarmClaimAll({
  accountId,
  gasTgas = DEFAULT_EXECUTE_GAS_TGAS,
  depositYocto = DEFAULT_NO_DEPOSIT,
}: {
  accountId: string;
} & ActionOptions): Action {
  return buildFunctionCall({
    method: "account_farm_claim_all",
    gasTgas,
    depositYocto,
    args: {
      account_id: accountId,
    },
  });
}
