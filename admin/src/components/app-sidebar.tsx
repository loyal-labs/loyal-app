"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AppWindowIcon,
  ArrowLeftRightIcon,
  BellRingIcon,
  BookOpenIcon,
  CircleDollarSignIcon,
  LayoutDashboardIcon,
  LandmarkIcon,
  LogOutIcon,
  RouteIcon,
  ShieldUserIcon,
  UsersRoundIcon,
  WalletCardsIcon,
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

type NavItem = {
  exact?: boolean;
  href: string;
  icon: LucideIcon;
  label: string;
};

type NavGroup = {
  items: NavItem[];
  label: string;
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Core",
    items: [
      { href: "/overview", icon: LayoutDashboardIcon, label: "Overview" },
      { href: "/communities", icon: UsersRoundIcon, label: "Communities" },
      // { href: "/features", icon: ListChecksIcon, label: "Features" },
      // { href: "/flags", icon: FlagIcon, label: "Flags" },
    ],
  },
  {
    label: "Solana",
    items: [
      { href: "/transfers", icon: ArrowLeftRightIcon, label: "Transfers" },
      { exact: true, href: "/earn", icon: CircleDollarSignIcon, label: "Earn" },
      { href: "/earn/rebalance", icon: RouteIcon, label: "Rebalance" },
      {
        href: "/earn/autonomous-vault",
        icon: LandmarkIcon,
        label: "Autonomous vault",
      },
      {
        href: "/smart-accounts",
        icon: WalletCardsIcon,
        label: "Smart accounts",
      },
    ],
  },
  {
    label: "Mobile",
    items: [
      { href: "/dapps", icon: AppWindowIcon, label: "dApps" },
      {
        href: "/push-notifications",
        icon: BellRingIcon,
        label: "Push notifications",
      },
      { href: "/library", icon: BookOpenIcon, label: "Library" },
    ],
  },
  {
    label: "Access",
    items: [{ href: "/admins", icon: ShieldUserIcon, label: "Admins" }],
  },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar className="lowercase">
      <SidebarHeader>
        <Image
          src="/sidebar-logo.svg"
          alt="Loyal admin"
          width={130}
          height={40}
          className="h-6 w-auto"
          priority
        />
      </SidebarHeader>

      <SidebarContent>
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map(({ exact, href, icon: Icon, label }) => {
                  const isActive =
                    pathname === href ||
                    (!exact && pathname?.startsWith(`${href}/`));

                  return (
                    <SidebarMenuItem key={href}>
                      <SidebarMenuButton asChild isActive={isActive}>
                        <Link href={href}>
                          <Icon />
                          <span>{label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <form action="/logout" method="post" className="w-full">
              <SidebarMenuButton type="submit" className="w-full gap-2">
                <LogOutIcon className="size-4" />
                <span>Logout</span>
              </SidebarMenuButton>
            </form>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
