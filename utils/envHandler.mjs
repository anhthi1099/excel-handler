import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';

config({ path: '.env.local' });
const envPath = path.resolve('.env.local');

export function updateEnvVariable(key, value) {
  let envVars = fs.readFileSync(envPath, 'utf8').split('\n');

  let updated = false;
  envVars = envVars.map((line) => {
    if (line.startsWith(`${key}=`)) {
      updated = true;
      return `${key}=${value}`; // Update existing key
    }
    return line;
  });

  if (!updated) {
    envVars.push(`${key}=${value}`); // Add new key if not found
  }

  fs.writeFileSync(envPath, envVars.join('\n'), 'utf8');
}

export function getEnvs() {
  return { ...process.env, AUTH_TOKEN: `Bearer ${process.env.AUTH_TOKEN}` };
}
