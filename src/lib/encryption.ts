import CryptoJS from 'crypto-js';

// SECURITY: Encryption key is SERVER-SIDE ONLY
// Never expose this to the client - all encryption/decryption happens on server
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

// Check if we're on the server
const isServer = typeof window === 'undefined';

export function encryptKey(privateKey: string): string {
  if (!isServer) {
    throw new Error('encryptKey can only be called on the server');
  }
  if (!ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  return CryptoJS.AES.encrypt(privateKey, ENCRYPTION_KEY).toString();
}

export function decryptKey(encryptedKey: string): string {
  if (!isServer) {
    throw new Error('decryptKey can only be called on the server');
  }
  if (!ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  
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
