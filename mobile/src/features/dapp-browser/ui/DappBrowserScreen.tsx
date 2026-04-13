import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator } from "react-native";
import WebView, { type WebViewNavigation } from "react-native-webview";

import {
  applyNavigationSnapshot,
  createBrowserSession,
  goHome,
  openUrl,
} from "../model/browser-session";
import { coerceBrowserUrl, normalizeOrigin } from "../model/origin";
import {
  resolveDappRequest,
  type DappRequestResolution,
} from "../model/request-controller";
import { TRUSTED_DAPPS } from "../model/trusted-dapps";
import type {
  DappHistoryEntry,
  PendingApproval,
  TrustedDapp,
} from "../model/types";
import {
  forgetConnectedOrigin,
  listConnectedOrigins,
  rememberConnectedOrigin,
} from "../storage/connected-origins";
import {
  listRecentHistory,
  recordRecentHistory,
} from "../storage/recent-history";
import { buildInjectedProviderScript } from "../bridge/build-injected-provider-script";
import { buildWebViewResponseScript } from "../bridge/build-webview-response-script";
import { BRIDGE_MESSAGE_SOURCE } from "../bridge/messages";
import { parseWebViewMessage } from "../bridge/parse-webview-message";
import { DappApprovalSheet } from "./DappApprovalSheet";
import { BrowserHome } from "./BrowserHome";
import { BrowserToolbar } from "./BrowserToolbar";

import { View } from "@/tw";

export function DappBrowserScreen() {
  const webViewRef = useRef<WebView>(null);
  const [session, setSession] = useState(createBrowserSession);
  const [recentHistory, setRecentHistory] = useState<DappHistoryEntry[]>([]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(
    null,
  );

  useEffect(() => {
    let mounted = true;

    listRecentHistory().then((entries) => {
      if (mounted) {
        setRecentHistory(entries);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  const handleOpenUrl = useCallback((rawUrl: string) => {
    const nextUrl = coerceBrowserUrl(rawUrl);
    setSession((current) => openUrl(current, nextUrl));
  }, []);

  const handleSubmitUrlInput = useCallback(() => {
    if (!session.pendingUrlInput.trim()) {
      return;
    }

    handleOpenUrl(session.pendingUrlInput);
  }, [handleOpenUrl, session.pendingUrlInput]);

  const handleOpenTrustedDapp = useCallback(
    (dapp: TrustedDapp) => {
      handleOpenUrl(dapp.startUrl);
    },
    [handleOpenUrl],
  );

  const handleOpenHistoryItem = useCallback(
    (item: DappHistoryEntry) => {
      handleOpenUrl(item.url);
    },
    [handleOpenUrl],
  );

  const handleNavigationStateChange = useCallback(
    (snapshot: WebViewNavigation) => {
      setSession((current) =>
        applyNavigationSnapshot(current, {
          url: snapshot.url,
          title: snapshot.title ?? null,
          canGoBack: snapshot.canGoBack,
          canGoForward: snapshot.canGoForward,
        }),
      );

      if (!snapshot.url.startsWith("http://") && !snapshot.url.startsWith("https://")) {
        return;
      }

      const entry: DappHistoryEntry = {
        origin: normalizeOrigin(snapshot.url),
        url: snapshot.url,
        title: snapshot.title ?? null,
        lastVisitedAt: Date.now(),
      };

      void recordRecentHistory(entry).then(() => {
        setRecentHistory((current) => [
          entry,
          ...current.filter((item) => item.origin !== entry.origin),
        ].slice(0, 20));
      });
    },
    [],
  );

  const injectResponse = useCallback((resolution: DappRequestResolution) => {
    if (resolution.kind === "response") {
      webViewRef.current?.injectJavaScript(
        buildWebViewResponseScript(resolution.response),
      );
    }
  }, []);

  const handleApproveApproval = useCallback(() => {
    const approval = pendingApproval;
    if (!approval) {
      return;
    }

    void (async () => {
      if (approval.type === "connect") {
        await rememberConnectedOrigin(approval.origin);
      }

      webViewRef.current?.injectJavaScript(
        buildWebViewResponseScript({
          source: BRIDGE_MESSAGE_SOURCE,
          id: approval.requestId,
          ok: true,
        }),
      );
      setPendingApproval((current) =>
        current?.requestId === approval.requestId ? null : current,
      );
    })();
  }, [pendingApproval]);

  const handleRejectApproval = useCallback(() => {
    const approval = pendingApproval;
    if (!approval) {
      return;
    }

    webViewRef.current?.injectJavaScript(
      buildWebViewResponseScript({
        source: BRIDGE_MESSAGE_SOURCE,
        id: approval.requestId,
        ok: false,
        error: "Request rejected.",
      }),
    );
    setPendingApproval((current) =>
      current?.requestId === approval.requestId ? null : current,
    );
  }, [pendingApproval]);

  const handleWebViewMessage = useCallback(
    async (event: { nativeEvent: { data: string } }) => {
      try {
        const request = parseWebViewMessage(event.nativeEvent.data);
        const currentUrl = session.currentUrl;
        if (
          !currentUrl ||
          (!currentUrl.startsWith("http://") &&
            !currentUrl.startsWith("https://"))
        ) {
          return;
        }
        const origin = normalizeOrigin(currentUrl);

        const connectedOrigins = await listConnectedOrigins();
        const resolution = resolveDappRequest({
          origin,
          request,
          connectedOrigins,
        });

        if (resolution.kind === "response") {
          injectResponse(resolution);
          if (request.type === "disconnect") {
            await forgetConnectedOrigin(origin);
          }
          return;
        }

        setPendingApproval(resolution.approval);
        return;
      } catch {
        try {
          const parsed = JSON.parse(event.nativeEvent.data) as { id?: unknown };
          if (typeof parsed.id === "string") {
            webViewRef.current?.injectJavaScript(
              buildWebViewResponseScript({
                source: BRIDGE_MESSAGE_SOURCE,
                id: parsed.id,
                ok: false,
                error: "Malformed bridge payload.",
              }),
            );
          }
        } catch {
          // Ignore malformed messages that cannot be associated with a request id.
        }
      }
    },
    [injectResponse, session.currentUrl],
  );

  return (
    <View className="flex-1 bg-white">
      {session.mode === "home" ? (
        <BrowserHome
          trustedDapps={TRUSTED_DAPPS}
          recentHistory={recentHistory}
          urlInput={session.pendingUrlInput}
          onChangeUrlInput={(value) =>
            setSession((current) => ({ ...current, pendingUrlInput: value }))
          }
          onSubmitUrlInput={handleSubmitUrlInput}
          onOpenTrustedDapp={handleOpenTrustedDapp}
          onOpenHistoryItem={handleOpenHistoryItem}
        />
      ) : (
        <>
          {session.currentUrl ? (
            <WebView
              ref={webViewRef}
              source={{ uri: session.currentUrl }}
              onNavigationStateChange={handleNavigationStateChange}
              onMessage={handleWebViewMessage}
              injectedJavaScriptBeforeContentLoaded={buildInjectedProviderScript()}
              startInLoadingState
              renderLoading={() => (
                <View className="flex-1 items-center justify-center bg-white">
                  <ActivityIndicator color="#f97362" />
                </View>
              )}
              className="flex-1"
            />
          ) : null}
          <BrowserToolbar
            canGoBack={session.canGoBack}
            canGoForward={session.canGoForward}
            onBack={() => webViewRef.current?.goBack()}
            onForward={() => webViewRef.current?.goForward()}
            onHome={() => setSession((current) => goHome(current))}
            onRefresh={() => webViewRef.current?.reload()}
          />
        </>
      )}
      <DappApprovalSheet
        approval={pendingApproval}
        onReject={handleRejectApproval}
        onApprove={handleApproveApproval}
      />
    </View>
  );
}
