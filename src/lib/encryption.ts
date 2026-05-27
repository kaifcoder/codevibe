import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// AES-256-GCM. Key is 32-byte hex (64 chars) in MCP_TOKEN_ENCRYPTION_KEY.
// Format on disk: base64(iv | authTag | ciphertext) — 12-byte IV, 16-byte tag.

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const hex = process.env.MCP_TOKEN_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error('MCP_TOKEN_ENCRYPTION_KEY env var is required (32-byte hex).');
  }
  if (hex.length !== 64) {
    throw new Error('MCP_TOKEN_ENCRYPTION_KEY must be 64 hex chars (32 bytes).');
  }
  return Buffer.from(hex, 'hex');
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
