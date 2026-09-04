import { CloudKeyInput } from "@/types/telegram";

const normalizeKeys = (input: CloudKeyInput): string[] =>
  Array.isArray(input) ? input : [input];

type TelegramCloudStorage = typeof import("@telegram-apps/sdk")["cloudStorage"];
type TelegramSdkModule = typeof import("@telegram-apps/sdk");

const CLOUD_STORAGE_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
const CLOUD_STORAGE_KEY_MIN_LENGTH = 1;
const CLOUD_STORAGE_KEY_MAX_LENGTH = 128;
const CLOUD_STORAGE_VALUE_MAX_LENGTH = 4096;

let sdkInitialized = false;

const getCloudStorage = async (): Promise<TelegramCloudStorage | null> => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const sdk = await import("@telegram-apps/sdk");
    await ensureSdkInitialized(sdk);
    return sdk.cloudStorage;
  } catch (error) {
    console.error("Failed to load Telegram cloud storage SDK", error);
    return null;
  }
};

const ensureSdkInitialized = async (sdk: TelegramSdkModule): Promise<void> => {
  if (sdkInitialized) return;

  try {
    sdk.init();
  } catch {
    // SDK may already be initialized or unavailable in non-Telegram contexts.
  } finally {
    sdkInitialized = true;
  }
};

const canUseCloudStorage = (cloudStorage: TelegramCloudStorage): boolean => {
  try {
    return cloudStorage.isSupported();
  } catch (error) {
    console.error("Failed to check cloud storage support", error);
    return false;
  }
};

const isValidCloudStorageKey = (key: string): boolean => {
  if (
    key.length < CLOUD_STORAGE_KEY_MIN_LENGTH ||
    key.length > CLOUD_STORAGE_KEY_MAX_LENGTH
  ) {
    console.error("Invalid cloud storage key length", key.length);
    return false;
  }

  if (!CLOUD_STORAGE_KEY_PATTERN.test(key)) {
    console.error("Invalid cloud storage key format", key);
    return false;
  }

  return true;
};

const hasValidKeys = (keys: string[]): boolean => {
  if (keys.length > 0) return true;

  console.error("Cloud storage operation requires at least one key");
  return false;
};

const isValidCloudStorageValue = (value: string): boolean => {
  const valueLength = Array.from(value).length;
  if (valueLength > CLOUD_STORAGE_VALUE_MAX_LENGTH) {
    console.error("Invalid cloud storage value length", valueLength);
    return false;
  }

  return true;
};

const validateKeys = (keys: string[]): boolean => {
  if (!hasValidKeys(keys)) return false;
  return keys.every((key) => isValidCloudStorageKey(key));
};

export async function setCloudValue(
  key: string,
  value: string
): Promise<boolean> {
  const cloudStorage = await getCloudStorage();
  if (!cloudStorage) return false;
  if (!canUseCloudStorage(cloudStorage)) return false;
  if (!cloudStorage.setItem.isAvailable()) return false;

  if (!validateKeys([key])) return false;
  if (!isValidCloudStorageValue(value)) return false;

  try {
    await cloudStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.error("Failed to set cloud storage value", error);
    return false;
  }
}

export async function getCloudValue(
  keyOrKeys: CloudKeyInput
): Promise<string | Record<string, string> | null> {
  const cloudStorage = await getCloudStorage();
  if (!cloudStorage) return null;
  if (!canUseCloudStorage(cloudStorage)) return null;
  if (!cloudStorage.getItem.isAvailable()) return null;

  const keys = normalizeKeys(keyOrKeys);
  if (!validateKeys(keys)) return null;

  try {
    if (typeof keyOrKeys === "string") {
      return await cloudStorage.getItem(keyOrKeys);
    }

    return await cloudStorage.getItem(keyOrKeys);
  } catch (error) {
    console.error("Failed to get cloud storage value", error);
    return null;
  }
}

export async function deleteCloudValue(
  keyOrKeys: CloudKeyInput
): Promise<boolean> {
  const cloudStorage = await getCloudStorage();
  if (!cloudStorage) return false;
  if (!canUseCloudStorage(cloudStorage)) return false;
  if (!cloudStorage.deleteItem.isAvailable()) return false;

  const keys = normalizeKeys(keyOrKeys);
  if (!validateKeys(keys)) return false;

  try {
    await cloudStorage.deleteItem(keyOrKeys);
    return true;
  } catch (error) {
    console.error("Failed to delete cloud storage value", error);
    return false;
  }
}
