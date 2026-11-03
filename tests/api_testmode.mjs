// Local testing: run the API with SMS in test mode (OTP shown on screen, no real SMS). dotenv never overrides a
// variable that already exists, so the key in server/.env is ignored.
process.env.SMS_2FACTOR_API_KEY = '';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../server/', import.meta.url))); // the API reads server/.env and serves ../<app>/dist from there
await import(new URL('../server/src/index.js', import.meta.url).href);
const { SMS_TEST_MODE } = await import(new URL('../server/src/sms.js', import.meta.url).href); console.log('SMS test mode:', SMS_TEST_MODE);
