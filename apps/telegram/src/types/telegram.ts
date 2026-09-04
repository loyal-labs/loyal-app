import { themeParams } from "@telegram-apps/sdk";
import type { RGB } from "@telegram-apps/types";

export type CloudKeyInput = string | string[];

export type BaseButtonOptions = {
  text: string;
  isEnabled?: boolean;
  hasShineEffect?: boolean;
  backgroundColor?: RGB;
  textColor?: RGB;
  showLoader?: boolean;
};

export const themeColorSignals = {
  accentTextColor: themeParams.accentTextColor,
  backgroundColor: themeParams.backgroundColor,
  buttonColor: themeParams.buttonColor,
  buttonTextColor: themeParams.buttonTextColor,
  destructiveTextColor: themeParams.destructiveTextColor,
  headerBackgroundColor: themeParams.headerBackgroundColor,
  hintColor: themeParams.hintColor,
  linkColor: themeParams.linkColor,
  secondaryBackgroundColor: themeParams.secondaryBackgroundColor,
  sectionBackgroundColor: themeParams.sectionBackgroundColor,
  sectionHeaderTextColor: themeParams.sectionHeaderTextColor,
  sectionSeparatorColor: themeParams.sectionSeparatorColor,
  subtitleTextColor: themeParams.subtitleTextColor,
  textColor: themeParams.textColor,
  bottomBarBgColor: themeParams.bottomBarBgColor,
  state: themeParams.state,
  isDark: themeParams.isDark,
} as const;

export type ThemeSignals = typeof themeColorSignals;

export type ThemeSignalKey = Exclude<keyof ThemeSignals, "state" | "isDark">;
