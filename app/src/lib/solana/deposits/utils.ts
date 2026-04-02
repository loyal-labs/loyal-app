// Username must be between 5 and 32 characters
// Username can only contain lowercase alphanumeric characters and underscores
// Source: https://limits.tginfo.me/en
// Source: https://telegram.org/faq#q-what-can-i-use-as-my-username
export const validateLowercaseUsername = (username: string) => {
  if (!username) {
    throw new Error("Username is required");
  }
  if (username.length < 5 || username.length > 32) {
    throw new Error("Username must be between 5 and 32 characters");
  }
  if (!/^[a-z0-9_]+$/.test(username)) {
    throw new Error(
      "Username can only contain lowercase alphanumeric characters and underscores"
    );
  }
};
