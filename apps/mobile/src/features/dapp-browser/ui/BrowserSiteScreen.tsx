import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import WebView, { type WebViewNavigation } from "react-native-webview";

import { fetchTrustedDapps } from "@/services/api";

import { normalizeOrigin } from "../model/origin";
import {
  resolveDappRequest,
  type DappRequestResolution,
} from "../model/request-controller";
import { TRUSTED_DAPPS } from "../model/trusted-dapps";
import type { PendingApproval } from "../model/types";
import {
  forgetConnectedOrigin,
  listConnectedOrigins,
  rememberConnectedOrigin,
} from "../storage/connected-origins";
import {
  buildConsoleForwardScript,
  forwardWebViewConsoleMessage,
  tryParseConsoleMessage,
} from "../bridge/build-console-forward-script";
import { buildInjectedProviderScript } from "../bridge/build-injected-provider-script";
import { executeApprovedRequest } from "../bridge/execute-approved-request";
import { buildWebViewResponseScript } from "../bridge/build-webview-response-script";
import {
  BRIDGE_MESSAGE_SOURCE,
  type BridgeResponse,
} from "../bridge/messages";
import { parseWebViewMessage } from "../bridge/parse-webview-message";
import { BrowserToolbar } from "./BrowserToolbar";
import { DappApprovalSheet } from "./DappApprovalSheet";

import { View } from "@/tw";

type BrowserSiteScreenProps = {
  initialUrl: string;
};

export function BrowserSiteScreen({ initialUrl }: BrowserSiteScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const currentUrlRef = useRef(initialUrl);
  const [navState, setNavState] = useState({
    canGoBack: false,
    canGoForward: false,
  });
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(
    null,
  );
  const trustedOriginsRef = useRef<string[]>(
    TRUSTED_DAPPS.map((dapp) => dapp.origin),
  );

  useEffect(() => {
    let cancelled = false;
    fetchTrustedDapps()
      .then((remote) => {
        if (cancelled || remote.length === 0) return;
        trustedOriginsRef.current = remote.map((dapp) => dapp.origin);
      })
      .catch(() => {
        // Keep bundled fallback when the network call fails.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleNavigationStateChange = useCallback(
    (snapshot: WebViewNavigation) => {
      currentUrlRef.current = snapshot.url;
      setNavState({
        canGoBack: snapshot.canGoBack,
        canGoForward: snapshot.canGoForward,
      });
    },
    [],
  );

  const injectBridgeResponse = useCallback((response: BridgeResponse) => {
    webViewRef.current?.injectJavaScript(buildWebViewResponseScript(response));
  }, []);

  const injectResponse = useCallback(
    (resolution: DappRequestResolution) => {
      if (resolution.kind === "response") {
        injectBridgeResponse(resolution.response);
      }
    },
    [injectBridgeResponse],
  );

  const executeApproval = useCallback(
    async (
      approval: PendingApproval,
      options?: { rememberOrigin?: boolean },
    ) => {
      try {
        if (approval.type === "connect" && options?.rememberOrigin !== false) {
          await rememberConnectedOrigin(approval.origin);
        }

        const result = await executeApprovedRequest(approval);
        injectBridgeResponse({
          source: BRIDGE_MESSAGE_SOURCE,
          id: approval.requestId,
          ok: true,
          result,
        });
      } catch (error) {
        injectBridgeResponse({
          source: BRIDGE_MESSAGE_SOURCE,
          id: approval.requestId,
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to execute approved request.",
        });
      } finally {
        setPendingApproval((current) =>
          current?.requestId === approval.requestId ? null : current,
        );
      }
    },
    [injectBridgeResponse],
  );

  const handleApproveApproval = useCallback(() => {
    const approval = pendingApproval;
    if (!approval) {
      return;
    }
    void executeApproval(approval);
  }, [executeApproval, pendingApproval]);

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
      const consoleMessage = tryParseConsoleMessage(event.nativeEvent.data);
      if (consoleMessage) {
        forwardWebViewConsoleMessage(consoleMessage);
        return;
      }

      try {
        const request = parseWebViewMessage(event.nativeEvent.data);
        const currentUrl = currentUrlRef.current;
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
          trustedOrigins: trustedOriginsRef.current,
        });

        if (resolution.kind === "response") {
          if (request.type === "connect") {
            await executeApproval(
              {
                requestId: request.id,
                origin,
                trustState: "connected",
                type: "connect",
              },
              { rememberOrigin: false },
            );
            return;
          }

          injectResponse(resolution);
          if (request.type === "disconnect") {
            await forgetConnectedOrigin(origin);
          }
          return;
        }

        setPendingApproval(resolution.approval);
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
    [executeApproval, injectResponse],
  );

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      <WebView
        ref={webViewRef}
        source={{ uri: initialUrl }}
        originWhitelist={["http://*", "https://*", "blob:*", "data:*"]}
        onNavigationStateChange={handleNavigationStateChange}
        onMessage={handleWebViewMessage}
        injectedJavaScriptBeforeContentLoaded={
          __DEV__
            ? buildConsoleForwardScript() + buildInjectedProviderScript()
            : buildInjectedProviderScript()
        }
        startInLoadingState
        renderLoading={() => (
          <View className="flex-1 items-center justify-center bg-white">
            <ActivityIndicator color="#f97362" />
          </View>
        )}
        className="flex-1"
      />
      <BrowserToolbar
        canGoBack={navState.canGoBack}
        canGoForward={navState.canGoForward}
        onBack={() => webViewRef.current?.goBack()}
        onForward={() => webViewRef.current?.goForward()}
        onHome={() => router.back()}
        onRefresh={() => webViewRef.current?.reload()}
      />
      <DappApprovalSheet
        approval={pendingApproval}
        onReject={handleRejectApproval}
        onApprove={handleApproveApproval}
      />
    </View>
  );
}
