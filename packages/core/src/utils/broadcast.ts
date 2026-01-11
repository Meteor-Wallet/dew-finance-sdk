/**
 * Transaction broadcasting utilities
 * @packageDocumentation
 */

import { JsonRpcProvider } from "@near-js/providers";
import type { FinalExecutionOutcome } from "@near-js/types";
import { SignedTransaction } from "@near-js/transactions";
import { createPublicClient, http } from "viem";
import type { Hex, PublicClient } from "viem";

/**
 * Broadcast a signed NEAR transaction to the network (waits for FINAL execution)
 *
 * @param rpcUrlOrProvider - NEAR RPC endpoint or provider
 * @param signedTx - Signed transaction (base64 string or Uint8Array)
 * @returns Transaction outcome
 */
export async function broadcastNearTransaction({
  rpcUrlOrProvider,
  signedTx,
}: {
  rpcUrlOrProvider: string | JsonRpcProvider;
  signedTx: string | Uint8Array;
}): Promise<FinalExecutionOutcome> {
  const provider =
    typeof rpcUrlOrProvider === "string"
      ? new JsonRpcProvider({ url: rpcUrlOrProvider })
      : rpcUrlOrProvider;

  const txBytes = typeof signedTx === "string" ? Buffer.from(signedTx, "base64") : signedTx;

  const signedTransaction = SignedTransaction.decode(txBytes);
  return provider.sendTransactionUntil(signedTransaction, "FINAL") as Promise<FinalExecutionOutcome>;
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
