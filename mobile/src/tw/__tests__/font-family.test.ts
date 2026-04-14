import { resolveTextFontProps } from "../font-family";

describe("resolveTextFontProps", () => {
  it("defaults plain text to Geist regular", () => {
    expect(resolveTextFontProps(undefined)).toEqual({
      className: undefined,
      fontFamily: "Geist_400Regular",
    });
    expect(resolveTextFontProps("text-black")).toEqual({
      className: "text-black",
      fontFamily: "Geist_400Regular",
    });
  });

  it("maps weight utilities to Geist variants", () => {
    expect(resolveTextFontProps("text-black font-medium")).toEqual({
      className: "text-black",
      fontFamily: "Geist_500Medium",
    });
    expect(resolveTextFontProps("font-semibold text-white")).toEqual({
      className: "text-white",
      fontFamily: "Geist_600SemiBold",
    });
    expect(resolveTextFontProps("text-black font-bold")).toEqual({
      className: "text-black",
      fontFamily: "Geist_700Bold",
    });
  });

  it("resolves mono and arbitrary font utilities to fontFamily", () => {
    expect(resolveTextFontProps("font-mono text-black", undefined, "Menlo")).toEqual({
      className: "text-black",
      fontFamily: "Menlo",
    });
    expect(
      resolveTextFontProps("font-[Geist_600SemiBold] text-black"),
    ).toEqual({
      className: "text-black",
      fontFamily: "Geist_600SemiBold",
    });
  });

  it("leaves className untouched when an explicit font family is already set", () => {
    expect(resolveTextFontProps("text-black font-semibold", "Menlo")).toEqual({
      className: "text-black font-semibold",
      fontFamily: undefined,
    });
  });
});
