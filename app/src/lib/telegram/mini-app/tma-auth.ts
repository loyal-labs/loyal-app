export const createAuthHeaders = (tgWebAppData: string | null): HeadersInit => {
  const headers: HeadersInit = { accept: "application/json" };

  if (tgWebAppData) {
    const base64Encoded = btoa(tgWebAppData);

    headers.Authorization = `Bearer ${base64Encoded}`;
  }

  return headers;
};
