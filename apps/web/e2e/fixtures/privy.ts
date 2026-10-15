import { useSyncExternalStore } from "react";
import { fixtureOwner } from "./swap-wallet";

const linkedUser = {
  linkedAccounts: [
    {
      type: "wallet",
      chainType: "solana",
      walletClientType: "phantom",
      address: fixtureOwner.toBase58(),
    },
    { type: "email", address: "fixture@example.invalid" },
  ],
};
const scenario = new URLSearchParams(location.search).get("scenario");
let user = scenario?.startsWith("fresh_")
  ? {
      ...linkedUser,
      linkedAccounts: linkedUser.linkedAccounts.filter(
        (account) => account.type === "email"
      ),
    }
  : linkedUser;
let creations = 0;
export const walletCreationCount = () => creations;
let state = {
  ready: true,
  authenticated: false,
  user: null as typeof user | null,
};
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const update = (authenticated: boolean) => {
  state = { ready: true, authenticated, user: authenticated ? user : null };
  listeners.forEach((listener) => listener());
};
const logout = async () => {
  update(false);
};
export const usePrivy = () => ({
  ...useSyncExternalStore(subscribe, () => state),
  logout,
});
let callbacks: {
  onComplete: (result: {
    loginAccount: { type: string; address: string };
  }) => void;
  onError: (code: string) => void;
};
let loginAttempts = 0;
const login = () => {
  loginAttempts++;
  if (scenario === "privy_error" && loginAttempts === 1) {
    callbacks.onError("unknown_connect_wallet_error");
    return;
  }
  if (scenario === "oauth_cancel") {
    callbacks.onError("oauth_user_denied");
    return;
  }
  if (new URLSearchParams(location.search).get("scenario") === "cancel") {
    callbacks.onError("exited_auth_flow");
    return;
  }
  callbacks.onComplete({
    loginAccount: { type: "wallet", address: fixtureOwner.toBase58() },
  });
  update(true);
};
export const useLogin = (next: typeof callbacks) => {
  callbacks = next;
  return { login };
};
const refreshUser = async () => user;
export const useUser = () => ({ refreshUser });
const linkEmail = () => {};
export const useLinkAccount = () => ({ linkEmail });
export const getIdentityToken = async () => "controlled-identity-fixture";
const wallets = [
  { address: fixtureOwner.toBase58(), standardWallet: { name: "Phantom" } },
];
export const useWallets = () => ({ ready: true, wallets });
const createWallet = async () => {
  if (!scenario?.startsWith("fresh_"))
    throw new Error("Unexpected wallet creation in linked-wallet fixture");
  creations++;
  user = linkedUser;
  update(true);
  return { wallet: { address: fixtureOwner.toBase58() } };
};
export const useCreateWallet = () => ({ createWallet });

// The separate standard-browser fixture exercises the real wallet adapter.
export const PrivyProvider = ({ children }: { children: React.ReactNode }) =>
  children;
export const toSolanaWalletConnectors = () => [];
export const useStandardWallets = () => ({ ready: true, wallets: [] });
