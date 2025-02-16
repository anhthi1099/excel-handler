import { getEnvs, updateEnvVariable } from './envHandler.mjs';
import axios from 'axios';

const envs = getEnvs();

const authInfo = {
  token: envs.AUTH_TOKEN,
  refreshing: false,
};

export function getAuth() {
  return authInfo;
}

export async function refreshAuthToken() {
  if (authInfo.refreshing) {
    await new Promise((resolve) => setTimeout(resolve, 8000));
    return;
  }
  authInfo.refreshing = true;
  const authResponse = await axios.post(
    'https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=AIzaSyDY4QvwgV2Dx4sy4H1LQIRiAxK3hJD2i2Y',
    {
      email: 'eyal@ethosia.com',
      password: 'Shira1gal!@',
      returnSecureToken: true,
    },
  );
  authInfo.refreshing = false;
  updateEnvVariable('AUTH_TOKEN', authResponse.data.idToken);
  authInfo.token = `Bearer ${authResponse.data.idToken}`;
}