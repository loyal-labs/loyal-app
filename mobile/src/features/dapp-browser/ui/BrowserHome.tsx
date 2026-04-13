import { Search } from "lucide-react-native";

import type { DappHistoryEntry, TrustedDapp } from "../model/types";
import { SiteAvatar } from "./SiteAvatar";

import { Pressable, ScrollView, Text, TextInput, View } from "@/tw";

type BrowserHomeProps = {
  trustedDapps: TrustedDapp[];
  recentHistory: DappHistoryEntry[];
  urlInput: string;
  onChangeUrlInput: (value: string) => void;
  onSubmitUrlInput: () => void;
  onOpenTrustedDapp: (dapp: TrustedDapp) => void;
  onOpenHistoryItem: (item: DappHistoryEntry) => void;
};

const SURFACE = "#f6f6f2";
const MUTED = "rgba(60, 60, 67, 0.6)";

export function BrowserHome({
  trustedDapps,
  recentHistory,
  urlInput,
  onChangeUrlInput,
  onSubmitUrlInput,
  onOpenTrustedDapp,
  onOpenHistoryItem,
}: BrowserHomeProps) {
  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerClassName="px-5 pb-10 pt-6"
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

      <View className="mt-8">
        <Text className="text-[18px] font-[Geist_600SemiBold] text-black">
          Trusted dapps
        </Text>
        <View className="mt-3 gap-3">
          {trustedDapps.map((dapp) => (
            <Pressable
              key={dapp.origin}
              className="flex-row items-center rounded-[24px] px-4 py-4"
              style={{ backgroundColor: SURFACE }}
              onPress={() => onOpenTrustedDapp(dapp)}
            >
              <SiteAvatar origin={dapp.origin} fallback="globe" />
              <View className="ml-3 flex-1">
                <Text className="text-[16px] font-[Geist_600SemiBold] text-black">
                  {dapp.name}
                </Text>
                <Text
                  className="mt-1 text-[13px] font-[Geist_400Regular]"
                  style={{ color: MUTED }}
                >
                  {dapp.origin}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      </View>

      <View className="mt-8">
        <Text className="text-[18px] font-[Geist_600SemiBold] text-black">
          Recent
        </Text>
        <View className="mt-3 gap-3">
          {recentHistory.length === 0 ? (
            <View className="rounded-[24px] px-4 py-5" style={{ backgroundColor: SURFACE }}>
              <Text
                className="text-[14px] font-[Geist_400Regular]"
                style={{ color: MUTED }}
              >
                No recent dapps yet.
              </Text>
            </View>
          ) : (
            recentHistory.map((item) => (
              <Pressable
                key={item.origin}
                className="flex-row items-center rounded-[24px] px-4 py-4"
                style={{ backgroundColor: SURFACE }}
                onPress={() => onOpenHistoryItem(item)}
              >
                <SiteAvatar origin={item.origin} fallback="history" />
                <View className="ml-3 flex-1">
                  <Text className="text-[16px] font-[Geist_600SemiBold] text-black">
                    {item.title ?? item.origin}
                  </Text>
                  <Text
                    className="mt-1 text-[13px] font-[Geist_400Regular]"
                    style={{ color: MUTED }}
                    numberOfLines={1}
                  >
                    {item.url}
                  </Text>
                </View>
              </Pressable>
            ))
          )}
        </View>
      </View>
    </ScrollView>
  );
}
