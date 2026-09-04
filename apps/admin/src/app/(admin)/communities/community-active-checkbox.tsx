"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { setCommunityActiveStatus } from "./community-list-actions";

type CommunityActiveCheckboxProps = {
  communityId: string;
  initialChecked: boolean;
  ariaLabel?: string;
};

export function CommunityActiveCheckbox({
  communityId,
  initialChecked,
  ariaLabel = "Toggle community active status",
}: CommunityActiveCheckboxProps) {
  const router = useRouter();
  const [checked, setChecked] = useState(initialChecked);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setChecked(initialChecked);
  }, [initialChecked]);

  function handleChange(nextChecked: boolean) {
    const previousChecked = checked;
    setChecked(nextChecked);

    startTransition(async () => {
      const result = await setCommunityActiveStatus(communityId, nextChecked);
      if ("error" in result) {
        setChecked(previousChecked);
        return;
      }

      router.refresh();
    });
  }

  return (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked}
      disabled={pending}
      onChange={(event) => handleChange(event.target.checked)}
      className="size-4 cursor-pointer accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
    />
  );
}
