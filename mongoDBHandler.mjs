import { MongoClient } from 'mongodb';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { processProfiles } from './processProfiles.mjs';

const uri = 'mongodb+srv://db_user_dev:uuGXYGfncLb6KCwg@main.sqbh5.gcp.mongodb.net/db1?retryWrites=true&w=majority';

async function connectToMongoDB() {
  const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  try {
    await client.connect();
    console.log('✅ Successfully connected to MongoDB');

    const db = client.db('db1'); // Specify the database name
    const profileCollection = db.collection('profilemodels'); // Change this to your collection

    // Query for documents where at least one of topMatchedJobWishlist, topMatchedJobRecruiter, or topMatchedJobLinkedin is a non-empty array
    const query = {
      $or: [
        { topMatchedJobWishlist: { $exists: true, $type: 'array', $ne: [] } },
        { topMatchedJobRecruiter: { $exists: true, $type: 'array', $ne: [] } },
        { topMatchedJobLinkedin: { $exists: true, $type: 'array', $ne: [] } },
        { isAvailable: true }
      ]
    };

    try {
      // First query: Get 14 records with the current conditions
      const firstBatchDocuments = await profileCollection.find(query).limit(50).toArray();
      console.log(`✅ First query: Found ${firstBatchDocuments.length} records`);

      // Get the slugs from the first batch to exclude them in the second query
      const existingSlugs = firstBatchDocuments.map(doc => doc.slug);
      console.log(`Found ${existingSlugs.length} unique slugs in the first batch`);

      // Second query: Get additional 36 records, WITHOUT requiring the topMatched fields
      // Just exclude the slugs from the first batch
      const secondQuery = { 
        slug: { $nin: existingSlugs } 
      };
      
      const secondBatchDocuments = await profileCollection.find(secondQuery).limit(1).toArray();
      console.log(`✅ Second query: Found ${secondBatchDocuments.length} additional records`);

      // Combine both result sets
      const allDocuments = [...firstBatchDocuments, ...secondBatchDocuments];
      
      // Ensure unique slugs (as an extra safety measure)
      const slugMap = new Map();
      const uniqueDocuments = [];
      
      for (const doc of allDocuments) {
        if (doc.slug && !slugMap.has(doc.slug)) {
          slugMap.set(doc.slug, true);
          uniqueDocuments.push(doc);
        }
      }
      
      console.log(`✅ Combined: Total of ${uniqueDocuments.length} unique records (maximum 50)`);

      // Display the first 5 documents as a sample if any exist
      if (uniqueDocuments.length > 0) {
        // Write the results to a JSON file
        try {
          await writeFile('matchResult.json', JSON.stringify(uniqueDocuments, null, 2));
          console.log('✅ Query results saved to matchResult.json');
        } catch (writeError) {
          console.error('❌ Failed to write to file:', writeError);
        }
      } else {
        console.log('No matching documents found');
      }
    } catch (queryError) {
      console.error('❌ Query execution failed:', queryError);
    }
  } catch (error) {
    console.error('❌ Connection failed:', error);
  } finally {
    await client.close();
    console.log('🔌 Connection closed');
  }
}

async function refreshProfilesFromMatchResults() {
  const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  try {
    // Read the matchResult.json file
    console.log('📖 Reading matchResult.json file...');
    const data = await readFile('matchResult.json', 'utf8');
    const profiles = JSON.parse(data);
    
    // Extract slugs from the profiles
    const slugs = profiles.map(profile => profile.slug).filter(Boolean);
    console.log(`✅ Found ${slugs.length} slugs from matchResult.json`);

    // Connect to MongoDB
    await client.connect();
    console.log('✅ Successfully connected to MongoDB');

    const db = client.db('db1');
    const profileCollection = db.collection('profilemodels');

    // Query MongoDB for profiles with the extracted slugs
    console.log('🔍 Querying profiles with the extracted slugs...');
    const query = { slug: { $in: slugs } };
    const refreshedProfiles = await profileCollection.find(query).toArray();
    
    console.log(`✅ Found ${refreshedProfiles.length} profiles matching the slugs`);

    // Write the results to refreshResult.json
    console.log('💾 Writing results to refreshResult.json...');
    await writeFile('refreshResult.json', JSON.stringify(refreshedProfiles, null, 2));
    console.log('✅ Results saved to refreshResult.json');
  } catch (error) {
    console.error('❌ Error:', );
  } finally {
    await client.close();
    console.log('🔌 Connection closed');
  }
}

async function refreshRandomProfile(startIndex, endIndex) {
  const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  try {
    await client.connect();
    console.log('✅ Successfully connected to MongoDB');

    const db = client.db('db1');
    const profileCollection = db.collection('profilemodels');

    // Calculate how many documents to skip and limit
    const skip = startIndex;
    const limit = endIndex - startIndex + 1;

    if (limit <= 0) {
      console.error('❌ Invalid range: endIndex must be greater than or equal to startIndex');
      return;
    }

    console.log(`🔍 Querying profiles from index ${startIndex} to ${endIndex} (${limit} profiles)...`);
    
    // Query MongoDB for profiles within the specified range
    const randomProfiles = await profileCollection.find({})
      .skip(skip)
      .limit(limit)
      .toArray();
    
    console.log(`✅ Found ${randomProfiles.length} profiles in the specified range`);

    if (randomProfiles.length > 0) {
      // Write the results to a temporary JSON file
      const tempFileName = `randomProfiles_${startIndex}_${endIndex}.json`;
      await writeFile(tempFileName, JSON.stringify(randomProfiles, null, 2));
      console.log(`✅ Random profiles saved to ${tempFileName}`);
      
      // Process the profiles using the processProfiles function
      console.log('🔄 Processing profiles with API calls...');
      await processProfiles(randomProfiles);
    } else {
      console.log('No profiles found in the specified range');
    }
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
    console.log('🔌 Connection closed');
  }
}

// Create a readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Function to prompt the user and run the selected function
async function promptAndRun() {
  console.log('📋 Available functions:');
  console.log('1. Connect to MongoDB and fetch profiles with matched jobs');
  console.log('2. Refresh profiles from matchResult.json');
  console.log('3. Refresh random profiles by index range');
  
  rl.question('Please enter your choice (1, 2, or 3): ', async (answer) => {
    try {
      if (answer === '1') {
        console.log('🔄 Running connectToMongoDB...');
        await connectToMongoDB();
      } else if (answer === '2') {
        console.log('🔄 Running refreshProfilesFromMatchResults...');
        await refreshProfilesFromMatchResults();
      } else if (answer === '3') {
        rl.question('Enter start index: ', async (startStr) => {
          rl.question('Enter end index: ', async (endStr) => {
            const start = parseInt(startStr, 10);
            const end = parseInt(endStr, 10);
            
            if (isNaN(start) || isNaN(end)) {
              console.log('❌ Invalid input. Please enter valid numbers.');
            } else {
              console.log(`🔄 Running refreshRandomProfile from ${start} to ${end}...`);
              await refreshRandomProfile(start, end);
            }
            rl.close();
          });
        });
        return; // Don't close rl yet
      } else {
        console.log('❌ Invalid choice. Please run again and select 1, 2, or 3.');
      }
    } catch (error) {
      console.error('❌ Error executing function:', error);
    } finally {
      if (answer !== '3') {
        rl.close();
      }
    }
  });
}

// Check if command line arguments are provided
const args = process.argv.slice(2);

// If arguments are provided, use them
if (args.length > 0) {
  if (args[0] === 'refresh') {
    console.log('🔄 Running refreshProfilesFromMatchResults...');
    await refreshProfilesFromMatchResults();
  } else if (args[0] === 'random' && args.length >= 3) {
    const start = parseInt(args[1], 10);
    const end = parseInt(args[2], 10);
    if (!isNaN(start) && !isNaN(end)) {
      console.log(`🔄 Running refreshRandomProfile from ${start} to ${end}...`);
      await refreshRandomProfile(start, end);
    } else {
      console.log('❌ Invalid arguments for random. Usage: node mongoDBHandler.mjs random <startIndex> <endIndex>');
    }
  } else {
    console.log('🔄 Running connectToMongoDB...');
    await connectToMongoDB();
  }
} else {
  // If no arguments, prompt the user
  await promptAndRun();
}
