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
  const outcome = (await provider.sendTransactionUntil(
    signedTransaction,
    "FINAL"
  )) as FinalExecutionOutcome;
  assertNoFailedReceipts({ outcome });
  return outcome;
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

function assertNoFailedReceipts({ outcome }: { outcome: FinalExecutionOutcome }): void {
  const topStatus = (outcome as { transaction_outcome?: { outcome?: { status?: unknown } } })
    .transaction_outcome?.outcome?.status;
  const topFailure = extractFailure(topStatus);
  if (topFailure) {
    throw new Error(`[NEAR] Transaction failed: ${formatFailure(topFailure)}`);
  }

  if (!Array.isArray(outcome.receipts_outcome)) {
    return;
  }
  for (const receipt of outcome.receipts_outcome) {
    const status = (receipt as { outcome?: { status?: unknown } }).outcome?.status;
    const failure = extractFailure(status);
    if (failure) {
      const receiptId =
        (receipt as { id?: string }).id ?? (receipt as { receipt_id?: string }).receipt_id;
      const suffix = receiptId ? ` (${receiptId})` : "";
      throw new Error(`[NEAR] Receipt failed${suffix}: ${formatFailure(failure)}`);
    }
  }
}

function extractFailure(status: unknown): unknown | null {
  if (!status || typeof status !== "object") {
    return null;
  }
  if ("Failure" in status) {
    return (status as { Failure?: unknown }).Failure ?? "Failure";
  }
  if ("Unknown" in status) {
    return (status as { Unknown?: unknown }).Unknown ?? "Unknown";
  }
  return null;
}

function formatFailure(failure: unknown): string {
  if (typeof failure === "string") {
    return failure;
  }
  try {
    return JSON.stringify(failure);
  } catch {
    return String(failure);
  }
}
