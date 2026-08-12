import { Search } from "lucide-react-native";
import { useMemo } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { TrustedDapp } from "../model/types";
import { SiteAvatar } from "./SiteAvatar";

import { Pressable, ScrollView, Text, TextInput, View } from "@/tw";

type BrowserHomeProps = {
  trustedDapps: TrustedDapp[];
  urlInput: string;
  onChangeUrlInput: (value: string) => void;
  onSubmitUrlInput: () => void;
  onOpenTrustedDapp: (dapp: TrustedDapp) => void;
};

const SURFACE = "#f6f6f2";
const MUTED = "rgba(60, 60, 67, 0.6)";
const SECTION_LABEL = "rgba(60, 60, 67, 0.45)";
const TILES_PER_ROW = 4;
const OTHER_CATEGORY = "Other";

type CategoryGroup = {
  label: string;
  dapps: TrustedDapp[];
};

/**
 * Preserves the order in which each category first appears in the input.
 * The API returns rows sorted by displayOrder, so a category's position
 * is determined by its lowest-ranked member — matches the allowlist's
 * master numbering while staying resilient to admin reordering.
 */
function groupByCategory(dapps: TrustedDapp[]): CategoryGroup[] {
  const buckets = new Map<string, CategoryGroup>();
  for (const dapp of dapps) {
    const label = dapp.category?.trim() || OTHER_CATEGORY;
    const existing = buckets.get(label);
    if (existing) {
      existing.dapps.push(dapp);
    } else {
      buckets.set(label, { label, dapps: [dapp] });
    }
  }
  // Push "Other" to the bottom when mixed with real categories.
  const groups = Array.from(buckets.values());
  const otherIdx = groups.findIndex((g) => g.label === OTHER_CATEGORY);
  if (otherIdx >= 0 && groups.length > 1) {
    const [other] = groups.splice(otherIdx, 1);
    groups.push(other);
  }
  return groups;
}

function DappTile({
  dapp,
  widthPercent,
  onPress,
}: {
  dapp: TrustedDapp;
  widthPercent: `${number}%`;
  onPress: () => void;
}) {
  return (
    <Pressable
      className="items-center px-1 pb-5 active:opacity-80"
      style={{ width: widthPercent }}
      onPress={onPress}
    >
      <SiteAvatar origin={dapp.origin} size={56} rounded={18} fallback="globe" />
      <Text
        className="mt-2 text-center text-[12px] font-[Geist_500Medium] text-black"
        numberOfLines={2}
      >
        {dapp.name}
      </Text>
    </Pressable>
  );
}

export function BrowserHome({
  trustedDapps,
  urlInput,
  onChangeUrlInput,
  onSubmitUrlInput,
  onOpenTrustedDapp,
}: BrowserHomeProps) {
  const insets = useSafeAreaInsets();
  const tileWidthPercent = `${100 / TILES_PER_ROW}%` as const;

  const groups = useMemo(() => groupByCategory(trustedDapps), [trustedDapps]);
  const hasCategories = groups.some((g) => g.label !== OTHER_CATEGORY);

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerClassName="px-5 pb-10"
      contentContainerStyle={{ paddingTop: insets.top + 16 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text className="text-[28px] font-[Geist_700Bold] text-black">
        Browser
      </Text>
      <Text
        className="mt-2 text-[15px] font-[Geist_400Regular]"
        style={{ color: MUTED }}
      >
        Open a trusted dapp or paste a URL.
      </Text>

      <View
        className="mt-5 flex-row items-center rounded-[24px] px-4 py-3"
        style={{ backgroundColor: SURFACE }}
      >
        <Search size={18} color={MUTED} strokeWidth={2} />
        <TextInput
          className="ml-3 flex-1 text-[16px] font-[Geist_400Regular] text-black"
          value={urlInput}
          onChangeText={onChangeUrlInput}
          onSubmitEditing={onSubmitUrlInput}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="Search or enter website"
          placeholderTextColor={MUTED}
          returnKeyType="go"
        />
      </View>

      {trustedDapps.length > 0 && !hasCategories && (
        <View className="mt-8">
          <Text className="text-[18px] font-[Geist_600SemiBold] text-black">
            Trusted dapps
          </Text>
          <View className="mt-4 flex-row flex-wrap">
            {trustedDapps.map((dapp) => (
              <DappTile
                key={dapp.origin}
                dapp={dapp}
                widthPercent={tileWidthPercent}
                onPress={() => onOpenTrustedDapp(dapp)}
              />
            ))}
          </View>
        </View>
      )}

      {hasCategories &&
        groups.map((group, index) => (
          <View key={group.label} className={index === 0 ? "mt-8" : "mt-6"}>
            <Text
              className="text-[12px] font-[Geist_600SemiBold] uppercase"
              style={{ color: SECTION_LABEL, letterSpacing: 0.6 }}
            >
              {group.label}
            </Text>
            <View className="mt-3 flex-row flex-wrap">
              {group.dapps.map((dapp) => (
                <DappTile
                  key={dapp.origin}
                  dapp={dapp}
                  widthPercent={tileWidthPercent}
                  onPress={() => onOpenTrustedDapp(dapp)}
                />
              ))}
            </View>
          </View>
        ))}
    </ScrollView>
  );
}
