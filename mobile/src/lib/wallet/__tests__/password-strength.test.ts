import { getPasswordStrength, MIN_PASSWORD_LENGTH } from "../password-strength";

describe("getPasswordStrength", () => {
  it("returns weak for empty", () => {
    expect(getPasswordStrength("").level).toBe("weak");
  });

  it("returns weak for too short", () => {
    expect(getPasswordStrength("abc").level).toBe("weak");
  });

  it("returns weak for 6 chars with 1 char type", () => {
    expect(getPasswordStrength("abcdef").level).toBe("weak");
  });

  it("returns fair for 8+ chars", () => {
    expect(getPasswordStrength("abcdefgh").level).toBe("fair");
  });

  it("returns fair for 6 chars with 2 char types", () => {
    expect(getPasswordStrength("abcde1").level).toBe("fair");
  });

  it("returns strong for 10+ chars with 2+ types", () => {
    expect(getPasswordStrength("abcdefgh12").level).toBe("strong");
  });

  it("exports MIN_PASSWORD_LENGTH as 6", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(6);
  });
});
