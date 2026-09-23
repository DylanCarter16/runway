import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM for secrets at rest (OAuth refresh tokens, the LEARN feed URL).
// The key is TOKEN_ENCRYPTION_KEY: 32 random bytes, base64. Ciphertext format:
// "v1.<iv>.<tag>.<data>", each part base64url.

const VERSION = 'v1';

function keyBytes(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded.');
  return key;
}

export function encryptSecret(plain: string, base64Key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(base64Key), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), data.toString('base64url')].join('.');
}

export function decryptSecret(ciphertext: string, base64Key: string): string {
  const [version, iv, tag, data] = ciphertext.split('.');
  if (version !== VERSION || !iv || !tag || data === undefined) throw new Error('Unreadable encrypted value.');
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(base64Key), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
