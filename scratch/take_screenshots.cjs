const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1'
  });
  
  const page = await context.newPage();
  
  // Ensure output directory exists
  const outputDir = path.join(__dirname, '..', 'mobile-screenshots');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('Navigating to local development server...');
  await page.goto('http://localhost:15173/', { waitUntil: 'networkidle' });

  // Wait for application mount
  await page.waitForSelector('nav.mobile-bottom-nav', { timeout: 15000 });
  console.log('App loaded. Taking screenshots...');

  // Helper to take screenshot
  const takeScreenshot = async (name) => {
    // Wait for any animations/rendering to stabilize
    await page.waitForTimeout(1000);
    const screenshotPath = path.join(outputDir, `${name}.png`);
    await page.screenshot({ path: screenshotPath });
    console.log(`Saved screenshot: ${screenshotPath}`);
  };

  // 1. Dashboard
  console.log('Navigating to Dashboard...');
  await page.click('button[aria-label="Dashboard"]');
  await takeScreenshot('1_dashboard');

  // 2. Queue
  console.log('Navigating to Queue...');
  await page.click('button[aria-label="Queue"]');
  await takeScreenshot('2_queue');

  // 3. Review
  console.log('Navigating to Review...');
  await page.click('button[aria-label="Review"]');
  await takeScreenshot('3_review');

  // 4. Documents
  console.log('Navigating to Documents...');
  await page.click('button[aria-label="Documents"]');
  await takeScreenshot('4_documents');

  // 5. Settings
  console.log('Navigating to Settings...');
  await page.click('button[aria-label="Settings"]');
  await takeScreenshot('5_settings');

  // 6. Analytics (Statistics)
  console.log('Opening More menu...');
  await page.click('button[aria-label="More sections and actions"]');
  await page.waitForSelector('.mobile-more-sheet', { timeout: 5000 });
  
  console.log('Navigating to Statistics...');
  await page.click('button:has-text("Statistics")');
  await takeScreenshot('6_analytics');

  await browser.close();
  console.log('All screenshots captured successfully!');
})();
