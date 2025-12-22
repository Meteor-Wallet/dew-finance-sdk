# Dew Finance SDK

Vault curation tooling for Dew Finance kernels across NEAR and EVM.

## Dew Kernel

A Dew Kernel is a NEAR smart contract that manages vault policies and configuration, and uses NEAR chain signatures to execute transactions on other blockchains. It also supports Shade Agents for delegated, automated execution.

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

- Build a transaction for the target chain
- Propose execution on the kernel under a policy
- Collect votes if required (auto-execute if the threshold is met)
- Extract signatures and optionally broadcast signed transactions

It also includes helpers for intents-based bridging and common polling patterns.

## Current scope

- Core kernel methods (propose, vote, query)
- Proposal helpers for ChainSig policies and signature extraction
- Broadcast utilities for signed NEAR and EVM transactions
- Auto-execute detection for proposals
- NEAR intents bridging helpers
- Dew Vault (NEAR) client: propose helpers, policies, and full getter suite

## Roadmap

- NEAR intents swapping
- Dew Vault (EVM) support
- CLI tools for deploying kernels and vaults
- Pre-made policies for kernel configuration
- Shade Agent templates

## Packages

- `@dew-finance/core`: DewClient, DewNearVaultClient, core types, and NEAR/EVM utilities (broadcasting, intents, polling).

## Requirements

- Node.js >= 18
- pnpm (workspace uses `pnpm@8`)
- NEAR RPC access and a `near-api-js` Account signer
- Optional EVM RPC access for broadcasting

Ledger support is planned; today the SDK uses `near-api-js` for signing.

## Local setup

This repo is not published to npm yet. Use the workspace directly:

```bash
pnpm install
pnpm build
```

## Related repositories

- <https://github.com/Meteor-Wallet/dew-finance-contract>
- <https://github.com/Meteor-Wallet/rNear-vault-public>
