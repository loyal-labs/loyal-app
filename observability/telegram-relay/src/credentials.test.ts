import { describe, expect, test } from "bun:test";

import { RelayCredentials } from "./credentials.ts";

describe("RelayCredentials", () => {
  const credentials = new RelayCredentials({
    clickStackWebhookSecret: "clickstack-bearer-secret-value",
    telegramBotToken: "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw",
    telegramChatId: "-1001234567890",
    slackWebhookUrl: "https://hooks.slack.com/services/T00000/B00000/abcdef123",
  });

  test("redacts every credential it was constructed with", () => {
    const redacted = credentials.redactLogText(
      [
        "secret=clickstack-bearer-secret-value",
        "token=123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw",
        "webhook=https://hooks.slack.com/services/T00000/B00000/abcdef123",
      ].join(" ")
    );

    expect(redacted).not.toContain("clickstack-bearer-secret-value");
    expect(redacted).not.toContain("AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw");
    expect(redacted).not.toContain("abcdef123");
  });

  test("redaction follows the credentials, not the first set built", () => {
    // The invariant the type enforces at compile time, asserted at runtime: a
    // different token means a redactor that covers that token, because the only
    // way to change one is to construct a new instance.
    const rotated = new RelayCredentials({
      clickStackWebhookSecret: "clickstack-bearer-secret-value",
      telegramBotToken: "rotated-unshaped-token-value",
      telegramChatId: "-1001234567890",
      slackWebhookUrl:
        "https://hooks.slack.com/services/T00000/B00000/abcdef123",
    });

    expect(rotated.redactLogText("token=rotated-unshaped-token-value")).toBe(
      "token=<redacted>"
    );
    // The old instance is unchanged and still covers only what it was given.
    expect(
      credentials.redactLogText("token=rotated-unshaped-token-value")
    ).toContain("rotated-unshaped-token-value");
  });

  test("redacts a secret that reaches the log HTML escaped", () => {
    // Alert text is escaped before it is logged, so a secret containing `&` or
    // `<` arrives in escaped form; matching only the raw literal missed it.
    const awkward = new RelayCredentials({
      clickStackWebhookSecret: "a&b<c>secret",
      telegramBotToken: "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw",
      telegramChatId: "-1001234567890",
      slackWebhookUrl: "https://hooks.slack.com/services/T00000/B00000/abcdef",
    });

    expect(awkward.redactLogText("secret=a&amp;b&lt;c&gt;secret")).toBe(
      "secret=<redacted>"
    );
    // And still in its raw spelling, which is what the Slack rendering carries.
    expect(awkward.redactLogText("secret=a&b<c>secret")).toBe(
      "secret=<redacted>"
    );
  });

  test("redacts a short secret rather than skipping it", () => {
    // Fails open otherwise: a length floor keeps logs readable by leaving the
    // shortest secrets in them.
    const short = new RelayCredentials({
      clickStackWebhookSecret: "hunter2",
      telegramBotToken: "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw",
      telegramChatId: "-1001234567890",
      slackWebhookUrl: "https://hooks.slack.com/services/T00000/B00000/abcdef",
    });

    expect(short.redactLogText("bearer=hunter2")).toBe("bearer=<redacted>");
  });

  test("does not let a short secret chew up another redaction's marker", () => {
    // `red` is a substring of the marker itself. Replacing in sequence rewrote
    // markers the earlier passes had written — `bot<<redacted>acted>` — so the
    // output was corrupted, and differently depending on credential order.
    const short = new RelayCredentials({
      clickStackWebhookSecret: "red",
      telegramBotToken: "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw",
      telegramChatId: "-1001234567890",
      slackWebhookUrl: "https://hooks.slack.com/services/T00000/B00000/abcdef",
    });

    expect(
      short.redactLogText(
        "url=https://api.telegram.org/bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/sendMessage"
      )
    ).toBe("url=https://api.telegram.org/bot<redacted>/sendMessage");
    expect(
      short.redactLogText(
        "hook=https://hooks.slack.com/services/T00000/B00000/abcdef"
      )
    ).toBe("hook=https://hooks.slack.com/services/<redacted>");
    // The secret itself is still redacted where it genuinely appears.
    expect(short.redactLogText("bearer=red")).toBe("bearer=<redacted>");
  });

  test("leaves no tail behind when two credentials overlap in the text", () => {
    // One credential ends where the other begins. Replacing left to right
    // consumed the second one's start and left its tail readable —
    // `<redacted>-BBBB`. Occurrences are found against the original text and
    // merged, so the whole run goes.
    const overlapping = new RelayCredentials({
      clickStackWebhookSecret: "AAAA-shared-tail",
      telegramBotToken: "shared-tail-BBBB",
      telegramChatId: "-1001234567890",
      slackWebhookUrl: "https://hooks.slack.com/services/T00000/B00000/abcdef",
    });

    expect(overlapping.redactLogText("x=AAAA-shared-tail-BBBB")).toBe(
      "x=<redacted>"
    );
    expect(overlapping.redactLogText("x=shared-tail-BBBB")).toBe(
      "x=<redacted>"
    );
  });

  test("survives an empty credential without shredding the text", () => {
    // Splitting on "" would put the marker between every character.
    const blank = new RelayCredentials({
      clickStackWebhookSecret: "",
      telegramBotToken: "",
      telegramChatId: "",
      slackWebhookUrl: "",
    });

    expect(blank.redactLogText("nothing secret here")).toBe(
      "nothing secret here"
    );
  });

  test("leaves the chat id readable", () => {
    expect(credentials.redactLogText("chat=-1001234567890")).toBe(
      "chat=-1001234567890"
    );
  });
});
