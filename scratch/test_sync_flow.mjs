import http from 'http';

async function runVerification() {
  console.log('1. Checking HTTP headers...');
  const projRes = await fetch('http://localhost:8080/projector.js');
  console.log('projector.js status:', projRes.status);
  console.log('Cache-Control:', projRes.headers.get('cache-control'));
  const projText = await projRes.text();
  const dupMatch = projText.match(/const currentIdx/g);
  console.log('Occurrences of "const currentIdx" in projector.js:', dupMatch ? dupMatch.length : 0);

  console.log('2. Connecting to SSE live stream...');
  let eventsReceived = 0;
  let sseBuffer = '';
  const sseReq = http.get('http://localhost:8080/api/stream', (res) => {
    res.on('data', (chunk) => {
      sseBuffer += chunk.toString();
      const messages = sseBuffer.split('\n\n');
      // keep the last incomplete piece in the buffer
      sseBuffer = messages.pop();
      for (const msg of messages) {
        if (msg.startsWith('data: ')) {
          try {
            const json = JSON.parse(msg.slice(6));
            eventsReceived++;
            console.log(`[SSE Event #${eventsReceived}] currentIdx=${json.current}, phase=${json.auctionPhase}, pts=${json.biddingPoints}, player=${json.players && json.players[json.current] ? json.players[json.current]['Full Name '] : 'N/A'}`);
          } catch (e) {
            console.error('Parse error on event:', e.message);
          }
        }
      }
    });
  });

  await new Promise(r => setTimeout(r, 600));

  console.log('3. Simulating Admin selecting Player #0 (Dhanraj Honparkhe)...');
  const s1 = await (await fetch('http://localhost:8080/api/state')).json();
  s1.current = 0;
  s1.auctionPhase = 'LIVE_AUCTION';
  s1.biddingPoints = 1000;
  s1.highestTeam = '';
  s1.broadcastOverlay = null;
  s1.soldAnimationEvent = null;
  s1.unsoldAnimationEvent = null;
  s1.lastUpdated = Date.now();

  await fetch('http://localhost:8080/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(s1)
  });

  await new Promise(r => setTimeout(r, 600));

  console.log('4. Simulating Admin selecting Player #2 (Abhishek Pawar) with 5,000 pts to Team Alpha...');
  s1.current = 2;
  s1.biddingPoints = 5000;
  s1.highestTeam = 'Team Alpha';
  s1.lastUpdated = Date.now();

  await fetch('http://localhost:8080/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(s1)
  });

  await new Promise(r => setTimeout(r, 1000));
  
  if (eventsReceived >= 3) {
    console.log('🎯 SUCCESS: Projector & Overlay SSE stream received all live Admin updates synchronously!');
    process.exit(0);
  } else {
    console.error('⚠️ Received:', eventsReceived);
    process.exit(1);
  }
}

runVerification().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
