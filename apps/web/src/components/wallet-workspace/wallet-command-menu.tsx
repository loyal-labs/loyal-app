"use client";

import { ExternalLink, Lightbulb } from "lucide-react";
import type * as React from "react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";

export type WalletCommandItem = {
  description?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
  iconUrl?: string;
  id: string;
  keywords?: string[];
  label: string;
  onSelect: () => void;
  shortcut?: string;
};

export type WalletCommandGroup = {
  heading: string;
  items: WalletCommandItem[];
};

function getCommandValue(item: WalletCommandItem) {
  return [
    item.id,
    item.label,
    item.description,
    ...(item.keywords ?? []),
  ]
    .filter(Boolean)
    .join(" ");
}

const COMMAND_SUGGESTION_URL = "https://tally.so/r/ZjRpev";

export function WalletCommandMenu({
  groups,
  onOpenChange,
  open,
}: {
  groups: WalletCommandGroup[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.disabled),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <CommandDialog
      className="!bg-white !text-black"
      contentClassName="max-w-[620px] overflow-hidden rounded-[28px] border-0 !bg-white p-0 !text-black !gap-0 shadow-[0_24px_80px_rgba(0,0,0,0.18)]"
      onOpenChange={onOpenChange}
      open={open}
    >
      <CommandInput
        className="h-11 text-[17px] leading-5 text-black placeholder:text-[#8E8E93]"
        placeholder="Search actions, tokens, and approvals"
        wrapperClassName="h-[72px] border-b-0 px-6"
      />
      <CommandList className="max-h-[520px] bg-white px-4 pb-4 pt-0 text-black [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <CommandEmpty className="px-0 pb-2 pt-0 text-left">
          <button
            className="flex min-h-[58px] w-full items-center gap-3 rounded-[18px] bg-[#F5F5F5] px-3 py-2 text-left transition hover:bg-[#EFEFEF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F9363C]/50"
            onClick={() => {
              window.open(
                COMMAND_SUGGESTION_URL,
                "_blank",
                "noopener,noreferrer"
              );
              onOpenChange(false);
            }}
            type="button"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-[#FDE8E9] text-[#F9363C]">
              <Lightbulb size={18} strokeWidth={1.9} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[16px] font-medium leading-5 text-black">
                Suggest your command
              </span>
              <span className="truncate text-[13px] leading-4 text-[#8E8E93]">
                Tell us what should be available here
              </span>
            </span>
            <ExternalLink
              className="shrink-0 text-[#8E8E93]"
              size={18}
              strokeWidth={1.8}
            />
          </button>
        </CommandEmpty>
        {visibleGroups.map((group, index) => (
          <div key={group.heading}>
            {index > 0 ? (
              <CommandSeparator className="my-2 bg-black/[0.08]" />
            ) : null}
            <CommandGroup
              className="p-0 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-2 [&_[cmdk-group-heading]]:pt-0 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-[#8E8E93]"
              heading={group.heading}
            >
              {group.items.map((item) => (
                <CommandItem
                  className="group min-h-[58px] rounded-[18px] px-3 py-2 data-[selected=true]:bg-[#F5F5F5]"
                  key={item.id}
                  onSelect={() => {
                    onOpenChange(false);
                    item.onSelect();
                  }}
                  value={getCommandValue(item)}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[14px] bg-[#FDE8E9] text-[#F9363C]">
                    {item.iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt=""
                        aria-hidden="true"
                        className="h-full w-full object-cover"
                        src={item.iconUrl}
                      />
                    ) : (
                      item.icon
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[16px] font-medium leading-5 text-black">
                      {item.label}
                    </span>
                    {item.description ? (
                      <span className="truncate text-[13px] leading-4 text-[#8E8E93]">
                        {item.description}
                      </span>
                    ) : null}
                  </span>
                  {item.shortcut ? (
                    <CommandShortcut className="rounded-full bg-black/[0.04] px-2 py-1 text-[11px] font-medium tracking-normal text-[#8E8E93]">
                      {item.shortcut}
                    </CommandShortcut>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </div>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
