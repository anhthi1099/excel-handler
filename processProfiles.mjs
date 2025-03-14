import { readFile, writeFile } from 'fs/promises';
import axios from 'axios';
import { getAuth, refreshAuthTokenDevEnv } from './utils/auth.mjs';
import { API_LIST } from './constant.mjs';

/**
 * Helper function to retry API calls when encountering auth-related errors
 * @param {Function} apiCallFn - Function to execute the API call
 * @param {number} maxRetries - Maximum number of retry attempts
 * @returns {Promise<any>} - API response data
 */
async function retryApiCall(apiCallFn, maxRetries = 2) {
  let retries = 0;
  let auth = getAuth();
  
  while (retries <= maxRetries) {
    try {
      return await apiCallFn(auth.token);
    } catch (error) {
      // If we have a 401 or 403 error and haven't exceeded max retries
      if (error.response && (error.response.status === 401 || error.response.status === 403)) {
        if (retries < maxRetries) {
          console.log(`🔑 Auth token expired or invalid (${error.response.status}), refreshing...`);
          await refreshAuthTokenDevEnv();
          auth = getAuth();
          retries++;
          console.log(`Retrying request after token refresh (attempt ${retries}/${maxRetries})...`);
        } else {
          console.error(`❌ Maximum retry attempts (${maxRetries}) reached for API call.`);
          throw error;
        }
      } else {
        // For other errors, don't retry
        throw error;
      }
    }
  }
}

/**
 * Process profiles by calling APIs for each profile
 * @param {Array|null} inputProfiles - Optional array of profiles to process. If not provided, reads from matchResult.json
 */
export async function processProfiles(inputProfiles = null) {
  try {
    // Get profiles either from input parameter or from matchResult.json
    let profiles;
    if (inputProfiles) {
      profiles = inputProfiles;
      console.log(`✅ Processing ${profiles.length} profiles provided as input`);
    } else {
      // Read the matchResult.json file
      const data = await readFile('matchResult.json', 'utf8');
      profiles = JSON.parse(data);
      console.log(`✅ Successfully loaded ${profiles.length} profiles from matchResult.json`);
    }

    // Get auth token or refresh if needed
    let auth = getAuth();
    if (!auth.token) {
      console.log('No auth token found, refreshing...');
      await refreshAuthTokenDevEnv();
      auth = getAuth();
    }

    // Prepare to store results
    const apiResults = {
      wishlist: {},
      recruiter: {},
      matchJob: {} // Add new property for matchJob results
    };
    
    // Process each profile
    for (const profile of profiles) {
      const { slug, _id } = profile;
      
      if (!slug) {
        console.warn('❌ Profile missing slug, skipping');
        continue;
      }
      
      console.log(`🔄 Processing profile with slug: ${slug}, _id: ${_id}`);
      
      try {
        // Call wishlist API using the retry helper
        const wishlistData = await retryApiCall(async (token) => {
          const response = await axios.get(
            `https://dev-recruiter.brightsource.com/api/v1/candidates/wishlist-topjobs/${slug}`,
            {
              headers: {
                Authorization: token
              }
            }
          );
          return response.data;
        });
        
        apiResults.wishlist[slug] = wishlistData;
        console.log(`✅ Successfully fetched wishlist data for ${slug}`);
        
        // Call recruiter API using the retry helper
        const recruiterData = await retryApiCall(async (token) => {
          const response = await axios.get(
            `https://dev-recruiter.brightsource.com/api/v1/candidates/recruiter-topjobs/${slug}`,
            {
              headers: {
                Authorization: token
              }
            }
          );
          return response.data;
        });
        
        apiResults.recruiter[slug] = recruiterData;
        console.log(`✅ Successfully fetched recruiter data for ${slug}`);
        
        // Call postMatchJob API with the top-level _id
        if (_id) {
          const matchJobData = await retryApiCall(async (token) => {
            const response = await axios.post(
              API_LIST.postMatchJob,
              { id: _id }, // Send the top-level _id as the request body
              {
                headers: {
                  Authorization: token,
                  'Content-Type': 'application/json'
                }
              }
            );
            return response.data;
          });
          
          apiResults.matchJob[_id] = matchJobData;
          console.log(`✅ Successfully fetched match job data for _id: ${_id}`);
        } else {
          console.warn(`⚠️ Profile with slug ${slug} is missing _id, skipping postMatchJob API call`);
        }
        
      } catch (error) {
        console.error(`❌ Error fetching data for ${slug}:`, error.message);
      }
      
      // Add a small delay to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Generate timestamp for unique filenames
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    // Save results to files with timestamp
    const wishlistFileName = `wishlistResults_${timestamp}.json`;
    const recruiterFileName = `recruiterResults_${timestamp}.json`;
    const matchJobFileName = `matchJobResults_${timestamp}.json`;
    
    await writeFile(wishlistFileName, JSON.stringify(apiResults.wishlist, null, 2));
    await writeFile(recruiterFileName, JSON.stringify(apiResults.recruiter, null, 2));
    await writeFile(matchJobFileName, JSON.stringify(apiResults.matchJob, null, 2));
    
    console.log(`✅ API results saved to ${wishlistFileName}, ${recruiterFileName}, and ${matchJobFileName}`);
    
    return apiResults;
  } catch (error) {
    console.error('❌ Error processing profiles:', error);
    throw error;
  }
}

// Only run the function if this file is executed directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  await processProfiles();
} 