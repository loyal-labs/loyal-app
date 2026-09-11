// Shape check only; Privy verifies deliverability with the code.
export const isValidEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
