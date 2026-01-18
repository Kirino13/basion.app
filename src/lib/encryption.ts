import CryptoJS from 'crypto-js';

const ENCRYPTION_KEY = process.env.NEXT_PUBLIC_ENCRYPTION_KEY || 'basion-default-key-change-in-production';

export function encryptKey(privateKey: string): string {
  return CryptoJS.AES.encrypt(privateKey, ENCRYPTION_KEY).toString();
}

export function decryptKey(encryptedKey: string): string {
  const secret = process.env.ENCRYPTION_SECRET || ENCRYPTION_KEY;
  const bytes = CryptoJS.AES.decrypt(encryptedKey, secret);
  return bytes.toString(CryptoJS.enc.Utf8);
}
