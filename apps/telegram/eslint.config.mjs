import { FlatCompat } from "@eslint/eslintrc";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    plugins: {
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      "@typescript-eslint/unbound-method": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env']",
          message:
            "Use centralized config modules instead of direct process.env access.",
        },
        {
          selector: "ImportDeclaration[source.value='@/lib/core/schema']",
          message:
            "Import shared schema from '@loyal-labs/db-core/schema' instead of app-local schema.",
        },
      ],
    },
  },
  {
    files: [
      "src/lib/core/config/**/*.ts",
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "src/**/__tests__/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-syntax": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/**/*.{ts,tsx}",
      "src/hooks/**/*.{ts,tsx}",
      "src/app/telegram/**/*.{ts,tsx}",
      "src/app/**/page.tsx",
      "src/app/**/layout.tsx",
      "src/app/**/template.tsx",
      "src/app/**/loading.tsx",
      "src/app/**/error.tsx",
      "src/app/**/not-found.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/core/config/server",
                "@/lib/core/config/server/*",
                "**/core/config/server",
                "**/core/config/server/*",
              ],
              message:
                "Client code must import public env from '@/lib/core/config/public'.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/lib/jupiter/**/*.{ts,tsx}"],
    ignores: ["src/lib/jupiter/**/*.server.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/core/config/server",
                "@/lib/core/config/server/*",
                "**/core/config/server",
                "**/core/config/server/*",
              ],
              message:
                "Do not import server config into shared/client jupiter modules. Use '@/lib/jupiter/server' for server-only entrypoints.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/app/api/og/**/*.tsx"],
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
];

export default eslintConfig;
