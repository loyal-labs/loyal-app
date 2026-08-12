import { getCloudValue, setCloudValue } from "./cloud-storage";

const GASLESS_ACTION_KEY = "gasless-state";

export enum GaslessState {
  NOT_CLAIMED = "not-claimed",
  CLAIMING = "claiming",
  CLAIMED = "claimed",
}

export const getGaslessState = async (): Promise<GaslessState> => {
  const value = await getCloudValue(GASLESS_ACTION_KEY);
  if (!value) {
    setCloudValue(GASLESS_ACTION_KEY, GaslessState.NOT_CLAIMED);
    return GaslessState.NOT_CLAIMED;
  }
  return value as GaslessState;
};

export const setGaslessState = async (state: GaslessState): Promise<void> => {
  await setCloudValue(GASLESS_ACTION_KEY, state);
};
