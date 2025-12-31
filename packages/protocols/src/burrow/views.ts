import { JsonRpcProvider } from "@near-js/providers";
import type { NearRpcOptions } from "@dew-finance/core";
import type {
  BurrowAccountDetail,
  BurrowAsset,
  BurrowConfig,
  BurrowContractId,
  BurrowPythPrice,
  TokenPythInfo,
} from "./types.js";
import Big from "big.js";
import { DEFAULT_BURROW_CONTRACT_ID } from "./constants.js";

export type BurrowViewOptions = NearRpcOptions & {
  burrowId?: BurrowContractId;
};

function resolveNearProvider({ nearProvider, nearRpcUrl }: NearRpcOptions): JsonRpcProvider {
  if (nearProvider) {
    return nearProvider;
  }
  if (nearRpcUrl) {
    return new JsonRpcProvider({ url: nearRpcUrl });
  }
  throw new Error("Missing nearProvider or nearRpcUrl for Burrow view call.");
}

async function viewFunction<T>({
  contractId,
  method,
  args,
  options,
}: {
  contractId: string;
  method: string;
  args: Record<string, unknown>;
  options: NearRpcOptions;
}): Promise<T> {
  const provider = resolveNearProvider(options);
  const res = (await provider.query({
    request_type: "call_function",
    account_id: contractId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "optimistic",
  })) as { result?: Uint8Array; body?: Uint8Array };
  const raw: Uint8Array = res.result ?? res.body ?? new Uint8Array();
  const text = Buffer.from(raw).toString();
  return text ? (JSON.parse(text) as T) : (null as unknown as T);
}

export async function getBurrowConfig(params: BurrowViewOptions = {}): Promise<BurrowConfig> {
  const { burrowId = DEFAULT_BURROW_CONTRACT_ID, ...options } = params;
  return viewFunction<BurrowConfig>({
    contractId: burrowId,
    method: "get_config",
    args: {},
    options,
  });
}

export async function getTokenPythInfo({
  tokenId,
  ...options
}: BurrowViewOptions & { tokenId: string }): Promise<TokenPythInfo> {
  const { burrowId = DEFAULT_BURROW_CONTRACT_ID } = options;
  return viewFunction<TokenPythInfo>({
    contractId: burrowId,
    method: "get_token_pyth_info",
    args: { token_id: tokenId },
    options,
  });
}

export async function getAsset({
  tokenId,
  ...options
}: BurrowViewOptions & { tokenId: string }): Promise<BurrowAsset> {
  const { burrowId = DEFAULT_BURROW_CONTRACT_ID } = options;
  return viewFunction<BurrowAsset>({
    contractId: burrowId,
    method: "get_asset",
    args: { token_id: tokenId },
    options,
  });
}

export async function getAccount({
  accountId,
  ...options
}: BurrowViewOptions & { accountId: string }): Promise<BurrowAccountDetail> {
  const { burrowId = DEFAULT_BURROW_CONTRACT_ID } = options;
  return viewFunction<BurrowAccountDetail>({
    contractId: burrowId,
    method: "get_account",
    args: { account_id: accountId },
    options,
  });
}

export function getBurrowDecimals({ pythInfo }: { pythInfo: TokenPythInfo }): number {
  return Math.max(18, pythInfo.decimals);
}

export function getCollateralFactor({ asset }: { asset: BurrowAsset }): number {
  return asset.config.volatility_ratio / 10000;
}

export async function fetchTokenPythPrice({
  tokenId,
  age = 60,
  ...options
}: BurrowViewOptions & { tokenId: string; age?: number }): Promise<Big> {
  const pythInfo = await getTokenPythInfo({ tokenId, ...options });
  const burrowConfig = await getBurrowConfig(options);

  const pythPrice = await viewFunction<BurrowPythPrice>({
    contractId: burrowConfig.pyth_oracle_account_id,
    method: "get_price_no_older_than",
    args: {
      price_id: pythInfo.price_identifier,
      age,
    },
    options,
  });

  if (!pythPrice) {
    throw new Error(`Pyth price not found for ${tokenId}`);
  }

  let extraCallMultiplier = Big(1);
  if (pythInfo.extra_call) {
    const rawMultiplier = await viewFunction<string>({
      contractId: tokenId,
      method: pythInfo.extra_call,
      args: {},
      options,
    });

    if (!rawMultiplier) {
      throw new Error(`Unable to get extra call result for ${tokenId}`);
    }

    extraCallMultiplier = Big(rawMultiplier).div(Big(10).pow(pythInfo.decimals));
  }

  return Big(pythPrice.price).mul(extraCallMultiplier).mul(Big(10).pow(pythPrice.expo));
}
