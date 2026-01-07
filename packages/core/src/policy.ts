/**
 * Shared policy defaults
 * @packageDocumentation
 */

import type { Policy } from "./types.js";

export const DEFAULT_POLICY_ACTIVATION_TIME = "0";
export const DEFAULT_POLICY_EXPIRY_NS = "86400000000000";

function pickPolicyForComparison(
  policy: Policy | Record<string, unknown>
): Record<string, unknown> | null {
  if (!policy || typeof policy !== "object") {
    return null;
  }
  const raw = policy as Record<string, unknown>;
  const id = readField(raw, "id");
  if (typeof id !== "string" || id.length === 0) {
    return null;
  }

  const descriptionValue = readField(raw, "description");
  const description =
    descriptionValue === undefined || descriptionValue === null ? null : descriptionValue;

  return {
    id,
    description,
    required_role: readField(raw, "requiredRole", "required_role"),
    required_vote_count: readField(raw, "requiredVoteCount", "required_vote_count"),
    proposal_expiry_time_nanosec: readField(
      raw,
      "proposalExpiryTimeNanosec",
      "proposal_expiry_time_nanosec"
    ),
    required_pending_actions: readField(raw, "requiredPendingActions", "required_pending_actions"),
    policy_type: readField(raw, "policyType", "policy_type"),
    policy_details: readField(raw, "policyDetails", "policy_details"),
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortForStableStringify(value));
}

function readField(record: Record<string, unknown>, camel: string, snake?: string): unknown {
  if (camel in record) {
    return record[camel];
  }
  if (snake && snake in record) {
    return record[snake];
  }
  return undefined;
}

function sortForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortForStableStringify(entry));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry === undefined) {
        continue;
      }
      sorted[key] = sortForStableStringify(entry);
    }
    return sorted;
  }
  return value;
}

export function arePoliciesEqual(
  left: Policy | Record<string, unknown>,
  right: Policy | Record<string, unknown>
): boolean {
  const normalizedLeft = pickPolicyForComparison(left);
  const normalizedRight = pickPolicyForComparison(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return stableStringify(normalizedLeft) === stableStringify(normalizedRight);
}
