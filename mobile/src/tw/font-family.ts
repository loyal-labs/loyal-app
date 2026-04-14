type ResolvedTextFontProps = {
  className?: string;
  fontFamily?: string;
};

const GEIST_REGULAR_FONT_FAMILY = "Geist_400Regular";
const GEIST_WEIGHT_CLASSES: {
  fontFamily: string;
  pattern: RegExp;
}[] = [
  { fontFamily: GEIST_REGULAR_FONT_FAMILY, pattern: /\bfont-normal\b/g },
  { fontFamily: "Geist_500Medium", pattern: /\bfont-medium\b/g },
  { fontFamily: "Geist_600SemiBold", pattern: /\bfont-semibold\b/g },
  { fontFamily: "Geist_700Bold", pattern: /\bfont-bold\b/g },
];
const ARBITRARY_FONT_CLASS_PATTERN = /font-\[([^\]]+)\]/;
const FONT_MONO_CLASS_PATTERN = /\bfont-mono\b/;

function normalizeClassName(className?: string): string | undefined {
  const normalized = className?.replace(/\s+/g, " ").trim();
  return normalized ? normalized : undefined;
}

export function resolveTextFontProps(
  className?: string,
  explicitFontFamily?: string,
  monoFontFamily = "monospace",
): ResolvedTextFontProps {
  const normalizedClassName = normalizeClassName(className);

  if (explicitFontFamily) {
    return { className: normalizedClassName, fontFamily: undefined };
  }

  if (!normalizedClassName) {
    return { className: undefined, fontFamily: GEIST_REGULAR_FONT_FAMILY };
  }

  if (FONT_MONO_CLASS_PATTERN.test(normalizedClassName)) {
    return {
      className: normalizeClassName(
        normalizedClassName.replace(FONT_MONO_CLASS_PATTERN, " "),
      ),
      fontFamily: monoFontFamily,
    };
  }

  const arbitraryFontMatch = normalizedClassName.match(ARBITRARY_FONT_CLASS_PATTERN);

  if (arbitraryFontMatch) {
    return {
      className: normalizeClassName(
        normalizedClassName.replace(arbitraryFontMatch[0], " "),
      ),
      fontFamily: arbitraryFontMatch[1],
    };
  }

  let strippedClassName = normalizedClassName;
  let fontFamily = GEIST_REGULAR_FONT_FAMILY;

  for (const weightClass of GEIST_WEIGHT_CLASSES) {
    const nextClassName = strippedClassName.replace(weightClass.pattern, " ");
    if (nextClassName !== strippedClassName) {
      strippedClassName = nextClassName;
      fontFamily = weightClass.fontFamily;
    }
  }

  return {
    className: normalizeClassName(strippedClassName),
    fontFamily,
  };
}
