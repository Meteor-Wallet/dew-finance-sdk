/**
 * Kernel proposal parsing helpers.
 * These functions turn raw NEAR execution outcomes into proposal IDs, execution flags,
 * and MPC signatures by inspecting logs and return values.
 * @packageDocumentation
 */

import type { FinalExecutionOutcome } from "@near-js/types";
import type { MPCSignature } from "../types.js";

/**
 * Type guard for outcomes that include receipt logs.
 * Some providers return a result-only response (no receipts_outcome).
 */
export function hasReceiptsOutcome(outcome: unknown): outcome is FinalExecutionOutcome {
  if (!outcome || typeof outcome !== "object") {
    return false;
  }
  return Array.isArray((outcome as { receipts_outcome?: unknown }).receipts_outcome);
}

/**
 * Check if a proposal executed immediately by scanning logs and return values.
 * This is heuristic-based because execution signals can appear in multiple places.
 */
export function wasProposalExecuted({ outcome }: { outcome: FinalExecutionOutcome }): boolean {
  if (!hasReceiptsOutcome(outcome)) {
    return false;
  }

  for (const receipt of outcome.receipts_outcome) {
    const logs = receipt.outcome.logs;
    for (const log of logs) {
      const event = parseEventJson({ log });
      if (event?.event === "proposal_executed") {
        return true;
      }

      // MPC signature logs indicate auto-execution for ChainSig transactions.
      if (log.includes('"big_r"') || log.includes('"signature"')) {
        return true;
      }
    }

    // Some contracts return structured data on execution; treat that as executed.
    const status = receipt.outcome.status as Record<string, unknown>;
    if (status && typeof status === "object" && "SuccessValue" in status && status.SuccessValue) {
      try {
        const decoded = Buffer.from(status.SuccessValue as string, "base64").toString();
        if (decoded && decoded !== "null" && decoded !== '""') {
          const parsed = JSON.parse(decoded);
          if (parsed && typeof parsed === "object") {
            return true;
          }
        }
      } catch {
        // Ignore malformed or non-JSON returns.
      }
    }
  }

  return false;
}

/**
 * Extract proposal ID from EVENT_JSON logs emitted by the kernel contract.
 */
export function extractProposalId({ outcome }: { outcome: FinalExecutionOutcome }): number {
  if (!hasReceiptsOutcome(outcome)) {
    throw new Error(
      "Failed to extract proposal ID: outcome is missing receipts_outcome (result-only response)."
    );
  }

  for (const receipt of outcome.receipts_outcome) {
    const logs = receipt.outcome.logs;
    for (const log of logs) {
      const event = parseEventJson({ log });
      if (event) {
        const id = extractProposalIdFromEvent({ event });
        if (id !== undefined) {
          return id;
        }
      }
    }
  }

  throw new Error("Failed to extract proposal ID from kernel logs.");
}

function parseEventJson({ log }: { log: string }): { event: string; data?: unknown } | null {
  if (!log.startsWith("EVENT_JSON:")) {
    return null;
  }
  const payload = log.slice("EVENT_JSON:".length);
  try {
    const parsed = JSON.parse(payload) as { event?: unknown; data?: unknown };
    if (parsed && typeof parsed === "object" && typeof parsed.event === "string") {
      return { event: parsed.event, data: parsed.data };
    }
  } catch {
    // Ignore malformed event logs.
  }
  return null;
}

function extractProposalIdFromEvent({
  event,
}: {
  event: { event: string; data?: unknown };
}): number | undefined {
  if (!isProposalEvent(event.event)) {
    return undefined;
  }
  // Expected NEP-000 shape: { data: [{ proposal_id: 123, ... }] }
  if (!Array.isArray(event.data) || event.data.length === 0) {
    return undefined;
  }
  const first = event.data[0];
  if (!first || typeof first !== "object") {
    return undefined;
  }
  const proposalId = (first as { proposal_id?: unknown }).proposal_id;
  if (typeof proposalId === "number" && Number.isFinite(proposalId)) {
    return proposalId;
  }
  if (typeof proposalId === "string" && /^\d+$/.test(proposalId)) {
    return parseInt(proposalId, 10);
  }
  return undefined;
}

function isProposalEvent(value: string): boolean {
  return (
    value === "proposal_created" || value === "proposal_executed" || value === "proposal_cancelled"
  );
}

function isEd25519Signature(
  value: unknown
): value is Extract<MPCSignature, { scheme: "Ed25519" | "ed25519"; signature: number[] }> {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { scheme?: unknown; signature?: unknown };
  if (!Array.isArray(candidate.signature)) {
    return false;
  }
  if (candidate.signature.some((item) => typeof item !== "number")) {
    return false;
  }
  if (typeof candidate.scheme !== "string") {
    return false;
  }
  return candidate.scheme.toLowerCase() === "ed25519";
}

function isSecp256k1Signature(
  value: unknown
): value is Extract<MPCSignature, { big_r: string; s: string; recovery_id: number }> {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { big_r?: unknown; s?: unknown; recovery_id?: unknown };
  return (
    candidate.big_r !== undefined &&
    candidate.s !== undefined &&
    candidate.recovery_id !== undefined
  );
}

/**
 * NearWasm ChainSig signatures are Ed25519; pick the first one.
 */
export function pickEd25519Signature(
  signatures: MPCSignature[]
): Extract<MPCSignature, { scheme: "Ed25519" | "ed25519"; signature: number[] }> | null {
  for (const signature of signatures) {
    if (isEd25519Signature(signature)) {
      return signature;
    }
  }
  return null;
}

/**
 * Extract MPC signatures by scanning receipt logs and return values.
 */
export function extractMPCSignatures({
  result,
}: {
  result: FinalExecutionOutcome;
}): MPCSignature[] {
  const signatures: MPCSignature[] = [];

  const collectSignature = (value: unknown) => {
    if (isEd25519Signature(value) || isSecp256k1Signature(value)) {
      signatures.push(value as MPCSignature);
    }
  };

  for (const receipt of result.receipts_outcome) {
    const logs = receipt.outcome.logs;
    for (const log of logs) {
      // Chain signature logs are JSON strings; parse only when they look relevant.
      try {
        if (
          log.includes('"big_r"') ||
          log.includes("big_r") ||
          log.includes('"Ed25519"') ||
          log.includes('"ed25519"') ||
          log.includes('"signature"')
        ) {
          const parsed = JSON.parse(log);
          collectSignature(parsed);
        }
      } catch {
        // Not JSON or not a signature log.
      }
    }

    const returnValue = receipt.outcome.status as Record<string, unknown>;
    if (returnValue && typeof returnValue === "object" && "SuccessValue" in returnValue) {
      try {
        const decoded = Buffer.from(returnValue.SuccessValue as string, "base64").toString();
        const parsed = JSON.parse(decoded);
        if (Array.isArray(parsed)) {
          for (const sig of parsed) {
            collectSignature(sig);
          }
        } else {
          collectSignature(parsed);
        }
      } catch {
        // Ignore non-signature return values.
      }
    }
  }

  return signatures;
}

/**
 * Extract MPC signatures when we only have a result value (no receipts_outcome).
 */
export function extractMPCSignaturesFromResultValue(value: unknown): MPCSignature[] {
  const signatures: MPCSignature[] = [];
  const collectSignature = (candidate: unknown) => {
    if (isEd25519Signature(candidate) || isSecp256k1Signature(candidate)) {
      signatures.push(candidate as MPCSignature);
    }
  };

  if (Array.isArray(value)) {
    for (const item of value) {
      collectSignature(item);
    }
  } else if (value) {
    collectSignature(value);
  }

  return signatures;
}
