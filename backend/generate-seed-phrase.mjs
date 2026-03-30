import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

// Parse command line args
const args = process.argv.slice(2);
const wordCount = args.includes('--24') ? 24 : 12;
const shouldEncrypt = args.includes('--encrypt');

console.log('\n=== BIP39 Seed Phrase Generator ===\n');

// Generate mnemonic (128 bits = 12 words, 256 bits = 24 words)
const strength = wordCount === 24 ? 256 : 128;
const mnemonic = generateMnemonic(wordlist, strength);

// Validate the generated mnemonic
if (!validateMnemonic(mnemonic, wordlist)) {
  console.error('Error: Generated mnemonic failed validation');
  process.exit(1);
}

console.log(`Generated ${wordCount}-word seed phrase:\n`);
console.log(mnemonic);
console.log('');

if (shouldEncrypt) {
  // Generate a random 32-byte encryption key
  const encryptionKey = crypto.randomBytes(32).toString('hex');

  // Encrypt using AES-256-GCM (matches src/utils/crypto.ts)
  const key = Buffer.from(encryptionKey, 'hex');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(mnemonic, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext (all base64)
  const encryptedSeed = `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;

  console.log('=== Add these lines to your .env file ===\n');
  console.log('HD_WALLET_ENABLED=true');
  console.log('HD_SEED_PHRASE_ENCRYPTED=' + encryptedSeed);
  console.log('HD_SEED_ENCRYPTION_KEY=' + encryptionKey);
  console.log('\n==========================================');
  console.log('WARNING: Keep these values secure!');
  console.log('==========================================\n');
} else {
  console.log('Tip: Use --encrypt to also generate encrypted .env values');
  console.log('Example: node generate-seed-phrase.mjs --encrypt\n');
}

console.log('Usage:');
console.log('  node generate-seed-phrase.mjs           # 12-word phrase');
console.log('  node generate-seed-phrase.mjs --24      # 24-word phrase');
console.log('  node generate-seed-phrase.mjs --encrypt # With .env encryption');
console.log('  node generate-seed-phrase.mjs --24 --encrypt # Both\n');
