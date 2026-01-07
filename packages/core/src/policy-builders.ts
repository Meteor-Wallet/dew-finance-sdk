/**
 * Dew Finance SDK - Policy Builders
 * @packageDocumentation
 */

import type {
  ChainEnvironment,
  ChainSigPolicySpec,
  KernelConfigPolicySpec,
  PolicyRestriction,
} from "./types.js";
import { DEFAULT_POLICY_ACTIVATION_TIME, DEFAULT_POLICY_EXPIRY_NS } from "./policy.js";

export function buildRestrictionSchema({
  predicates,
  indent = "  ",
}: {
  predicates: string[];
  indent?: string;
}): string {
  const lines = predicates.map((predicate) => `${indent}${predicate}`);
  return `and(\n${lines.join(",\n")}\n)`;
}

export function buildChainSigTransactionPolicy({
  policyId,
  description,
  requiredRole,
  requiredVoteCount,
  derivationPath,
  chainEnvironment,
  restrictions,
  activationTime,
  proposalExpiryTimeNanosec,
  requiredPendingActions,
}: {
  policyId: string;
  description: string;
  requiredRole: string;
  requiredVoteCount: number;
  derivationPath: string;
  chainEnvironment?: ChainEnvironment;
  restrictions: PolicyRestriction[];
  activationTime?: string;
  proposalExpiryTimeNanosec?: string;
  requiredPendingActions?: string[];
}): ChainSigPolicySpec {
  return {
    id: policyId,
    description,
    required_role: requiredRole,
    required_vote_count: requiredVoteCount,
    policy_type: "ChainSigTransaction",
    policy_details: {
      ChainSigTransaction: {
        derivation_path: derivationPath,
        chain_environment: chainEnvironment ?? "NearWasm",
        restrictions,
      },
    },
    activation_time: activationTime ?? DEFAULT_POLICY_ACTIVATION_TIME,
    proposal_expiry_time_nanosec: proposalExpiryTimeNanosec ?? DEFAULT_POLICY_EXPIRY_NS,
    required_pending_actions: requiredPendingActions ?? [],
  };
}

export function buildKernelConfigPolicy({
  policyId,
  description,
  requiredRole,
  requiredVoteCount,
  activationTime,
  proposalExpiryTimeNanosec,
  requiredPendingActions,
}: {
  policyId: string;
  description: string;
  requiredRole: string;
  requiredVoteCount: number;
  activationTime?: string;
  proposalExpiryTimeNanosec?: string;
  requiredPendingActions?: string[];
}): KernelConfigPolicySpec {
  return {
    id: policyId,
    description,
    required_role: requiredRole,
    required_vote_count: requiredVoteCount,
    policy_type: "KernelConfiguration",
    policy_details: "KernelConfiguration",
    activation_time: activationTime ?? DEFAULT_POLICY_ACTIVATION_TIME,
    proposal_expiry_time_nanosec: proposalExpiryTimeNanosec ?? DEFAULT_POLICY_EXPIRY_NS,
    required_pending_actions: requiredPendingActions ?? [],
  };
}
