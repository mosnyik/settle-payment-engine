const crypto = require('crypto');
const readline = require('readline');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('\n=== HD Wallet Key Generator ===\n');
console.log('Enter your 12 or 24 word mnemonic (ALL ON ONE LINE):');
console.log('');

rl.question('> ', (mnemonic) => {
  // Clean up: remove extra spaces and newlines
  mnemonic = mnemonic.trim().replace(/\s+/g, ' ');

  // Basic validation
  const wordCount = mnemonic.split(' ').length;
  if (wordCount !== 12 && wordCount !== 24) {
    console.error(`\nError: Mnemonic must be 12 or 24 words. You entered ${wordCount} words.`);
    console.error('Make sure to paste all words on a SINGLE line.\n');
    rl.close();
    process.exit(1);
  }

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

  console.log('\n=== Add these lines to your .env file ===\n');
  console.log('HD_WALLET_ENABLED=true');
  console.log('HD_SEED_PHRASE_ENCRYPTED=' + encryptedSeed);
  console.log('HD_SEED_ENCRYPTION_KEY=' + encryptionKey);
  console.log('\n==========================================');
  console.log('WARNING: Keep these values secure!');
  console.log('==========================================\n');

  rl.close();
});

