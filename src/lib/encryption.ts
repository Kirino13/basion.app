import CryptoJS from 'crypto-js';

// Encryption key - must be same on client and server for burner wallet restore
// Note: In production, consider server-side-only encryption with signature verification
const ENCRYPTION_KEY = process.env.NEXT_PUBLIC_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || 'basion-default-key-change-in-production';

export function encryptKey(privateKey: string): string {
  return CryptoJS.AES.encrypt(privateKey, ENCRYPTION_KEY).toString();
}

export function decryptKey(encryptedKey: string): string {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedKey, ENCRYPTION_KEY);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    
    // Validate that we got a valid private key
    if (!decrypted || !decrypted.startsWith('0x')) {
      throw new Error('Decryption failed - invalid key format');
    }
    
    return decrypted;
  } catch (error) {
    console.error('Failed to decrypt key:', error);
    throw new Error('Failed to decrypt burner key');
  }
}
