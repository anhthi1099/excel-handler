export const FORBIDDEN = 403;
export const SERVER_ERROR = 500;

export const ResponseType = {
  FORBIDDEN: 'Request Forbidden',
  SERVER_ERROR: 'Server Error',
  EMPTY_RESPONSE: 'Empty Response',
  SERVER_TIMEOUT: 'Server Timeout',
  FILE_IS_CORRUPTED: 'File Is Corrupted',
  WRONG_EMAIL: 'Wrong Email ',
  WRONG_PHONE: 'Wrong Phone',
  WRONG_URL: 'Wrong URL',
  WRONG_URL_HTML_EXTRACT: 'Wrong URL, HTML Extracted',
  WRONG_URL_IMG_EXTRACT: 'Wrong URL Img Extracted',
  INVALID_URL: 'Invalid URL',
};

export const RETRY_CV = 'Retry CV';

// Dev environment credentials
export const DEV_CREDENTIALS = {
  email: 'testrec@brightsource.com',
  password: '12qwaszx'
};

export const API_LIST = {
  getJobDetail: (jobId) => `https://dev-recruiter.brightsource.com/api/jobs-slug/${jobId}`,
  postMatchJob: `https://dev-recruiter.brightsource.com/api/search/profile-matches`,
  profilePage: (slug) => `https://rec-test1.firebaseapp.com/profile/${slug}`,
};
