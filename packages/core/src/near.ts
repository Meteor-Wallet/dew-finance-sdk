/**
 * NEAR transaction utilities
 * @packageDocumentation
 */

import { Account } from "@near-js/accounts";
import { KeyPair } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import {
  formatNearAmount as formatNearAmountRaw,
  parseNearAmount as parseNearAmountRaw,
} from "@near-js/utils";
import type { NearTransactionData, NearTransactionResult } from "./types.js";

/**
 * Build and send a NEAR transaction
 * @param account - NEAR account
 * @param data - Transaction data
 * @returns Final execution outcome
 */
export async function sendNearTransaction({
  account,
  data,
}: {
  account: Account;
  data: NearTransactionData;
}): Promise<NearTransactionResult> {
  try {
    const result = await account.signAndSendTransaction({
      receiverId: data.receiverId,
      actions: data.actions,
    });
    return result;
  } catch (error) {
    throw new Error(
      `Failed to send NEAR transaction: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Create a NEAR account from private key
 * @param config - Connection config with rpc URL, network ID, account ID, and private key
 * @returns Connected Account instance
 */
export async function createNearAccount({
  rpcUrl,
  networkId: _networkId,
  accountId,
  privateKey,
}: {
  rpcUrl: string;
  networkId: string;
  accountId: string;
  privateKey: string;
}): Promise<Account> {
  const keyPair = KeyPair.fromString(privateKey as `ed25519:${string}`);
  const signer = new KeyPairSigner(keyPair);
  const provider = new JsonRpcProvider({ url: rpcUrl });
  return new Account(accountId, provider, signer);
}

/**
 * Get a NEAR provider for queries
 * @param rpcUrl - RPC endpoint URL
 * @returns JSON RPC provider
 */
export function getNearProvider({ rpcUrl }: { rpcUrl: string }): JsonRpcProvider {
  return new JsonRpcProvider({ url: rpcUrl });
}

/**
 * Convert JS amount to yoctoNEAR (10^24)
 * Defers to near-js utils
 */
export function parseNearAmount({ amount }: { amount: string }): string {
  const parsed = parseNearAmountRaw(amount);
  if (parsed === null) {
    throw new Error(`Invalid NEAR amount: ${amount}`);
  }
  return parsed;
}

/**
 * Convert yoctoNEAR to NEAR
 * Defers to near-js utils
 */
export function formatNearAmount({
  amount,
  decimals = 4,
}: {
  amount: string;
  decimals?: number;
}): string {
  return formatNearAmountRaw(amount, decimals);
}
