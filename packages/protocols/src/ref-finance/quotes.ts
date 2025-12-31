export type RefFinanceSwapRoute = {
  pools: Array<{
    pool_id: string;
    token_in: string;
    token_out: string;
    amount_in: string;
    min_amount_out: string;
  }>;
  amount_in: string;
  min_amount_out: string;
};

export type RefFinanceSwapQuote = {
  routes: RefFinanceSwapRoute[];
  contract_in: string;
  contract_out: string;
  amount_in: string;
  amount_out: string;
};

export async function getSwapQuote({
  amountIn,
  tokenIn,
  tokenOut,
  slippage,
  pathDeep = 3,
}: {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippage: number;
  pathDeep?: number;
}): Promise<RefFinanceSwapQuote> {
  const url = new URL("https://smartrouter.rhea.finance/findPath");
  url.searchParams.set("amountIn", amountIn);
  url.searchParams.set("tokenIn", tokenIn);
  url.searchParams.set("tokenOut", tokenOut);
  url.searchParams.set("slippage", slippage.toString());
  url.searchParams.set("pathDeep", pathDeep.toString());

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to get swap quote for ${amountIn} ${tokenIn} -> ${tokenOut}`);
  }

  const json = (await response.json()) as {
    result_code: number;
    result_message: string;
    result_data: RefFinanceSwapQuote;
  };

  if (json.result_code !== 0) {
    throw new Error(
      `Failed to get swap quote for ${amountIn} ${tokenIn} -> ${tokenOut}. ${json.result_message}`
    );
  }

  return json.result_data;
}
