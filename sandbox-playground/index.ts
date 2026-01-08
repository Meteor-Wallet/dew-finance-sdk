import {
  createNearAccount,
  DewClient,
  definePolicies,
  type NearWallet,
} from "../packages/core/dist/index.js";

const requiredSeeds = ["OWNER_SEED_1"];
const [seed] = requiredSeeds.map((key) => process.env[key]);
if (!seed) {
  throw new Error(`Missing seed phrases. Set ${requiredSeeds.join("/")} in .env.`);
}

const RPC_URL = "https://rpc.testnet.near.org";
const CHAIN_SIG_DERIVATION_PATH = process.env.CHAIN_SIG_DERIVATION_PATH;
const DEFAULT_DERIVATION_PATH = CHAIN_SIG_DERIVATION_PATH ?? "fizz";

const [accountId, privateKey] = seed.split("|").map((value) => value.trim());
if (!accountId || !privateKey) {
  throw new Error(`${requiredSeeds[0]} must be "account.testnet|ed25519:..."`);
}

const wallet: NearWallet = await createNearAccount({
  rpcUrl: RPC_URL,
  accountId,
  privateKey,
});

const policies = definePolicies({
  foo_kernel_no_builder: {
    id: "foo_kernel_no_builder",
    description: "KernelConfiguration example (no builder)",
    required_role: "owner",
    required_vote_count: 1,
    policy_type: "KernelConfiguration",
    policy_details: "KernelConfiguration",
    activation_time: "0",
    proposal_expiry_time_nanosec: "0",
    required_pending_actions: [],
  },
  fizz_chain_sig_prebuilt: {
    id: "fizz_chain_sig_prebuilt",
    description: "ChainSigTransaction example with builder (prebuilt)",
    required_role: "strategist",
    required_vote_count: 1,
    policy_type: "ChainSigTransaction",
    policy_details: {
      ChainSigTransaction: {
        derivation_path: DEFAULT_DERIVATION_PATH,
        chain_environment: "NearWasm",
        restrictions: [],
      },
    },
    activation_time: "0",
    proposal_expiry_time_nanosec: "0",
    required_pending_actions: [],
    builder: () => ({
      receiverId: "bar.receiver.testnet",
      actions: [],
      signer: {
        type: "ChainSig",
        derivationPath: DEFAULT_DERIVATION_PATH,
        nearNetwork: "Testnet",
      },
    }),
  },
  buzz_chain_sig_args: {
    id: "buzz_chain_sig_args",
    description: "ChainSigTransaction example with builder (args)",
    required_role: "strategist",
    required_vote_count: 1,
    policy_type: "ChainSigTransaction",
    policy_details: {
      ChainSigTransaction: {
        derivation_path: DEFAULT_DERIVATION_PATH,
        chain_environment: "NearWasm",
        restrictions: [],
      },
    },
    activation_time: "0",
    proposal_expiry_time_nanosec: "0",
    required_pending_actions: [],
    builder: (receiverId: string, derivationPath: string) => ({
      receiverId,
      actions: [],
      signer: {
        type: "ChainSig",
        derivationPath,
        nearNetwork: "Testnet",
      },
    }),
  },
});

const dew = new DewClient({
  kernelId: "foo.kernel.testnet",
  nearWallet: wallet,
  policies,
});

async function run() {
  // 1) Policy without builder: use proposeExecution directly.
  await dew.proposeExecution({
    policyId: "foo_kernel_no_builder",
    functionArgs: {
      foo: "bar",
      fizz: "buzz",
    },
  });

  if (!CHAIN_SIG_DERIVATION_PATH) {
    console.warn("CHAIN_SIG_DERIVATION_PATH is not set; using 'fizz' placeholder.");
  }

  // 2) ChainSig policy with builder (prebuilt).
  await dew.execute({
    id: "fizz_chain_sig_prebuilt",
    prebuilt: true,
    options: { encoding: "base64" },
  });

  // 3) ChainSig policy with builder (args).
  await dew.execute({
    id: "buzz_chain_sig_args",
    args: ["foo.receiver.testnet", DEFAULT_DERIVATION_PATH],
    options: { encoding: "base64" },
  });
}

run().catch((error) => {
  console.error("Sandbox playground failed:", error);
  process.exitCode = 1;
});
