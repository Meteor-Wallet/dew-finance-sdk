# Dew Finance SDK

Vault curation tooling for Dew Finance kernels across NEAR and ChainSig transactions.

## Dew Kernel

A Dew Kernel is a NEAR smart contract that manages vault policies and configuration, and uses NEAR chain signatures to execute ChainSig transactions on other blockchains. It also supports Shade Agents for delegated, automated execution.

Key features:

- Roles
- Policies
- Proposals and voting
- Agents
- Chain signatures

Key responsibilities:

- Manage a smart contract vault (pricing, deposits, withdrawals)
- Move and allocate funds across chains and protocols
- Manage kernel and vault policy configuration

## What this SDK does

This SDK abstracts kernel interactions so higher-level vault operations are simpler to build and execute. For example, a cross-chain action can be composed as:

- Build a ChainSig transaction for the target chain
- Propose execution on the kernel under a policy
- Collect votes if required (auto-execute if the threshold is met)
- Extract signatures and optionally broadcast signed transactions

It also includes helpers for intents-based bridging and common polling patterns.

## Current scope

- Core kernel methods (propose, vote, query)
- Proposal helpers for ChainSig policies and signature extraction
- Broadcast utilities for signed NEAR and ChainSig transactions
- Auto-execute detection for proposals
- NEAR intents bridging helpers
- NEAR intents swapping helpers
- NEAR intents policy builders (ft deposit/withdraw, ERC-20 transfer, swap signing)
- Dew Vault (NEAR) client: propose helpers, policy builders (ChainSigTransaction), and full getter suite

Policy typing:

- `Policy` reflects the on-chain schema for kernel methods like `upsert_policy`.
- `PolicySpec` is the client-side typed wrapper used to attach builders and drive `DewClient.execute`.
- Use `definePolicies(...)` (or `satisfies PolicySpecMap`) to preserve literal policy IDs and builder signatures so `DewClient.execute` can infer `args`.
- For builder-backed policies, prefer `*PolicySpecWithBuilder` types to keep builders required and args typed.
- `NearNativeTransaction` and `ChainSigTransaction` (NearWasm) expect a base64-encoded, Borsh-serialized NEAR transaction string. Use `DewClient.buildNearTransaction` to construct `encodedTx`, or return `NearTransactionBuildParams` from a policy builder so `DewClient.execute` can build it for you.

## Roadmap

- Dew Vault (EVM) support
- CLI tools for deploying kernels and vaults
- Pre-made policies for kernel configuration
- Shade Agent templates

## Packages

- `@dew-finance/core`: DewClient, DewNearVaultClient, core types, and NEAR/ChainSig utilities (broadcasting, intents, policy builders, polling).
- `@dew-finance/protocols`: Protocol adapters and helpers (Burrow views/actions/policies, Ref Finance swap quotes, Burrow math utilities).

## Protocol adapters

Lightweight helpers for protocol-specific actions and reads. These are composable building blocks and do not handle signing or execution.

```ts
import { burrow } from "@dew-finance/protocols";
import { DewClient } from "@dew-finance/core";

const client = new DewClient({ kernelId: "kernel.near", nearWallet });

const action = burrow.buildBorrowAndWithdraw({
  tokenId: "usdt.tether-token.near",
  amount: "1000000", // Burrow internal decimals
});

const { encodedTx } = await client.buildNearTransaction({
  receiverId: "contract.main.burrow.near",
  actions: [action],
  signer: { type: "ChainSig", derivationPath: "1", nearNetwork: "Mainnet" },
});

await client.proposeChainSigTransaction({ policyId: "borrow_usdt", encodedTx });
```

## Requirements

- Node.js >= 22
- bun (workspace uses `bun@1.3.0`)
- NEAR RPC access and an `@near-js/accounts` `Account` signer
- Chain RPC access for ChainSig broadcasting

Ledger support is planned; today the SDK uses `@near-js/*` signers for signing.

## Local setup

This repo is not published to npm yet. Use the workspace directly:

```bash
bun install
bun run build
```

## Related repositories

- <https://github.com/Meteor-Wallet/dew-finance-contract>
- <https://github.com/Meteor-Wallet/rNear-vault-public>
