import {
  createNearAccount,
  DewClient,
  definePolicies,
  type NearWallet,
} from "../packages/core/dist/index.js";

const requiredSeeds = ["OWNER_SEED_1", "OWNER_SEED_2", "OWNER_SEED_3", "STRATEGIST_SEED"];

const seeds = requiredSeeds.map((key) => process.env[key]);
const missing = requiredSeeds.filter((_, i) => !seeds[i]);
if (missing.length) {
  throw new Error(`Missing seed phrases. Set ${missing.join("/")} in .env.`);
}

const NETWORK_ID = "testnet";
const RPC_URL = "https://rpc.testnet.near.org";
const CHAIN_SIG_DERIVATION_PATH = process.env.CHAIN_SIG_DERIVATION_PATH;

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

const policies = definePolicies({
  grant_role: {
    id: "grant_role",
    description: "Kernel configuration example (grant_role)",
    requiredRole: "owner",
    requiredVoteCount: 1,
    policyType: "KernelConfiguration",
    policyDetails: {
      type: "KernelConfiguration",
    },
    activationTime: "0",
    proposalExpiryTimeNanosec: "0",
    requiredPendingActions: [],
  },
  near_native_policy: {
    id: "near_native_policy",
    description: "NearNativeTransaction example",
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
  chain_sig_near_policy: {
    id: "chain_sig_near_policy",
    description: "ChainSigTransaction example (NearWasm)",
    requiredRole: "strategist",
    requiredVoteCount: 1,
    policyType: "ChainSigTransaction",
    policyDetails: {
      type: "ChainSigTransaction",
      config: {
        derivationPath: CHAIN_SIG_DERIVATION_PATH ?? "0",
        chainEnvironment: "NearWasm",
        restrictions: [],
      },
    },
    activationTime: "0",
    proposalExpiryTimeNanosec: "0",
    requiredPendingActions: [],
  },
  chain_sig_message_policy: {
    id: "chain_sig_message_policy",
    description: "ChainSigMessage example (NEP-413 intents)",
    requiredRole: "strategist",
    requiredVoteCount: 1,
    policyType: "ChainSigMessage",
    policyDetails: {
      type: "ChainSigMessage",
      config: {
        derivationPath: CHAIN_SIG_DERIVATION_PATH ?? "0",
        signMethod: "NearIntentsSwap",
      },
    },
    activationTime: "0",
    proposalExpiryTimeNanosec: "0",
    requiredPendingActions: [],
  },
});

const dew = new DewClient({
  kernelId: "mock.kernel.testnet",
  nearWallet: wallets[0] as NearWallet,
  policies,
});

async function run() {
  // KernelConfiguration example
  await dew.execute({
    id: "grant_role",
    prebuilt: {
      role_id: "strategist",
      target: {
        type: "AccountId",
        accountId: wallets[3].accountId,
      },
    },
  });

  // NearNativeTransaction example (build + encode NEAR transaction)
  const { encodedTx: nearNativeTx } = await dew.buildNearTransaction({
    receiverId: "receiver.testnet",
    actions: [],
    signer: { type: "Account", nearWallet: wallets[0] },
  });

  await dew.execute({
    id: "near_native_policy",
    prebuilt: nearNativeTx,
  });

  // ChainSigTransaction example (NearWasm)
  if (CHAIN_SIG_DERIVATION_PATH) {
    const { encodedTx: chainSigNearTx } = await dew.buildNearTransaction({
      receiverId: "receiver.testnet",
      actions: [],
      signer: {
        type: "ChainSig",
        derivationPath: CHAIN_SIG_DERIVATION_PATH,
        nearNetwork: "Testnet",
      },
    });

    await dew.execute({
      id: "chain_sig_near_policy",
      prebuilt: chainSigNearTx,
      options: { encoding: "base64" },
    });
  } else {
    console.warn("Skipping ChainSigTransaction example: set CHAIN_SIG_DERIVATION_PATH.");
  }

  // ChainSigMessage example (NEP-413 payload is a JSON string)
  if (CHAIN_SIG_DERIVATION_PATH) {
    const intentPayload = {
      nonce: Array.from(new Uint8Array(32)),
      recipient: "intents.near",
      message: JSON.stringify({
        signer_id: "example.testnet",
        deadline: new Date(Date.now() + 60_000).toISOString(),
        intents: [
          {
            intent: "token_diff",
            diff: {
              "nep141:usdc.testnet": "-1",
              "nep141:usdt.testnet": "1",
            },
          },
        ],
      }),
      callback_url: null,
    };

    await dew.proposeExecution({
      policyId: "chain_sig_message_policy",
      functionArgs: JSON.stringify(intentPayload),
    });
  } else {
    console.warn("Skipping ChainSigMessage example: set CHAIN_SIG_DERIVATION_PATH.");
  }
}

run().catch((error) => {
  console.error("Sandbox playground failed:", error);
  process.exitCode = 1;
});
