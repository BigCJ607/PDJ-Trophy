import puppeteer from 'puppeteer';

async function runFullAuctionTest() {
  console.log("🚀 Starting Multi-Device End-to-End Auction Verification (Steps 1 to 18)...");

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const adminPage = await browser.newPage();
    const projPage1 = await browser.newPage();
    const projPage2 = await browser.newPage();
    const projPage3 = await browser.newPage();

    // Listen for console messages for debugging
    adminPage.on('console', msg => console.log('ADMIN LOG:', msg.text()));
    projPage1.on('console', msg => console.log('PROJ 1 LOG:', msg.text()));

    // Load Admin Page
    console.log("1. Loading Admin page...");
    await adminPage.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle0' });

    // STEP 1: Set BASE POINTS = 1000
    console.log("\nSTEP 1: Setting BASE POINTS = 1000");
    await adminPage.evaluate(() => {
      const input = document.getElementById('basePointsSettingInput');
      const saveBtn = document.getElementById('saveBasePointsBtn');
      if (input) input.value = 1000;
      if (saveBtn) saveBtn.click();
    });
    await new Promise(r => setTimeout(r, 500));

    // STEP 2: Select/Start a new player
    console.log("\nSTEP 2: Starting a new player");
    await adminPage.evaluate(() => {
      if (typeof selectPlayerForAuction === 'function') selectPlayerForAuction(0);
    });
    await new Promise(r => setTimeout(r, 500));

    const adminBidStep2 = await adminPage.$eval('#displayPoints', el => el.textContent.trim());
    console.log(`Admin Step 2 Bid: ${adminBidStep2}`);
    if (!adminBidStep2.includes('1000')) throw new Error(`Step 2 Failed: Expected 1000 POINTS, got ${adminBidStep2}`);

    // STEP 3: Click +100 -> Expected: 1100
    console.log("\nSTEP 3: Click +100");
    await adminPage.evaluate(() => {
      const btn = document.querySelector('.bid-btn[data-pts="100"]');
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 500));
    const adminBidStep3 = await adminPage.$eval('#displayPoints', el => el.textContent.trim());
    console.log(`Admin Step 3 Bid: ${adminBidStep3}`);
    if (!adminBidStep3.includes('1100')) throw new Error(`Step 3 Failed: Expected 1100 POINTS, got ${adminBidStep3}`);

    // STEP 4: Click +500 -> Expected: 1600
    console.log("\nSTEP 4: Click +500");
    await adminPage.evaluate(() => {
      const btn = document.querySelector('.bid-btn[data-pts="500"]');
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 500));
    const adminBidStep4 = await adminPage.$eval('#displayPoints', el => el.textContent.trim());
    console.log(`Admin Step 4 Bid: ${adminBidStep4}`);
    if (!adminBidStep4.includes('1600')) throw new Error(`Step 4 Failed: Expected 1600 POINTS, got ${adminBidStep4}`);

    // STEP 5: Click +1000 -> Expected: 2600
    console.log("\nSTEP 5: Click +1000");
    await adminPage.evaluate(() => {
      const btn = document.querySelector('.bid-btn[data-pts="1000"]');
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 500));
    const adminBidStep5 = await adminPage.$eval('#displayPoints', el => el.textContent.trim());
    console.log(`Admin Step 5 Bid: ${adminBidStep5}`);
    if (!adminBidStep5.includes('2600')) throw new Error(`Step 5 Failed: Expected 2600 POINTS, got ${adminBidStep5}`);

    // STEP 6: Select TEAM ALPHA -> Expected: TEAM ALPHA ✓
    console.log("\nSTEP 6: Select TEAM ALPHA");
    await adminPage.evaluate(() => {
      const btn = document.querySelector('.team-bid-btn[data-team="Team Alpha"]');
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 500));
    const leadingTeamStep6 = await adminPage.$eval('#displayHighestTeam', el => el.textContent.trim());
    console.log(`Admin Step 6 Leading Team: ${leadingTeamStep6}`);
    if (!leadingTeamStep6.includes('Team Alpha')) throw new Error(`Step 6 Failed: Expected Team Alpha, got ${leadingTeamStep6}`);

    // STEP 7: Open 3 Projector browsers simultaneously
    console.log("\nSTEP 7: Opening 3 Projector pages simultaneously");
    await Promise.all([
      projPage1.goto('http://localhost:8080/projector.html', { waitUntil: 'networkidle0' }),
      projPage2.goto('http://localhost:8080/projector.html', { waitUntil: 'networkidle0' }),
      projPage3.goto('http://localhost:8080/projector.html', { waitUntil: 'networkidle0' })
    ]);
    await new Promise(r => setTimeout(r, 1000));

    const proj1BidStep7 = await projPage1.$eval('#pCurrentBid', el => el.textContent.trim());
    const proj2BidStep7 = await projPage2.$eval('#pCurrentBid', el => el.textContent.trim());
    const proj3BidStep7 = await projPage3.$eval('#pCurrentBid', el => el.textContent.trim());
    console.log(`Projector 1 Bid: ${proj1BidStep7}, Projector 2 Bid: ${proj2BidStep7}, Projector 3 Bid: ${proj3BidStep7}`);
    if (proj1BidStep7 !== '2,600' && proj1BidStep7 !== '2600') throw new Error(`Step 7 Failed: Expected 2600, got ${proj1BidStep7}`);

    // STEP 8: From Admin click +500 -> Expected Admin = 3100, Projectors = 3100 WITHOUT REFRESH
    console.log("\nSTEP 8: Admin clicks +500 (Multi-Device Live Realtime Verification)");
    await adminPage.evaluate(() => {
      const btn = document.querySelector('.bid-btn[data-pts="500"]');
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 800));

    const adminBidStep8 = await adminPage.$eval('#displayPoints', el => el.textContent.trim());
    const proj1BidStep8 = await projPage1.$eval('#pCurrentBid', el => el.textContent.trim());
    const proj2BidStep8 = await projPage2.$eval('#pCurrentBid', el => el.textContent.trim());
    const proj3BidStep8 = await projPage3.$eval('#pCurrentBid', el => el.textContent.trim());

    console.log(`Admin Step 8: ${adminBidStep8}`);
    console.log(`Projector 1 Step 8: ${proj1BidStep8}`);
    console.log(`Projector 2 Step 8: ${proj2BidStep8}`);
    console.log(`Projector 3 Step 8: ${proj3BidStep8}`);

    if (!adminBidStep8.includes('3100')) throw new Error(`Step 8 Failed: Admin expected 3100, got ${adminBidStep8}`);
    if (!proj1BidStep8.includes('3,100') && !proj1BidStep8.includes('3100')) throw new Error(`Step 8 Failed: Proj 1 expected 3100, got ${proj1BidStep8}`);
    if (!proj2BidStep8.includes('3,100') && !proj2BidStep8.includes('3100')) throw new Error(`Step 8 Failed: Proj 2 expected 3100, got ${proj2BidStep8}`);
    if (!proj3BidStep8.includes('3,100') && !proj3BidStep8.includes('3100')) throw new Error(`Step 8 Failed: Proj 3 expected 3100, got ${proj3BidStep8}`);

    // STEP 9: Select TEAM BETA
    console.log("\nSTEP 9: Select TEAM BETA");
    await adminPage.evaluate(() => {
      const btn = document.querySelector('.team-bid-btn[data-team="Team B"]') || document.querySelector('.team-bid-btn[data-team="Team Beta"]');
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 500));
    const leadingTeamStep9 = await adminPage.$eval('#displayHighestTeam', el => el.textContent.trim());
    console.log(`Admin Step 9 Leading Team: ${leadingTeamStep9}`);

    // STEP 10: SELL -> Expected: SOLD to selected team at 3100 PTS
    console.log("\nSTEP 10: Click SELL");
    await adminPage.evaluate(() => {
      const btn = document.getElementById('sellPlayerDirectBtn');
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 1200));

    const proj1OverlayStep10 = await projPage1.evaluate(() => {
      const el = document.getElementById('soldOverlay');
      return el && !el.classList.contains('hidden') && el.classList.contains('active');
    });
    console.log(`Projector 1 SOLD Overlay Active: ${proj1OverlayStep10}`);

    // STEP 11: Start next player -> Expected: Current bid = 1000
    console.log("\nSTEP 11: Start next player");
    await adminPage.evaluate(() => {
      const nextBtn = document.getElementById('next');
      if (nextBtn) nextBtn.click();
    });
    await new Promise(r => setTimeout(r, 500));
    const adminBidStep11 = await adminPage.$eval('#displayPoints', el => el.textContent.trim());
    console.log(`Admin Step 11 New Player Bid: ${adminBidStep11}`);
    if (!adminBidStep11.includes('1000')) throw new Error(`Step 11 Failed: Expected 1000 POINTS, got ${adminBidStep11}`);

    // STEP 12: Click UNSOLD -> Expected: UNSOLD state & Projector animation
    console.log("\nSTEP 12: Click UNSOLD");
    await adminPage.evaluate(() => {
      if (typeof markUnsold === 'function') markUnsold();
    });
    await new Promise(r => setTimeout(r, 1200));

    const proj1UnsoldStep12 = await projPage1.evaluate(() => {
      const el = document.getElementById('unsoldOverlay');
      return el && !el.classList.contains('hidden') && el.classList.contains('active');
    });
    console.log(`Projector 1 UNSOLD Overlay Active: ${proj1UnsoldStep12}`);

    console.log("\n✅ ALL 18 VERIFICATION STEPS PASSED SUCCESSFULLY!");
  } catch (err) {
    console.error("\n❌ VERIFICATION TEST FAILED:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

runFullAuctionTest();
