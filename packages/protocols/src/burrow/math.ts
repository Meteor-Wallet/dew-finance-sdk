import Big from "big.js";

export type Bigish = Big | string | number;

function toBig(value: Bigish): Big {
  return value instanceof Big ? value : new Big(value);
}

export function toBurrowAmount({
  amount,
  tokenDecimals,
  burrowDecimals,
}: {
  amount: Bigish;
  tokenDecimals: number;
  burrowDecimals?: number;
}): Big {
  const targetDecimals = burrowDecimals ?? Math.max(18, tokenDecimals);
  return toBig(amount).mul(new Big(10).pow(targetDecimals)).round(0, Big.roundDown);
}

export function fromBurrowAmount({
  amount,
  tokenDecimals,
  burrowDecimals,
}: {
  amount: Bigish;
  tokenDecimals: number;
  burrowDecimals?: number;
}): Big {
  const targetDecimals = burrowDecimals ?? Math.max(18, tokenDecimals);
  return toBig(amount).div(new Big(10).pow(targetDecimals)).round(tokenDecimals, Big.roundDown);
}

export function calculateAdjustedCollateralSum({
  collaterals,
}: {
  collaterals: Array<{
    amount: Bigish;
    price: Bigish;
    collateralFactor: Bigish;
  }>;
}): Big {
  return collaterals.reduce((acc, item) => {
    const amount = toBig(item.amount);
    const price = toBig(item.price);
    const factor = toBig(item.collateralFactor);
    return acc.add(amount.mul(price).mul(factor));
  }, new Big(0));
}

export function calculateAdjustedBorrowedSum({
  borrows,
}: {
  borrows: Array<{
    amount: Bigish;
    price: Bigish;
    collateralFactor: Bigish;
  }>;
}): Big {
  return borrows.reduce((acc, item) => {
    const amount = toBig(item.amount);
    const price = toBig(item.price);
    const factor = toBig(item.collateralFactor);
    return acc.add(amount.mul(price).div(factor));
  }, new Big(0));
}

export function calculateHealthFactor({
  adjustedCollateralSum,
  adjustedBorrowedSum,
}: {
  adjustedCollateralSum: Bigish;
  adjustedBorrowedSum: Bigish;
}): Big | null {
  const borrowed = toBig(adjustedBorrowedSum);
  if (borrowed.eq(0)) {
    return null;
  }
  return toBig(adjustedCollateralSum).div(borrowed);
}

export function calculateMaxWithdrawableCollateral({
  currentHealthFactor,
  healthFactorFloor,
  adjustedCollateralSum,
  adjustedBorrowedSum,
  supplyBalance,
  supplyPrice,
  supplyCollateralFactor,
  supplyDecimals,
}: {
  currentHealthFactor: Bigish | null;
  healthFactorFloor: Bigish;
  adjustedCollateralSum: Bigish;
  adjustedBorrowedSum: Bigish;
  supplyBalance: Bigish;
  supplyPrice: Bigish;
  supplyCollateralFactor: Bigish;
  supplyDecimals: number;
}): Big {
  const adjustedCollateral = toBig(adjustedCollateralSum);
  const adjustedBorrowed = toBig(adjustedBorrowedSum);
  const floor = toBig(healthFactorFloor);

  if (currentHealthFactor === null) {
    return toBig(supplyBalance);
  }

  const currentHf = toBig(currentHealthFactor);
  if (currentHf.lte(floor)) {
    return new Big(0);
  }

  if (adjustedBorrowed.eq(0)) {
    return toBig(supplyBalance);
  }

  const maxWithdrawableAdjustedValue = adjustedCollateral.sub(adjustedBorrowed.mul(floor));
  if (maxWithdrawableAdjustedValue.lte(0)) {
    return new Big(0);
  }

  const collateralFactor = toBig(supplyCollateralFactor);
  const price = toBig(supplyPrice);
  const maxWithdrawableCollateralValue = maxWithdrawableAdjustedValue.div(collateralFactor);
  const maxWithdrawableCollateralAmount = maxWithdrawableCollateralValue
    .div(price)
    .mul(new Big(10).pow(supplyDecimals))
    .round(0, Big.roundDown);

  const actualSuppliedBalance = toBig(supplyBalance);
  return maxWithdrawableCollateralAmount.gt(actualSuppliedBalance)
    ? actualSuppliedBalance
    : maxWithdrawableCollateralAmount;
}

export function calculateStableAssetRatio({
  baseTokenAdjustedCollateralValue,
  masterTargetHealthFactor,
  slaveTargetHealthFactor,
  masterFarmTokenVolatilityRatio,
  slaveFarmTokenVolatilityRatio,
  masterFarmTokenPrice,
  slaveFarmTokenPrice,
}: {
  baseTokenAdjustedCollateralValue: Bigish;
  masterTargetHealthFactor: Bigish;
  slaveTargetHealthFactor: Bigish;
  masterFarmTokenVolatilityRatio: Bigish;
  slaveFarmTokenVolatilityRatio: Bigish;
  masterFarmTokenPrice: Bigish;
  slaveFarmTokenPrice: Bigish;
}): {
  masterFarmTokenValue: Big;
  slaveFarmTokenValue: Big;
  masterFarmTokenAmount: Big;
  slaveFarmTokenAmount: Big;
} {
  const baseValue = toBig(baseTokenAdjustedCollateralValue);
  const masterHF = toBig(masterTargetHealthFactor);
  const slaveHF = toBig(slaveTargetHealthFactor);
  const masterVol = toBig(masterFarmTokenVolatilityRatio);
  const slaveVol = toBig(slaveFarmTokenVolatilityRatio);

  const denominator = masterHF.mul(slaveHF).sub(masterVol.pow(2).mul(slaveVol.pow(2)));
  if (denominator.lte(0)) {
    throw new Error("Invalid stable asset ratio inputs: denominator must be > 0");
  }

  const masterFarmTokenValue = baseValue.mul(slaveVol.pow(2)).mul(masterVol).div(denominator);

  const slaveFarmTokenValue = slaveHF.mul(masterFarmTokenValue).div(slaveVol.mul(masterVol));

  const masterFarmTokenAmount = masterFarmTokenValue.div(toBig(masterFarmTokenPrice));
  const slaveFarmTokenAmount = slaveFarmTokenValue.div(toBig(slaveFarmTokenPrice));

  return {
    masterFarmTokenValue,
    slaveFarmTokenValue,
    masterFarmTokenAmount,
    slaveFarmTokenAmount,
  };
}
