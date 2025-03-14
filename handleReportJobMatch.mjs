import { readFile, writeFile } from 'fs/promises';
import { MongoClient, ObjectId } from 'mongodb';

const uri = 'mongodb+srv://db_user_dev:uuGXYGfncLb6KCwg@main.sqbh5.gcp.mongodb.net/db1?retryWrites=true&w=majority';

/**
 * Calculate match scores between profiles and their matched jobs based on skill overlap
 * @param {Array} filteredProfiles - List of profiles that passed the blocked companies filter
 * @param {Collection} jobsCollection - MongoDB collection for jobs
 * @returns {Object} - Object containing profiles with match scores and analysis data
 */
async function calculateMatchScore(filteredProfiles, jobsCollection) {
  const profilesWithScores = [];
  const matchAnalysisResults = [];

  console.log(`🔢 Calculating match scores for ${filteredProfiles.length} filtered profiles...`);

  for (let i = 0; i < filteredProfiles.length; i++) {
    const profile = filteredProfiles[i];
    const { slug, _id } = profile;

    if (!slug) {
      continue;
    }

    try {
      // Get profile skills - could be in different formats depending on your data structure
      const profileSkills = extractProfileSkills(profile);
      
      console.log(`🧩 Profile ${slug} has ${profileSkills.length} skills`);
      
      // Merge topMatchedJobRecruiter and topMatchedJobWishlist
      const topMatchedJobRecruiter = profile.topMatchedJobRecruiter || [];
      const topMatchedJobWishlist = profile.topMatchedJobWishlist || [];

      // Combine the arrays and remove duplicates based on Job Slug
      const uniqueJobSlugs = new Set();
      const allMatchedJobs = [];

      // Add recruiter jobs to allMatchedJobs
      topMatchedJobRecruiter.forEach((job) => {
        if (job['Job Slug'] && !uniqueJobSlugs.has(job['Job Slug'])) {
          uniqueJobSlugs.add(job['Job Slug']);
          allMatchedJobs.push({
            ...job,
            source: 'recruiter',
          });
        }
      });

      // Add wishlist jobs to allMatchedJobs
      topMatchedJobWishlist.forEach((job) => {
        if (job['Job Slug'] && !uniqueJobSlugs.has(job['Job Slug'])) {
          uniqueJobSlugs.add(job['Job Slug']);
          allMatchedJobs.push({
            ...job,
            source: 'wishlist',
          });
        }
      });

      const jobsWithScores = [];
      let totalMatchScore = 0;
      let averageMatchScore = 0;

      // Query jobs in batch if possible
      if (allMatchedJobs.length > 0) {
        // Get slugs from jobs instead of IDs
        const jobSlugs = allMatchedJobs.map((job) => job['Job Slug']);

        // Query jobs from MongoDB using slug field instead of _id
        const jobsFromDB = await jobsCollection.find({ slug: { $in: jobSlugs } }).toArray();

        // Create a map for quick lookup using slug as the key
        const jobMap = new Map();
        jobsFromDB.forEach((job) => {
          jobMap.set(job.slug, job);
        });

        // Process each matched job with its details
        for (const matchedJob of allMatchedJobs) {
          const jobSlug = matchedJob['Job Slug'];
          const jobDetail = jobMap.get(jobSlug);

          if (jobDetail) {
            // Extract job skills
            const jobSkills = extractJobSkills(jobDetail);
            
            // Calculate skill match score
            const { matchScore, matchedSkills } = calculateSkillMatchScore(profileSkills, jobSkills);
            
            // Add to the total score
            totalMatchScore += matchScore;
            
            // Add to jobs with scores
            jobsWithScores.push({
              ...matchedJob,
              details: {
                title: jobDetail.title,
                jobId: jobDetail._id && typeof jobDetail._id === 'object' ? jobDetail._id.$oid : jobDetail._id,
                company: jobDetail.company && typeof jobDetail.company === 'object' ? jobDetail.company.$oid : jobDetail.company,
                totalSkills: jobSkills.length,
                matchScore: matchScore,
                matchedSkills: matchedSkills,
                skills: jobSkills
              }
            });
            
            console.log(`✅ Job ${jobSlug} has match score ${matchScore.toFixed(2)} with ${matchedSkills.length} matched skills`);
          } else {
            // Job not found in DB
            jobsWithScores.push({
              ...matchedJob,
              details: {
                matchScore: 0,
                matchedSkills: [],
                skills: []
              }
            });
          }
        }
        
        // Calculate average match score
        averageMatchScore = allMatchedJobs.length > 0 ? totalMatchScore / allMatchedJobs.length : 0;
      }

      // Create a profile with scores
      const profileWithScores = {
        ...profile,
        matchAnalysis: {
          totalMatchScore: totalMatchScore,
          averageMatchScore: averageMatchScore,
          jobsWithScores: jobsWithScores,
          profileSkills: profileSkills
        }
      };

      // Store the match analysis result
      const matchAnalysisResult = {
        profileId: _id,
        slug,
        totalJobs: allMatchedJobs.length,
        totalSkills: profileSkills.length,
        totalMatchScore: totalMatchScore,
        averageMatchScore: averageMatchScore,
        jobScores: jobsWithScores.map(job => ({
          jobSlug: job['Job Slug'],
          source: job.source,
          matchScore: job.details.matchScore,
          matchedSkillsCount: job.details.matchedSkills?.length || 0
        }))
      };

      profilesWithScores.push(profileWithScores);
      matchAnalysisResults.push(matchAnalysisResult);
      
      console.log(`📊 Profile ${slug} has average match score: ${averageMatchScore.toFixed(2)}`);
      
    } catch (error) {
      console.error(`❌ Error calculating match score for profile ${slug}:`, error);
      // Include the original profile in the result even if there's an error
      profilesWithScores.push(profile);
    }
  }

  // Sort profiles by average match score (descending)
  profilesWithScores.sort((a, b) => 
    (b.matchAnalysis?.averageMatchScore || 0) - (a.matchAnalysis?.averageMatchScore || 0)
  );
  
  // Calculate overall statistics
  const totalProfiles = profilesWithScores.length;
  const profilesWithMatchingSkills = matchAnalysisResults.filter(profile => profile.averageMatchScore > 0).length;
  const averageOverallMatchScore = matchAnalysisResults.reduce((sum, profile) => sum + profile.averageMatchScore, 0) / 
    (matchAnalysisResults.length || 1);
  
  const summary = {
    totalProfiles,
    profilesWithMatchingSkills,
    averageOverallMatchScore,
    highMatchProfiles: matchAnalysisResults.filter(profile => profile.averageMatchScore >= 0.7).length,
    mediumMatchProfiles: matchAnalysisResults.filter(profile => profile.averageMatchScore >= 0.4 && profile.averageMatchScore < 0.7).length,
    lowMatchProfiles: matchAnalysisResults.filter(profile => profile.averageMatchScore > 0 && profile.averageMatchScore < 0.4).length,
    noMatchProfiles: matchAnalysisResults.filter(profile => profile.averageMatchScore === 0).length
  };

  return {
    profilesWithScores,
    matchAnalysisResults,
    summary
  };
}

/**
 * Extract skills from a profile
 * @param {Object} profile - The profile object
 * @returns {Array} - Array of profile skills (lowercase)
 */
function extractProfileSkills(profile) {
  const skills = [];
  
  // Check different possible locations of skills in the profile
  if (profile.skills && Array.isArray(profile.skills)) {
    skills.push(...profile.skills);
  }
  
  if (profile.talent && profile.talent.skills && Array.isArray(profile.talent.skills)) {
    skills.push(...profile.talent.skills);
  }
  
  // If there are skill objects with 'name' property
  if (profile.skillList && Array.isArray(profile.skillList)) {
    profile.skillList.forEach(skillObj => {
      if (skillObj.name) {
        skills.push(skillObj.name);
      } else if (typeof skillObj === 'string') {
        skills.push(skillObj);
      }
    });
  }
  
  // Also check for skillIds which might be needed to cross-reference
  const skillIds = [];
  if (profile.categories && Array.isArray(profile.categories)) {
    skillIds.push(...profile.categories);
  }
  
  // Convert all skills to lowercase for case-insensitive comparison
  return [...new Set(skills.map(skill => typeof skill === 'string' ? skill.toLowerCase() : String(skill)))];
}

/**
 * Extract skills from a job
 * @param {Object} job - The job object
 * @returns {Array} - Array of job skills (lowercase)
 */
function extractJobSkills(job) {
  const skills = [];
  
  // Check different possible locations of skills in the job
  if (job.skills && Array.isArray(job.skills)) {
    skills.push(...job.skills);
  }
  
  if (job.skillsNeeded && Array.isArray(job.skillsNeeded)) {
    skills.push(...job.skillsNeeded);
  }
  
  if (job.categories && Array.isArray(job.categories)) {
    skills.push(...job.categories);
  }
  
  // If there are skill objects with 'name' property
  if (job.skillList && Array.isArray(job.skillList)) {
    job.skillList.forEach(skillObj => {
      if (skillObj.name) {
        skills.push(skillObj.name);
      } else if (typeof skillObj === 'string') {
        skills.push(skillObj);
      }
    });
  }
  
  // Convert all skills to lowercase for case-insensitive comparison
  return [...new Set(skills.map(skill => typeof skill === 'string' ? skill.toLowerCase() : String(skill)))];
}

/**
 * Calculate skill match score between profile skills and job skills
 * @param {Array} profileSkills - Array of profile skills
 * @param {Array} jobSkills - Array of job skills
 * @returns {Object} - Object containing match score and matched skills
 */
function calculateSkillMatchScore(profileSkills, jobSkills) {
  if (!jobSkills.length) return { matchScore: 0, matchedSkills: [] };
  
  // Find skills that match between profile and job
  const matchedSkills = profileSkills.filter(skill => 
    jobSkills.some(jobSkill => 
      // Check for exact match or partial match (skill is part of job skill or vice versa)
      jobSkill === skill || 
      (typeof jobSkill === 'string' && typeof skill === 'string' && 
       (jobSkill.includes(skill) || skill.includes(jobSkill)))
    )
  );
  
  // Calculate match score as a percentage of job skills that are matched
  const matchScore = jobSkills.length > 0 ? matchedSkills.length / jobSkills.length : 0;
  
  return {
    matchScore,
    matchedSkills
  };
}

/**
 * Filter profiles to remove those that have companies in their blocked list that also exist in their match company list
 * @param {Array} profiles - List of profiles to filter
 * @param {Collection} jobsCollection - MongoDB collection for jobs
 * @returns {Object} - Object containing filtered profiles and analysis data
 */
async function filterBlockedCompanies(profiles, jobsCollection) {
  const filteredProfiles = [];
  const removedProfiles = [];
  const analysisResults = [];

  console.log(`🔍 Filtering ${profiles.length} profiles for blocked companies...`);

  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i];
    const { slug, _id } = profile;

    if (!slug) {
      continue;
    }

    try {
      // Merge topMatchedJobRecruiter and topMatchedJobWishlist
      const topMatchedJobRecruiter = profile.topMatchedJobRecruiter || [];
      const topMatchedJobWishlist = profile.topMatchedJobWishlist || [];

      // Combine the arrays and remove duplicates based on Job Slug
      const uniqueJobSlugs = new Set();
      const allMatchedJobs = [];

      // Add recruiter jobs to allMatchedJobs
      topMatchedJobRecruiter.forEach((job) => {
        // Use 'Job Slug' instead of jobId
        if (job['Job Slug'] && !uniqueJobSlugs.has(job['Job Slug'])) {
          uniqueJobSlugs.add(job['Job Slug']);
          allMatchedJobs.push({
            ...job,
            source: 'recruiter',
          });
        }
      });

      // Add wishlist jobs to allMatchedJobs
      topMatchedJobWishlist.forEach((job) => {
        // Use 'Job Slug' instead of jobId
        if (job['Job Slug'] && !uniqueJobSlugs.has(job['Job Slug'])) {
          uniqueJobSlugs.add(job['Job Slug']);
          allMatchedJobs.push({
            ...job,
            source: 'wishlist',
          });
        }
      });

      // Get the blocked companies from the profile
      const selectedBlockedCompanies =
        (profile.talent && profile.talent.wishlist && profile.talent.wishlist.selectedBlockedCompanies) || [];

      // Query job details for each job slug and collect company IDs
      const companyIds = new Set();
      let jobsFromDB;
      // Query jobs in batch if possible
      if (allMatchedJobs.length > 0) {
        // Get slugs from jobs instead of IDs
        const jobSlugs = allMatchedJobs.map((job) => job['Job Slug']);

        // Query jobs from MongoDB using slug field instead of _id
        jobsFromDB = await jobsCollection.find({ slug: { $in: jobSlugs } }).toArray();

        // Process each job to extract company IDs
        for (const job of jobsFromDB) {
          // Extract company ID if available
          if (job.company && typeof job.company === 'object' && job.company.$oid) {
            companyIds.add(job.company.$oid);
          } else if (job.company) {
            companyIds.add(job.company.toString());
          }
        }
      }

      // Convert Set to Array
      const companyIdsArray = Array.from(companyIds);

      // Check if any company IDs are in the blocked companies list
      const blockedCompaniesFound = selectedBlockedCompanies.filter((blockedCompany) =>
        companyIdsArray.includes(blockedCompany),
      );

      // Store the analysis result
      const analysisResult = {
        profileId: _id,
        slug,
        totalUniqueJobs: allMatchedJobs.length,
        totalCompanies: companyIdsArray.length,
        totalBlockedCompanies: selectedBlockedCompanies.length,
        blockedCompaniesInMatches: blockedCompaniesFound,
        hasBlockedCompanies: blockedCompaniesFound.length > 0,
      };

      analysisResults.push(analysisResult);

      // If no blocked companies found in matches, keep the profile
      if (blockedCompaniesFound.length === 0) {
        filteredProfiles.push(profile);
      } else {
        // Profile has blocked companies in matches, remove it
        removedProfiles.push({
          profile,
          blockedCompaniesFound,
        });
        console.log(`🚫 Removed profile ${slug} due to ${blockedCompaniesFound.length} blocked companies in matches`);
        blockedCompaniesFound.forEach((blockedCompany) => {
          console.log(
            `🚫 Blocked company: ${blockedCompany} of job ${jobsFromDB.find((job) => job.company.toString() === blockedCompany).slug}`,
          );
        });
      }
    } catch (error) {
      console.error(`❌ Error processing profile ${slug}:`, error);
      // Include profile in filtered list even if there's an error
      filteredProfiles.push(profile);
    }
  }

  return {
    filteredProfiles,
    removedProfiles,
    analysisResults,
    summary: {
      totalProfiles: profiles.length,
      filteredProfiles: filteredProfiles.length,
      removedProfiles: removedProfiles.length,
      percentageRemoved: ((removedProfiles.length / profiles.length) * 100).toFixed(2) + '%',
    },
  };
}

async function handleReportMatchJob() {
  try {
    // Read the matchResult.json file
    console.log('📖 Reading refreshResult.json file...');
    const data = await readFile('refreshResult.json', 'utf8');
    const profiles = JSON.parse(data);
    const client = new MongoClient(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    await client.connect();
    console.log('✅ Connected successfully');

    const db = client.db('db1'); // Specify the database name
    const profilesCollection = db.collection('profilemodels'); // Change this to your collection
    const companiesCollection = db.collection('companymodels'); // Change this to your collection
    const jobsCollection = db.collection('jobmodels'); // Change this to your collection

    // Filter profiles with blocked companies
    const { filteredProfiles, removedProfiles, analysisResults, summary } = await filterBlockedCompanies(
      profiles,
      jobsCollection,
    );

    console.log('\n📊 Filtering Summary:');
    console.log(`Total Profiles: ${summary.totalProfiles}`);
    console.log(`Filtered Profiles (kept): ${summary.filteredProfiles}`);
    console.log(`Removed Profiles: ${summary.removedProfiles} (${summary.percentageRemoved})`);
    
    // Calculate match scores for filtered profiles
    const { profilesWithScores, matchAnalysisResults, summary: matchSummary } = await calculateMatchScore(
      filteredProfiles,
      jobsCollection
    );
    
    console.log('\n📊 Match Score Summary:');
    console.log(`Total Profiles Analyzed: ${matchSummary.totalProfiles}`);
    console.log(`Profiles With Matching Skills: ${matchSummary.profilesWithMatchingSkills}`);
    console.log(`Average Overall Match Score: ${matchSummary.averageOverallMatchScore.toFixed(2)}`);
    console.log(`High Match Profiles (>=70%): ${matchSummary.highMatchProfiles}`);
    console.log(`Medium Match Profiles (40-69%): ${matchSummary.mediumMatchProfiles}`);
    console.log(`Low Match Profiles (1-39%): ${matchSummary.lowMatchProfiles}`);
    console.log(`No Match Profiles (0%): ${matchSummary.noMatchProfiles}`);

    // Save profiles and analysis results to files
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // Save filtered profiles with match scores
    const scoredProfilesFileName = `profilesWithScores_${timestamp}.json`;
    await writeFile(scoredProfilesFileName, JSON.stringify(profilesWithScores, null, 2));
    console.log(`✅ Profiles with match scores saved to ${scoredProfilesFileName}`);
    
    // Save match analysis results
    const matchAnalysisFileName = `matchAnalysis_${timestamp}.json`;
    await writeFile(matchAnalysisFileName, JSON.stringify(matchAnalysisResults, null, 2));
    console.log(`✅ Match analysis saved to ${matchAnalysisFileName}`);
    
    // Save match summary
    const matchSummaryFileName = `matchSummary_${timestamp}.json`;
    await writeFile(matchSummaryFileName, JSON.stringify(matchSummary, null, 2));
    console.log(`✅ Match summary saved to ${matchSummaryFileName}`);

    // Save removed profiles summary
    const removedSummaryFileName = `removedSummary_${timestamp}.json`;
    await writeFile(removedSummaryFileName, JSON.stringify({
      summary: summary,
      removedProfileSlugs: removedProfiles.map(item => item.profile.slug)
    }, null, 2));
    console.log(`✅ Removed profiles summary saved to ${removedSummaryFileName}`);

    // Close MongoDB connection
    await client.close();
    console.log('🔌 MongoDB connection closed');

    console.log('✅ Process completed successfully');
    return { filteredProfiles, profilesWithScores, matchAnalysisResults, summary, matchSummary };
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the function
handleReportMatchJob();
