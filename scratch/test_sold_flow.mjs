import http from 'http';

async function testSoldFlow() {
  console.log('1. Fetching current auction state...');
  const stateRes = await fetch('http://localhost:8080/api/state');
  const state = await stateRes.json();
  const player = state.players[0];
  const playerName = (player['Full Name '] || 'Test Player').trim();
  console.log(`Current player #0: ${playerName}`);

  console.log('2. Connecting to SSE stream...');
  let soldEventReceived = false;
  let sseBuffer = '';
  
  const sseReq = http.get('http://localhost:8080/api/stream', (res) => {
    res.on('data', (chunk) => {
      sseBuffer += chunk.toString();
      const messages = sseBuffer.split('\n\n');
      sseBuffer = messages.pop();
      for (const msg of messages) {
        if (msg.startsWith('data: ')) {
          try {
            const json = JSON.parse(msg.slice(6));
            if (json.soldAnimationEvent && json.soldAnimationEvent.type === 'SOLD') {
              soldEventReceived = true;
              console.log(`🎉 [SSE SOLD EVENT CONFIRMED] Player: "${json.soldAnimationEvent.name}" SOLD TO "${json.soldAnimationEvent.team}" FOR ${json.soldAnimationEvent.points} PTS!`);
            }
          } catch (e) {}
        }
      }
    });
  });

  await new Promise(r => setTimeout(r, 600));

  console.log('3. Triggering SOLD action from Admin...');
  const soldPayload = {
    ...state,
    current: 1, // moves to next player
    soldAnimationEvent: {
      type: 'SOLD',
      id: '1',
      name: playerName,
      photo: player['Upload Your Picture .... चेहरा स्पष्टपणे दिसेल असा फोटो अपलोड करा.\r\n '],
      role: player['Player Type '] || 'All Rounder',
      style: player['Player Style'] || 'Right Hand Batsman/Bowler',
      team: 'Adv. Vikrant Phatate Royals',
      teamLogo: '',
      points: 2500,
      timestamp: Date.now()
    },
    lastUpdated: Date.now()
  };

  const postRes = await fetch('http://localhost:8080/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(soldPayload)
  });
  console.log('Admin POST result:', await postRes.json());

  await new Promise(r => setTimeout(r, 1000));

  if (soldEventReceived) {
    console.log('✅ VERIFIED: Sold card event was successfully generated, broadcast, and delivered via SSE!');
    process.exit(0);
  } else {
    console.error('❌ Failed to receive sold event via SSE');
    process.exit(1);
  }
}

testSoldFlow().catch(e => {
  console.error(e);
  process.exit(1);
});
