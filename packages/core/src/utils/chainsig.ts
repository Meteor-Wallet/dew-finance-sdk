/**
 * ChainSig transaction helpers
 * @packageDocumentation
 */

import type { ChainSigTransactionAdapter, MPCSignature } from "../types.js";

export function finalizeTransactionSigning<UnsignedTx, SignedTx>({
  adapter,
  transaction,
  signatures,
}: {
  adapter: ChainSigTransactionAdapter<UnsignedTx, SignedTx>;
  transaction: UnsignedTx;
  signatures: MPCSignature[];
}): SignedTx {
  return adapter.finalizeTransactionSigning({ transaction, signatures });
}

export async function broadcastTx<SignedTx>({
  adapter,
  signedTx,
}: {
  adapter: ChainSigTransactionAdapter<unknown, SignedTx>;
  signedTx: SignedTx;
}): Promise<string> {
  return adapter.broadcastTx(signedTx);
}
