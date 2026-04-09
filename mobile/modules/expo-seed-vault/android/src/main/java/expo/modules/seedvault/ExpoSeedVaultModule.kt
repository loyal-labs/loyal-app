package expo.modules.seedvault

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Base64
import com.solanamobile.seedvault.Bip32DerivationPath
import com.solanamobile.seedvault.BipLevel
import com.solanamobile.seedvault.SeedVault
import com.solanamobile.seedvault.Wallet
import com.solanamobile.seedvault.WalletContractV1
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicInteger

private class SeedVaultException(code: String, message: String) :
    CodedException(code, message, null)

private enum class PendingKind {
    AUTHORIZE_EXISTING,
    CREATE,
    IMPORT,
    SIGN_TRANSACTION,
    SIGN_MESSAGE,
}

private data class PendingRequest(
    val kind: PendingKind,
    val promise: Promise,
    val derivationPath: String,
)

class ExpoSeedVaultModule : Module() {
    private val pending = mutableMapOf<Int, PendingRequest>()
    private val nextRequestCode = AtomicInteger(9000)

    override fun definition() =
        ModuleDefinition {
            Name("ExpoSeedVault")

            AsyncFunction("isAvailable") { promise: Promise ->
                val context = appContext.reactContext
                if (context == null) {
                    promise.resolve(false)
                    return@AsyncFunction
                }
                try {
                    promise.resolve(SeedVault.isAvailable(context, false))
                } catch (_: Throwable) {
                    promise.resolve(false)
                }
            }

            AsyncFunction("authorizeExistingSeed") { derivationPath: String, promise: Promise ->
                launchAuthIntent(PendingKind.AUTHORIZE_EXISTING, derivationPath, promise) { activity ->
                    Wallet.authorizeSeed(
                        activity,
                        WalletContractV1.PURPOSE_SIGN_SOLANA_TRANSACTION,
                    )
                }
            }

            AsyncFunction("createNewSeed") { derivationPath: String, promise: Promise ->
                launchAuthIntent(PendingKind.CREATE, derivationPath, promise) { activity ->
                    Wallet.createSeed(
                        activity,
                        WalletContractV1.PURPOSE_SIGN_SOLANA_TRANSACTION,
                    )
                }
            }

            AsyncFunction("importSeed") { derivationPath: String, promise: Promise ->
                launchAuthIntent(PendingKind.IMPORT, derivationPath, promise) { activity ->
                    Wallet.importSeed(
                        activity,
                        WalletContractV1.PURPOSE_SIGN_SOLANA_TRANSACTION,
                    )
                }
            }

            AsyncFunction("deauthorize") { authToken: Double, promise: Promise ->
                val context = appContext.reactContext
                if (context == null) {
                    promise.reject(SeedVaultException("NO_CONTEXT", "No React context"))
                    return@AsyncFunction
                }
                try {
                    Wallet.deauthorizeSeed(context, authToken.toLong())
                    promise.resolve(null)
                } catch (e: Throwable) {
                    promise.reject(
                        SeedVaultException(
                            "DEAUTH_FAILED",
                            e.message ?: "deauthorizeSeed failed",
                        ),
                    )
                }
            }

            AsyncFunction("signTransaction") {
                authToken: Double,
                derivationPath: String,
                txBase64: String,
                promise: Promise,
                ->
                val activity = appContext.currentActivity
                if (activity == null) {
                    promise.reject(SeedVaultException("NO_ACTIVITY", "No current activity"))
                    return@AsyncFunction
                }
                try {
                    val bytes = Base64.decode(txBase64, Base64.NO_WRAP)
                    val pathUri = parseDerivationPath(derivationPath)
                    val intent =
                        Wallet.signTransaction(activity, authToken.toLong(), pathUri, bytes)
                    val code = nextRequestCode.getAndIncrement()
                    pending[code] =
                        PendingRequest(
                            PendingKind.SIGN_TRANSACTION,
                            promise,
                            derivationPath,
                        )
                    activity.startActivityForResult(intent, code)
                } catch (e: Throwable) {
                    promise.reject(
                        SeedVaultException(
                            "SIGN_TX_FAILED",
                            e.message ?: "signTransaction failed",
                        ),
                    )
                }
            }

            AsyncFunction("signMessage") {
                authToken: Double,
                derivationPath: String,
                messageBase64: String,
                promise: Promise,
                ->
                val activity = appContext.currentActivity
                if (activity == null) {
                    promise.reject(SeedVaultException("NO_ACTIVITY", "No current activity"))
                    return@AsyncFunction
                }
                try {
                    val bytes = Base64.decode(messageBase64, Base64.NO_WRAP)
                    val pathUri = parseDerivationPath(derivationPath)
                    val intent =
                        Wallet.signMessage(activity, authToken.toLong(), pathUri, bytes)
                    val code = nextRequestCode.getAndIncrement()
                    pending[code] =
                        PendingRequest(
                            PendingKind.SIGN_MESSAGE,
                            promise,
                            derivationPath,
                        )
                    activity.startActivityForResult(intent, code)
                } catch (e: Throwable) {
                    promise.reject(
                        SeedVaultException(
                            "SIGN_MSG_FAILED",
                            e.message ?: "signMessage failed",
                        ),
                    )
                }
            }

            AsyncFunction("getPublicKey") {
                authToken: Double,
                derivationPath: String,
                promise: Promise,
                ->
                val context = appContext.reactContext
                if (context == null) {
                    promise.reject(SeedVaultException("NO_CONTEXT", "No React context"))
                    return@AsyncFunction
                }
                try {
                    val pk = queryPublicKey(context, authToken.toLong(), derivationPath)
                    if (pk == null) {
                        promise.reject(
                            SeedVaultException(
                                "PK_NOT_FOUND",
                                "Public key not found for $derivationPath",
                            ),
                        )
                        return@AsyncFunction
                    }
                    promise.resolve(Base64.encodeToString(pk, Base64.NO_WRAP))
                } catch (e: Throwable) {
                    promise.reject(
                        SeedVaultException(
                            "GET_PK_FAILED",
                            e.message ?: "getPublicKey failed",
                        ),
                    )
                }
            }

            OnActivityResult { _, payload ->
                val request = pending.remove(payload.requestCode) ?: return@OnActivityResult
                try {
                    when (request.kind) {
                        PendingKind.AUTHORIZE_EXISTING,
                        PendingKind.CREATE,
                        PendingKind.IMPORT,
                        -> {
                            val authToken =
                                Wallet.onAuthorizeSeedResult(
                                    payload.resultCode,
                                    payload.data,
                                )
                            val context = appContext.reactContext
                                ?: throw SeedVaultException("NO_CONTEXT", "No React context")
                            val pk = queryPublicKey(context, authToken, request.derivationPath)
                                ?: throw SeedVaultException(
                                    "PK_NOT_FOUND",
                                    "Public key not found after authorization",
                                )
                            request.promise.resolve(
                                mapOf(
                                    "authToken" to authToken.toDouble(),
                                    "derivationPath" to request.derivationPath,
                                    "publicKey" to Base64.encodeToString(pk, Base64.NO_WRAP),
                                ),
                            )
                        }

                        PendingKind.SIGN_TRANSACTION -> {
                            val responses =
                                Wallet.onSignTransactionsResult(
                                    payload.resultCode,
                                    payload.data,
                                )
                            val sig =
                                responses.firstOrNull()?.signatures?.firstOrNull()
                                    ?: throw SeedVaultException(
                                        "NO_SIGNATURE",
                                        "Vault returned no signature",
                                    )
                            request.promise.resolve(Base64.encodeToString(sig, Base64.NO_WRAP))
                        }

                        PendingKind.SIGN_MESSAGE -> {
                            val responses =
                                Wallet.onSignMessagesResult(
                                    payload.resultCode,
                                    payload.data,
                                )
                            val sig =
                                responses.firstOrNull()?.signatures?.firstOrNull()
                                    ?: throw SeedVaultException(
                                        "NO_SIGNATURE",
                                        "Vault returned no signature",
                                    )
                            request.promise.resolve(Base64.encodeToString(sig, Base64.NO_WRAP))
                        }
                    }
                } catch (e: Throwable) {
                    request.promise.reject(
                        if (e is CodedException) {
                            e
                        } else {
                            SeedVaultException(
                                "ACTIVITY_RESULT_FAILED",
                                e.message ?: "Activity result handling failed",
                            )
                        },
                    )
                }
            }
        }

    private fun launchAuthIntent(
        kind: PendingKind,
        derivationPath: String,
        promise: Promise,
        factory: (Activity) -> Intent,
    ) {
        val activity = appContext.currentActivity
        if (activity == null) {
            promise.reject(SeedVaultException("NO_ACTIVITY", "No current activity"))
            return
        }
        try {
            val intent = factory(activity)
            val code = nextRequestCode.getAndIncrement()
            pending[code] = PendingRequest(kind, promise, derivationPath)
            activity.startActivityForResult(intent, code)
        } catch (e: Throwable) {
            promise.reject(
                SeedVaultException(
                    "INTENT_FAILED",
                    e.message ?: "Failed to launch Seed Vault intent",
                ),
            )
        }
    }

    /**
     * Parse a BIP-32 derivation path string like `m/44'/501'/0'/0'` into the
     * [Uri] form the Seed Vault SDK expects.
     */
    private fun parseDerivationPath(path: String): Uri {
        require(path.startsWith("m/")) { "Derivation path must start with m/" }
        val segments = path.removePrefix("m/").split("/").filter { it.isNotEmpty() }
        val builder = Bip32DerivationPath.Builder()
        for (segment in segments) {
            val hardened = segment.endsWith("'") || segment.endsWith("h")
            val raw = segment.trimEnd('\'', 'h')
            val index = raw.toInt()
            builder.appendLevel(BipLevel(index, hardened))
        }
        return builder.build().toUri()
    }

    /**
     * Look up the raw 32-byte public key for a derivation path from the
     * `accounts` content provider table. Returns `null` if the path has not
     * been derived for this seed yet (the Solana defaults are pre-derived
     * at authorization time).
     */
    private fun queryPublicKey(
        context: Context,
        authToken: Long,
        derivationPath: String,
    ): ByteArray? {
        val rawPathUri = parseDerivationPath(derivationPath)
        val resolvedPathUri =
            Wallet.resolveDerivationPath(
                context,
                rawPathUri,
                WalletContractV1.PURPOSE_SIGN_SOLANA_TRANSACTION,
            )
        val tableUri =
            Uri.parse(
                "content://${WalletContractV1.AUTHORITY_WALLET_PROVIDER}/" +
                    "${WalletContractV1.ACCOUNTS_TABLE}/$authToken",
            )
        val cursor =
            context.contentResolver.query(
                tableUri,
                arrayOf(
                    WalletContractV1.ACCOUNTS_BIP32_DERIVATION_PATH,
                    WalletContractV1.ACCOUNTS_PUBLIC_KEY_RAW,
                ),
                "${WalletContractV1.ACCOUNTS_BIP32_DERIVATION_PATH} = ?",
                arrayOf(resolvedPathUri.toString()),
                null,
            ) ?: return null
        cursor.use {
            if (it.moveToFirst()) {
                val colIndex = it.getColumnIndex(WalletContractV1.ACCOUNTS_PUBLIC_KEY_RAW)
                if (colIndex >= 0) {
                    return it.getBlob(colIndex)
                }
            }
        }
        return null
    }
}
