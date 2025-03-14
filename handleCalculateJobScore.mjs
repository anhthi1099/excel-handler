import { MongoClient } from 'mongodb';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { processProfiles } from './processProfiles.mjs';
import { processProfilesBySlug } from './playwrightProcess.mjs';
import { log } from 'console';

const uri = 'mongodb+srv://db_user_dev:uuGXYGfncLb6KCwg@main.sqbh5.gcp.mongodb.net/db1?retryWrites=true&w=majority';

const profileWithBlockedCompanyInMatchJobs = [];

async function handleWishlistJob(wishlistProfile, talentDB, db) {
  // Extract slugs from wishlistProfile
  const talentSlugs = wishlistProfile.map((profile) => profile.talentSlug);
  const slugs = wishlistProfile.map((profile) => profile.slug);

  // Extract job slugs from wishlistProfile's topMatchedJobWishlist
  const jobSlugs = wishlistProfile
    .flatMap((profile) => (profile.topMatchedJobWishlist || []).map((job) => job['Job Slug']))
    .filter(Boolean);

  // Get job details from collection
  const jobsCollection = db.collection('jobmodels');
  const jobs = await jobsCollection
    .find({ slug: { $in: jobSlugs } }, { projection: { slug: 1, company: 1 } })
    .toArray();

  // Create a map of job slug to company ID
  const jobCompanyMap = {};
  jobs.forEach((job) => {
    jobCompanyMap[job.slug] = job.company;
  });

  // Fetch seniorityLevels from metadata collection for seniority comparison
  const metadataCollection = db.collection('metadata');
  let seniorityRanking = {};

  try {
    const seniorityLevelsMetadata = await metadataCollection.findOne({
      key: { $regex: 'seniorityLevels', $options: 'i' },
    });

    if (seniorityLevelsMetadata && seniorityLevelsMetadata.val) {
      // Create a mapping of seniority ID to order value
      Object.entries(seniorityLevelsMetadata.val).forEach(([id, data]) => {
        if (data && data.order) {
          seniorityRanking[id] = data.order;
        }
      });
      console.log('✅ Successfully fetched seniorityLevels from metadata');
    } else {
      console.warn('⚠️ seniorityLevels metadata not found or invalid, using fallback values');
      // Fallback to hardcoded values if metadata is not available
      seniorityRanking = {
        1: 2, // Junior (order: 2)
        2: 5, // Team Leader (order: 5)
        3: 7, // Director (order: 7)
        5: 8, // CxO (order: 8)
        9: 3, // Experienced (order: 3)
        14: 6, // Manager (order: 6)
        15: 4, // Senior (order: 4)
        16: 10, // Owner (order: 10)
        17: 9, // Consultant (order: 9)
        18: 11, // Founder (order: 11)
      };
    }
  } catch (error) {
    console.error('❌ Error fetching seniorityLevels metadata:', error);
    // Fallback to hardcoded values if there's an error
    seniorityRanking = {
      1: 2, // Junior
      2: 5, // Team Leader
      3: 7, // Director
      5: 8, // CxO
      9: 3, // Experienced
      14: 6, // Manager
      15: 4, // Senior
      16: 10, // Owner
      17: 9, // Consultant
      18: 11, // Founder
    };
  }

  // Check for each profile if any of their matched jobs belong to blocked companies
  for (const profile of wishlistProfile) {

    // Find users in talentDB.Users that match profileSlug with wishlistProfile slugs
    const usersCollection = talentDB.collection('Users');
    const talentUsers = await usersCollection
      .find({ profileSlug: { $in: talentSlugs } }, { projection: { _id: 1, slug: 1, profileSlug: 1 } })
      .toArray();

    // Create a map of profileSlug to userSlug for easier lookup
    const profileToUserMap = {};
    talentUsers.forEach((user) => {
      profileToUserMap[user.profileSlug] = user.slug;
    });

    // Find job preferences in talentDB.JobPreferences
    const jobPreferencesCollection = talentDB.collection('JobPreferences');
    const userSlugs = talentUsers.map((user) => user.slug).filter(Boolean);
    const jobPreferences = await jobPreferencesCollection.find({ userSlug: { $in: userSlugs } }).toArray();

    // Create a map of userSlug to job preferences
    const userPreferencesMap = {};
    jobPreferences.forEach((pref) => {
      userPreferencesMap[pref.userSlug] = pref;
    });

    // Get full job details for scoring
    const fullJobs = await jobsCollection.find({ slug: { $in: jobSlugs } }).toArray();

    // Create a map of job slug to job details
    const jobDetailsMap = {};
    fullJobs.forEach((job) => {
      jobDetailsMap[job.slug] = job;
    });

    // Calculate scores for each profile and its matched jobs
    for (const profile of wishlistProfile) {
      if (!profile.topMatchedJobWishlist || profile.topMatchedJobWishlist.length === 0) continue;

      const userSlug = profileToUserMap[profile.slug];
      if (!userSlug) continue;

      const preferences = userPreferencesMap[userSlug];
      if (!preferences) continue;

      // Calculate score for each matched job
      const scoredJobs = profile.topMatchedJobWishlist.map((matchedJob) => {
        const jobSlug = matchedJob['Job Slug'];
        const jobDetails = jobDetailsMap[jobSlug];
        if (!jobDetails) return { ...matchedJob, score: 0 };

        let score = 0;
        let maxPossibleScore = 0;
        let scoreBreakdown = {};

        // Job Roles (Weight: 36)
        // Any matching role between candidate's wishlist and job roles gives full 36 points
        if (jobDetails.roles && preferences.desiredRoles) {
          const desiredRoles = preferences.desiredRoles;
          const jobRoles = Array.isArray(jobDetails.roles) ? jobDetails.roles : [jobDetails.roles];

          // Check for any intersection between job roles and desired roles
          const hasMatchingRole = jobRoles.some((role) => desiredRoles.includes(role));

          if (hasMatchingRole) {
            score += 36;
            scoreBreakdown.roles = 36;
          } else {
            scoreBreakdown.roles = 0;
          }
          maxPossibleScore += 36;
        }

        // Skills Matching (Weight: 36)
        // Calculate the fraction of overlapping skills between job requirements and candidate skills
        if (jobDetails.mandatorySkills && preferences.skills) {
          const candidateSkills = preferences.skills;
          const jobSkills = Array.isArray(jobDetails.mandatorySkills)
            ? jobDetails.mandatorySkills
            : [jobDetails.mandatorySkills];

          // Count matching skills
          const matchingSkillsCount = jobSkills.filter((skill) => candidateSkills.includes(skill)).length;

          // Calculate fraction of job skills that match with candidate skills
          if (jobSkills.length > 0) {
            const fraction = matchingSkillsCount / jobSkills.length;
            const skillScore = Math.round(36 * fraction);
            score += skillScore;
            scoreBreakdown.skills = skillScore;
          } else {
            scoreBreakdown.skills = 0;
          }
          maxPossibleScore += 36;
        }

        // Seniority Alignment (Weight: 17)
        // Full points if candidate's seniority meets or exceeds job requirements
        if (jobDetails.seniorityLevel && preferences.seniorityLevel) {
          const jobSeniority = jobDetails.seniorityLevel[0]; // Take first seniority level
          const candidateSeniority = preferences.seniorityLevel[0]; // Take first preference

          // Get order values from the dynamically fetched seniorityRanking
          const jobSeniorityOrder = seniorityRanking[jobSeniority] || 0;
          const candidateSeniorityOrder = seniorityRanking[candidateSeniority] || 0;

          // Check if candidate's seniority meets or exceeds job requirement based on order value
          if (candidateSeniorityOrder >= jobSeniorityOrder) {
            score += 17;
            scoreBreakdown.seniority = 17;
          } else {
            scoreBreakdown.seniority = 0;
          }
          maxPossibleScore += 17;
        }

        // Company Size (Weight: 1)
        // Exact match between candidate preference and job company size
        if (jobDetails.companyData && jobDetails.companyData.bsId && preferences.companySizes) {
          const hasMatchingCompanySize = preferences.companySizes.includes(jobDetails.companyData.bsId);

          if (hasMatchingCompanySize) {
            score += 1;
            scoreBreakdown.companySize = 1;
          } else {
            scoreBreakdown.companySize = 0;
          }
          maxPossibleScore += 1;
        }

        // Industries (Weight: 10)
        // Any intersection between candidate's interested industries and job industries gives full points
        if (jobDetails.industries && preferences.industries) {
          const hasMatchingIndustry = jobDetails.industries.some((industry) =>
            preferences.industries.includes(industry),
          );

          if (hasMatchingIndustry) {
            score += 10;
            scoreBreakdown.industries = 10;
          } else {
            scoreBreakdown.industries = 0;
          }
          maxPossibleScore += 10;
        }

        // Calculate percentage score
        const percentageScore = maxPossibleScore > 0 ? (score / maxPossibleScore) * 100 : 0;

        // Add debug info about the match
        const matchDebug = {
          jobTitle: jobDetails.title || 'Unknown',
          jobRoles: jobDetails.roles || [],
          preferenceRoles: preferences.desiredRoles || [],
          jobMandatorySkills: jobDetails.mandatorySkills || [],
          preferenceSkills: preferences.skills || [],
          jobSeniorityLevel: jobDetails.seniorityLevel || [],
          preferenceSeniorityLevel: preferences.seniorityLevel || [],
          jobIndustries: jobDetails.industries || [],
          preferenceIndustries: preferences.industries || [],
        };

        return {
          ...matchedJob,
          score: Math.round(percentageScore),
          scoreDetails: {
            raw: score,
            maxPossible: maxPossibleScore,
            breakdown: scoreBreakdown,
          },
          debug: matchDebug,
        };
      });

      // Sort jobs by score in descending order
      scoredJobs.sort((a, b) => b.score - a.score);



      // Update the profile with scored jobs
      profile.topMatchedJobWishlist = scoredJobs;
      // Log some information about the scoring for the first job if available
      if (scoredJobs.length > 0) {
        console.log(`✅ Scored ${scoredJobs.length} jobs for profile ${profile.slug}`);
        console.log(`   Top job (${scoredJobs[0]['Job Slug']}) score: ${scoredJobs[0].score}%`);
      }
    }

    await writeFile(`wishlistProfilesResult.json`, JSON.stringify(wishlistProfile, null, 2));
    
  }
}

function handleRecruiterJob(recruiterProfile) {}

async function handleCalculateJobScore() {
  const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  try {
    await client.connect();
    console.log('✅ Successfully connected to MongoDB');

    const db = client.db('db1'); // Specify the database name
    const profileCollection = db.collection('profilemodels'); // Change this to your collection
    const talentDB = client.db('talent');
    const jobPreferCollection = talentDB.collection('JobPreferences');
    const jobmodelsCollection = db.collection('jobmodels');
    const companymodelsCollection = db.collection('companymodels');
    const talentUserCollection = talentDB.collection('Users');

    const listProfileTest = jobPreferCollection.find().limit(50).toArray();

    const queryFindProfileWithTalentSlug = {
      $and: [
        { talentSlug: { $exists: true } },
        {
          $or: [
            { topMatchedJobWishlist: { $exists: true, $type: 'array', $ne: [] } },
            { topMatchedJobRecruiter: { $exists: true, $type: 'array', $ne: [] } },
          ],
        },
      ],
    };

    const profileWithTalentSlug = await profileCollection.find(queryFindProfileWithTalentSlug).limit(50).toArray();

    console.log(`✅ Found ${profileWithTalentSlug.length} profiles with talentSlug`);

    // Query for documents where at least one of topMatchedJobWishlist, topMatchedJobRecruiter, or topMatchedJobLinkedin is a non-empty array
    const query = {
      $and: [
        { isAvailable: true }, // This is now a required condition
        {
          $or: [
            { topMatchedJobWishlist: { $exists: true, $type: 'array', $ne: [] } },
            { topMatchedJobRecruiter: { $exists: true, $type: 'array', $ne: [] } },
          ],
        },
      ],
    };

    try {
      // First query: Get 14 records with the current conditions
      const normalProfiles = await profileCollection
        .find(query)
        .limit(profileWithTalentSlug.length >= 50 ? 1 : 50 - profileWithTalentSlug.length)
        .toArray();
      console.log(`✅ First query: Found ${normalProfiles.length} records`);

      const combinedProfiles = [...normalProfiles, ...profileWithTalentSlug];

      const allTestingSlugs = combinedProfiles.map((profile) => profile.slug);

      // Filter profiles that don't have any topMatchedJob fields
      const profilesWithoutTopMatchJobs = combinedProfiles.filter((profile) => {
        const hasTopMatchedJobWishlist = profile.topMatchedJobWishlist && profile.topMatchedJobWishlist.length > 0;
        const hasTopMatchedJobRecruiter = profile.topMatchedJobRecruiter && profile.topMatchedJobRecruiter.length > 0;

        return !hasTopMatchedJobWishlist && !hasTopMatchedJobRecruiter;
      });

      // Log profiles without top matched jobs

      // Extract slugs from profiles for playwright processing
      const slugsForPlaywright = profilesWithoutTopMatchJobs.map((profile) => ({
        slug: profile.slug,
      }));

      // Write these slugs to a separate file for playwright processing
      try {
        // Import the playwright process function and run it with the slugs
        try {
          console.log(`handling ${slugsForPlaywright.length} profiles for playwright processing`);
          if (slugsForPlaywright.length) {
            await processProfilesBySlug(slugsForPlaywright).catch((err) =>
              console.error('❌ Error in playwright process:', err),
            );
          }
        } catch (importError) {
          console.error('❌ Failed to import or run playwright process:', importError);
        }
      } catch (writeError) {
        console.error('❌ Failed to write slugs to file:', writeError);
      }

      const updatedProfiles = await profileCollection.find({ slug: { $in: allTestingSlugs } }).toArray();
      await writeFile('refreshResult.json', JSON.stringify(combinedProfiles, null, 2));

      const filteredProfiles = await handleFilterBlockedCompanies(updatedProfiles, db);

      const wishlistProfiles = filteredProfiles.filter(
        (profile) => profile.topMatchedJobWishlist?.length > 0 && profile.talentSlug,
      );
      const recruiterProfiles = filteredProfiles.filter((profile) => profile.topMatchedJobRecruiter?.length > 0);

      console.log(`handling ${wishlistProfiles.length} wish list profile`);
      await handleWishlistJob(wishlistProfiles, talentDB, db);

      return;

      // Write wishlistProfiles to a JSON file after calculation
      try {
        await writeFile('wishlistProfilesResult.json', JSON.stringify(wishlistProfiles, null, 2));
        console.log('✅ Wishlist profiles saved to wishlistProfilesResult.json');
      } catch (writeError) {
        console.error('❌ Failed to write wishlist profiles to file:', writeError);
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

// Helper function to safely compare MongoDB ObjectIds or their string representations
function isSameObjectId(id1, id2) {
  if (!id1 || !id2) return false;

  // Convert to string if they're not already
  const str1 = typeof id1 === 'object' ? id1.toString() || id1.$oid?.toString() : id1.toString();
  const str2 = typeof id2 === 'object' ? id2.toString() || id2.$oid?.toString() : id2.toString();

  return str1 === str2;
}

async function handleFilterBlockedCompanies(profiles, db) {
  console.log(`🔍 Filtering profiles with blocked companies in matched jobs...`);

  for (const profile of profiles) {
    const blockedCompaniesList = [];
    const blockedCompanies = profile.talent?.wishlist?.selectedBlockedCompanies || [];
    if (!blockedCompanies.length) {
      continue;
    }

    // Get all job slugs from the profile's matched jobs
    const matchedJobSlugs = [];

    // Check topMatchedJobWishlist if it exists
    if (profile.topMatchedJobWishlist && profile.topMatchedJobWishlist.length > 0) {
      for (const matchedJob of profile.topMatchedJobWishlist) {
        if (matchedJob['Job Slug']) {
          matchedJobSlugs.push(matchedJob['Job Slug']);
        }
      }
    }

    // Check topMatchedJobRecruiter if it exists
    if (profile.topMatchedJobRecruiter && profile.topMatchedJobRecruiter.length > 0) {
      for (const matchedJob of profile.topMatchedJobRecruiter) {
        if (matchedJob['Job Slug']) {
          matchedJobSlugs.push(matchedJob['Job Slug']);
        }
      }
    }

    // If no matched jobs, skip this profile
    if (matchedJobSlugs.length === 0) {
      continue;
    }

    // Get all job objects for the matched job slugs
    const jobCollection = db.collection('jobmodels');
    const matchedJobs = await jobCollection.find({ slug: { $in: matchedJobSlugs } }).toArray();

    // Check if any of the matched jobs are from blocked companies
    const blockedJobs = [];

    for (const job of matchedJobs) {
      // Check if the job's company ID is in the profile's blockedCompanies list
      if (job.company && blockedCompanies.some((blockedCompany) => isSameObjectId(blockedCompany, job.company))) {
        console.log(`🔍 Found blocked job: ${job.slug} for profile ${profile.slug}`);
        blockedJobs.push(job);
        blockedCompaniesList.push({
          company: job.companySlug,
          jobSlug: job.slug,
          profileSlug: profile.slug,
          companyName: job.companyData?.name || '',
          jobName: job.title,
        });
      }
    }

    // If any blocked jobs found, add this profile to the list
    if (blockedJobs.length > 0) {
      profileWithBlockedCompanyInMatchJobs.push({
        profileSlug: profile.slug,
        profileName: profile.name || 'Unknown',
        foundBLockedCompanies: blockedCompaniesList,
      });
    }
  }

  // Write the results to a file
  try {
    await writeFile('blockedReport.json', JSON.stringify(profileWithBlockedCompanyInMatchJobs, null, 2));
    console.log(
      `✅ Wrote report of ${profileWithBlockedCompanyInMatchJobs.length} profiles with blocked companies to blockedReport.json`,
    );
  } catch (writeError) {
    console.error('❌ Failed to write blocked companies report to file:', writeError);
  }
  // filter out the profile that has blocked job
  const filteredProfiles = profiles.filter(
    (profile) =>
      !profileWithBlockedCompanyInMatchJobs.some((blockedProfile) => blockedProfile.profileSlug === profile.slug),
  );

  return filteredProfiles;
}

// Check if command line arguments are provided
const args = process.argv.slice(2);

await handleCalculateJobScore();
