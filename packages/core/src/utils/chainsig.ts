/**
 * ChainSig transaction helpers
 * @packageDocumentation
 */

import type { ChainSigTransactionAdapter, MPCSignature } from "../types.js";

export function finalizeTransactionSigning<UnsignedTx, SignedTx>(
  adapter: ChainSigTransactionAdapter<UnsignedTx, SignedTx>,
  params: {
    transaction: UnsignedTx;
    signatures: MPCSignature[];
  }
): SignedTx {
  return adapter.finalizeTransactionSigning(params);
}

export async function broadcastTx<SignedTx>(
  adapter: ChainSigTransactionAdapter<unknown, SignedTx>,
  signedTx: SignedTx
): Promise<string> {
  return adapter.broadcastTx(signedTx);
}
