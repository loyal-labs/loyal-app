import { Search } from "lucide-react-native";
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
const TILES_PER_ROW = 4;

export function BrowserHome({
  trustedDapps,
  urlInput,
  onChangeUrlInput,
  onSubmitUrlInput,
  onOpenTrustedDapp,
}: BrowserHomeProps) {
  const insets = useSafeAreaInsets();
  const tileWidthPercent = `${100 / TILES_PER_ROW}%` as const;

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

      {trustedDapps.length > 0 ? (
        <View className="mt-8">
          <Text className="text-[18px] font-[Geist_600SemiBold] text-black">
            Trusted dapps
          </Text>
          <View className="mt-4 flex-row flex-wrap">
            {trustedDapps.map((dapp) => (
              <Pressable
                key={dapp.origin}
                className="items-center px-1 pb-5"
                style={{ width: tileWidthPercent }}
                onPress={() => onOpenTrustedDapp(dapp)}
              >
                <SiteAvatar origin={dapp.origin} size={56} rounded={18} fallback="globe" />
                <Text
                  className="mt-2 text-center text-[12px] font-[Geist_500Medium] text-black"
                  numberOfLines={2}
                >
                  {dapp.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}
