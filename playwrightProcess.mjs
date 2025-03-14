import { chromium } from 'playwright';
import { readFile } from 'fs/promises';
import { API_LIST, DEV_CREDENTIALS } from './constant.mjs';

/**
 * Process profiles using Playwright to navigate to profile pages and click the Match tab
 */
async function playwrightProcess() {
  try {
    // Read the matchResult.json file
    console.log('📖 Reading matchResult.json file...');
    const data = await readFile('matchResult.json', 'utf8');
    const profiles = JSON.parse(data);
    console.log(`✅ Successfully loaded ${profiles.length} profiles from matchResult.json`);

    // Use dev environment credentials
    const { email, password } = DEV_CREDENTIALS;
    console.log(`🔑 Using dev environment credentials (${email})`);
    
    // Launch the browser
    console.log('🚀 Launching browser...');
    const browser = await chromium.launch({ 
      headless: false, // Set to true for headless mode, false to see the browser
      slowMo: 500 // Slow down operations by 500ms for visibility
    });
    
    // Create a new context with viewport size
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 }
    });
    
    // Create a new page
    const page = await context.newPage();
    
    // Login to the application
    await login(page, email, password);
    
    // Process each profile
    for (let i = 0; i < profiles.length; i++) {
      const profile = profiles[i];
      const { slug } = profile;
      
      if (!slug) {
        console.warn(`⚠️ Profile at index ${i} missing slug, skipping`);
        continue;
      }
      
      console.log(`🔄 Processing profile ${i+1}/${profiles.length} with slug: ${slug}`);
      
      try {
        // Navigate to the profile page
        const profileUrl = API_LIST.profilePage(slug);
        console.log(`📄 Navigating to: ${profileUrl}`);
        await page.goto(profileUrl, { waitUntil: 'networkidle' });
        
        // Wait for the page to load
        await page.waitForLoadState('domcontentloaded');
        
        // Look for the Match tab and click it
        console.log('🔍 Looking for Match tab...');

        await page.locator("div[class*='tab']", {hasText: 'Matches'}).last().click();
        
        
        // Wait for 20 seconds before moving to the next profile
        console.log(`⏳ Waiting for 20 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        console.log(`✅ Completed processing for profile with slug: ${slug}`);
      } catch (error) {
        console.error(`❌ Error processing profile with slug ${slug}:`, error.message);
        // Take a screenshot for debugging
      }
    }
    
    // Close the browser
    console.log('🔚 Closing browser...');
    await browser.close();
    
    console.log('✅ Process completed successfully');
  } catch (error) {
    console.error('❌ Error in playwrightProcess:', error);
  }
}

/**
 * Login to the application
 * @param {Page} page - Playwright page object
 * @param {string} email - Email for login
 * @param {string} password - Password for login
 */
async function login(page, email, password) {
  try {
    console.log('🔑 Attempting to login...');
    
    // Navigate to login page
    await page.goto('https://rec-test1.firebaseapp.com/login', { waitUntil: 'networkidle' });
    
    // Check if we need to login
    const currentUrl = page.url();
    if (!currentUrl.includes('login')) {
      console.log('✅ Already logged in, continuing...');
      return;
    }
    
    // Fill in login credentials
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    
    // Click login button
    await page.locator('button', {hasText: 'Sign In'}).click();
    
    // Wait for navigation to complete
    await page.waitForNavigation({ waitUntil: 'domcontentloaded' });
    
    console.log('✅ Login successful');
  } catch (error) {
    console.error('❌ Login failed:', error.message);
    throw error;
  }
}

// Run the function
playwrightProcess().catch(console.error); 