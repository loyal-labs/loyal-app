module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@loyal-labs/shared$": "<rootDir>/../packages/shared/src/index",
    "^expo-seed-vault$": "<rootDir>/modules/expo-seed-vault/src/index",
  },
  transform: {
    "^.+\\.tsx?$": "ts-jest",
    "node_modules/@noble/.+\\.js$": "ts-jest",
  },
  transformIgnorePatterns: [
    "node_modules/(?!(@noble/ciphers|@noble/hashes)/)",
  ],
};
