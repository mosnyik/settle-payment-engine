#!/usr/bin/env node
const crypto = require('crypto');

const secret = crypto.randomBytes(32).toString('hex');

console.log('\n=== Admin Secret Generated ===\n');
console.log('Add this to your .env file:\n');
console.log(`ADMIN_SECRET=${secret}`);
console.log('\n==============================\n');
