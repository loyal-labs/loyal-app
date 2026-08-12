export const KNOWN_PROGRAMS: Record<string, string> = {
  "11111111111111111111111111111111": "System Program",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "Token Program",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "Token-2022",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "Associated Token",
  ComputeBudget111111111111111111111111111111: "Compute Budget",
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: "Memo",
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: "Jupiter v6",
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: "Orca Whirlpool",
  KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD: "Kamino Lend",
  "97FzQdWi26mFNR21AbQNg4KqofiCLqQydQfAvRQMcXhV": "Loyal Private Transfer",
  "9yiphKYd4b69tR1ZPP8rNwtMeUwWgjYXaXdEzyNziNhz": "Loyal Telegram Verification",
  DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh: "MagicBlock Delegation",
  ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1: "MagicBlock Permission",
  Magic11111111111111111111111111111111111111: "MagicBlock Magic",
};

export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function programDisplayName(address: string): string {
  return KNOWN_PROGRAMS[address] ?? truncateAddress(address);
}

export function isKnownProgram(address: string): boolean {
  return Object.prototype.hasOwnProperty.call(KNOWN_PROGRAMS, address);
}
