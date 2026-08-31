module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@loyal-labs/shared$": "<rootDir>/../../packages/shared/src/index",
    "^@loyal-labs/wallet-core/lib$":
      "<rootDir>/../../packages/wallet-core/src/lib/index",
    "^expo-seed-vault$": "<rootDir>/modules/expo-seed-vault/src/index",
    "^expo-synced-keychain$": "<rootDir>/modules/expo-synced-keychain/src/index",
    "\\.(png|jpg|jpeg|gif|webp|svg)$": "<rootDir>/test/fileMock.js",
  },
  transform: {
    "^.+\\.tsx?$": "ts-jest",
    "node_modules/@noble/.+\\.js$": "ts-jest",
  },
  transformIgnorePatterns: [
    "node_modules/(?!(@noble/ciphers|@noble/hashes)/)",
  ],
};
