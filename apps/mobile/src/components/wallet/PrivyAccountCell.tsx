import { usePrivy } from "@privy-io/expo";
import type { ReactNode } from "react";
import { useState } from "react";

import { LinkEmailForm, privyEmail } from "@/components/wallet/AddEmailNudge";
import { isPrivyConfigured } from "@/components/wallet/PrivyProviderRoot";
import { View } from "@/tw";

type CellProps = {
  title: string;
  subtitle?: string;
  showChevron?: boolean;
  onPress?: () => void;
};

// Profile "Account" row: shows the Privy email, or opens the link-email form
// when there is none. Renders nothing without a Privy user (unconfigured
// build, or a legacy wallet that has not migrated yet).
export function PrivyAccountCell({
  render,
}: {
  render: (props: CellProps) => ReactNode;
}) {
  if (!isPrivyConfigured()) return null;
  return <Inner render={render} />;
}

function Inner({ render }: { render: (props: CellProps) => ReactNode }) {
  const { user } = usePrivy();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const email = privyEmail(user);
  if (email) return <>{render({ title: "Account", subtitle: email })}</>;
  return (
    <>
      {render({
        title: "Add email",
        subtitle: "Sign in to this account from any device",
        showChevron: !open,
        onPress: () => setOpen((v) => !v),
      })}
      {open ? (
        <View className="px-4 pb-4">
          <LinkEmailForm onLinked={() => setOpen(false)} />
        </View>
      ) : null}
    </>
  );
}
