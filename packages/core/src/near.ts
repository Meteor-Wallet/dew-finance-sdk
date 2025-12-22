/**
 * NEAR transaction utilities using near-api-js
 * @packageDocumentation
 */

import {
  Account,
  providers,
  utils,
  keyStores,
  KeyPair,
  connect,
  type ConnectConfig,
} from "near-api-js";
import type { NearTransactionData, NearTransactionResult } from "./types.js";

/**
 * Build and send a NEAR transaction using near-api-js
 * @param account - NEAR account (from near-api-js)
 * @param data - Transaction data
 * @returns Final execution outcome
 */
export async function sendNearTransaction(
  account: Account,
  data: NearTransactionData
): Promise<NearTransactionResult> {
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
 * Create a NEAR connection and account from private key
 * @param config - Connection config with rpc URL, network ID, account ID, and private key
 * @returns Connected Account instance
 */
export async function createNearAccount(config: {
  rpcUrl: string;
  networkId: string;
  accountId: string;
  privateKey: string;
}): Promise<Account> {
  const keyPair = KeyPair.fromString(config.privateKey as `ed25519:${string}`);
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey(config.networkId, config.accountId, keyPair);

  const near = await connect({
    networkId: config.networkId,
    keyStore,
    nodeUrl: config.rpcUrl,
  } as ConnectConfig);

  return near.account(config.accountId);
}

/**
 * Get a NEAR provider for queries
 * @param rpcUrl - RPC endpoint URL
 * @returns JSON RPC provider
 */
export function getNearProvider(rpcUrl: string): providers.JsonRpcProvider {
  return new providers.JsonRpcProvider({ url: rpcUrl });
}

/**
 * Convert JS amount to yoctoNEAR (10^24)
 * Defers to near-api-js utils
 */
export function parseNearAmount(amount: string): string {
  const parsed = utils.format.parseNearAmount(amount);
  if (parsed === null) {
    throw new Error(`Invalid NEAR amount: ${amount}`);
  }
  return parsed;
}

/**
 * Convert yoctoNEAR to NEAR
 * Defers to near-api-js utils
 */
export function formatNearAmount(amount: string, decimals: number = 4): string {
  return utils.format.formatNearAmount(amount, decimals);
}
