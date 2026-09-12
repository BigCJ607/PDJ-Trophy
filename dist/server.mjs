import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = 8080;
const STATE_FILE_PATH = path.join(process.cwd(), 'scpl_auction_state.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

let stateClients = [];
let currentAuctionState = {
  players: [],
  current: 0,
  biddingPoints: 1000,
  defaultBasePoints: 1000,
  highestTeam: '',
  status: 'AVAILABLE',
  auctionPhase: 'PRE_AUCTION', // PRE_AUCTION | COUNTDOWN | LIVE_AUCTION | FILTER_TRANSITION | BREAK | RESUME_COUNTDOWN | AUCTION_COMPLETED
  unsoldRound: 0, // 0 = Normal auction, 1 = UNSOLD LIST 1, 2 = UNSOLD LIST 2, 3 = UNSOLD LIST 3
  breakTimer: { secondsRemaining: 300, isRunning: false, isNoTimer: false },
  broadcastOverlay: null, // { type: 'FILTER'|'SOLD'|'UNSOLD'|'COMPLETED', title: string, subtitle: string, durationMs: number }
  soldAnimationEvent: null,
  unsoldAnimationEvent: null,
  activeSquadDisplay: null,
  theme_color: 'green',
  teamsConfig: {
    'Team Alpha': { pointLimit: 20000, maxPlayers: 11, logoUrl: '' },
    'Team A': { pointLimit: 20000, maxPlayers: 11, logoUrl: '' },
    'Team B': { pointLimit: 20000, maxPlayers: 11, logoUrl: '' },
    'Team C': { pointLimit: 20000, maxPlayers: 11, logoUrl: '' },
    'Team D': { pointLimit: 20000, maxPlayers: 11, logoUrl: '' },
    'Team E': { pointLimit: 20000, maxPlayers: 11, logoUrl: '' }
  },
  historyLog: [],
  lastUpdated: Date.now()
};

// ----------------------------------------------------
// PERSISTENT DISK STORAGE (READ ON STARTUP)
// ----------------------------------------------------
function loadStateFromDisk() {
  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      const raw = fs.readFileSync(STATE_FILE_PATH, 'utf-8');
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.players) && data.players.length > 0) {
        currentAuctionState = { ...currentAuctionState, ...data };
        console.log(`💾 Disk Persistence: Loaded ${data.players.length} players from scpl_auction_state.json`);
      }
    }
  } catch (err) {
    console.error('⚠️ Disk Persistence Load Error:', err.message);
  }
}

function saveStateToDisk() {
  try {
    fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(currentAuctionState, null, 2), 'utf-8');
  } catch (err) {
    console.error('⚠️ Disk Persistence Save Error:', err.message);
  }
}

// Load saved state from disk on startup
loadStateFromDisk();

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

if (process.stdin.resume) {
  process.stdin.resume();
}

function broadcastState() {
  const payload = `data: ${JSON.stringify(currentAuctionState)}\n\n`;
  stateClients.forEach(client => {
    try {
      client.write(payload);
    } catch (e) {
      // client disconnected
    }
  });
}

const server = http.createServer((req, res) => {
  req.on('error', (err) => console.error('Req error:', err.message));
  res.on('error', (err) => console.error('Res error:', err.message));

  let reqUrl = (req.url || '/').split('?')[0];
  if (reqUrl === '/' || reqUrl === '/admin' || reqUrl === '/admin.html') reqUrl = '/index.html';
  if (reqUrl === '/projector') reqUrl = '/projector.html';

  // API: Server-Sent Events stream for Projector Real-Time Sync
  if (reqUrl === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(`data: ${JSON.stringify(currentAuctionState)}\n\n`);
    stateClients.push(res);

    req.on('close', () => {
      stateClients = stateClients.filter(client => client !== res);
    });
    return;
  }

  // API: Get or Update Auction State
  if (reqUrl === '/api/state') {
    if (req.method === 'GET' || req.method === 'HEAD') {
      res.writeHead(200, { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      res.end(JSON.stringify(currentAuctionState));
      return;
    } 
    
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          currentAuctionState = {
            ...currentAuctionState,
            ...data,
            lastUpdated: Date.now()
          };
          
          saveStateToDisk(); // Save instantly to disk JSON file!
          broadcastState();
          
          res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(JSON.stringify({ success: true, lastUpdated: currentAuctionState.lastUpdated }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
  }

  // Serve Static Files
  let filePath;
  try {
    filePath = path.join(process.cwd(), decodeURIComponent(reqUrl));
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('400 Bad Request');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });

    const stream = fs.createReadStream(filePath);
    stream.on('error', (sErr) => {
      console.error('Stream error:', sErr.message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
      }
      res.end();
    });
    stream.pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`SCPL Auction Desk running at http://localhost:${PORT}`);
  console.log(`Admin Control: http://localhost:${PORT}/index.html`);
  console.log(`Projector Display: http://localhost:${PORT}/projector.html`);
});
