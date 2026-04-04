'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const REQUIRED = ['OPENAI_API_KEY'];

for (const key of REQUIRED) {
  if (!process.env[key]) {
    console.error(`\n[EcoGate] FATAL: Missing required environment variable: ${key}`);
    console.error(`[EcoGate] Create a .env file in the ecogate/ directory. See .env.example for reference.\n`);
    process.exit(1);
  }
}

const config = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  PORT: parseInt(process.env.PORT, 10) || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
};

module.exports = config;
