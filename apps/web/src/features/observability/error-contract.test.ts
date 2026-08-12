import { describe, expect, test } from "bun:test";

import { isThirdPartyExtensionError } from "./error-contract";

// Real stacks captured from ClickStack (ServiceName=loyal-frontend).
const EXTENSION_ONLY_STACK = [
  "Error: func sseError not found",
  "    at Object.<anonymous> (chrome-extension://cadiboklkpojfamcoggejbbdjcoiljjk/inpage.js:252:19758)",
  "    at Generator.next (chrome-extension://cadiboklkpojfamcoggejbbdjcoiljjk/inpage.js:219:38552)",
].join("\n");

const APP_STACK_WITH_EXTENSION_CALLER = [
  "TypeError: t is not a function",
  "    at o (chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/scripts/inpage.js:2:59596)",
  "    at p (https://app.askloyal.com/_next/static/chunks/8156-abc.js:1:2048)",
].join("\n");

describe("isThirdPartyExtensionError", () => {
  test("drops ambient errors whose stack is only extension frames", () => {
    expect(
      isThirdPartyExtensionError(
        "browser.unhandled_rejection",
        EXTENSION_ONLY_STACK
      )
    ).toBe(true);
    expect(
      isThirdPartyExtensionError("browser.window.error", EXTENSION_ONLY_STACK)
    ).toBe(true);
  });

  test("keeps ambient errors that touch a first-party frame", () => {
    expect(
      isThirdPartyExtensionError(
        "browser.window.error",
        APP_STACK_WITH_EXTENSION_CALLER
      )
    ).toBe(false);
  });

  test("keeps explicit operations even on a pure extension stack", () => {
    expect(
      isThirdPartyExtensionError("earn.deposit.execute", EXTENSION_ONLY_STACK)
    ).toBe(false);
    expect(
      isThirdPartyExtensionError("react.error_boundary", EXTENSION_ONLY_STACK)
    ).toBe(false);
  });

  test("keeps ambient errors that carry no stack", () => {
    expect(
      isThirdPartyExtensionError("browser.unhandled_rejection", undefined)
    ).toBe(false);
  });

  test("still drops after the extension id is redacted by sanitization", () => {
    const sanitized = EXTENSION_ONLY_STACK.replace(
      "cadiboklkpojfamcoggejbbdjcoiljjk",
      "[REDACTED_IDENTIFIER]"
    );
    expect(
      isThirdPartyExtensionError("browser.unhandled_rejection", sanitized)
    ).toBe(true);
  });
});
