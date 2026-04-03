import type {
  SignTransactionRequest,
  SignTransactionResponse,
} from "~/src/lib/external-wallet-signer";
import type {
  DappApprovalDecision,
  DappConnectResponse,
  DappSignTransactionResponse,
  DappSignMessageResponse,
  BackgroundToDappResponse,
} from "~/src/lib/dapp-messages";
import { getStoredPublicKey } from "~/src/lib/keypair-storage";
import {
  activeWalletSource,
  autoLockTimeout,
  connectedDappOrigins,
  connectedExternalWallet,
  isWalletUnlocked,
  lastActivityAt,
  pendingDappApproval,
  viewMode,
} from "~/src/lib/storage";

// In-memory session keypair — never persisted to storage.
// Lost when service worker restarts; wallet falls back to locked state.
let sessionSecretKey: string | null = null;

// Track the connect tab so we can route signing requests to it
let connectTabId: number | null = null;

// Pending sign requests: id -> sendResponse callback
const pendingSignRequests = new Map<
  string,
  (response: SignTransactionResponse) => void
>();

interface PendingDappRequest {
  respond: (response: BackgroundToDappResponse) => void;
  kind: "connect" | "signTransaction" | "signMessage";
  transaction?: string; // base64
  message?: string; // base64
}

const pendingDappRequests = new Map<string, PendingDappRequest>();

const LOCK_ALARM = "auto-lock-check";

async function checkAutoLock() {
  const [unlocked, timeout, lastActive] = await Promise.all([
    isWalletUnlocked.getValue(),
    autoLockTimeout.getValue(),
    lastActivityAt.getValue(),
  ]);
  if (!unlocked || timeout === 0 || lastActive === 0) return;
  const elapsed = Date.now() - lastActive;
  if (elapsed >= timeout * 60_000) {
    await isWalletUnlocked.setValue(false);
    sessionSecretKey = null;
  }
}

const hasSidePanel = typeof browser.sidePanel !== "undefined";

async function applyViewMode(mode: "sidebar" | "popup") {
  if (!hasSidePanel) {
    // Firefox: always use popup mode (no sidePanel API)
    await browser.action.setPopup({ popup: "/popup.html" });
    return;
  }
  if (mode === "sidebar") {
    // Popup takes priority over openPanelOnActionClick — must clear it first
    await browser.action.setPopup({ popup: "" });
    await browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } else {
    await browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
    await browser.action.setPopup({ popup: "/popup.html" });
  }
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Extract the browser-verified page origin from the message sender. */
function getVerifiedOrigin(
  sender: browser.runtime.MessageSender,
): string | null {
  if (sender.origin) return sender.origin;
  const url = sender.url ?? sender.tab?.url;
  if (url) {
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  }
  return null;
}

export default defineBackground(() => {
  // Track how many extension UI instances (popup/sidepanel) are currently open.
  // The counter is best-effort — it resets on service worker restart.
  // openExtensionForApproval() uses getContexts() as the authoritative check.
  let uiConnectionCount = 0;

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === "sidepanel" || port.name === "popup") {
      uiConnectionCount++;
      port.onDisconnect.addListener(() => {
        uiConnectionCount = Math.max(0, uiConnectionCount - 1);
      });
    }
  });

  if (hasSidePanel) {
    // Chrome: apply saved view mode on startup
    viewMode.getValue().then((mode) => applyViewMode(mode));

    // Track popup window so we can close it when sidebar opens
    let popupWindowId: number | null = null;

    // React to view mode changes from settings — switch on the fly
    viewMode.watch(async (mode) => {
      await applyViewMode(mode);
      if (mode === "popup") {
        const win = await browser.windows.create({
          url: browser.runtime.getURL("/popup.html"),
          type: "popup",
          width: 400,
          height: 600,
        });
        popupWindowId = win.id ?? null;
      } else {
        // Can't open sidebar programmatically — badge hints the user to click
        await browser.action.setBadgeText({ text: "↗" });
        await browser.action.setBadgeBackgroundColor({ color: "#F9363C" });
      }
    });

    // When sidebar opens: clear badge and close leftover popup window
    browser.runtime.onConnect.addListener((port) => {
      if (port.name === "sidepanel") {
        void browser.action.setBadgeText({ text: "" });
        if (popupWindowId !== null) {
          void browser.windows.remove(popupWindowId).catch(() => {});
          popupWindowId = null;
        }
      }
    });

    // Clear tracked ID if popup is closed manually
    browser.windows.onRemoved.addListener((windowId) => {
      if (windowId === popupWindowId) popupWindowId = null;
    });
  }

  // --- Auto-lock: periodic alarm check ---
  browser.alarms.create(LOCK_ALARM, { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === LOCK_ALARM) void checkAutoLock();
  });

  // --- Auto-lock: system idle / screen lock ---
  browser.idle.setDetectionInterval(60);
  browser.idle.onStateChanged.addListener((state) => {
    if (state === "locked") {
      void isWalletUnlocked.setValue(false);
      sessionSecretKey = null;
    } else if (state === "idle") {
      void checkAutoLock();
    }
  });

  // --- Auto-lock: activity heartbeat from UI ---
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "ACTIVITY_HEARTBEAT") {
      void lastActivityAt.setValue(Date.now());
      return;
    }

    // --- Session keypair: kept in memory only, never persisted ---
    if (message.type === "STORE_SESSION_KEYPAIR") {
      sessionSecretKey = message.secretKey;
      return;
    }
    if (message.type === "GET_SESSION_KEYPAIR") {
      sendResponse({ secretKey: sessionSecretKey });
      return;
    }
    if (message.type === "CLEAR_SESSION_KEYPAIR") {
      sessionSecretKey = null;
      return;
    }
  });

  // Clean up tracked tab and reject pending sign requests when it closes
  browser.tabs.onRemoved.addListener((tabId) => {
    if (tabId === connectTabId) {
      connectTabId = null;
      for (const [id, resolve] of pendingSignRequests) {
        resolve({
          type: "SIGN_TRANSACTION_RESPONSE",
          id,
          error: "Wallet tab was closed before signing completed.",
        } satisfies SignTransactionResponse);
        pendingSignRequests.delete(id);
      }
    }
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // --- Wallet connection from connect tab ---
    if (message.type === "WALLET_CONNECTED" && message.publicKey) {
      connectTabId = sender.tab?.id ?? null;
      void connectedExternalWallet.setValue(message.publicKey);
      void activeWalletSource.setValue("external");
      return;
    }

    // --- Sign request from popup/sidepanel ---
    if (message.type === "SIGN_TRANSACTION") {
      const request = message as SignTransactionRequest;

      if (connectTabId === null) {
        sendResponse({
          type: "SIGN_TRANSACTION_RESPONSE",
          id: request.id,
          error:
            "No wallet tab connected. Open the connect page and link your wallet first.",
        } satisfies SignTransactionResponse);
        return;
      }

      // Store the callback so we can resolve when the tab responds
      pendingSignRequests.set(request.id, sendResponse);

      // Forward to the connect tab
      browser.tabs
        .sendMessage(connectTabId, request)
        .catch((err: unknown) => {
          pendingSignRequests.delete(request.id);
          sendResponse({
            type: "SIGN_TRANSACTION_RESPONSE",
            id: request.id,
            error:
              err instanceof Error
                ? err.message
                : "Failed to reach wallet tab",
          } satisfies SignTransactionResponse);
        });

      // Return true to indicate we will call sendResponse asynchronously
      return true;
    }

    // --- Sign response from connect tab ---
    if (message.type === "SIGN_TRANSACTION_RESPONSE") {
      const response = message as SignTransactionResponse;
      const pending = pendingSignRequests.get(response.id);
      if (pending) {
        pendingSignRequests.delete(response.id);
        pending(response);
      }
      return;
    }
  });

  let approvalPopupId: number | null = null;

  async function isExtensionUiOpen(): Promise<boolean> {
    // Fast path: in-memory counter (accurate unless SW restarted)
    if (uiConnectionCount > 0) return true;
    // Authoritative check: query live extension contexts (survives SW restart)
    try {
      const contexts = await (chrome.runtime as typeof chrome.runtime).getContexts({});
      return contexts.some(
        (ctx) =>
          ctx.contextType === "SIDE_PANEL" ||
          ctx.contextType === "POPUP" ||
          (ctx.contextType === "TAB" &&
            ctx.documentUrl?.includes(browser.runtime.id)),
      );
    } catch {
      // Firefox / older Chrome — fall back to counter only
      return false;
    }
  }

  function openExtensionForApproval() {
    void isExtensionUiOpen().then((open) => {
      if (open) return;
      void browser.windows
        .create({
          url: browser.runtime.getURL("/popup.html"),
          type: "popup",
          width: 400,
          height: 800,
        })
        .then((win) => {
          approvalPopupId = win?.id ?? null;
        });
    });
  }

  /** Reject any existing pending dApp request before accepting a new one. */
  function rejectStalePendingRequests(excludeId?: string) {
    for (const [id, req] of pendingDappRequests) {
      if (id === excludeId) continue;
      if (req.kind === "signTransaction") {
        req.respond({
          type: "DAPP_SIGN_TRANSACTION_RESPONSE",
          id,
          approved: false,
          error: "Replaced by a newer request.",
        } satisfies DappSignTransactionResponse);
      } else if (req.kind === "signMessage") {
        req.respond({
          type: "DAPP_SIGN_MESSAGE_RESPONSE",
          id,
          approved: false,
          error: "Replaced by a newer request.",
        } satisfies DappSignMessageResponse);
      } else {
        req.respond({
          type: "DAPP_CONNECT_RESPONSE",
          id,
          approved: false,
          error: "Replaced by a newer request.",
        } satisfies DappConnectResponse);
      }
      pendingDappRequests.delete(id);
    }
  }

  // --- dApp connect / sign requests from content scripts ---
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // --- Connect request from dApp ---
    if (message.type === "DAPP_CONNECT_REQUEST") {
      const { id, favicon } = message;
      const origin = getVerifiedOrigin(sender);

      if (!origin) {
        sendResponse({
          type: "DAPP_CONNECT_RESPONSE",
          id,
          approved: false,
          error: "Could not verify request origin.",
        } satisfies DappConnectResponse);
        return;
      }

      void (async () => {
        const origins = await connectedDappOrigins.getValue();
        if (origins.includes(origin)) {
          // Already approved — auto-respond with public key
          const publicKey = await getStoredPublicKey();
          sendResponse({
            type: "DAPP_CONNECT_RESPONSE",
            id,
            approved: true,
            publicKey: publicKey ?? undefined,
          } satisfies DappConnectResponse);
          return;
        }

        // Need user approval — reject any stale request, park this one
        rejectStalePendingRequests(id);
        pendingDappRequests.set(id, { respond: sendResponse, kind: "connect" });
        await pendingDappApproval.setValue({
          id,
          kind: "connect",
          origin,
          favicon,
        });
        void browser.action.setBadgeText({ text: "1" });
        void browser.action.setBadgeBackgroundColor({ color: "#F9363C" });
        openExtensionForApproval();
      })();

      return true;
    }

    // --- Sign transaction request from dApp ---
    if (message.type === "DAPP_SIGN_TRANSACTION_REQUEST") {
      const { id, favicon, transaction } = message;
      const origin = getVerifiedOrigin(sender);

      if (!origin) {
        sendResponse({
          type: "DAPP_SIGN_TRANSACTION_RESPONSE",
          id,
          approved: false,
          error: "Could not verify request origin.",
        } satisfies DappSignTransactionResponse);
        return;
      }

      rejectStalePendingRequests(id);
      pendingDappRequests.set(id, { respond: sendResponse, kind: "signTransaction", transaction });
      void pendingDappApproval.setValue({
        id,
        kind: "signTransaction",
        origin,
        favicon,
        transaction,
      });
      void browser.action.setBadgeText({ text: "1" });
      void browser.action.setBadgeBackgroundColor({ color: "#F9363C" });
      openExtensionForApproval();

      return true;
    }

    // --- Sign message request from dApp ---
    if (message.type === "DAPP_SIGN_MESSAGE_REQUEST") {
      const { id, favicon, message: msg } = message;
      const origin = getVerifiedOrigin(sender);

      if (!origin) {
        sendResponse({
          type: "DAPP_SIGN_MESSAGE_RESPONSE",
          id,
          approved: false,
          error: "Could not verify request origin.",
        } satisfies DappSignMessageResponse);
        return;
      }

      rejectStalePendingRequests(id);
      pendingDappRequests.set(id, { respond: sendResponse, kind: "signMessage", message: msg });
      void pendingDappApproval.setValue({
        id,
        kind: "signMessage",
        origin,
        favicon,
        message: msg,
      });
      void browser.action.setBadgeText({ text: "1" });
      void browser.action.setBadgeBackgroundColor({ color: "#F9363C" });
      openExtensionForApproval();

      return true;
    }

    // --- Disconnect from dApp ---
    if (message.type === "DAPP_DISCONNECT") {
      const origin = getVerifiedOrigin(sender);
      if (!origin) return;
      void (async () => {
        const origins = await connectedDappOrigins.getValue();
        await connectedDappOrigins.setValue(
          origins.filter((o) => o !== origin),
        );
      })();
      return;
    }

    // --- Connect response forwarded from popup/sidepanel ---
    if (message.type === "DAPP_CONNECT_RESPONSE") {
      const response = message as DappConnectResponse;
      const pending = pendingDappRequests.get(response.id);
      if (pending) {
        pendingDappRequests.delete(response.id);
        pending.respond(response);
      }
      void pendingDappApproval.setValue(null);
      void browser.action.setBadgeText({ text: "" });
      if (approvalPopupId !== null) {
        void viewMode.getValue().then((mode) => {
          if (mode === "sidebar" && approvalPopupId !== null) {
            void browser.windows.remove(approvalPopupId).catch(() => {});
          }
          approvalPopupId = null;
        });
      }
      return;
    }

    // --- Approval decision from popup/sidepanel ---
    if (message.type === "DAPP_APPROVAL_DECISION") {
      const decision = message as DappApprovalDecision;
      const { id, approved } = decision;

      void (async () => {
        const pending = pendingDappRequests.get(id);
        if (!pending) return;
        pendingDappRequests.delete(id);

        if (!approved) {
          // User denied — resolve with denied response
          if (pending.kind === "signTransaction") {
            pending.respond({
              type: "DAPP_SIGN_TRANSACTION_RESPONSE",
              id,
              approved: false,
              error: "User denied the request.",
            } satisfies DappSignTransactionResponse);
          } else if (pending.kind === "signMessage") {
            pending.respond({
              type: "DAPP_SIGN_MESSAGE_RESPONSE",
              id,
              approved: false,
              error: "User denied the request.",
            } satisfies DappSignMessageResponse);
          }
        } else {
          // User approved — sign with in-memory session keypair
          try {
            if (!sessionSecretKey) throw new Error("Wallet is locked.");

            const { Keypair, Transaction, VersionedTransaction } =
              await import("@solana/web3.js");
            const keypair = Keypair.fromSecretKey(
              new Uint8Array(JSON.parse(sessionSecretKey)),
            );

            if (pending.kind === "signTransaction" && pending.transaction) {
              const txBytes = base64ToUint8Array(pending.transaction);
              let signedBytes: Uint8Array;

              try {
                // Try VersionedTransaction first
                const vtx = VersionedTransaction.deserialize(txBytes);
                vtx.sign([keypair]);
                signedBytes = vtx.serialize();
              } catch {
                // Fall back to legacy Transaction
                const tx = Transaction.from(txBytes);
                tx.partialSign(keypair);
                signedBytes = tx.serialize({
                  requireAllSignatures: false,
                });
              }

              pending.respond({
                type: "DAPP_SIGN_TRANSACTION_RESPONSE",
                id,
                approved: true,
                signedTransaction: uint8ArrayToBase64(signedBytes),
              } satisfies DappSignTransactionResponse);
            } else if (pending.kind === "signMessage" && pending.message) {
              const { sign } = await import("tweetnacl");
              const msgBytes = base64ToUint8Array(pending.message);
              const signature = sign.detached(msgBytes, keypair.secretKey);

              pending.respond({
                type: "DAPP_SIGN_MESSAGE_RESPONSE",
                id,
                approved: true,
                signature: uint8ArrayToBase64(signature),
              } satisfies DappSignMessageResponse);
            }
          } catch (err) {
            const errorMsg =
              err instanceof Error ? err.message : "Signing failed.";
            if (pending.kind === "signTransaction") {
              pending.respond({
                type: "DAPP_SIGN_TRANSACTION_RESPONSE",
                id,
                approved: false,
                error: errorMsg,
              } satisfies DappSignTransactionResponse);
            } else if (pending.kind === "signMessage") {
              pending.respond({
                type: "DAPP_SIGN_MESSAGE_RESPONSE",
                id,
                approved: false,
                error: errorMsg,
              } satisfies DappSignMessageResponse);
            }
          }
        }

        // Clean up storage, badge, and temporary approval popup
        await pendingDappApproval.setValue(null);
        void browser.action.setBadgeText({ text: "" });

        if (approvalPopupId !== null) {
          const mode = await viewMode.getValue();
          if (mode === "sidebar") {
            void browser.windows.remove(approvalPopupId).catch(() => {});
          }
          approvalPopupId = null;
        }
      })();

      return;
    }
  });
});
