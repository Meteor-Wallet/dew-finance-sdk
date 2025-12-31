import type { ChainEnvironment, Policy, PolicyRestriction } from "@dew-finance/core";
import { DEFAULT_POLICY_ACTIVATION_TIME, DEFAULT_POLICY_EXPIRY_NS } from "@dew-finance/core";
import { DEFAULT_BURROW_CONTRACT_ID } from "./constants.js";

type BurrowPolicyBase = {
  policyId: string;
  description?: string;
  requiredRole: string;
  requiredVoteCount: number;
  derivationPath: string;
  chainEnvironment?: ChainEnvironment;
  activationTime?: string;
  proposalExpiryTimeNanosec?: string;
  requiredPendingActions?: string[];
  burrowId?: string;
};

type BurrowTokenPolicy = BurrowPolicyBase & {
  tokenId: string;
};

function buildRestrictionSchema({
  predicates,
  indent = "  ",
}: {
  predicates: string[];
  indent?: string;
}): string {
  const lines = predicates.map((predicate) => `${indent}${predicate}`);
  return `and(\n${lines.join(",\n")}\n)`;
}

function buildChainSigTransactionPolicy({
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
  chainEnvironment: ChainEnvironment;
  restrictions: PolicyRestriction[];
  activationTime: string;
  proposalExpiryTimeNanosec: string;
  requiredPendingActions: string[];
}): Policy {
  return {
    id: policyId,
    description,
    requiredRole,
    requiredVoteCount,
    policyType: "ChainSigTransaction",
    policyDetails: {
      type: "ChainSigTransaction",
      config: {
        derivationPath,
        chainEnvironment,
        restrictions,
      },
    },
    activationTime,
    proposalExpiryTimeNanosec,
    requiredPendingActions,
  };
}

function resolvePolicyMeta(params: BurrowPolicyBase): {
  chainEnvironment: ChainEnvironment;
  activationTime: string;
  proposalExpiryTimeNanosec: string;
  requiredPendingActions: string[];
  burrowId: string;
} {
  return {
    chainEnvironment: params.chainEnvironment ?? "NearWasm",
    activationTime: params.activationTime ?? DEFAULT_POLICY_ACTIVATION_TIME,
    proposalExpiryTimeNanosec: params.proposalExpiryTimeNanosec ?? DEFAULT_POLICY_EXPIRY_NS,
    requiredPendingActions: params.requiredPendingActions ?? [],
    burrowId: params.burrowId ?? DEFAULT_BURROW_CONTRACT_ID,
  };
}

export function createBurrowIncreaseCollateralPolicy(params: BurrowTokenPolicy): Policy {
  const meta = resolvePolicyMeta(params);
  const restrictions: PolicyRestriction[] = [
    {
      schema: buildRestrictionSchema({
        predicates: [
          `$.contract_id.equal("${params.tokenId}")`,
          `$.function_name.equal("ft_transfer_call")`,
          `$.args.receiver_id.equal("${meta.burrowId}")`,
          `$.args.msg.json().Execute.actions.get_index(0).IncreaseCollateral.token_id.equal("${params.tokenId}")`,
        ],
      }),
      interface: "",
    },
  ];

  return buildChainSigTransactionPolicy({
    policyId: params.policyId,
    description: params.description ?? `Burrow: increase collateral for ${params.tokenId}`,
    requiredRole: params.requiredRole,
    requiredVoteCount: params.requiredVoteCount,
    derivationPath: params.derivationPath,
    chainEnvironment: meta.chainEnvironment,
    restrictions,
    activationTime: meta.activationTime,
    proposalExpiryTimeNanosec: meta.proposalExpiryTimeNanosec,
    requiredPendingActions: meta.requiredPendingActions,
  });
}

export function createBurrowRepayPolicy(params: BurrowTokenPolicy): Policy {
  const meta = resolvePolicyMeta(params);
  const restrictions: PolicyRestriction[] = [
    {
      schema: buildRestrictionSchema({
        predicates: [
          `$.contract_id.equal("${params.tokenId}")`,
          `$.function_name.equal("ft_transfer_call")`,
          `$.args.receiver_id.equal("${meta.burrowId}")`,
          `$.args.msg.json().Execute.actions.get_index(0).Repay.token_id.equal("${params.tokenId}")`,
        ],
      }),
      interface: "",
    },
  ];

  return buildChainSigTransactionPolicy({
    policyId: params.policyId,
    description: params.description ?? `Burrow: repay ${params.tokenId}`,
    requiredRole: params.requiredRole,
    requiredVoteCount: params.requiredVoteCount,
    derivationPath: params.derivationPath,
    chainEnvironment: meta.chainEnvironment,
    restrictions,
    activationTime: meta.activationTime,
    proposalExpiryTimeNanosec: meta.proposalExpiryTimeNanosec,
    requiredPendingActions: meta.requiredPendingActions,
  });
}

export function createBurrowBorrowAndWithdrawPolicy(params: BurrowTokenPolicy): Policy {
  const meta = resolvePolicyMeta(params);
  const restrictions: PolicyRestriction[] = [
    {
      schema: buildRestrictionSchema({
        predicates: [
          `$.contract_id.equal("${meta.burrowId}")`,
          `$.function_name.equal("execute_with_pyth")`,
          `$.args.actions.get_index(0).Borrow.token_id.equal("${params.tokenId}")`,
          `$.args.actions.get_index(1).Withdraw.token_id.equal("${params.tokenId}")`,
        ],
      }),
      interface: "",
    },
  ];

  return buildChainSigTransactionPolicy({
    policyId: params.policyId,
    description: params.description ?? `Burrow: borrow + withdraw ${params.tokenId}`,
    requiredRole: params.requiredRole,
    requiredVoteCount: params.requiredVoteCount,
    derivationPath: params.derivationPath,
    chainEnvironment: meta.chainEnvironment,
    restrictions,
    activationTime: meta.activationTime,
    proposalExpiryTimeNanosec: meta.proposalExpiryTimeNanosec,
    requiredPendingActions: meta.requiredPendingActions,
  });
}

export function createBurrowDecreaseCollateralAndWithdrawPolicy(params: BurrowTokenPolicy): Policy {
  const meta = resolvePolicyMeta(params);
  const restrictions: PolicyRestriction[] = [
    {
      schema: buildRestrictionSchema({
        predicates: [
          `$.contract_id.equal("${meta.burrowId}")`,
          `$.function_name.equal("execute_with_pyth")`,
          `$.args.actions.get_index(0).DecreaseCollateral.token_id.equal("${params.tokenId}")`,
          `$.args.actions.get_index(1).Withdraw.token_id.equal("${params.tokenId}")`,
        ],
      }),
      interface: "",
    },
  ];

  return buildChainSigTransactionPolicy({
    policyId: params.policyId,
    description: params.description ?? `Burrow: decrease collateral + withdraw ${params.tokenId}`,
    requiredRole: params.requiredRole,
    requiredVoteCount: params.requiredVoteCount,
    derivationPath: params.derivationPath,
    chainEnvironment: meta.chainEnvironment,
    restrictions,
    activationTime: meta.activationTime,
    proposalExpiryTimeNanosec: meta.proposalExpiryTimeNanosec,
    requiredPendingActions: meta.requiredPendingActions,
  });
}

export function createBurrowWithdrawPolicy(params: BurrowTokenPolicy): Policy {
  const meta = resolvePolicyMeta(params);
  const restrictions: PolicyRestriction[] = [
    {
      schema: buildRestrictionSchema({
        predicates: [
          `$.contract_id.equal("${meta.burrowId}")`,
          `$.function_name.equal("execute")`,
          `$.args.actions.get_index(0).Withdraw.token_id.equal("${params.tokenId}")`,
        ],
      }),
      interface: "",
    },
  ];

  return buildChainSigTransactionPolicy({
    policyId: params.policyId,
    description: params.description ?? `Burrow: withdraw ${params.tokenId}`,
    requiredRole: params.requiredRole,
    requiredVoteCount: params.requiredVoteCount,
    derivationPath: params.derivationPath,
    chainEnvironment: meta.chainEnvironment,
    restrictions,
    activationTime: meta.activationTime,
    proposalExpiryTimeNanosec: meta.proposalExpiryTimeNanosec,
    requiredPendingActions: meta.requiredPendingActions,
  });
}

export function createBurrowClaimAllRewardsPolicy(params: BurrowPolicyBase): Policy {
  const meta = resolvePolicyMeta(params);
  const restrictions: PolicyRestriction[] = [
    {
      schema: buildRestrictionSchema({
        predicates: [
          `$.contract_id.equal("${meta.burrowId}")`,
          `$.function_name.equal("account_farm_claim_all")`,
        ],
      }),
      interface: "",
    },
  ];

  return buildChainSigTransactionPolicy({
    policyId: params.policyId,
    description: params.description ?? "Burrow: claim farm rewards",
    requiredRole: params.requiredRole,
    requiredVoteCount: params.requiredVoteCount,
    derivationPath: params.derivationPath,
    chainEnvironment: meta.chainEnvironment,
    restrictions,
    activationTime: meta.activationTime,
    proposalExpiryTimeNanosec: meta.proposalExpiryTimeNanosec,
    requiredPendingActions: meta.requiredPendingActions,
  });
}
