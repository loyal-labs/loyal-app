import { Redirect } from "expo-router";

// Wallet deeplink return URLs (https://askloyal.com/ul/wallet/<action> and the
// loyal[-dev]://ul/wallet/<action> dev fallback) are consumed by the pending-
// request listener in src/lib/wallet/deeplink-signer.ts, not by navigation.
// Expo Router still routes every incoming URL, so without this catch-all the
// wallet's redirect would land the user on the not-found screen.
export default function UniversalLinkReturn() {
  return <Redirect href="/" />;
}
