import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import { writeFile } from 'fs/promises';
import readline from 'readline';

// Load environment variables
dotenv.config({ path: '.env.local' });

const uri = 'mongodb+srv://db_user_dev:uuGXYGfncLb6KCwg@main.sqbh5.gcp.mongodb.net/db1?retryWrites=true&w=majority';

/**
 * Get job preferences for a profile
 * @param {string} profileSlug - The profile slug to lookup
 * @returns {Promise<Object|null>} - The job preference object or null if not found
 */
export async function getJobPreferenceByProfileSlug(profileSlug) {
  if (!profileSlug) {
    console.error('❌ Profile slug is required');
    return null;
  }

  const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    // First get the profile to find its talentSlug
    const db = client.db('db1');
    const profileCollection = db.collection('profilemodels');
    
    // Find the profile to get its talentSlug
    const profile = await profileCollection.findOne(
      { slug: profileSlug },
      { projection: { talentSlug: 1 } }
    );
    
    if (!profile || !profile.talentSlug) {
      console.log(`❌ No profile found with slug: ${profileSlug} or profile doesn't have talentSlug`);
      return null;
    }
    
    const talentSlug = profile.talentSlug;
    console.log(`✅ Found profile with talentSlug: ${talentSlug}`);

    // Get the talent database and relevant collections
    const talentDB = client.db('talent');
    const usersCollection = talentDB.collection('Users');
    const jobPreferencesCollection = talentDB.collection('JobPreferences');

    // Find the user with matching talentSlug (not profileSlug)
    const user = await usersCollection.findOne(
      { slug: talentSlug },
      { projection: { _id: 1, slug: 1 } }
    );

    if (!user) {
      console.log(`❌ No user found with talentSlug: ${talentSlug}`);
      return null;
    }

    const userSlug = user.slug;
    console.log(`✅ Found user with slug: ${userSlug}`);

    // Find the job preference for this user
    const jobPreference = await jobPreferencesCollection.findOne({ userSlug });

    if (!jobPreference) {
      console.log(`❌ No job preference found for user: ${userSlug}`);
      return null;
    }

    console.log(`✅ Found job preference for user: ${userSlug}`);
    
    // Write job preference to file
    try {
      await writeFile('testingJobPreference.json', JSON.stringify(jobPreference, null, 2));
      console.log('✅ Job preference written to testingJobPreference.json');
    } catch (writeError) {
      console.error('❌ Error writing job preference to file:', writeError);
    }
    
    return jobPreference;
  } catch (error) {
    console.error('❌ Error accessing MongoDB:', error);
    return null;
  } finally {
    await client.close();
    console.log('🔌 Connection closed');
  }
}

/**
 * Search for job preferences by specific criteria
 * @param {Object} criteria - Search criteria (e.g., { skills: [123] })
 * @returns {Promise<Array|null>} - Array of job preference objects or null if error
 */
export async function searchJobPreferences(criteria) {
  if (!criteria || Object.keys(criteria).length === 0) {
    console.error('❌ Search criteria are required');
    return null;
  }

  const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    // Get the talent database and relevant collections
    const talentDB = client.db('talent');
    const jobPreferencesCollection = talentDB.collection('JobPreferences');

    // Search for job preferences matching the criteria
    const jobPreferences = await jobPreferencesCollection.find(criteria).toArray();

    if (jobPreferences.length === 0) {
      console.log(`❌ No job preferences found matching the criteria`);
      return [];
    }

    console.log(`✅ Found ${jobPreferences.length} job preferences matching the criteria`);
    
    // Write job preferences to file
    try {
      await writeFile('searchJobPreferences.json', JSON.stringify(jobPreferences, null, 2));
      console.log('✅ Job preferences written to searchJobPreferences.json');
    } catch (writeError) {
      console.error('❌ Error writing job preferences to file:', writeError);
    }
    
    return jobPreferences;
  } catch (error) {
    console.error('❌ Error accessing MongoDB:', error);
    return null;
  } finally {
    await client.close();
    console.log('🔌 Connection closed');
  }
}

// Run this when file is executed directly
if (process.argv[1] === import.meta.url.substring(7)) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\n=== Job Preference Utilities ===');
  console.log('1. Get job preference by profile slug');
  console.log('2. Search job preferences by criteria');
  console.log('q. Quit');

  rl.question('\nWhich function would you like to run? ', async (answer) => {
    try {
      switch (answer.trim()) {
        case '1':
          rl.question('Enter profile slug: ', async (profileSlug) => {
            try {
              await getJobPreferenceByProfileSlug(profileSlug.trim());
            } catch (err) {
              console.error('Error:', err);
            } finally {
              rl.close();
            }
          });
          break;
        
        case '2':
          rl.question('Enter search criteria (JSON format, e.g., {"skills": [2108]}): ', async (criteriaStr) => {
            try {
              const criteria = JSON.parse(criteriaStr.trim());
              await searchJobPreferences(criteria);
            } catch (err) {
              console.error('Error parsing criteria or searching:', err);
            } finally {
              rl.close();
            }
          });
          break;
        
        case 'q':
        case 'Q':
          console.log('Exiting...');
          rl.close();
          break;
        
        default:
          console.log('Invalid option. Exiting...');
          rl.close();
          break;
      }
    } catch (error) {
      console.error('Error:', error);
      rl.close();
    }
  });
} 