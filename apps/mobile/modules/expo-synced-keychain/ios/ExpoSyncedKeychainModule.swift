import ExpoModulesCore
import Security

// Generic-password keychain items with kSecAttrSynchronizable, which iCloud
// Keychain carries across the user's devices. Deliberately a separate service
// from expo-secure-store's items: those stay device-only
// (WHEN_UNLOCKED_THIS_DEVICE_ONLY); a synchronizable item cannot be
// *_THIS_DEVICE_ONLY, so synced copies live here with WHEN_UNLOCKED.
public class ExpoSyncedKeychainModule: Module {
  private let service = "app.askloyal.synced-keychain"

  public func definition() -> ModuleDefinition {
    Name("ExpoSyncedKeychain")

    AsyncFunction("setItem") { (key: String, value: String) in
      guard let data = value.data(using: .utf8) else {
        throw SyncedKeychainException("value is not UTF-8 encodable")
      }
      // Delete-then-add keeps this a single code path; SecItemUpdate on a
      // missing item would need a second branch for the same result.
      var query = self.baseQuery(key: key)
      SecItemDelete(query as CFDictionary)
      query[kSecValueData as String] = data
      query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlocked
      let status = SecItemAdd(query as CFDictionary, nil)
      guard status == errSecSuccess else {
        throw SyncedKeychainException("SecItemAdd failed with status \(status)")
      }
    }

    AsyncFunction("getItem") { (key: String) -> String? in
      var query = self.baseQuery(key: key)
      query[kSecReturnData as String] = true
      query[kSecMatchLimit as String] = kSecMatchLimitOne
      var result: AnyObject?
      let status = SecItemCopyMatching(query as CFDictionary, &result)
      if status == errSecItemNotFound {
        return nil
      }
      guard status == errSecSuccess, let data = result as? Data else {
        throw SyncedKeychainException("SecItemCopyMatching failed with status \(status)")
      }
      return String(data: data, encoding: .utf8)
    }

    AsyncFunction("deleteItem") { (key: String) in
      let status = SecItemDelete(self.baseQuery(key: key) as CFDictionary)
      guard status == errSecSuccess || status == errSecItemNotFound else {
        throw SyncedKeychainException("SecItemDelete failed with status \(status)")
      }
    }
  }

  private func baseQuery(key: String) -> [String: Any] {
    return [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key,
      kSecAttrSynchronizable as String: true,
    ]
  }
}

internal final class SyncedKeychainException: GenericException<String> {
  override var reason: String {
    "Synced keychain error: \(param)"
  }
}
