import type {
  Commitment,
  Connection,
  GetAccountInfoConfig,
  PublicKey,
} from "@solana/web3.js";
import type { LoyalSmartAccountsTransport } from "@loyal-labs/loyal-smart-accounts-core";
import type {
  LoyalSmartAccountsFeatureName,
  RuntimeOperationDefinition,
  RuntimeOperationsForFeature,
} from "./operation-registry.js";

type QueryFunction = (
  connection: Connection,
  ...args: any[]
) => Promise<unknown>;
type QueryFactories = Record<string, QueryFunction>;

type Simplify<T> = { [K in keyof T]: T[K] } & {};
type OperationEntries<Operations extends Record<string, unknown>> = Array<
  [keyof Operations & string, RuntimeOperationDefinition]
>;

type InstructionsApi<Operations> = {
  [K in keyof Operations as Operations[K] extends { instruction: (...args: never[]) => unknown }
    ? K
    : never]: Operations[K] extends { instruction: infer T } ? T : never;
};

type PrepareApi<Operations> = {
  [K in keyof Operations]: Operations[K] extends { prepare: infer T } ? T : never;
};

type BoundPrepareApi<Operations> = {
  [K in keyof Operations]: Operations[K] extends { boundPrepare: infer T } ? T : never;
};

type ClientMethodApi<Operations> = {
  [K in keyof Operations]: Operations[K] extends { client: infer T } ? T : never;
};

type FeatureModule<
  Operations extends Record<string, unknown>,
  Accounts extends Record<string, unknown>,
  Queries extends QueryFactories,
> = {
  accounts: Accounts;
  instructions: InstructionsApi<Operations>;
  prepare: PrepareApi<Operations>;
  queries: Queries;
  client: (
    transport: LoyalSmartAccountsTransport
  ) => Simplify<
    ClientMethodApi<Operations> & {
      prepare: BoundPrepareApi<Operations>;
      queries: {
        [K in keyof Queries]: Queries[K] extends (
          connection: Connection,
          ...args: infer Rest
        ) => infer Result
          ? (...args: Rest) => Result
          : never;
      };
    }
  >;
};

export function createAccountFetcher<T>(accountClass: {
  fromAccountAddress(
    connection: Connection,
    address: PublicKey,
    commitmentOrConfig?: Commitment | GetAccountInfoConfig
  ): Promise<T>;
}): (
  connection: Connection,
  address: PublicKey,
  commitmentOrConfig?: Commitment | GetAccountInfoConfig
) => Promise<T> {
  return (
    connection: Connection,
    address: PublicKey,
    commitmentOrConfig?: Commitment | GetAccountInfoConfig
  ) => accountClass.fromAccountAddress(connection, address, commitmentOrConfig);
}

function bindQueries<Queries extends QueryFactories>(
  queries: Queries,
  connection: Connection
): {
  [K in keyof Queries]: Queries[K] extends (
    connection: Connection,
    ...args: infer Rest
  ) => infer Result
    ? (...args: Rest) => Result
    : never;
} {
  return Object.fromEntries(
    Object.entries(queries).map(([name, query]) => [
      name,
      (...args: readonly unknown[]) => query(connection, ...args),
    ])
  ) as {
    [K in keyof Queries]: Queries[K] extends (
      connection: Connection,
      ...args: infer Rest
    ) => infer Result
      ? (...args: Rest) => Result
      : never;
  };
}

export function createFeatureModule<
  Feature extends LoyalSmartAccountsFeatureName,
  Operations extends RuntimeOperationsForFeature<Feature>,
  Accounts extends Record<string, unknown>,
  Queries extends QueryFactories,
>(args: {
  feature: Feature;
  accounts: Accounts;
  operations: Operations;
  queries: Queries;
}): FeatureModule<Operations, Accounts, Queries> {
  const operationEntries = Object.entries(args.operations) as OperationEntries<Operations>;

  const instructions = Object.fromEntries(
    operationEntries
      .filter(([, operation]) => typeof operation.instruction === "function")
      .map(([name, operation]) => [name, operation.instruction])
  ) as InstructionsApi<Operations>;

  const prepare = Object.fromEntries(
    operationEntries.map(([name, operation]) => [name, operation.prepare])
  ) as PrepareApi<Operations>;

  return {
    accounts: args.accounts,
    instructions,
    prepare,
    queries: args.queries,
    client: (transport: LoyalSmartAccountsTransport) =>
      ({
        ...Object.fromEntries(
          operationEntries.map(([name, operation]) => [
            name,
            (clientArgs: unknown) => operation.client(transport, clientArgs as never),
          ])
        ),
        prepare: Object.fromEntries(
          operationEntries.map(([name, operation]) => [
            name,
            (prepareArgs: unknown) =>
              operation.boundPrepare(transport, prepareArgs as never),
          ])
        ),
        queries: bindQueries(args.queries, transport.connection),
      }) as Simplify<
        ClientMethodApi<Operations> & {
          prepare: BoundPrepareApi<Operations>;
          queries: {
            [K in keyof Queries]: Queries[K] extends (
              connection: Connection,
              ...rest: infer Rest
            ) => infer Result
              ? (...args: Rest) => Result
              : never;
          };
        }
      >,
  };
}

export type { FeatureModule };
