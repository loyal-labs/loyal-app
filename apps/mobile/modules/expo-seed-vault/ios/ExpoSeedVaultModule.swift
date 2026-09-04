import ExpoModulesCore

/// iOS stub. Seed Vault is an Android-only Solana Mobile SDK; on iOS every
/// entry point reports unavailability so the JS layer can disable the UI.
public class ExpoSeedVaultModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoSeedVault")

    AsyncFunction("isAvailable") { () -> Bool in
      return false
    }

    AsyncFunction("authorizeExistingSeed") { (_: String, promise: Promise) in
      promise.reject("SEED_VAULT_UNAVAILABLE", "Seed Vault is only available on Android")
    }

    AsyncFunction("createNewSeed") { (_: String, promise: Promise) in
      promise.reject("SEED_VAULT_UNAVAILABLE", "Seed Vault is only available on Android")
    }

    AsyncFunction("importSeed") { (_: String, promise: Promise) in
      promise.reject("SEED_VAULT_UNAVAILABLE", "Seed Vault is only available on Android")
    }

    AsyncFunction("deauthorize") { (_: Double, promise: Promise) in
      promise.resolve(nil)
    }

    AsyncFunction("signTransaction") {
      (_: Double, _: String, _: String, promise: Promise) in
      promise.reject("SEED_VAULT_UNAVAILABLE", "Seed Vault is only available on Android")
    }

    AsyncFunction("signMessage") {
      (_: Double, _: String, _: String, promise: Promise) in
      promise.reject("SEED_VAULT_UNAVAILABLE", "Seed Vault is only available on Android")
    }

    AsyncFunction("getPublicKey") {
      (_: Double, _: String, promise: Promise) in
      promise.reject("SEED_VAULT_UNAVAILABLE", "Seed Vault is only available on Android")
    }
  }
}
