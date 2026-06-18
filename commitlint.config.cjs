module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Commit bodies often carry pasted context (URLs, logs, paths); the project
    // squash-merges PRs so per-commit body wrapping never reaches main history.
    // Keep it as guidance (warning) instead of a hard CI failure.
    "body-max-line-length": [1, "always", 100],
  },
};
