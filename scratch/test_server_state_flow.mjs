import http from 'http';

async function testServerStateFlow() {
  console.log("🔍 Testing Server API endpoints and state logic...");

  // 1. Get initial state
  const stateRes = await fetch('http://localhost:8080/api/state');
  const state = await stateRes.json();
  console.log("Initial server state fetched successfully:");
  console.log(`- Players count: ${state.players ? state.players.length : 0}`);
  console.log(`- Bidding points: ${state.biddingPoints}`);
  console.log(`- Default base points: ${state.defaultBasePoints}`);

  // 2. Post state update
  state.defaultBasePoints = 1000;
  state.biddingPoints = 3100;
  state.highestTeam = 'Team Alpha';

  const updateRes = await fetch('http://localhost:8080/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state)
  });
  const updateResult = await updateRes.json();
  console.log("State update result:", updateResult);

  // 3. Verify state persisted
  const verifyRes = await fetch('http://localhost:8080/api/state');
  const verifiedState = await verifyRes.json();
  console.log(`Verified Bidding Points: ${verifiedState.biddingPoints}`);
  console.log(`Verified Base Points: ${verifiedState.defaultBasePoints}`);
  console.log(`Verified Highest Team: ${verifiedState.highestTeam}`);

  if (verifiedState.biddingPoints === 3100 && verifiedState.highestTeam === 'Team Alpha') {
    console.log("\n✅ SERVER API STATE SYNC TEST PASSED PERFECTLY!");
  } else {
    console.error("❌ STATE SYNC TEST FAILED");
    process.exit(1);
  }
}

testServerStateFlow();
