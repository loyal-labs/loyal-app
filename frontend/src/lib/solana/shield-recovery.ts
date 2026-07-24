export async function runShieldAttemptWithOptionalAccounting<
  TPlan,
  TExecutionResult
>(args: {
  readAccountingBaseline?: () => Promise<bigint>;
  buildPlan: () => Promise<TPlan>;
  executePlan: (plan: TPlan) => Promise<TExecutionResult>;
  onAccountingReadError?: (error: unknown) => void;
}): Promise<{
  accountingBaseline: bigint | null;
  executionResult: TExecutionResult;
}> {
  let accountingBaseline: bigint | null = null;

  if (args.readAccountingBaseline) {
    try {
      accountingBaseline = await args.readAccountingBaseline();
    } catch (error) {
      args.onAccountingReadError?.(error);
    }
  }

  const plan = await args.buildPlan();
  const executionResult = await args.executePlan(plan);

  return { accountingBaseline, executionResult };
}
