"use client";

import { addToHomeScreen, biometry, postEvent } from "@telegram-apps/sdk";
import {
  hapticFeedback,
  openTelegramLink,
  retrieveLaunchParams,
  useRawInitData,
} from "@telegram-apps/sdk-react";
import {
  ArrowUpRight,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CirclePlus,
  Copy,
  Fingerprint,
  Globe,
  KeyRound,
  Network,
  Smile,
  Sparkle,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTelegramUser } from "@/components/telegram/TelegramProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveEndpoint } from "@/lib/core/api";
import { publicEnv } from "@/lib/core/config/public";
import { getSolanaEnv } from "@/lib/solana/rpc/connection";
import type { SolanaEnv } from "@/lib/solana/rpc/types";
import { setLoyalEmojiStatus } from "@/lib/telegram/mini-app/emoji-status";
import { cn } from "@/lib/utils";

type ToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  activeColor?: string;
};

function Toggle({
  checked,
  onChange,
  disabled = false,
  activeColor = "#34c759",
}: ToggleProps) {
  const handleClick = () => {
    if (disabled) return;
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    onChange(!checked);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={handleClick}
      disabled={disabled}
      className={`relative h-[31px] w-[51px] rounded-full transition-colors duration-200 ease-in-out ${
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
      }`}
      style={{
        backgroundColor: checked
          ? activeColor
          : "rgba(120, 120, 128, 0.16)",
      }}
    >
      <div
        className="absolute top-1/2 -translate-y-1/2 h-[27px] w-[27px] rounded-full bg-white transition-all duration-200 ease-in-out"
        style={{
          left: checked ? "calc(100% - 29px)" : "2px",
          boxShadow:
            "0px 0px 0px 1px rgba(0, 0, 0, 0.04), 0px 3px 8px 0px rgba(0, 0, 0, 0.15), 0px 3px 1px 0px rgba(0, 0, 0, 0.06)",
        }}
      />
    </button>
  );
}

type ProfileCellProps = {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  rightDetail?: string;
  showChevron?: boolean;
  showArrow?: boolean;
  toggle?: {
    checked: boolean;
    onChange: (checked: boolean) => void;
    activeColor?: string;
  };
  onClick?: () => void;
  disabled?: boolean;
};

function ProfileCell({
  icon,
  title,
  subtitle,
  rightDetail,
  showChevron = false,
  showArrow = false,
  toggle,
  onClick,
  disabled = false,
}: ProfileCellProps) {
  const content = (
    <div
      className={`flex items-center w-full overflow-hidden px-4 ${
        disabled ? "opacity-50" : ""
      }`}
    >
      {/* Left - Icon */}
      <div className="flex items-center pr-3 py-1.5">
        <div className="flex items-center justify-center pr-1 py-2.5">
          <div className="text-black/60">{icon}</div>
        </div>
      </div>

      {/* Middle - Text */}
      <div
        className={`flex-1 flex flex-col min-w-0 ${subtitle ? "py-[9px]" : "py-[13px]"}`}
      >
        <p className="text-[17px] font-medium leading-[22px] tracking-[-0.187px] text-black">
          {title}
        </p>
        {subtitle && (
          <p className="text-[15px] font-normal leading-5 text-[rgba(60,60,67,0.6)]">
            {subtitle}
          </p>
        )}
      </div>

      {/* Right - Detail, Toggle, Arrow, or Chevron */}
      {rightDetail && (
        <div className="pl-3 flex items-center py-[13px]">
          <p className="text-[17px] font-normal leading-[22px] text-[rgba(60,60,67,0.6)] text-right">
            {rightDetail}
          </p>
        </div>
      )}
      {toggle && (
        <div className="pl-3">
          <Toggle
            checked={toggle.checked}
            onChange={toggle.onChange}
            disabled={disabled}
            activeColor={toggle.activeColor}
          />
        </div>
      )}
      {showArrow && (
        <div className="pl-3 flex items-center justify-center h-10 py-2">
          <ArrowUpRight size={24} className="text-[rgba(60,60,67,0.3)]" />
        </div>
      )}
      {showChevron && (
        <div className="pl-3 flex items-center justify-center h-10 py-2">
          <ChevronRight size={16} className="text-[rgba(60,60,67,0.3)]" />
        </div>
      )}
    </div>
  );

  if (onClick && !disabled) {
    return (
      <button
        onClick={onClick}
        className="w-full text-left active:opacity-80 transition-opacity"
      >
        {content}
      </button>
    );
  }

  return content;
}

function SettingsSection({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-[#f2f2f7] rounded-[20px] py-1">{children}</div>
  );
}

const VERIFY_TAP_COUNT = 5;
const VERIFY_TAP_TIMEOUT = 2000;

export default function ProfilePage() {
  const { userData, cachedAvatar, isAvatarLoading } = useTelegramUser();
  const rawInitData = useRawInitData();
  const router = useRouter();

  const [isMobilePlatform, setIsMobilePlatform] = useState(false);

  // Hidden 5-tap trigger for verification flow
  const verifyTapCount = useRef(0);
  const verifyTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleAvatarTap = useCallback(() => {
    verifyTapCount.current += 1;

    if (verifyTapTimer.current) {
      clearTimeout(verifyTapTimer.current);
    }

    if (verifyTapCount.current >= VERIFY_TAP_COUNT) {
      verifyTapCount.current = 0;
      if (hapticFeedback.notificationOccurred.isAvailable()) {
        hapticFeedback.notificationOccurred("success");
      }
      router.push("/telegram/verify?userId=111");
      return;
    }

    verifyTapTimer.current = setTimeout(() => {
      verifyTapCount.current = 0;
    }, VERIFY_TAP_TIMEOUT);
  }, [router]);
  const [usernameCopied, setUsernameCopied] = useState(false);
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const [isImageError, setIsImageError] = useState(false);
  const [networkEnv, setNetworkEnv] = useState<SolanaEnv>(getSolanaEnv);
  const [isNetworkDropdownOpen, setIsNetworkDropdownOpen] = useState(false);
  const networkDropdownRef = useRef<HTMLDivElement>(null);
  const [botNotifications, setBotNotifications] = useState(true);
  const [isNotificationsLoading, setIsNotificationsLoading] = useState(true);
  const [assistantModel, setAssistantModel] = useState("qwen-2.5");
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  // Fetch user settings on mount
  useEffect(() => {
    if (!rawInitData) return;
    const endpoint = resolveEndpoint(
      `/api/telegram/settings?initData=${encodeURIComponent(rawInitData)}`,
    );
    fetch(endpoint)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setBotNotifications(data.notifications);
        }
      })
      .catch((err) => console.error("Failed to load user settings", err))
      .finally(() => setIsNotificationsLoading(false));
  }, [rawInitData]);

  // Detect platform on mount
  useEffect(() => {
    let platform: string | undefined;
    try {
      const launchParams = retrieveLaunchParams();
      platform = launchParams.tgWebAppPlatform;
    } catch {
      if (typeof window !== "undefined") {
        const hash = window.location.hash.slice(1);
        const params = new URLSearchParams(hash);
        platform = params.get("tgWebAppPlatform") || undefined;
      }
    }

    const isMobile = platform === "ios" || platform === "android";
    setIsMobilePlatform(isMobile);
  }, []);

  const fullName = useMemo(() => {
    if (!userData) return "User";
    return userData.lastName
      ? `${userData.firstName} ${userData.lastName}`
      : userData.firstName;
  }, [userData]);

  const displayUsername = useMemo(() => {
    if (!userData?.username) return null;
    return `@${userData.username}`;
  }, [userData]);

  const avatarLetter = useMemo(() => {
    return fullName.charAt(0).toUpperCase();
  }, [fullName]);

  const addToHomeScreenDisabled = !isMobilePlatform;

  const handleAddToHomeScreen = useCallback(() => {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    if (addToHomeScreen.isAvailable()) {
      addToHomeScreen();
    } else {
      postEvent("web_app_add_to_home_screen");
    }
  }, []);

  const handleSetCustomEmoji = useCallback(async () => {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    await setLoyalEmojiStatus();
  }, []);

  const handleSupport = useCallback(() => {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    if (openTelegramLink.isAvailable()) {
      openTelegramLink("https://t.me/spacesymmetry");
    }
  }, []);

  const handleBiometrics = useCallback(() => {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    if (biometry.openSettings.isAvailable()) {
      biometry.openSettings();
    }
  }, []);

  const networkOptions: { value: SolanaEnv; label: string }[] = [
    { value: "mainnet", label: "Mainnet" },
    { value: "testnet", label: "Testnet" },
    { value: "devnet", label: "Devnet" },
  ];

  const modelOptions = [
    { value: "qwen-2.5", label: "Qwen 2.5" },
    { value: "deepseek", label: "DeepSeek" },
    { value: "llama-3", label: "Llama 3" },
    { value: "mixtral", label: "Mixtral" },
  ];

  const handleModelSelect = useCallback(
    (value: string) => {
      if (value === assistantModel) {
        setIsModelDropdownOpen(false);
        return;
      }
      if (hapticFeedback.impactOccurred.isAvailable()) {
        hapticFeedback.impactOccurred("light");
      }
      setAssistantModel(value);
      setIsModelDropdownOpen(false);
    },
    [assistantModel],
  );

  const handleNetworkSelect = useCallback((env: SolanaEnv) => {
    if (env === networkEnv) {
      setIsNetworkDropdownOpen(false);
      return;
    }
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    setNetworkEnv(env);
    setIsNetworkDropdownOpen(false);
    localStorage.setItem("solana-env-override", env);
    setTimeout(() => window.location.reload(), 300);
  }, [networkEnv]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (networkDropdownRef.current && !networkDropdownRef.current.contains(e.target as Node)) {
        setIsNetworkDropdownOpen(false);
      }
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    };
    if (isNetworkDropdownOpen || isModelDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isNetworkDropdownOpen, isModelDropdownOpen]);

  return (
    <main className="min-h-screen bg-white font-sans overflow-hidden relative">
      <div className="pb-32 max-w-md mx-auto flex flex-col min-h-screen">
        {/* Avatar and Name Section */}
        <div className="flex flex-col gap-4 items-center justify-center pt-8 pb-6 px-8">
          {/* Avatar — tap 5 times to open verification */}
          <button
            type="button"
            onClick={handleAvatarTap}
            className="appearance-none focus:outline-none"
            aria-label="Profile avatar"
          >
          {userData?.photoUrl && !isImageError ? (
            <div className="relative w-24 h-24">
              {(!isImageLoaded || isAvatarLoading) && (
                <Skeleton className="absolute inset-0 w-24 h-24 rounded-full z-10" />
              )}
              <Image
                src={cachedAvatar || userData.photoUrl}
                alt={fullName}
                width={96}
                height={96}
                className={cn(
                  "w-24 h-24 rounded-full object-cover transition-opacity duration-300",
                  !isImageLoaded || isAvatarLoading
                    ? "opacity-0"
                    : "opacity-100",
                )}
                priority
                onLoad={() => setIsImageLoaded(true)}
                onError={() => setIsImageError(true)}
              />
            </div>
          ) : (
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <span className="text-4xl font-semibold text-white">
                {avatarLetter}
              </span>
            </div>
          )}
          </button>

          {/* Name and Username */}
          <div className="flex flex-col gap-1 items-center text-center w-full">
            <p className="text-2xl font-semibold leading-7 text-black">
              {fullName}
            </p>
            {displayUsername && (
              <button
                onClick={() => {
                  if (hapticFeedback.impactOccurred.isAvailable()) {
                    hapticFeedback.impactOccurred("light");
                  }
                  if (userData?.username && navigator?.clipboard?.writeText) {
                    navigator.clipboard.writeText(userData.username);
                    setUsernameCopied(true);
                    setTimeout(() => setUsernameCopied(false), 2000);
                    if (hapticFeedback.notificationOccurred.isAvailable()) {
                      hapticFeedback.notificationOccurred("success");
                    }
                  }
                }}
                className="flex items-center gap-1 active:opacity-70 transition-opacity"
              >
                <Copy
                  className="w-[18px] h-[18px]"
                  strokeWidth={1.5}
                  style={{ color: "rgba(60, 60, 67, 0.6)" }}
                />
                <span className="text-[17px] leading-[22px] text-[rgba(60,60,67,0.6)]">
                  {usernameCopied ? "Copied!" : displayUsername}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Settings Sections */}
        <div className="flex flex-col gap-4 px-4 pb-4">
          {/* Section 1: Keys & Recovery, Biometric Access */}
          <SettingsSection>
            <ProfileCell
              icon={<KeyRound size={28} strokeWidth={1.5} />}
              title="Keys & Recovery"
              showChevron
              onClick={() => {
                if (hapticFeedback.impactOccurred.isAvailable()) {
                  hapticFeedback.impactOccurred("light");
                }
                router.push("/telegram/profile/keys");
              }}
            />
            <ProfileCell
              icon={<Fingerprint size={28} strokeWidth={1.5} />}
              title="Biometric Access"
              showChevron
              onClick={handleBiometrics}
              disabled={!isMobilePlatform}
            />
          </SettingsSection>

          {/* Section 2: Network */}
          <SettingsSection>
            <div ref={networkDropdownRef} className="relative">
              <button
                onClick={() => {
                  if (hapticFeedback.impactOccurred.isAvailable()) {
                    hapticFeedback.impactOccurred("light");
                  }
                  setIsNetworkDropdownOpen((prev) => !prev);
                }}
                className="w-full text-left active:opacity-80 transition-opacity"
              >
                <div className="flex items-center w-full overflow-hidden px-4">
                  <div className="flex items-center pr-3 py-1.5">
                    <div className="flex items-center justify-center pr-1 py-2.5">
                      <div className="text-black/60">
                        <Network size={28} strokeWidth={1.5} />
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col min-w-0 py-[13px]">
                    <p className="text-[17px] font-medium leading-[22px] tracking-[-0.187px] text-black">
                      Network
                    </p>
                  </div>
                  <div className="pl-3 flex items-center gap-1 py-[13px]">
                    <p className="text-[17px] font-normal leading-[22px] text-[rgba(60,60,67,0.6)]">
                      {networkOptions.find((o) => o.value === networkEnv)?.label}
                    </p>
                    <ChevronDown
                      size={16}
                      className={cn(
                        "text-[rgba(60,60,67,0.3)] transition-transform duration-200",
                        isNetworkDropdownOpen && "rotate-180",
                      )}
                    />
                  </div>
                </div>
              </button>

              {isNetworkDropdownOpen && (
                <div className="absolute right-4 top-full -mt-1 z-50 min-w-[160px] bg-white rounded-xl shadow-[0px_4px_24px_rgba(0,0,0,0.12)] py-1 overflow-hidden">
                  {networkOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => handleNetworkSelect(option.value)}
                      className="w-full flex items-center justify-between px-4 py-2.5 active:bg-black/5 transition-colors"
                    >
                      <span className="text-[17px] font-normal leading-[22px] text-black">
                        {option.label}
                      </span>
                      {option.value === networkEnv && (
                        <Check size={18} className="text-[#f9363c]" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </SettingsSection>

          {/* Section 3: Language, Notifications, Model */}
          <SettingsSection>
            <ProfileCell
              icon={<Globe size={28} strokeWidth={1.5} />}
              title="Language"
              rightDetail="English"
              disabled
            />
            <ProfileCell
              icon={<Bell size={28} strokeWidth={1.5} />}
              title="Bot Notifications"
              disabled={isNotificationsLoading}
              toggle={{
                checked: botNotifications,
                onChange: (checked) => {
                  setBotNotifications(checked);
                  if (!rawInitData) return;
                  const endpoint = resolveEndpoint("/api/telegram/settings");
                  fetch(endpoint, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      rawInitData,
                      notifications: checked,
                    }),
                  }).catch((err) => {
                    console.error("Failed to update notifications", err);
                    setBotNotifications(!checked);
                  });
                },
                activeColor: "#f9363c",
              }}
            />
            <div ref={modelDropdownRef} className="relative">
              <button
                onClick={() => {
                  if (hapticFeedback.impactOccurred.isAvailable()) {
                    hapticFeedback.impactOccurred("light");
                  }
                  setIsModelDropdownOpen((prev) => !prev);
                }}
                className="w-full text-left active:opacity-80 transition-opacity"
              >
                <div className="flex items-center w-full overflow-hidden px-4">
                  <div className="flex items-center pr-3 py-1.5">
                    <div className="flex items-center justify-center pr-1 py-2.5">
                      <div className="text-black/60">
                        <Sparkle size={28} strokeWidth={1.5} />
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col min-w-0 py-[13px]">
                    <p className="text-[17px] font-medium leading-[22px] tracking-[-0.187px] text-black">
                      Assistant Model
                    </p>
                  </div>
                  <div className="pl-3 flex items-center gap-1 py-[13px]">
                    <p className="text-[17px] font-normal leading-[22px] text-[rgba(60,60,67,0.6)]">
                      {modelOptions.find((o) => o.value === assistantModel)?.label}
                    </p>
                    <ChevronDown
                      size={16}
                      className={cn(
                        "text-[rgba(60,60,67,0.3)] transition-transform duration-200",
                        isModelDropdownOpen && "rotate-180",
                      )}
                    />
                  </div>
                </div>
              </button>

              {isModelDropdownOpen && (
                <div className="absolute right-4 top-full -mt-1 z-50 min-w-[180px] backdrop-blur-[8px] bg-white/70 rounded-[20px] shadow-[0px_0px_4px_1px_rgba(0,0,0,0.04),0px_32px_64px_0px_rgba(0,0,0,0.16)] overflow-hidden">
                  {modelOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => handleModelSelect(option.value)}
                      className="w-full flex items-center justify-between px-4 h-12 active:bg-black/5 transition-colors"
                    >
                      <span
                        className={cn(
                          "text-[17px] leading-[22px] text-black",
                          option.value === assistantModel
                            ? "font-medium"
                            : "font-normal",
                        )}
                      >
                        {option.label}
                      </span>
                      {option.value === assistantModel && (
                        <Check size={18} className="text-[#f9363c]" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </SettingsSection>

          {/* Section 4: Actions */}
          <SettingsSection>
            <ProfileCell
              icon={<CirclePlus size={28} strokeWidth={1.5} />}
              title="Add App to Home Screen"
              showArrow
              onClick={handleAddToHomeScreen}
              disabled={addToHomeScreenDisabled}
            />
            <ProfileCell
              icon={<Smile size={28} strokeWidth={1.5} />}
              title="Set Custom Emoji"
              showArrow
              onClick={handleSetCustomEmoji}
            />
          </SettingsSection>

          {/* Section 5: Support */}
          <SettingsSection>
            <ProfileCell
              icon={<CircleHelp size={28} strokeWidth={1.5} />}
              title="Support"
              subtitle="Report a bug or ask any question"
              showChevron
              onClick={handleSupport}
            />
          </SettingsSection>

          {/* Build Info */}
          <p className="text-center text-xs text-black/20 pt-2">
            {publicEnv.gitBranch} @ {publicEnv.gitCommitHash}
          </p>
        </div>
      </div>
    </main>
  );
}
