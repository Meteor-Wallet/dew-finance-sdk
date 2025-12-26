import {
  createNearAccount,
  DewClient,
  definePolicies,
  type NearWallet,
  type NearNativeExecutionPayload,
  type NearNativePolicySpec,
  type NearNativePolicySpecWithBuilder,
} from "../packages/core/dist/index.js";
import { depositToIntents, withdrawFromIntents } from "../packages/core/dist/utils/intents.js";

const requiredSeeds = ["OWNER_SEED_1", "OWNER_SEED_2", "OWNER_SEED_3", "STRATEGIST_SEED"];

const seeds = requiredSeeds.map((key) => process.env[key]);
const missing = requiredSeeds.filter((_, i) => !seeds[i]);
if (missing.length) {
  throw new Error(`Missing seed phrases. Set ${missing.join("/")} in .env.`);
}

const NETWORK_ID = "testnet";
const RPC_URL = "https://rpc.testnet.near.org";

const wallets: NearWallet[] = await Promise.all(
  seeds.map((seed, i) => {
    const [accountId, privateKey] = (seed as string).split("|").map((s) => s.trim());
    if (!accountId || !privateKey) {
      throw new Error(`${requiredSeeds[i]} must be "account.testnet|ed25519:..."`);
    }
    return createNearAccount({
      rpcUrl: RPC_URL,
      networkId: NETWORK_ID,
      accountId,
      privateKey,
    });
  })
);

const emptyNearPayload: NearNativeExecutionPayload = {
  receiverId: "receiver.testnet",
  actions: [],
};

const policyWithoutBuilder = {
  id: "near_policy",
  description: "near_policy",
  requiredRole: "owner",
  requiredVoteCount: 1,
  policyType: "NearNativeTransaction",
  policyDetails: {
    type: "NearNativeTransaction",
    config: {
      chainEnvironment: "NearWasm",
      restrictions: [],
    },
  },
  activationTime: "0",
  proposalExpiryTimeNanosec: "0",
  requiredPendingActions: [],
} satisfies NearNativePolicySpec;

const policyWithBuilder = {
  id: "near_policy",
  description: "near_policy",
  requiredRole: "owner",
  requiredVoteCount: 1,
  policyType: "NearNativeTransaction",
  policyDetails: {
    type: "NearNativeTransaction",
    config: {
      chainEnvironment: "NearWasm",
      restrictions: [],
    },
  },
  activationTime: "0",
  proposalExpiryTimeNanosec: "0",
  requiredPendingActions: [],
  builder: (args: { foo: string; bar: number }): NearNativeExecutionPayload => {
    if (!args.foo) {
      return emptyNearPayload;
    }
    return emptyNearPayload;
  },
} satisfies NearNativePolicySpecWithBuilder<[{ foo: string; bar: number }]>;

const policyWithBuilder2 = {
  id: "near_policy",
  description: "near_policy",
  requiredRole: "owner",
  requiredVoteCount: 1,
  policyType: "NearNativeTransaction",
  policyDetails: {
    type: "NearNativeTransaction",
    config: {
      chainEnvironment: "NearWasm",
      restrictions: [],
    },
  },
  activationTime: "0",
  proposalExpiryTimeNanosec: "0",
  requiredPendingActions: [],
  builder: (args: { foo: string; bar: number; fizz: bigint }): NearNativeExecutionPayload => {
    if (!args.foo) {
      return emptyNearPayload;
    }
    if (args.fizz > 0n) {
      return emptyNearPayload;
    }
    return emptyNearPayload;
  },
} satisfies NearNativePolicySpecWithBuilder<[{ foo: string; bar: number; fizz: bigint }]>;

const policies = definePolicies({
  policyWithoutBuilder,
  policyWithBuilder,
  policyWithBuilder2,
});

const dew = new DewClient({
  kernelId: "mock.kernel.testnet",
  nearWallet: wallets[0] as NearWallet,
  policies,
});

dew.execute({
  id: "policyWithoutBuilder",
  prebuilt: emptyNearPayload,
});

dew.execute({
  id: "policyWithBuilder",
  args: [{ foo: "bar", bar: 123 }],
});

dew.execute({
  id: "policyWithBuilder2",
  args: [{ foo: "bar", bar: 123, fizz: BigInt(456) }],
});

async function run() {
  // Propose + Auto Execute (1 vote required by policy)
  await dew.upsertPolicy({
    targetPolicyId: "near_policy",
    policy: {
      id: "near_policy",
      description: "near_policy",
      requiredRole: "owner",
      requiredVoteCount: 1,
      policyType: "NearNativeTransaction",
      policyDetails: {
        type: "NearNativeTransaction",
        config: {
          chainEnvironment: "NearWasm",
          restrictions: [],
        },
      },
      activationTime: "0",
      proposalExpiryTimeNanosec: "0",
      requiredPendingActions: [],
    },
  });
  // Propose and vote (1 < votes required by policy)
  const proposal = await dew.grantRole({
    roleId: "strategist",
    target: {
      type: "AccountId",
      accountId: wallets[3].accountId,
    },
  });
  await dew.voteOnProposal({
    proposalId: proposal.proposalId,
    options: { nearWallet: wallets[1] },
  });
  const finalVote = await dew.voteOnProposal({
    proposalId: proposal.proposalId,
    options: { nearWallet: wallets[2] },
  });
  console.log("grant_role executed:", finalVote.executed);

  const nearTx = await dew.proposeNearActions({
    policyId: "near_policy",
    receiverId: "receiver.testnet",
    actions: [],
  });
  console.log("near tx executed:", nearTx.executed);

  const evmTx = await dew.proposeChainSigTransaction({
    policyId: "evm_policy",
    encodedTx: "0xdead",
  });
  console.log("chain sig tx executed", evmTx);

  const deposit = await depositToIntents({
    client: dew,
    policyId: "1",
    tokenId: "usdc.testnet",
    amount: "1000000",
  });
  console.log("intent deposit executed:", deposit.executed);

  const withdraw = await withdrawFromIntents({
    client: dew,
    policyId: "1",
    tokenId: "nep141:usdc.testnet",
    amount: "500000",
    destination: "destination.testnet",
  });
  console.log("intent withdraw executed:", withdraw.executed);

  console.log("intent swap: missing SDK helper");
}

run().catch((error) => {
  console.error("Sandbox playground failed:", error);
  process.exitCode = 1;
});
