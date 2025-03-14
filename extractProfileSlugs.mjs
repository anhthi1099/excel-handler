import { readFile, writeFile } from 'fs/promises';

async function extractProfileSlugs() {
  try {
    // Read the matchResult.json file
    console.log('📖 Reading matchResult.json file...');
    const data = await readFile('matchResult.json', 'utf8');
    const profiles = JSON.parse(data);
    
    // Extract only the main profile slugs
    const profileSlugs = profiles
      .map(profile => profile.slug)
      .filter(Boolean); // Remove any undefined or null values
    
    // Create a simple object with the slugs array
    const result = {
      profileSlugs: profileSlugs,
      count: profileSlugs.length
    };
    
    // Write the results to profileSlugs.json
    console.log('💾 Writing results to profileSlugs.json...');
    await writeFile('profileSlugs.json', JSON.stringify(result, null, 2));
    console.log('✅ Profile slugs extracted and saved to profileSlugs.json');
    console.log(`📊 Total profile slugs: ${profileSlugs.length}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the function
extractProfileSlugs(); 