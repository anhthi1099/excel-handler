import { readFile, writeFile } from 'fs/promises';

async function extractSlugs() {
  try {
    // Read the matchResult.json file
    console.log('📖 Reading matchResult.json file...');
    const data = await readFile('matchResult.json', 'utf8');
    const profiles = JSON.parse(data);
    
    // Create an object to store different types of slugs
    const slugs = {
      profileSlugs: [],
      companySlugs: [],
      recruiterSlugs: [],
      educationSlugs: [],
      editBySlugs: [],
      talentSlugs: [],
      allSlugs: [] // Combined list of all slugs
    };
    
    // Function to recursively find all slug fields in an object
    function findSlugsInObject(obj, path = '') {
      if (!obj || typeof obj !== 'object') return;
      
      // Check each property in the object
      for (const key in obj) {
        const value = obj[key];
        const newPath = path ? `${path}.${key}` : key;
        
        // If the key contains "slug" (case insensitive) and the value is a string
        if (key.toLowerCase().includes('slug') && typeof value === 'string' && value) {
          // Add to the appropriate category
          if (key === 'slug') {
            slugs.profileSlugs.push(value);
          } else if (key === 'companySlug') {
            slugs.companySlugs.push(value);
          } else if (key === 'recruiterInChargeSlug') {
            slugs.recruiterSlugs.push(value);
          } else if (key === 'educationInstitutionSlug') {
            slugs.educationSlugs.push(value);
          } else if (key === 'editBySlug') {
            slugs.editBySlugs.push(value);
          } else if (key === 'talentSlug') {
            slugs.talentSlugs.push(value);
          }
          
          // Add to the combined list with path information
          slugs.allSlugs.push({
            path: newPath,
            value: value
          });
        }
        
        // Recursively check nested objects and arrays
        if (typeof value === 'object') {
          findSlugsInObject(value, newPath);
        }
      }
    }
    
    // Process each profile
    profiles.forEach((profile, index) => {
      console.log(`Processing profile ${index + 1}/${profiles.length}`);
      findSlugsInObject(profile);
    });
    
    // Remove duplicates from each category
    for (const category in slugs) {
      if (category === 'allSlugs') {
        // For allSlugs, we need to deduplicate based on the value property
        const uniqueValues = new Map();
        slugs.allSlugs.forEach(item => {
          if (!uniqueValues.has(item.value)) {
            uniqueValues.set(item.value, item);
          }
        });
        slugs.allSlugs = Array.from(uniqueValues.values());
      } else {
        // For other categories, we can deduplicate the array directly
        slugs[category] = [...new Set(slugs[category])];
      }
    }
    
    // Write the results to slugs.json
    console.log('💾 Writing results to slugs.json...');
    await writeFile('slugs.json', JSON.stringify(slugs, null, 2));
    console.log('✅ Slugs extracted and saved to slugs.json');
    
    // Print summary
    console.log('\n📊 Summary:');
    console.log(`Profile Slugs: ${slugs.profileSlugs.length}`);
    console.log(`Company Slugs: ${slugs.companySlugs.length}`);
    console.log(`Recruiter Slugs: ${slugs.recruiterSlugs.length}`);
    console.log(`Education Slugs: ${slugs.educationSlugs.length}`);
    console.log(`Edit By Slugs: ${slugs.editBySlugs.length}`);
    console.log(`Talent Slugs: ${slugs.talentSlugs.length}`);
    console.log(`Total Unique Slugs: ${slugs.allSlugs.length}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the function
extractSlugs(); 