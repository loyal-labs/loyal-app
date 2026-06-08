import { mock } from "bun:test";

export const findActiveYieldPosition = mock(async () => null);
export const findActiveYieldRoutePolicy = mock(async () => null);
export const findYieldPositionEvents = mock(async () => []);
export const findYieldPositionHistoryEvents = mock(async () => []);
export const recordConfirmedYieldDeposit = mock(async () => null);
export const recordConfirmedYieldWithdrawal = mock(async () => null);

export const getCurrentReserveUpdatesByReserve = mock(async () => []);
export const getReserveApyHistorySamples = mock(async () => []);
export const closeTimescaleReserveClient = mock(async () => {});

export class MockTimescaleReserveClient {
  getReserveApyHistorySamples = getReserveApyHistorySamples;
  close = closeTimescaleReserveClient;
}

export function getTimescaleReserveDatabaseUrl(): string | null {
  return process.env.TIMESCALEDB_URL ?? null;
}

export function createYieldDepositRepositoryMock() {
  return {
    findActiveYieldPosition,
    findActiveYieldRoutePolicy,
    findYieldPositionEvents,
    findYieldPositionHistoryEvents,
    recordConfirmedYieldDeposit,
    recordConfirmedYieldWithdrawal,
  };
}

export function createTimescaleReserveClientMock() {
  return {
    TimescaleReserveClient: MockTimescaleReserveClient,
    getCurrentReserveUpdatesByReserve,
    getTimescaleReserveDatabaseUrl,
  };
}
