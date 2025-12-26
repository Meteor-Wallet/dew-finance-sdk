/**
 * Transaction broadcasting utilities
 * @packageDocumentation
 */

import type { providers } from "near-api-js";
import { createPublicClient, http } from "viem";
import type { Hex, PublicClient } from "viem";

/**
 * Broadcast a signed NEAR transaction to the network
 *
 * @param rpcUrlOrProvider - NEAR RPC endpoint or provider
 * @param signedTx - Signed transaction (base64 string or Uint8Array)
 * @returns Transaction outcome
 */
export async function broadcastNearTransaction({
  rpcUrlOrProvider,
  signedTx,
}: {
  rpcUrlOrProvider: string | providers.JsonRpcProvider;
  signedTx: string | Uint8Array;
}): Promise<providers.FinalExecutionOutcome> {
  const { providers: nearProviders, transactions } = await import("near-api-js");
  const provider =
    typeof rpcUrlOrProvider === "string"
      ? new nearProviders.JsonRpcProvider({ url: rpcUrlOrProvider })
      : rpcUrlOrProvider;

  const txBytes = typeof signedTx === "string" ? Buffer.from(signedTx, "base64") : signedTx;

  const signedTransaction = transactions.SignedTransaction.decode(txBytes);
  return provider.sendTransaction(signedTransaction) as Promise<providers.FinalExecutionOutcome>;
}

/**
 * Broadcast a signed EVM transaction via JSON-RPC
 *
 * @param rpcUrlOrClient - EVM chain RPC endpoint or viem public client
 * @param signedTx - Signed transaction (0x-prefixed hex string)
 * @returns Transaction hash
 */
export async function broadcastEvmTransaction({
  rpcUrlOrClient,
  signedTx,
}: {
  rpcUrlOrClient: string | PublicClient;
  signedTx: Hex;
}): Promise<string> {
  const client =
    typeof rpcUrlOrClient === "string"
      ? createPublicClient({ transport: http(rpcUrlOrClient) })
      : rpcUrlOrClient;

  return client.sendRawTransaction({
    serializedTransaction: signedTx,
  });
}
