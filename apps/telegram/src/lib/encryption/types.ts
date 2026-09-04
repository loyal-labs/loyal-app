export interface EncryptedData {
  ciphertext: string; // base64 encoded
  iv: string; // base64 encoded (12 bytes)
}
