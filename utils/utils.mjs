import axios from 'axios';
import { updateEnvVariable } from './envHandler.mjs';

export async function refreshAuthToken(authToken) {
  if (authToken.refreshing) {
    await new Promise((resolve) => setTimeout(resolve, 8000));
    return;
  }
  authToken.refreshing = true;
  const authResponse = await axios.post(
    'https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=AIzaSyDY4QvwgV2Dx4sy4H1LQIRiAxK3hJD2i2Y',
    {
      email: 'eyal@ethosia.com',
      password: 'Shira1gal!@',
      returnSecureToken: true,
    },
  );
  authToken.refreshing = false;
  updateEnvVariable('AUTH_TOKEN', authResponse.data.idToken);
  authToken.token = `Bearer ${authResponse.data.idToken}`;
}
