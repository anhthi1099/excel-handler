import { MongoClient } from 'mongodb';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import readline from 'readline';
import ExcelJS from 'exceljs';
import { processProfiles } from './processProfiles.mjs';
import { processProfilesBySlug } from './playwrightProcess.mjs';
import { log } from 'console';
import dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

const uri = 'mongodb+srv://db_user_dev:uuGXYGfncLb6KCwg@main.sqbh5.gcp.mongodb.net/db1?retryWrites=true&w=majority';

// Get the domains from environment variables or use defaults
const PROFILE_DOMAIN = `${process.env.DOMAIN}/profile/`;
const JOB_DOMAIN = process.env.JOB_DOMAIN;
const REFRESH_WISHLIST_PROFILE_URL = (profileSlug) =>
  `${PROFILE_DOMAIN}/api/v1/candidates/wishlist-matching/${profileSlug}`;

const REFRESH_RECRUITER_PROFILE_URL = (profileSlug) =>
  `${PROFILE_DOMAIN}/api/v1/candidates/recruiter-matching/${profileSlug}`;

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

  // try {
  //   const seniorityLevelsMetadata = await metadataCollection.findOne({
  //     key: { $regex: 'seniorityLevels', $options: 'i' },
  //   });

  //   if (seniorityLevelsMetadata && seniorityLevelsMetadata.val) {
  //     // Create a mapping of seniority ID to order value
  //     Object.entries(seniorityLevelsMetadata.val).forEach(([id, data]) => {
  //       if (data && data.order) {
  //         seniorityRanking[id] = data.order;
  //       }
  //     });
  //     console.log('✅ Successfully fetched seniorityLevels from metadata');
  //   } else {
  //     console.warn('⚠️ seniorityLevels metadata not found or invalid, using fallback values');
  //     // Fallback to hardcoded values if metadata is not available
  //     seniorityRanking = {
  //       1: 2, // Junior (order: 2)
  //       2: 5, // Team Leader (order: 5)
  //       3: 7, // Director (order: 7)
  //       5: 8, // CxO (order: 8)
  //       9: 3, // Experienced (order: 3)
  //       14: 6, // Manager (order: 6)
  //       15: 4, // Senior (order: 4)
  //       16: 10, // Owner (order: 10)
  //       17: 9, // Consultant (order: 9)
  //       18: 11, // Founder (order: 11)
  //     };
  //   }
  // } catch (error) {
  //   console.error('❌ Error fetching seniorityLevels metadata:', error);
  //   // Fallback to hardcoded values if there's an error
  //   seniorityRanking = {
  //     1: 2, // Junior
  //     2: 5, // Team Leader
  //     3: 7, // Director
  //     5: 8, // CxO
  //     9: 3, // Experienced
  //     14: 6, // Manager
  //     15: 4, // Senior
  //     16: 10, // Owner
  //     17: 9, // Consultant
  //     18: 11, // Founder
  //   };
  // }

  // Check for each profile if any of their matched jobs belong to blocked companies
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

    const userSlug = profileToUserMap[profile.talentSlug];
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
      if (jobDetails.skills && preferences.skills) {
        const candidateSkills = preferences.skills;
        const jobSkills = Array.isArray(jobDetails.skills) ? jobDetails.skills : [jobDetails.skills];

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
        const jobSeniority = jobDetails.seniorityLevel; // Take first seniority level
        const candidateSeniority = preferences.seniorityLevel; // Take first preference

        // Get order values from the dynamically fetched seniorityRanking
        // const jobSeniorityOrder = seniorityRanking[jobSeniority] || 0;
        // const candidateSeniorityOrder = seniorityRanking[candidateSeniority] || 0;

        // Check if candidate's seniority meets or exceeds job requirement based on order value
        if (jobSeniority.some((seniority) => candidateSeniority.includes(seniority))) {
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
        const hasMatchingIndustry = jobDetails.industries.some((industry) => preferences.industries.includes(industry));

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
        jobSkills: jobDetails.skills || [],
        preferenceSkills: preferences.skills || [],
        jobSeniorityLevel: jobDetails.seniorityLevel || [],
        preferenceSeniorityLevel: preferences.seniorityLevel || [],
        jobIndustries: jobDetails.industries || [],
        preferenceIndustries: preferences.industries || [],
      };

      return {
        ...matchedJob,
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
      console.log(`✅ Scored ${scoredJobs.length} jobs for profile ${profile.talentSlug}`);
      console.log(`   Top job (${scoredJobs[0]['Job Slug']}) score: ${scoredJobs[0].score}%`);
    }
  }

  await writeFile(`wishlistProfilesResult.json`, JSON.stringify(wishlistProfile, null, 2));
}

async function handleRecruiterJob(recruiterProfiles, db) {
  console.log(`🔍 Handling ${recruiterProfiles.length} profiles for recruiter job matching...`);

  // Extract job slugs from profiles' topMatchedJobRecruiter
  const jobSlugs = recruiterProfiles
    .flatMap((profile) => (profile.topMatchedJobRecruiter || []).map((job) => job['Job Slug']))
    .filter(Boolean);

  if (jobSlugs.length === 0) {
    console.log('❌ No job slugs found in topMatchedJobRecruiter');
    return;
  }

  console.log(`📊 Found ${jobSlugs.length} unique job slugs to score`);

  // Get job details from collection
  const jobsCollection = db.collection('jobmodels');
  const jobs = await jobsCollection.find({ slug: { $in: jobSlugs } }).toArray();

  if (jobs.length === 0) {
    console.log('❌ No jobs found with the provided slugs');
    return;
  }

  console.log(`✅ Retrieved ${jobs.length} jobs from database`);

  // Create a map of job slug to job details
  const jobDetailsMap = {};
  jobs.forEach((job) => {
    jobDetailsMap[job.slug] = job;
  });

  // Fetch seniorityLevels from metadata collection for seniority comparison
  const metadataCollection = db.collection('metadata');
  // let seniorityRanking = {};

  // try {
  //   const seniorityLevelsMetadata = await metadataCollection.findOne({
  //     key: { $regex: 'seniorityLevels', $options: 'i' },
  //   });

  //   if (seniorityLevelsMetadata && seniorityLevelsMetadata.val) {
  //     // Create a mapping of seniority ID to order value
  //     Object.entries(seniorityLevelsMetadata.val).forEach(([id, data]) => {
  //       if (data && data.order) {
  //         seniorityRanking[id] = data.order;
  //       }
  //     });
  //     console.log('✅ Successfully fetched seniorityLevels from metadata');
  //   } else {
  //     console.warn('⚠️ seniorityLevels metadata not found or invalid, using fallback values');
  //     // Fallback to hardcoded values if metadata is not available
  //     seniorityRanking = {
  //       1: 2, // Junior (order: 2)
  //       2: 5, // Team Leader (order: 5)
  //       3: 7, // Director (order: 7)
  //       5: 8, // CxO (order: 8)
  //       9: 3, // Experienced (order: 3)
  //       14: 6, // Manager (order: 6)
  //       15: 4, // Senior (order: 4)
  //       16: 10, // Owner (order: 10)
  //       17: 9, // Consultant (order: 9)
  //       18: 11, // Founder (order: 11)
  //     };
  //   }
  // } catch (error) {
  //   console.error('❌ Error fetching seniorityLevels metadata:', error);
  //   // Fallback to hardcoded values if there's an error
  //   seniorityRanking = {
  //     1: 2, // Junior
  //     2: 5, // Team Leader
  //     3: 7, // Director
  //     5: 8, // CxO
  //     9: 3, // Experienced
  //     14: 6, // Manager
  //     15: 4, // Senior
  //     16: 10, // Owner
  //     17: 9, // Consultant
  //     18: 11, // Founder
  //   };
  // }

  // Calculate scores for each profile and its matched jobs
  for (const profile of recruiterProfiles) {
    if (!profile.topMatchedJobRecruiter || profile.topMatchedJobRecruiter.length === 0) continue;

    // Extract profile skills (only using primarySkills since secondary skills are optional)
    const profileSkills = [...profile.primarySkills, ...profile.skills] || [];

    // Calculate score for each matched job
    const scoredJobs = profile.topMatchedJobRecruiter.map((matchedJob) => {
      const jobSlug = matchedJob['Job Slug'];
      const jobDetails = jobDetailsMap[jobSlug];
      if (!jobDetails) return { ...matchedJob, score: 0 };

      let score = 0;
      let maxPossibleScore = 0;
      let scoreBreakdown = {};

      // Job Roles (Weight: 36)
      // Any matching role between profile roles and job roles gives full 36 points
      if (jobDetails.roles && profile.roles) {
        const profileRoles = Array.isArray(profile.roles) ? profile.roles : [profile.roles];
        const jobRoles = Array.isArray(jobDetails.roles) ? jobDetails.roles : [jobDetails.roles];

        // Check for any intersection between job roles and profile roles
        const hasMatchingRole = jobRoles.some((role) => profileRoles.includes(role));

        if (hasMatchingRole) {
          score += 36;
          scoreBreakdown.roles = 36;
        } else {
          scoreBreakdown.roles = 0;
        }
        maxPossibleScore += 36;
      }

      // Skills Matching (Weight: 36)
      if (jobDetails.skills && profileSkills.length > 0) {
        const jobSkills = Array.isArray(jobDetails.skills) ? jobDetails.skills : [jobDetails.skills];

        // Count matching skills
        const matchingSkillsCount = jobSkills.filter((skill) => profileSkills.includes(skill)).length;

        // Calculate fraction of job skills that match with profile skills
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
      // Full points if profile's seniority meets or exceeds job requirements
      if (jobDetails.seniorityLevel && profile.seniority) {
        const jobSeniority = jobDetails.seniorityLevel;
        const profileSeniority = profile.seniority;

        // Get order values from the dynamically fetched seniorityRanking
        // const jobSeniorityOrder = seniorityRanking[jobSeniority] || 0;
        // const profileSeniorityOrder = seniorityRanking[profileSeniority] || 0;

        // Check if profile's seniority meets or exceeds job requirement based on order value
        if (jobSeniority.some((seniority) => profileSeniority === seniority)) {
          score += 17;
          scoreBreakdown.seniority = 17;
        } else {
          scoreBreakdown.seniority = 0;
        }
        maxPossibleScore += 17;
      }

      // Company Size (Weight: 1)
      // Exact match between profile's preferred company size and job's company size
      if (jobDetails.companyData && jobDetails.companyData.bsId && profile.companySize) {
        const profileCompanySizes = Array.isArray(profile.companySize) ? profile.companySize : [profile.companySize];

        const hasMatchingCompanySize = profileCompanySizes.includes(jobDetails.companyData.bsId);

        if (hasMatchingCompanySize) {
          score += 1;
          scoreBreakdown.companySize = 1;
        } else {
          scoreBreakdown.companySize = 0;
        }
        maxPossibleScore += 1;
      }

      // Industries (Weight: 10)
      // Any intersection between profile's industries and job industries gives full points
      if (jobDetails.industries && profile.industries) {
        const profileIndustries = Array.isArray(profile.industries) ? profile.industries : [profile.industries];
        const jobIndustries = Array.isArray(jobDetails.industries) ? jobDetails.industries : [jobDetails.industries];

        const hasMatchingIndustry = jobIndustries.some((industry) => profileIndustries.includes(industry));

        if (hasMatchingIndustry) {
          score += 10;
          scoreBreakdown.industries = 10;
        } else {
          scoreBreakdown.industries = 0;
        }
        maxPossibleScore += 10;
      }

      // Languages (Weight: 5)
      // Any intersection between profile's languages and job languages gives full points
      if (jobDetails.languages && profile.languages) {
        // Extract language IDs from profile.languages (which are objects with a language property)
        const profileLanguageIds = profile.languages.map((lang) => lang.language);

        const jobLanguages = Array.isArray(jobDetails.languages) ? jobDetails.languages : [jobDetails.languages];

        // Check if any job language ID matches any profile language ID
        const hasMatchingLanguage = jobLanguages.some((languageId) => profileLanguageIds.includes(languageId));

        if (hasMatchingLanguage) {
          score += 5;
          scoreBreakdown.languages = 5;
        } else {
          scoreBreakdown.languages = 0;
        }
        maxPossibleScore += 5;
      }

      // Calculate percentage score
      const percentageScore = maxPossibleScore > 0 ? (score / maxPossibleScore) * 100 : 0;

      // Add debug info about the match
      const matchDebug = {
        jobTitle: jobDetails.title || 'Unknown',
        jobRoles: jobDetails.roles || [],
        profileRoles: profile.roles || [],
        jobSkill: jobDetails.skills || [],
        profileSkills: profileSkills,
        jobSeniorityLevel: jobDetails.seniorityLevel || [],
        profileSeniority: profile.seniority,
        jobIndustries: jobDetails.industries || [],
        profileIndustries: profile.industries || [],
        jobLanguages: jobDetails.languages || [],
        profileLanguageIds: profile.languages ? profile.languages.map((lang) => lang.language) : [],
      };

      return {
        ...matchedJob,
        scoreDetails: {
          raw: score,
          breakdown: scoreBreakdown,
        },
        debug: matchDebug,
      };
    });

    // Sort jobs by score in descending order
    scoredJobs.sort((a, b) => b.score - a.score);

    // Update the profile with scored jobs
    profile.topMatchedJobRecruiter = scoredJobs;

    // Log some information about the scoring for the first job if available
    if (scoredJobs.length > 0) {
      console.log(`✅ Scored ${scoredJobs.length} recruiter jobs for profile ${profile.slug || profile.talentSlug}`);
      console.log(`   Top job (${scoredJobs[0]['Job Slug']}) score: ${scoredJobs[0].score}%`);
    }
  }

  // Write results to a JSON file
  await writeFile('recruiterProfilesResult.json', JSON.stringify(recruiterProfiles, null, 2));
  console.log('✅ Recruiter profiles saved to recruiterProfilesResult.json');
}

async function mergeProfileLists(wishlistProfiles, recruiterProfiles) {
  console.log('🔄 Merging wishlist and recruiter profiles...');

  // Use a Map to track profiles by slug
  const profileMap = new Map();

  // Process wishlist profiles
  for (const profile of wishlistProfiles) {
    profileMap.set(profile.slug, profile);
  }

  // Process recruiter profiles
  for (const profile of recruiterProfiles) {
    if (profileMap.has(profile.slug)) {
      // Profile exists in both lists, merge the topMatchedJobRecruiter array
      const existingProfile = profileMap.get(profile.slug);
      existingProfile.topMatchedJobRecruiter = profile.topMatchedJobRecruiter;
    } else {
      // Profile only exists in recruiter list, add it
      profileMap.set(profile.slug, profile);
    }
  }

  // Convert Map to Array
  const mergedProfiles = Array.from(profileMap.values());

  console.log(
    `✅ Merged ${wishlistProfiles.length} wishlist profiles and ${recruiterProfiles.length} recruiter profiles into ${mergedProfiles.length} unique profiles`,
  );

  // Write the merged list to finalReport.json
  try {
    await writeFile('finalReport.json', JSON.stringify(mergedProfiles, null, 2));
    console.log('✅ Merged profiles saved to finalReport.json');
  } catch (writeError) {
    console.error('❌ Failed to write merged profiles to file:', writeError);
  }

  return mergedProfiles;
}

async function exportExcelReport(profiles) {
  console.log('📊 Creating Excel report...');

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Job Matching System';
  workbook.lastModifiedBy = 'Job Matching System';
  workbook.created = new Date();
  workbook.modified = new Date();

  // Create Summary Sheet (renamed)
  const summarySheet = workbook.addWorksheet('Report Summary');

  // Set up the columns for the summary sheet (removed Position, Seniority, and other columns)
  summarySheet.columns = [
    { header: 'Profile ID', key: 'profileId', width: 15 },
    { header: 'Name', key: 'name', width: 25 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Profile Details', key: 'profileLink', width: 20 },
    { header: 'Profile URL', key: 'profileUrl', width: 25 },
  ];

  // Style the header row
  summarySheet.getRow(1).font = { bold: true };
  summarySheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD3D3D3' },
  };

  // Create Blocked Companies Sheet (if there are any blocked companies)
  if (profileWithBlockedCompanyInMatchJobs.length > 0) {
    const blockedSheet = workbook.addWorksheet('Blocked Companies');

    // Set up columns for the blocked companies sheet
    blockedSheet.columns = [
      { header: 'Profile ID', key: 'profileId', width: 15 },
      { header: 'Profile Name', key: 'profileName', width: 25 },
      { header: 'Profile URL', key: 'profileUrl', width: 25 },
      { header: 'Company Name', key: 'companyName', width: 25 },
      { header: 'Job Title', key: 'jobTitle', width: 30 },
      { header: 'Job URL', key: 'jobUrl', width: 20 },
    ];

    // Style the header row
    blockedSheet.getRow(1).font = { bold: true };
    blockedSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFCCCC' }, // Light red background for blocked companies
    };

    // For each profile with blocked companies
    for (const blockedItem of profileWithBlockedCompanyInMatchJobs) {
      const profile = blockedItem.profile;
      const profileName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || 'Unknown';
      const profileSlug = profile.slug;

      // For each blocked company in this profile
      for (const blockedCompany of blockedItem.foundBLockedCompanies) {
        // Add row data
        const dataRow = blockedSheet.addRow([
          profileSlug,
          profileName,
          'Open Profile',
          blockedCompany.companyName || 'Unknown',
          blockedCompany.jobName || 'Unknown',
          'View Job',
        ]);

        // Get current row number
        const currentRowNumber = dataRow.number;

        // Add profile URL hyperlink
        const profileUrl = `${PROFILE_DOMAIN}${profileSlug}`;
        blockedSheet.getCell(`C${currentRowNumber}`).value = {
          text: 'Open Profile',
          hyperlink: profileUrl,
          tooltip: `Open ${profileSlug} profile page`,
        };

        // Style the profile URL hyperlink
        blockedSheet.getCell(`C${currentRowNumber}`).font = {
          color: { argb: 'FF800080' }, // Purple color for profile links
          underline: true,
        };

        // Add job URL hyperlink
        const jobUrl = `${JOB_DOMAIN}${blockedCompany.jobSlug}`;
        blockedSheet.getCell(`F${currentRowNumber}`).value = {
          text: 'View Job',
          hyperlink: jobUrl,
          tooltip: `View job ${blockedCompany.jobSlug} details`,
        };

        // Style the job URL hyperlink
        blockedSheet.getCell(`F${currentRowNumber}`).font = {
          color: { argb: 'FF008000' }, // Green color for job links
          underline: true,
        };
      }
    }

    // Auto-fit columns width for better readability
    blockedSheet.columns.forEach((column) => {
      let maxLength = 0;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const columnLength = cell.value ? cell.value.toString().length : 10;
        if (columnLength > maxLength) {
          maxLength = columnLength;
        }
      });
      column.width = Math.min(maxLength + 2, 50); // Cap width at 50 characters
    });
  }

  // For each profile, create a dedicated sheet
  for (const profile of profiles) {
    const profileSlug = profile.slug;

    if (!profileSlug) {
      continue; // Skip profiles without a slug
    }

    // Add data to the summary sheet
    const rowIndex = summarySheet.addRow({
      profileId: profileSlug,
      name: `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || 'Unknown',
      email: profile.email || profile.emails?.find((e) => e.isPrimary)?.email || 'Not available',
      profileLink: 'View Details',
      profileUrl: 'Open Profile',
    }).number;

    // Add hyperlink to the profile sheet
    summarySheet.getCell(`D${rowIndex}`).value = {
      text: 'View Details',
      hyperlink: `#'${profileSlug}'!A1`,
      tooltip: `Go to ${profileSlug} details`,
    };

    // Style the hyperlink
    summarySheet.getCell(`D${rowIndex}`).font = {
      color: { argb: 'FF0000FF' },
      underline: true,
    };

    // Add external hyperlink to the actual profile page
    const profileUrl = `${PROFILE_DOMAIN}${profileSlug}`;
    summarySheet.getCell(`E${rowIndex}`).value = {
      text: 'Open Profile',
      hyperlink: profileUrl,
      tooltip: `Open ${profileSlug} profile page`,
    };

    // Style the external hyperlink
    summarySheet.getCell(`E${rowIndex}`).font = {
      color: { argb: 'FF800080' }, // Purple color to distinguish from internal links
      underline: true,
    };

    // Create a dedicated sheet for this profile
    const profileSheet = workbook.addWorksheet(profileSlug);

    // Get profile URL for the header
    const profileUrlForHeader = `${PROFILE_DOMAIN}${profileSlug}`;

    // Add a "Back to Summary" hyperlink at the top of the profile sheet
    const backLinkRow = profileSheet.addRow(['Back to Summary']);
    profileSheet.getCell('A1').value = {
      text: 'Back to Summary',
      hyperlink: `#'Report Summary'!A1`,
      tooltip: 'Return to Report Summary',
    };

    // Style the back link
    profileSheet.getCell('A1').font = {
      color: { argb: 'FF0000FF' },
      underline: true,
      bold: true,
    };

    // Add some padding
    profileSheet.addRow([]);

    // Add profile header information
    profileSheet.addRow([`Profile: ${profileSlug}`]);
    profileSheet.addRow([`Name: ${profile.firstName || ''} ${profile.lastName || ''}`]);
    profileSheet.addRow([
      `Email: ${profile.email || profile.emails?.find((e) => e.isPrimary)?.email || 'Not available'}`,
    ]);
    profileSheet.addRow([`Position: ${profile.position || 'Not specified'}`]);
    profileSheet.addRow([`Seniority: ${getSeniorityLabel(profile.seniority) || 'Not specified'}`]);

    // Add profile URL to header section
    const profileUrlRow = profileSheet.addRow([`Profile URL:`]);
    profileSheet.getCell(`A8`).font = { bold: true };

    // Add hyperlink cell for the profile URL
    profileSheet.getCell(`B8`).value = {
      text: profileUrlForHeader,
      hyperlink: profileUrlForHeader,
      tooltip: `Open ${profileSlug} profile page`,
    };

    // Style the profile URL hyperlink
    profileSheet.getCell(`B8`).font = {
      color: { argb: 'FF800080' },
      underline: true,
    };

    profileSheet.addRow([]);

    // Style the profile header
    for (let i = 3; i <= 8; i++) {
      profileSheet.getRow(i).font = { bold: true };
    }

    // Add Wishlist Jobs table if available
    if (profile.topMatchedJobWishlist && profile.topMatchedJobWishlist.length > 0) {
      profileSheet.addRow(['Wishlist Jobs']);

      // Create header row for wishlist jobs
      const wishlistHeaderRow = profileSheet.addRow([
        'Job Slug',
        'Match Score',
        'QA Match Score',
        'Roles Match',
        'Skills Match',
        'Seniority Match',
        'Company Size Match',
        'Industry Match',
        'Language Match',
        'Job URL', // Add Job URL column
      ]);

      // Style the header row
      wishlistHeaderRow.eachCell((cell) => {
        cell.font = { bold: true };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFCCFFCC' },
        };
      });

      // Add wishlist job rows
      profile.topMatchedJobWishlist.forEach((job, rowIndex) => {
        const scoreDetails = job.scoreDetails || {};
        const breakdown = scoreDetails.breakdown || {};
        const jobSlug = job['Job Slug'];

        const dataRow = profileSheet.addRow([
          jobSlug,
          job.score || job['Match Score'] || 'N/A',
          scoreDetails.raw || 'N/A',
          breakdown.roles !== undefined ? breakdown.roles : 'N/A',
          breakdown.skills !== undefined ? breakdown.skills : 'N/A',
          breakdown.seniority !== undefined ? breakdown.seniority : 'N/A',
          breakdown.companySize !== undefined ? breakdown.companySize : 'N/A',
          breakdown.industries !== undefined ? breakdown.industries : 'N/A',
          breakdown.languages !== undefined ? breakdown.languages : 'N/A',
          'View Job', // Placeholder for job URL link
        ]);

        // Get row number for adding hyperlink
        const currentRowNumber = dataRow.number;

        // Add job URL hyperlink
        const jobUrl = `${JOB_DOMAIN}${jobSlug}`;
        profileSheet.getCell(`J${currentRowNumber}`).value = {
          text: 'View Job',
          hyperlink: jobUrl,
          tooltip: `View job ${jobSlug} details`,
        };

        // Style the job URL hyperlink
        profileSheet.getCell(`J${currentRowNumber}`).font = {
          color: { argb: 'FF008000' }, // Green color for job links
          underline: true,
        };
      });

      // Add a blank row after the table
      profileSheet.addRow([]);
    }

    // Add Recruiter Jobs table if available
    if (profile.topMatchedJobRecruiter && profile.topMatchedJobRecruiter.length > 0) {
      profileSheet.addRow(['Recruiter Jobs']);

      // Create header row for recruiter jobs
      const recruiterHeaderRow = profileSheet.addRow([
        'Job Slug',
        'Match Score',
        'QA Match Score',
        'Roles Match',
        'Skills Match',
        'Seniority Match',
        'Company Size Match',
        'Industry Match',
        'Language Match',
        'Job URL', // Add Job URL column
      ]);

      // Style the header row
      recruiterHeaderRow.eachCell((cell) => {
        cell.font = { bold: true };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFCCCC' },
        };
      });

      // Add recruiter job rows
      profile.topMatchedJobRecruiter.forEach((job, rowIndex) => {
        const scoreDetails = job.scoreDetails || {};
        const breakdown = scoreDetails.breakdown || {};
        const jobSlug = job['Job Slug'];

        const dataRow = profileSheet.addRow([
          jobSlug,
          job.score || job['Match Score'] || 'N/A',
          scoreDetails.raw || 'N/A',
          breakdown.roles !== undefined ? breakdown.roles : 'N/A',
          breakdown.skills !== undefined ? breakdown.skills : 'N/A',
          breakdown.seniority !== undefined ? breakdown.seniority : 'N/A',
          breakdown.companySize !== undefined ? breakdown.companySize : 'N/A',
          breakdown.industries !== undefined ? breakdown.industries : 'N/A',
          breakdown.languages !== undefined ? breakdown.languages : 'N/A',
          'View Job', // Placeholder for job URL link
        ]);

        // Get row number for adding hyperlink
        const currentRowNumber = dataRow.number;

        // Add job URL hyperlink
        const jobUrl = `${JOB_DOMAIN}${jobSlug}`;
        profileSheet.getCell(`J${currentRowNumber}`).value = {
          text: 'View Job',
          hyperlink: jobUrl,
          tooltip: `View job ${jobSlug} details`,
        };

        // Style the job URL hyperlink
        profileSheet.getCell(`J${currentRowNumber}`).font = {
          color: { argb: 'FF008000' }, // Green color for job links
          underline: true,
        };
      });
    }

    // Auto-fit columns width for better readability
    profileSheet.columns.forEach((column) => {
      let maxLength = 0;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const columnLength = cell.value ? cell.value.toString().length : 10;
        if (columnLength > maxLength) {
          maxLength = columnLength;
        }
      });
      column.width = Math.min(maxLength + 2, 50); // Cap width at 50 characters
    });
  }

  // Save the workbook to a file
  const fileName = `jobMatchReport/JobMatchingReport_${new Date().toISOString().split('T')[0]}.xlsx`;
  await workbook.xlsx.writeFile(fileName);
  console.log(`✅ Excel report saved as ${fileName}`);

  return fileName;
}

// Helper function to get seniority label from ID
function getSeniorityLabel(seniorityId) {
  const seniorityLabels = {
    1: 'Junior',
    2: 'Team Leader',
    3: 'Director',
    5: 'CxO',
    9: 'Experienced',
    14: 'Manager',
    15: 'Senior',
    16: 'Owner',
    17: 'Consultant',
    18: 'Founder',
  };

  return seniorityLabels[seniorityId] || `Level ${seniorityId}`;
}

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

    try {
      let updatedProfiles = [];
      let combinedProfiles = [];
      if (true) {
        const queryFindProfileWithTalentSlug = {
          $and: [
            { talentSlug: { $exists: true } },
            { isAvailable: true },
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
          isAvailable: true,
          // $and: [
          // { isAvailable: true }, // This is now a required condition
          // {
          //   $or: [
          //     { topMatchedJobWishlist: { $exists: true, $type: 'array', $ne: [] } },
          //     { topMatchedJobRecruiter: { $exists: true, $type: 'array', $ne: [] } },
          //   ],
          // },
          // ],
        };
        const normalProfiles = await profileCollection.find(query).limit(250).toArray();
        console.log(`✅ First query: Found ${normalProfiles.length} records`);

        combinedProfiles = [...normalProfiles, ...profileWithTalentSlug];

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
            await handleClickMatchUsingPlaywright(slugsForPlaywright);
          } catch (importError) {
            console.error('❌ Failed to import or run playwright process:', importError);
          }
        } catch (writeError) {
          console.error('❌ Failed to write slugs to file:', writeError);
        }

        updatedProfiles = await profileCollection.find({ slug: { $in: allTestingSlugs } }).toArray();
      }
      // First query: Get 14 records with the current conditions

      await writeFile('rawQueryProfiles.json', JSON.stringify(updatedProfiles, null, 2));

      const filteredProfiles = await handleFilterBlockedCompanies(updatedProfiles.length ? updatedProfiles : [], db);

      const wishlistProfiles = filteredProfiles.filter(
        (profile) => profile.topMatchedJobWishlist?.length > 0 && profile.talentSlug,
      );
      const recruiterProfiles = filteredProfiles.filter((profile) => profile.topMatchedJobRecruiter?.length > 0);

      console.log(`handling ${wishlistProfiles.length} wish list profile`);
      await handleWishlistJob(wishlistProfiles, talentDB, db);

      console.log(`handling ${recruiterProfiles.length} recruiter profile`);
      await handleRecruiterJob(recruiterProfiles, db);

      // Merge and save the final combined results
      const mergedProfiles = await mergeProfileLists(wishlistProfiles, recruiterProfiles);

      // Generate Excel report
      await exportExcelReport(mergedProfiles);
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

async function handleClickMatchUsingPlaywright(profileSlugs) {
  return;
  if (profileSlugs.length) {
    await processProfilesBySlug(profileSlugs).catch((err) => console.error('❌ Error in playwright process:', err));
  }
}

// Helper function to safely compare MongoDB ObjectIds or their string representations
function isSameObjectId(id1, id2) {
  if (!id1 || !id2) return false;

  // Convert to string if they're not already
  const str1 = typeof id1 === 'object' ? id1.toString() || id1.$soid?.toString() : id1.toString();
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
        profile,
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
    (profile) => !profileWithBlockedCompanyInMatchJobs.some((blockedProfile) => blockedProfile.slug === profile.slug),
  );

  return filteredProfiles;
}

// Check if command line arguments are provided
const args = process.argv.slice(2);

await handleCalculateJobScore();
