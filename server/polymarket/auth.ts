import crypto from 'crypto';

const API_KEY = process.env.POLYMARKET_API_KEY ?? '';
const API_SECRET = process.env.POLYMARKET_API_SECRET ?? '';
const PASSPHRASE = process.env.POLYMARKET_PASSPHRASE ?? '';

export function getAuthHeaders(): Record<string, string> {
  if (!API_KEY || !API_SECRET || !PASSPHRASE) {
    return {};
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();

  const message = timestamp + nonce;
  const signature = crypto
    .createHmac('sha256', API_SECRET)
    .update(message)
    .digest('base64');

  return {
    'POLY_API_KEY': API_KEY,
    'POLY_SIGNATURE': signature,
    'POLY_TIMESTAMP': timestamp,
    'POLY_NONCE': nonce,
    'POLY_PASSPHRASE': PASSPHRASE,
    'Content-Type': 'application/json',
  };
}

export function isConfigured(): boolean {
  return !!(API_KEY && API_SECRET && PASSPHRASE);
}
