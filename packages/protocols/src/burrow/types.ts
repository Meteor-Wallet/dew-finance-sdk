/**
 * Burrow protocol types (on-chain JSON shapes)
 */

export interface BurrowAssetShareBalance {
  shares: string;
  balance: string;
}

export interface BurrowAssetShareBalanceWithCustom extends BurrowAssetShareBalance {
  balance_formatted?: string;
  usd?: string;
}

export interface BurrowAssetShareBalanceWithCustomWithId extends BurrowAssetShareBalanceWithCustom {
  token_id: string;
  apr: string;
  farm_apr?: string;
}

export interface BurrowReward {
  reward_per_day: string;
  booster_log_base: string;
  remaining_rewards: string;
  boosted_shares: string;
}

export interface BurrowAccountDetail {
  account_id: string;
  supplied: BurrowAssetShareBalanceWithCustomWithId[];
  collateral: BurrowAssetShareBalanceWithCustomWithId[];
  borrowed: BurrowAssetShareBalanceWithCustomWithId[];
  farms: Array<{
    farm_id:
      | {
          TokenNetBalance?: string;
          Supplied?: string;
        }
      | "NetTvl";
    rewards: Array<{
      reward_token_id: string;
      asset_farm_reward: BurrowReward;
      boosted_shares: string;
      unclaimed_amount: string;
    }>;
  }>;
  has_non_farmed_assets: boolean;
  booster_staking: null | {
    staked_booster_amount: string;
    x_booster_amount: string;
    unlock_timestamp: string;
  };
  booster_stakings: Record<
    string,
    {
      staked_booster_amount: string;
      x_booster_amount: string;
      unlock_timestamp: string;
    }
  >;
}

export interface BurrowConfig {
  boost_suppress_factor: number;
  booster_decimals: number;
  booster_token_id: string;
  dcl_id: string | null;
  enable_price_oracle: boolean;
  enable_pyth_oracle: boolean;
  force_closing_enabled: boolean;
  lp_tokens_info_valid_duration_sec: number;
  max_num_assets: number;
  maximum_recency_duration_sec: number;
  maximum_staking_duration_sec: number;
  maximum_staleness_duration_sec: number;
  minimum_staking_duration_sec: number;
  oracle_account_id: string;
  owner_id: string;
  pyth_oracle_account_id: string;
  pyth_price_valid_duration_sec: number;
  ref_exchange_id: string;
  x_booster_multiplier_at_maximum_staking_duration: number;
}

export interface TokenPythInfo {
  decimals: number;
  default_price: number | null;
  extra_call: string | null;
  fraction_digits: number;
  price_identifier: string | null;
}

export interface BurrowPythPrice {
  conf: string;
  expo: number;
  price: string;
  publish_time: number;
}

export interface BurrowAsset {
  borrowed: {
    balance: string;
    shares: string;
  };
  config: {
    borrowed_limit: string | null;
    can_borrow: boolean;
    can_deposit: boolean;
    can_use_as_collateral: boolean;
    can_withdraw: boolean;
    extra_decimals: number;
    holding_position_fee_rate: string;
    max_change_rate: string | null;
    max_utilization_rate: string;
    min_borrowed_amount: string | null;
    net_tvl_multiplier: number;
    prot_ratio?: number;
    reserve_ratio: number;
    supplied_limit: string | null;
    target_utilization: number;
    target_utilization_rate: string;
    volatility_ratio: number;
  };
  last_update_timestamp: string;
  lostfound_shares: string;
  margin_debt: {
    balance: string;
    shares: string;
  };
  margin_pending_debt: string;
  margin_position: string;
  prot_fee: string;
  reserved: string;
  supplied: {
    balance: string;
    shares: string;
  };
  unit_acc_hp_interest?: string;
}

export type BurrowContractId = string;
