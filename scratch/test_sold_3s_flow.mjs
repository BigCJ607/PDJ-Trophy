import http from 'http';

async function testSoldFlow() {
  console.log('Testing 3-second Sold & Unsold Transition Flow...');

  // 1. Fetch current state
  const stateRes = await fetch('http://localhost:8080/api/state');
  const state = await stateRes.json();
  console.log(`Current player index: ${state.current}, highestTeam: "${state.highestTeam}"`);

  // Verify teamsConfig exists and has teams
  const teams = Object.keys(state.teamsConfig || {});
  console.log(`Total teams configured: ${teams.length} -> [${teams.slice(0, 3).join(', ')}...]`);
  if (teams.length === 0) {
    throw new Error('teamsConfig is empty!');
  }

  // 2. Simulate sending a SOLD event with selectedTeam
  const selectedTeam = state.highestTeam || teams[0];
  const soldPlayer = state.players[state.current];
  const soldPlayerName = soldPlayer ? (soldPlayer['Full Name'] || soldPlayer['Name']) : 'Test Player';
  console.log(`Simulating SOLD for player "${soldPlayerName}" to "${selectedTeam}" at 2500 PTS`);

  const soldEvent = {
    type: 'SOLD',
    id: soldPlayer ? soldPlayer['CricHeroes Account No'] || soldPlayerName : '1',
    name: soldPlayerName,
    photo: '',
    role: 'All-rounder',
    style: 'Right Hand',
    team: selectedTeam,
    teamLogo: '',
    points: 2500,
    timestamp: Date.now()
  };

  soldPlayer.Team = selectedTeam;
  soldPlayer['Transferred Team'] = selectedTeam;
  soldPlayer.Points = 2500;
  soldPlayer.Status = 'SOLD';

  const update1 = await fetch('http://localhost:8080/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...state,
      soldAnimationEvent: soldEvent,
      unsoldAnimationEvent: null
    })
  });
  console.log(`POST soldEvent status: ${update1.status}`);

  // Check state immediately
  const verify1 = await (await fetch('http://localhost:8080/api/state')).json();
  console.log(`Immediate check: soldAnimationEvent type = ${verify1.soldAnimationEvent?.type}, team = ${verify1.soldAnimationEvent?.team}`);
  if (verify1.soldAnimationEvent?.type !== 'SOLD' || verify1.soldAnimationEvent?.team !== selectedTeam) {
    throw new Error('Immediate check failed: soldAnimationEvent not set properly!');
  }

  // 3. Wait 3.2 seconds and simulate the 3-second transition to random player
  console.log('Waiting 3 seconds...');
  await new Promise(r => setTimeout(r, 3100));

  // Available players pool
  const availablePool = verify1.players
    .map((p, idx) => ({ p, idx }))
    .filter(item => {
      const st = item.p.Status;
      const tm = item.p.Team;
      return st !== 'SOLD' && st !== 'UNSOLD' && (!tm || tm === 'Not assigned' || tm === '—' || tm === 'Not Assigned');
    });

  console.log(`Remaining available players in pool: ${availablePool.length}`);
  const randomChoice = availablePool[Math.floor(Math.random() * availablePool.length)];
  console.log(`Selected new random player: index ${randomChoice.idx} (${randomChoice.p['Full Name'] || randomChoice.p['Name']})`);

  // Clear soldAnimationEvent and advance to random player
  randomChoice.p.Status = 'LIVE';
  const update2 = await fetch('http://localhost:8080/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...verify1,
      current: randomChoice.idx,
      biddingPoints: 1000,
      highestTeam: '',
      soldAnimationEvent: null,
      unsoldAnimationEvent: null
    })
  });
  console.log(`POST transition status: ${update2.status}`);

  // Verify transition state
  const verify2 = await (await fetch('http://localhost:8080/api/state')).json();
  console.log(`After 3s transition check:`);
  console.log(`- current player: index ${verify2.current}`);
  console.log(`- soldAnimationEvent: ${verify2.soldAnimationEvent}`);
  console.log(`- biddingPoints: ${verify2.biddingPoints}`);
  console.log(`- highestTeam: "${verify2.highestTeam}"`);
  console.log(`- teamsConfig count: ${Object.keys(verify2.teamsConfig || {}).length}`);

  if (verify2.soldAnimationEvent !== null) {
    throw new Error('soldAnimationEvent should be null after 3s transition!');
  }
  if (verify2.current !== randomChoice.idx) {
    throw new Error('current should match the random choice index!');
  }
  if (Object.keys(verify2.teamsConfig || {}).length === 0) {
    throw new Error('teamsConfig was lost!');
  }

  console.log('✅ ALL TESTS PASSED SUCCESSFULLY!');
}

testSoldFlow().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
