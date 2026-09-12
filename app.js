const LOCAL_STORAGE_KEY = 'scpl_auction_saved_data';

// ----------------------------------------------------
// SUPABASE CLIENT & SINGLETON REALTIME CHANNEL INITIALIZATION
// ----------------------------------------------------
const SUPABASE_URL = "https://irxxmqfpokfbwxmueles.supabase.co";
const SUPABASE_KEY = "sb_publishable_PDDDQPtT2swFOw_8WL3UPQ_B-iF-4DQ";
let supabaseClient = null;
let supabaseRealtimeChannel = null;
let supabaseChannelSubscribed = false;

if (window.supabase) {
  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log("⚡ Supabase Client initialized successfully.");
    
    // SINGLETON CHANNEL INITIATION ONCE AT STARTUP
    supabaseRealtimeChannel = supabaseClient.channel('scpl_auction_room');
    supabaseRealtimeChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        supabaseChannelSubscribed = true;
        console.log("⚡ Supabase Realtime Singleton Channel SUBSCRIBED.");
      }
    });
  } catch (e) {
    console.warn("⚠️ Supabase Client init fallback:", e.message);
  }
}

const sample = [];

let players = [];
let current = 0;
let defaultBasePoints = 1000;
let biddingPoints = 1000;
let highestTeam = '';
let activeSquadDisplay = null;
let currentTheme = 'green';
let historyLog = [];
let undoStack = [];
let redoStack = [];
let activeRoleFilter = 'ALL';
let editingPlayerIndex = null;
let revealedTeamsInEnd = [];

// STAGE & TIMER STATE MACHINE
let auctionPhase = 'PRE_AUCTION'; // PRE_AUCTION | COUNTDOWN | LIVE_AUCTION | FILTER_TRANSITION | BREAK | RESUME_COUNTDOWN | AUCTION_COMPLETED
let breakSecondsRemaining = 300;
let breakIsRunning = false;
let breakIsNoTimer = false;
let breakTimerInterval = null;
let broadcastOverlay = null;
let activeSoldEvent = null;
let activeUnsoldEvent = null;
let soldEventTimer = null;
let unsoldEventTimer = null;
let soldTransitionTimer = null;
let unsoldTransitionTimer = null;

const imageCache = new Map();

let teamsConfig = {
  'Team Alpha': { logoUrl: '', pointLimit: 20000, maxPlayers: 11 },
  'Team A': { logoUrl: '', pointLimit: 20000, maxPlayers: 11 },
  'Team B': { logoUrl: '', pointLimit: 20000, maxPlayers: 11 },
  'Team C': { logoUrl: '', pointLimit: 20000, maxPlayers: 11 },
  'Team D': { logoUrl: '', pointLimit: 20000, maxPlayers: 11 },
  'Team E': { logoUrl: '', pointLimit: 20000, maxPlayers: 11 }
};

const broadcastChannel = new BroadcastChannel('scpl_auction_channel');
const $ = id => document.getElementById(id);

function safeSetText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function safeSetVal(id, val) {
  const el = $(id);
  if (el) el.value = val;
}

function showToast(message, type = 'success') {
  const toast = $('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast ${type}`;
  setTimeout(() => {
    toast.className = 'toast hidden';
  }, 4000);
}

function addHistory(text) {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  historyLog.unshift({ time, text });
}

function closeAllModals() {
  const modalIds = [
    'availableModal', 'soldModal', 'unsoldModal', 'teamsModal', 'teamSettingsModal',
    'historyModal', 'createTeamDialog', 'editTeamDialog', 'teamDialog', 'confirmUnsoldDialog',
    'breakModal', 'endAuctionDialog'
  ];
  modalIds.forEach(id => {
    const m = $(id);
    if (m && typeof m.close === 'function' && m.open) {
      m.close();
    }
  });
}

function preloadImage(url) {
  if (!url) return;
  try {
    const img = new Image();
    img.src = url;
    imageCache.set(url, img);
  } catch (e) {}
}

function preloadUpcomingImages(queue) {
  if (!queue || !queue.length) return;
  queue.slice(0, 6).forEach(item => {
    const p = item.pl || item;
    const rawPhoto = val(p, 'Upload Your Picture', 'Picture', 'Photo', 'Image', 'cached_image_url', 'original_image_url');
    const photoUrl = drivePhoto(rawPhoto);
    if (photoUrl && !imageCache.has(photoUrl)) {
      const img = new Image();
      img.src = photoUrl;
      imageCache.set(photoUrl, img);
    }
  });
}

// Save state to LocalStorage for offline browser persistence
function saveToLocalStorage() {
  try {
    const payload = {
      players,
      current,
      defaultBasePoints,
      biddingPoints,
      highestTeam,
      teamsConfig,
      historyLog,
      activeSquadDisplay,
      theme_color: currentTheme,
      auctionPhase,
      breakSecondsRemaining,
      breakIsRunning,
      breakIsNoTimer,
      broadcastOverlay,
      timestamp: Date.now()
    };
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.error('LocalStorage Save Error:', e);
  }
}

// Load saved state from LocalStorage
function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.players) && data.players.length > 0) {
      players = data.players;
      current = data.current || 0;
      defaultBasePoints = data.defaultBasePoints || 1000;
      biddingPoints = data.biddingPoints || defaultBasePoints;
      highestTeam = data.highestTeam || '';
      teamsConfig = data.teamsConfig || teamsConfig;
      historyLog = data.historyLog || [];
      activeSquadDisplay = data.activeSquadDisplay || null;
      currentTheme = data.theme_color || 'green';
      auctionPhase = data.auctionPhase || 'PRE_AUCTION';
      breakSecondsRemaining = data.breakSecondsRemaining || 300;
      breakIsRunning = data.breakIsRunning || false;
      breakIsNoTimer = data.breakIsNoTimer || false;
      broadcastOverlay = data.broadcastOverlay || null;
      revealedTeamsInEnd = data.revealedTeamsInEnd || [];
      return true;
    }
  } catch (e) {
    console.error('LocalStorage Load Error:', e);
  }
  return false;
}

// 1-STEP UNDO & REDO STACK MACHINE
function saveStateSnapshot() {
  const snapshot = JSON.stringify({
    players: JSON.parse(JSON.stringify(players)),
    current,
    defaultBasePoints,
    biddingPoints,
    highestTeam,
    activeSquadDisplay,
    theme_color: currentTheme,
    auctionPhase,
    broadcastOverlay
  });
  
  if (undoStack.length > 0 && undoStack[undoStack.length - 1] === snapshot) {
    return;
  }
  
  undoStack.push(snapshot);
  if (undoStack.length > 30) undoStack.shift();
  redoStack = [];
  updateUndoRedoUI();
}

function undoLastAction() {
  if (!undoStack.length) {
    showToast('⚠️ Nothing to undo.', 'error');
    return;
  }

  const currentSnap = JSON.stringify({
    players: JSON.parse(JSON.stringify(players)),
    current,
    defaultBasePoints,
    biddingPoints,
    highestTeam,
    activeSquadDisplay,
    theme_color: currentTheme,
    auctionPhase,
    broadcastOverlay
  });
  redoStack.push(currentSnap);

  const prevSnap = JSON.parse(undoStack.pop());
  players = prevSnap.players;
  current = prevSnap.current;
  defaultBasePoints = prevSnap.defaultBasePoints || 1000;
  biddingPoints = prevSnap.biddingPoints || defaultBasePoints;
  highestTeam = prevSnap.highestTeam || '';
  activeSquadDisplay = prevSnap.activeSquadDisplay || null;
  currentTheme = prevSnap.theme_color || 'green';
  auctionPhase = prevSnap.auctionPhase || 'LIVE_AUCTION';
  broadcastOverlay = prevSnap.broadcastOverlay || null;

  if (soldTransitionTimer) { clearTimeout(soldTransitionTimer); soldTransitionTimer = null; }
  if (unsoldTransitionTimer) { clearTimeout(unsoldTransitionTimer); unsoldTransitionTimer = null; }
  activeSoldEvent = null;
  activeUnsoldEvent = null;

  showToast('↩ Undid 1 step!', 'success');
  addHistory('Auctioneer executed UNDO.');
  syncStateToServer();
  render();
  updateUndoRedoUI();
}

function redoNextAction() {
  if (!redoStack.length) {
    showToast('⚠️ Nothing to redo.', 'error');
    return;
  }

  const currentSnap = JSON.stringify({
    players: JSON.parse(JSON.stringify(players)),
    current,
    defaultBasePoints,
    biddingPoints,
    highestTeam,
    activeSquadDisplay,
    theme_color: currentTheme,
    auctionPhase,
    broadcastOverlay
  });
  undoStack.push(currentSnap);

  const nextSnap = JSON.parse(redoStack.pop());
  players = nextSnap.players;
  current = nextSnap.current;
  defaultBasePoints = nextSnap.defaultBasePoints || 1000;
  biddingPoints = nextSnap.biddingPoints || defaultBasePoints;
  highestTeam = nextSnap.highestTeam || '';
  activeSquadDisplay = nextSnap.activeSquadDisplay || null;
  currentTheme = nextSnap.theme_color || 'green';
  auctionPhase = nextSnap.auctionPhase || 'LIVE_AUCTION';
  broadcastOverlay = nextSnap.broadcastOverlay || null;

  showToast('↪ Redid 1 step!', 'success');
  addHistory('Auctioneer executed REDO.');
  syncStateToServer();
  render();
  updateUndoRedoUI();
}

function updateUndoRedoUI() {
  const undoBtn = $('undoBtn');
  const undoBidBtn = $('undoBidBtn');
  const redoBtn = $('redoBtn');

  if (undoBtn) undoBtn.disabled = (undoStack.length === 0);
  if (undoBidBtn) undoBidBtn.disabled = (undoStack.length === 0);
  if (redoBtn) redoBtn.disabled = (redoStack.length === 0);
}

// REAL-TIME SYNCHRONIZATION WITH SUPABASE & SERVER
function syncStateToServer(animationEvent = null) {
  saveToLocalStorage();

  const timestamp = Date.now();

  if (animationEvent && animationEvent.type === 'SOLD') {
    activeSoldEvent = animationEvent;
    activeUnsoldEvent = null;
    if (soldEventTimer) clearTimeout(soldEventTimer);
    soldEventTimer = setTimeout(() => {
      activeSoldEvent = null;
      syncStateToServer();
    }, 3000);
  } else if (animationEvent && animationEvent.type === 'UNSOLD') {
    activeUnsoldEvent = animationEvent;
    activeSoldEvent = null;
    if (unsoldEventTimer) clearTimeout(unsoldEventTimer);
    unsoldEventTimer = setTimeout(() => {
      activeUnsoldEvent = null;
      syncStateToServer();
    }, 3000);
  }

  // Auto-expire
  if (activeSoldEvent && timestamp - activeSoldEvent.timestamp >= 3000) {
    activeSoldEvent = null;
  }
  if (activeUnsoldEvent && timestamp - activeUnsoldEvent.timestamp >= 3000) {
    activeUnsoldEvent = null;
  }

  const payload = {
    players,
    current,
    defaultBasePoints: defaultBasePoints || 1000,
    biddingPoints: biddingPoints || defaultBasePoints || 1000,
    highestTeam,
    teamsConfig,
    historyLog,
    activeSquadDisplay,
    theme_color: currentTheme,
    auctionPhase,
    breakSecondsRemaining,
    breakIsRunning,
    breakIsNoTimer,
    broadcastOverlay,
    revealedTeamsInEnd: revealedTeamsInEnd || [],
    soldAnimationEvent: activeSoldEvent,
    unsoldAnimationEvent: activeUnsoldEvent,
    lastUpdated: timestamp,
    timestamp
  };

  try {
    broadcastChannel.postMessage(payload);
  } catch (e) {
    console.error('BroadcastChannel error', e);
  }

  // SINGLETON BROADCAST TRANSMISSION
  if (supabaseRealtimeChannel) {
    try {
      supabaseRealtimeChannel.send({
        type: 'broadcast',
        event: 'state_update',
        payload
      });
    } catch (sbErr) {
      console.warn("Supabase Realtime Broadcast Notice:", sbErr);
    }
  }

  // DATABASE ROW UPSERT (PERSISTENT SOURCE OF TRUTH FOR NEW DEVICES)
  if (supabaseClient) {
    try {
      supabaseClient.from('auction_state').upsert({
        id: 1,
        state_data: payload,
        current_index: current,
        default_base_points: defaultBasePoints || 1000,
        bidding_points: biddingPoints || defaultBasePoints || 1000,
        highest_team: highestTeam,
        active_role_filter: activeRoleFilter,
        auction_phase: auctionPhase,
        theme_color: currentTheme,
        break_seconds_remaining: breakSecondsRemaining,
        break_is_running: breakIsRunning,
        break_is_no_timer: breakIsNoTimer,
        sold_animation_event: activeSoldEvent,
        unsold_animation_event: activeUnsoldEvent,
        last_updated: new Date(timestamp).toISOString()
      }, { onConflict: 'id' }).then(() => {}).catch(() => {});
    } catch (dbErr) {
      console.warn("Supabase DB Upsert Notice:", dbErr);
    }
  }

  fetch('/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(err => console.error('Sync Error:', err));
}

function val(player, ...aliases) {
  if (!player) return '';
  const entries = Object.entries(player);
  for (const alias of aliases) {
    const aliasLC = alias.trim().toLowerCase();
    const found = entries.find(([k, v]) => {
      if (v === '' || v == null || v === 'undefined') return false;
      const kLC = k.trim().toLowerCase();
      return kLC === aliasLC || kLC.startsWith(aliasLC) || kLC.includes(aliasLC);
    });
    if (found) return found[1];
  }
  return '';
}

function getRawStatus(player) {
  if (!player) return 'AVAILABLE';
  const st = String(val(player, 'Status', 'Auction Status') || '').toUpperCase();
  const tm = String(val(player, 'Team', 'Transferred Team') || '').trim();
  if (st === 'SOLD' || (tm !== '' && tm !== 'Not assigned' && tm !== '—' && tm !== 'Not Assigned')) return 'SOLD';
  if (st === 'UNSOLD') return 'UNSOLD';
  if (st === 'WITHDRAWN') return 'WITHDRAWN';
  if (st === 'LIVE') return 'LIVE';
  return 'AVAILABLE';
}

function getPlayerUnsoldRound(player) {
  return parseInt(player.unsold_round || val(player, 'unsold_round', 'Unsold Round')) || 0;
}

function drivePhoto(url) {
  if (!url) return '';
  let trimmed = String(url).trim();
  if (!trimmed || trimmed === 'undefined' || trimmed === 'null' || trimmed === '—') return '';
  if (trimmed.startsWith('data:image')) return trimmed;
  
  trimmed = trimmed.replace(/^["']|["']$/g, '');

  const driveMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/) || 
                     trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
                     trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
                     trimmed.match(/^([a-zA-Z0-9_-]{25,})$/);
                     
  if (driveMatch && driveMatch[1]) {
    const fileId = driveMatch[1];
    return `https://lh3.googleusercontent.com/d/${fileId}=s1000`;
  }

  return trimmed;
}

function getSafeCssUrl(url) {
  if (!url) return '';
  const trimmed = String(url).trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('data:image')) {
    return `url("${trimmed}")`;
  }
  return `url("${encodeURI(trimmed).replace(/"/g, '\\"')}")`;
}

function formatPlayerStyle(type, style) {
  const typeLC = (type || '').toLowerCase();
  if (typeLC.includes('all-rounder') || typeLC.includes('allrounder')) return style;
  const handMatch = (style || '').match(/(right|left)\s*hand/i);
  if (!handMatch) return style;
  const hand = handMatch[1];
  if (typeLC.includes('batsman') && typeLC.includes('bowler')) return hand + ' Hand Batsman/Bowler';
  if (typeLC.includes('batsman')) return hand + ' Hand Batsman';
  if (typeLC.includes('bowler')) return hand + ' Hand Bowler';
  return style;
}

function calculateTeamPointsSpent(teamName) {
  let spent = 0;
  players.forEach(p => {
    if (getRawStatus(p) === 'SOLD') {
      const tm = val(p, 'Team', 'Transferred Team');
      if (tm.trim().toLowerCase() === teamName.trim().toLowerCase()) {
        spent += parseInt(val(p, 'Points', 'Final Points')) || 0;
      }
    }
  });
  return spent;
}

function validateTeamPointLimit(teamName, attemptedPoints) {
  const config = teamsConfig[teamName] || { pointLimit: 20000, maxPlayers: 11 };
  const currentSpent = calculateTeamPointsSpent(teamName);
  if (currentSpent + attemptedPoints > config.pointLimit) {
    return {
      valid: false,
      reason: `⚠ POINT LIMIT EXCEEDED — ${teamName} cannot acquire this player. Point limit is ${config.pointLimit} PTS (Current spent: ${currentSpent} PTS, Attempted: ${attemptedPoints} PTS).`
    };
  }
  return { valid: true };
}

function safeSetText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function safeSetVal(id, val) {
  const el = $(id);
  if (el) el.value = val;
}

function showToast(message, type = 'info') {
  showToastWithAction(message, type);
}

function showToastWithAction(message, type = 'info', actionText = null, actionCallback = null, duration = 2500) {
  let container = $('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.style.cssText = 'position:fixed; bottom:20px; right:20px; z-index:9999; display:flex; flex-direction:column; gap:10px; pointer-events:none;';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  const bg = type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#3b82f6';
  toast.style.cssText = `background:${bg}; color:#fff; padding:12px 20px; border-radius:12px; font-weight:800; font-size:13px; font-family:Manrope,sans-serif; box-shadow:0 10px 25px rgba(0,0,0,0.3); transition:all 0.3s ease; pointer-events:auto; display:flex; align-items:center; gap:12px;`;
  
  let html = `<span>${message}</span>`;
  if (actionText && typeof actionCallback === 'function') {
    html += `<button class="toast-action-btn" style="background:rgba(255,255,255,0.25); border:1px solid rgba(255,255,255,0.4); color:#fff; padding:4px 10px; border-radius:8px; font-weight:900; font-size:11px; cursor:pointer; text-transform:uppercase;">${actionText}</button>`;
  }
  toast.innerHTML = html;

  if (actionText && typeof actionCallback === 'function') {
    const btn = toast.querySelector('.toast-action-btn');
    if (btn) {
      btn.onclick = () => {
        actionCallback();
        toast.remove();
      };
    }
  }

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function setRoleFilter(filter) {
  activeRoleFilter = filter || 'ALL';
}

function selectPlayerForAuction(index) {
  if (index < 0 || index >= players.length) return;
  saveStateSnapshot();
  current = index;
  const p = players[current];
  if (getRawStatus(p) === 'AVAILABLE') {
    p['Status'] = 'LIVE';
  }
  biddingPoints = defaultBasePoints || 1000;
  highestTeam = '';
  activeSquadDisplay = null;
  broadcastOverlay = null;
  activeSoldEvent = null;
  activeUnsoldEvent = null;
  auctionPhase = 'LIVE_AUCTION';
  closeAllModals();
  showToast(`🎯 Selected ${val(p, 'Full Name', 'Name')} for live auction`, 'success');
  addHistory(`Admin selected player ${val(p, 'Full Name', 'Name')} for auction.`);
  syncStateToServer();
  render();
}
window.selectPlayerForAuction = selectPlayerForAuction;

function updateUndoRedoUI() {
  const uBtn = $('undoBtn');
  const uBidBtn = $('undoBidBtn');
  const rBtn = $('redoBtn');
  if (uBtn) uBtn.disabled = undoStack.length === 0;
  if (uBidBtn) uBidBtn.disabled = undoStack.length === 0;
  if (rBtn) rBtn.disabled = redoStack.length === 0;
}

function redoNextAction() {
  if (!redoStack.length) {
    showToast('⚠️ Nothing to redo.', 'error');
    return;
  }
  const currentSnap = JSON.stringify({
    players: JSON.parse(JSON.stringify(players)),
    current,
    biddingPoints,
    highestTeam,
    activeSquadDisplay,
    theme_color: currentTheme,
    auctionPhase,
    broadcastOverlay
  });
  undoStack.push(currentSnap);

  const nextSnap = JSON.parse(redoStack.pop());
  players = nextSnap.players;
  current = nextSnap.current;
  biddingPoints = nextSnap.biddingPoints;
  highestTeam = nextSnap.highestTeam;
  activeSquadDisplay = nextSnap.activeSquadDisplay;
  currentTheme = nextSnap.theme_color;
  auctionPhase = nextSnap.auctionPhase;
  broadcastOverlay = nextSnap.broadcastOverlay;

  updateUndoRedoUI();
  showToast('🔄 Redid last action.', 'info');
  syncStateToServer();
  render();
}

// startBreakMode defined below (line ~1643) — single canonical definition

function confirmEndAuction() {
  auctionPhase = 'AUCTION_COMPLETED';
  broadcastOverlay = {
    type: 'AUCTION_COMPLETED',
    timestamp: Date.now()
  };
  showToast('🏁 Auction Completed!', 'success');
  addHistory('Admin officially completed the auction.');
  const dlg = $('endAuctionDialog');
  if (dlg) dlg.close();
  syncStateToServer();
  render();
}

function performFullAuctionReset() {
  saveStateSnapshot();
  (players || []).forEach(p => {
    p['Status'] = 'AVAILABLE';
    p['Team'] = '';
    p['Points'] = '';
    p['unsold_round'] = 0;
    p['Auction Time'] = '';
  });
  current = 0;
  biddingPoints = 2000;
  highestTeam = '';
  activeSquadDisplay = null;
  currentTheme = 'green';
  auctionPhase = 'PRE_AUCTION';
  broadcastOverlay = null;
    activeSoldEvent = null;
    activeUnsoldEvent = null;
  historyLog = [];
  revealedTeamsInEnd = [];

  showToast('🔄 Full Auction Reset Completed!', 'success');
  addHistory('Admin performed a full auction reset.');
  const dlg = $('resetAuctionDialog');
  if (dlg) dlg.close();
  syncStateToServer();
  render();
}

function performDeleteAllData() {
  saveStateSnapshot();
  players = [];
  current = 0;
  biddingPoints = 1000;
  highestTeam = '';
  activeSquadDisplay = null;
  currentTheme = 'green';
  auctionPhase = 'PRE_AUCTION';
  broadcastOverlay = null;
    activeSoldEvent = null;
    activeUnsoldEvent = null;
  animationEvent = null;
  historyLog = [];
  revealedTeamsInEnd = [];

  showToast('🗑️ All player data reset. Teams preserved!', 'info');
  addHistory('Admin permanently deleted all auction data.');
  
  const dlg = $('deleteAllDataModal');
  if (dlg) dlg.close();
  
  syncStateToServer();
  render();
}

// EXPLICIT MASTER EXCEL EXPORT WITH AUTO-FITTED COLUMN WIDTHS
function downloadMasterExcel() {
  try {
    if (!window.XLSX) {
      showToast('⚠️ XLSX library unavailable', 'error');
      return false;
    }

    const exportRows = players.map(p => {
      return {
        "Full Name ": val(p, 'Full Name', 'Name') || 'Unnamed Player',
        "Player Type ": val(p, 'Player Type', 'Type', 'Role') || '',
        "Player Style": val(p, 'Player Style', 'Style') || '',
        "Age": val(p, 'Age') || '',
        "CricHeroes Account No or Id": val(p, 'CricHeroes Account No', 'CricHeroes ID') || '',
        "Team": val(p, 'Team', 'Transferred Team') || '',
        "Points": val(p, 'Points', 'Final Points') || '',
        "Status": getRawStatus(p),
        "Unsold Round": getPlayerUnsoldRound(p),
        "Auction Time": val(p, 'Auction Time') || '',
        "Upload Your Picture": val(p, 'Upload Your Picture', 'Photo', 'Image') || '',
        "Phone number ": val(p, 'Phone number', 'Phone') || '',
        "Please enter your profession or job role": val(p, 'Please enter your profession', 'profession') || ''
      };
    });

    const sheet = XLSX.utils.json_to_sheet(exportRows);

    // Auto-fit column widths based on maximum text length per column
    const maxLens = {};
    exportRows.forEach(row => {
      Object.keys(row).forEach(key => {
        const valStr = String(row[key] || '');
        const currentMax = maxLens[key] || key.length;
        maxLens[key] = Math.max(currentMax, valStr.length);
      });
    });

    sheet['!cols'] = Object.keys(maxLens).map(key => ({
      wch: Math.min(Math.max(maxLens[key] + 4, 14), 55)
    }));

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'SCPL_Master_Auction');
    XLSX.writeFile(book, 'PDJ_Trophy_2026_Auction_Export.xlsx');
    
    showToast('📤 Master Excel workbook exported with auto-fitted column widths!', 'success');
    addHistory('Master Excel file exported by admin operator.');
    return true;
  } catch (err) {
    console.error('Excel Export Error:', err);
    showToast('⚠️ Could not export Excel file: ' + err.message, 'error');
    return false;
  }
}

// MATCH ROLE FILTER (FILTER + AVAILABLE/UNSOLD STATUS = RANDOM POOL)
function matchesActiveRole(player) {
  if (activeRoleFilter.startsWith('UNSOLD')) {
    if (getRawStatus(player) !== 'UNSOLD') return false;
    const rd = getPlayerUnsoldRound(player);
    if (activeRoleFilter === 'UNSOLD_1') return rd <= 1;
    if (activeRoleFilter === 'UNSOLD_2') return rd === 2;
    if (activeRoleFilter === 'UNSOLD_3') return rd === 3;
    if (activeRoleFilter === 'UNSOLD_4') return rd === 4;
    if (activeRoleFilter === 'UNSOLD_5') return rd === 5;
    if (activeRoleFilter === 'UNSOLD_6') return rd === 6;
    if (activeRoleFilter === 'UNSOLD_7') return rd >= 7;
    return true;
  }

  if (getRawStatus(player) !== 'AVAILABLE') return false;

  if (!activeRoleFilter || activeRoleFilter === 'ALL') return true;

  const pType = (val(player, 'Player Type', 'Type', 'Role') || '').toUpperCase();
  const filter = activeRoleFilter.toUpperCase();

  if (filter.includes('BAT')) return pType.includes('BAT');
  if (filter.includes('BOWL')) return pType.includes('BOWL');
  if (filter.includes('ALL')) return pType.includes('ALL');
  if (filter.includes('KEEP') || filter.includes('WK')) return pType.includes('KEEP') || pType.includes('WICKET') || pType.includes('WK');

  return pType.includes(filter);
}

function updateTeamDropdownSelectors() {
  const teamNames = Object.keys(teamsConfig);
  
  const quickTeamButtonsContainer = $('quickTeamButtons');
  if (quickTeamButtonsContainer) {
    quickTeamButtonsContainer.innerHTML = teamNames.map(t => {
      const isActive = (highestTeam === t);
      const cfg = teamsConfig[t] || { pointLimit: 20000 };
      const spent = calculateTeamPointsSpent(t);
      const remPoints = Math.max(0, cfg.pointLimit - spent);
      const logoUrl = teamsConfig[t] && teamsConfig[t].logoUrl ? drivePhoto(teamsConfig[t].logoUrl) : '';
      const logoHtml = logoUrl ? `<img src="${encodeURI(logoUrl).replace(/"/g, '\\"')}" class="team-btn-mini-logo" alt="${t}">` : `<span class="team-btn-mini-badge">${t.slice(0, 2).toUpperCase()}</span>`;
      const activeMark = isActive ? ' <span style="color:#ffffff; font-weight:900;">✓</span>' : '';
      
      return `<button class="team-bid-btn ${isActive ? 'active' : ''}" data-team="${t}" title="Select ${t} as leading team (${remPoints.toLocaleString()} PTS remaining)">
        <div class="team-bid-btn-top">
          ${logoHtml}
          <span class="team-btn-name">${t}${activeMark}</span>
        </div>
        <span class="team-btn-rem-pts">${remPoints.toLocaleString()} PTS REM</span>
      </button>`;
    }).join('');

    quickTeamButtonsContainer.querySelectorAll('.team-bid-btn').forEach(btn => {
      btn.onclick = () => {
        const targetTeam = btn.dataset.team;
        const valResult = validateTeamPointLimit(targetTeam, biddingPoints);
        if (!valResult.valid) {
          showToast(valResult.reason, 'error');
          return;
        }
        saveStateSnapshot();
        highestTeam = targetTeam;
        showToast(`🛡️ ${highestTeam} set as leading team ✓`, 'success');
        syncStateToServer();
        render();
      };
    });
  }

  const teamDatalist = $('teamList');
  if (teamDatalist) {
    teamDatalist.innerHTML = teamNames.map(t => `<option value="${t}"></option>`).join('');
  }

  const teamListEdit = $('teamListEdit');
  if (teamListEdit) {
    teamListEdit.innerHTML = teamNames.map(t => `<option value="${t}"></option>`).join('');
  }

  const projSquadSelect = $('projectorSquadSelect');
  if (projSquadSelect) {
    const currVal = activeSquadDisplay || '';
    projSquadSelect.innerHTML = '<option value="">-- Live Auction --</option>' +
      teamNames.map(t => `<option value="${t}">${t}</option>`).join('');
    projSquadSelect.value = currVal;
  }
}

function renderStageControlUI() {
  const stageDot = $('stageDot');
  const stageStatusLabel = $('stageStatusLabel');
  
  if (stageStatusLabel) {
    let stageText = 'STAGE: LIVE AUCTION';
    let dotClass = 'stage-indicator-dot live';

    if (auctionPhase === 'PRE_AUCTION') {
      stageText = 'STAGE: PRE-AUCTION WAITING';
      dotClass = 'stage-indicator-dot waiting';
    } else if (auctionPhase === 'COUNTDOWN') {
      stageText = 'STAGE: BROADCAST COUNTDOWN (10s)';
      dotClass = 'stage-indicator-dot countdown';
    } else if (auctionPhase === 'BREAK') {
      stageText = `STAGE: AUCTION BREAK (${breakIsNoTimer ? 'OPEN BREAK' : formatTime(breakSecondsRemaining)})`;
      dotClass = 'stage-indicator-dot break';
    } else if (auctionPhase === 'AUCTION_COMPLETED') {
      stageText = 'STAGE: AUCTION COMPLETED';
      dotClass = 'stage-indicator-dot finished';
    }

    stageStatusLabel.textContent = stageText;
    if (stageDot) stageDot.className = dotClass;
  }
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateBreakTimerUI() {
  safeSetText('breakDisplayTimer', breakIsNoTimer ? 'OPEN BREAK' : formatTime(breakSecondsRemaining));
}

function render() {
  if (!players || !players.length) return;
  if (current >= players.length) current = 0;

  updateTeamDropdownSelectors();
  updateUndoRedoUI();
  renderStageControlUI();
  updateBreakTimerUI();

  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === currentTheme);
  });

  const p = players[current];
  const name = val(p, 'Full Name', 'Name', 'Player Name') || 'Unnamed Player';
  const rawPhoto = val(p, 'Upload Your Picture', 'Picture', 'Photo', 'Image', 'cached_image_url', 'original_image_url') || p.cached_image_url || p.original_image_url;
  const photo = drivePhoto(rawPhoto);
  const status = getRawStatus(p);

  safeSetText('position', `AUCTION PLAYER ${current + 1} OF ${players.length}`);
  safeSetText('name', name);
  
  const nameParts = name.trim().split(/\s+/);
  let initText = 'P';
  if (nameParts.length >= 2) {
    initText = (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase();
  } else if (nameParts.length === 1 && nameParts[0].length >= 2) {
    initText = nameParts[0].slice(0, 2).toUpperCase();
  }
  safeSetText('initials', initText);

  const photoEl = $('photo');
  if (photoEl) {
    if (photo) {
      photoEl.style.backgroundImage = getSafeCssUrl(photo);
      photoEl.classList.add('has-image');
    } else {
      photoEl.style.backgroundImage = '';
      photoEl.classList.remove('has-image');
    }
  }

  const type = val(p, 'Player Type', 'Type', 'Role') || 'Player';
  const style = val(p, 'Player Style', 'Style', 'Batting Style') || 'Not provided';
  safeSetText('role', type.toUpperCase());
  const formattedStyle = formatPlayerStyle(type, style);
  safeSetText('batting', formattedStyle);

  safeSetText('category', type);
  safeSetText('speciality', formattedStyle);
  const age = val(p, 'Age');
  safeSetText('age', age ? age + ' years' : 'Not provided');
  safeSetText('cricId', val(p, 'CricHeroes Account No', 'CricHeroes ID', 'CricHeroes') || 'Not provided');
  
  safeSetText('profession', val(p, 'Please enter your profession', 'profession', 'job role') || 'Not provided');
  safeSetText('phone', val(p, 'Phone number', 'Phone') || '—');

  const team = val(p, 'Team', 'Transferred Team');
  const points = val(p, 'Points', 'Final Points');
  
  const statusEl = $('status');
  if (status === 'SOLD') {
    safeSetText('team', `${team || 'Assigned'} (${points ? points + ' PTS' : 'SOLD'})`);
    if (statusEl) { statusEl.textContent = 'SOLD'; statusEl.className = 'status sold'; }
  } else if (status === 'UNSOLD') {
    const rd = getPlayerUnsoldRound(p);
    safeSetText('team', `UNSOLD (Round ${rd})`);
    if (statusEl) { statusEl.textContent = `UNSOLD (R${rd})`; statusEl.className = 'status unsold-badge'; }
  } else if (status === 'LIVE') {
    safeSetText('team', highestTeam ? `${highestTeam} (${biddingPoints} PTS)` : 'Bidding in progress...');
    if (statusEl) { statusEl.textContent = '🔴 LIVE ON BLOCK'; statusEl.className = 'status live-badge'; }
  } else {
    safeSetText('team', 'Not assigned');
    if (statusEl) { statusEl.textContent = 'AVAILABLE'; statusEl.className = 'status available'; }
  }

  safeSetVal('basePointsSettingInput', defaultBasePoints);
  safeSetText('displayBasePointsLabel', (defaultBasePoints || 1000) + ' POINTS');
  safeSetText('displayPoints', (biddingPoints || defaultBasePoints || 1000) + ' POINTS');
  safeSetText('displayHighestTeam', highestTeam || team || 'None');
  safeSetText('dialogName', 'SELL PLAYER');
  safeSetText('confirmPlayerName', name);
  safeSetText('confirmBidPoints', (biddingPoints || defaultBasePoints || 1000) + ' POINTS');
  safeSetVal('finalPointsInput', biddingPoints || defaultBasePoints || 1000);

  // Update Dynamic Giant SELL Button in Right Control Console
  const sellBtn = $('sellPlayerDirectBtn');
  if (sellBtn) {
    if (status === 'SOLD') {
      sellBtn.disabled = true;
      sellBtn.className = 'btn-huge-sell disabled';
      sellBtn.innerHTML = `<span class="sell-main">PLAYER ALREADY SOLD</span><span class="sell-sub">Assigned to ${team || 'Team'}</span>`;
    } else if (highestTeam) {
      sellBtn.disabled = false;
      sellBtn.className = 'btn-huge-sell active';
      sellBtn.innerHTML = `<span class="sell-main">✓ SELL TO ${highestTeam.toUpperCase()}</span><span class="sell-sub">${(biddingPoints || defaultBasePoints || 1000).toLocaleString()} POINTS</span>`;
    } else {
      sellBtn.disabled = true;
      sellBtn.className = 'btn-huge-sell disabled';
      sellBtn.innerHTML = `<span class="sell-main">SELECT TEAM TO SELL</span><span class="sell-sub">Pick bidding team above</span>`;
    }
  }

  // Statistics
  let availableCount = 0, soldCount = 0, unsoldCount = 0, liveCount = 0, withdrawnCount = 0;
  let unsold1Count = 0, unsold2Count = 0, unsold3Count = 0;
  let unsold4Count = 0, unsold5Count = 0, unsold6Count = 0, unsold7Count = 0;

  players.forEach(pl => {
    const st = getRawStatus(pl);
    const rd = getPlayerUnsoldRound(pl);
    if (st === 'SOLD') soldCount++;
    else if (st === 'UNSOLD') {
      unsoldCount++;
      if (rd <= 1) unsold1Count++;
      else if (rd === 2) unsold2Count++;
      else if (rd === 3) unsold3Count++;
      else if (rd === 4) unsold4Count++;
      else if (rd === 5) unsold5Count++;
      else if (rd === 6) unsold6Count++;
      else unsold7Count++;
    }
    else if (st === 'LIVE') liveCount++;
    else if (st === 'WITHDRAWN') withdrawnCount++;
    else availableCount++;
  });

  safeSetText('statTotal', players.length);
  safeSetText('statAvailable', availableCount);
  safeSetText('statAvailableTab', availableCount);
  safeSetText('modalAvailableTotal', availableCount);
  safeSetText('statLive', liveCount);
  safeSetText('statSold', soldCount);
  safeSetText('statUnsold', unsoldCount);
  safeSetText('statUnsold1Count', unsold1Count);
  safeSetText('statUnsold2Count', unsold2Count);
  safeSetText('statUnsold3Count', unsold3Count);
  safeSetText('statUnsold4Count', unsold4Count);
  safeSetText('statUnsold5Count', unsold5Count);
  safeSetText('statUnsold6Count', unsold6Count);
  safeSetText('statUnsold7Count', unsold7Count);
  safeSetText('statWithdrawn', withdrawnCount);

  safeSetText('statSoldTab', soldCount);
  safeSetText('statUnsoldTab', unsoldCount);

  // Dynamic Unsold List Buttons Visibility (Show 4-7 when players exist or selected)
  const b4 = $('btnUnsold4'); if (b4) b4.style.display = (unsold4Count > 0 || activeRoleFilter === 'UNSOLD_4') ? 'inline-flex' : 'none';
  const b5 = $('btnUnsold5'); if (b5) b5.style.display = (unsold5Count > 0 || activeRoleFilter === 'UNSOLD_5') ? 'inline-flex' : 'none';
  const b6 = $('btnUnsold6'); if (b6) b6.style.display = (unsold6Count > 0 || activeRoleFilter === 'UNSOLD_6') ? 'inline-flex' : 'none';
  const b7 = $('btnUnsold7'); if (b7) b7.style.display = (unsold7Count > 0 || activeRoleFilter === 'UNSOLD_7') ? 'inline-flex' : 'none';

  // Filter Slider Controls
  const btnScrollL = $('filterScrollLeft');
  const btnScrollR = $('filterScrollRight');
  const scrollContainer = $('roleFiltersScroll');
  if (btnScrollL && scrollContainer) {
    btnScrollL.onclick = () => scrollContainer.scrollBy({ left: -220, behavior: 'smooth' });
  }
  if (btnScrollR && scrollContainer) {
    btnScrollR.onclick = () => scrollContainer.scrollBy({ left: 220, behavior: 'smooth' });
  }

  let displayRoleLabel = activeRoleFilter;
  if (activeRoleFilter === 'UNSOLD_1') displayRoleLabel = 'UNSOLD ROUND 1';
  else if (activeRoleFilter === 'UNSOLD_2') displayRoleLabel = 'UNSOLD ROUND 2';
  else if (activeRoleFilter === 'UNSOLD_3') displayRoleLabel = 'UNSOLD ROUND 3';
  
  safeSetText('activeRoleLabel', displayRoleLabel);
  safeSetText('activeFilterName', displayRoleLabel);

  const filteredQueue = players.map((pl, idx) => ({ pl, idx })).filter(item => matchesActiveRole(item.pl) && item.idx !== current);
  safeSetText('count', filteredQueue.length + (activeRoleFilter.startsWith('UNSOLD') ? ' unsold remaining' : ' available remaining'));

  preloadUpcomingImages(filteredQueue);

  const qList = $('queueList');
  if (qList) {
    qList.innerHTML = filteredQueue.slice(0, 6).map(item => {
      const nm = val(item.pl, 'Full Name', 'Name') || 'Player ' + (item.idx + 1);
      const tp = val(item.pl, 'Player Type', 'Role') || 'Player';
      return `<div class="queue-card" data-i="${item.idx}">
        <b>${nm}</b><span>${tp}</span>
      </div>`;
    }).join('') || '<div style="font-size:11px; color:var(--muted); padding:4px;">No players in this category</div>';

    qList.querySelectorAll('.queue-card').forEach(e => {
      e.onclick = () => {
        selectPlayerForAuction(+e.dataset.i);
      };
    });
  }

  const searchDatalist = $('adminPlayerSearchDatalist');
  if (searchDatalist) {
    searchDatalist.innerHTML = players.map((p, idx) => {
      const nm = val(p, 'Full Name', 'Name') || 'Player ' + (idx + 1);
      const role = val(p, 'Player Type', 'Role') || '';
      return `<option value="${nm} (${role}) [#${idx + 1}]"></option>`;
    }).join('');
  }

  renderAvailableModal();
  renderSoldModal();
  renderUnsoldModal();
  renderTeamsModal();
  renderTeamSettingsModal();
  renderHistoryModal();

  // End Auction Team Reveal Bar Control
  const revealBar = $('endAuctionTeamRevealBar');
  const revealContainer = $('revealTeamButtonsContainer');
  
  if (auctionPhase === 'AUCTION_COMPLETED') {
    if (revealBar) revealBar.classList.remove('hidden');
    if (revealContainer) {
      const teamNames = Object.keys(teamsConfig);
      revealContainer.innerHTML = teamNames.map(t => {
        const isRevealed = (revealedTeamsInEnd || []).includes('ALL') || (revealedTeamsInEnd || []).includes(t);
        return `<button class="reveal-team-btn ${isRevealed ? 'revealed' : ''}" data-team="${t}">
          ${isRevealed ? '👁' : '🙈'} ${t}
        </button>`;
      }).join('');

      revealContainer.querySelectorAll('.reveal-team-btn').forEach(btn => {
        btn.onclick = () => {
          const tm = btn.dataset.team;
          if (!Array.isArray(revealedTeamsInEnd)) revealedTeamsInEnd = [];
          if (revealedTeamsInEnd.includes('ALL')) {
            revealedTeamsInEnd = teamNames.filter(name => name !== tm);
          } else {
            const idx = revealedTeamsInEnd.indexOf(tm);
            if (idx >= 0) revealedTeamsInEnd.splice(idx, 1);
            else revealedTeamsInEnd.push(tm);
          }
          syncStateToServer();
          render();
        };
      });
    }

    const btnRevAll = $('btnRevealAllTeams');
    if (btnRevAll) {
      btnRevAll.onclick = () => {
        revealedTeamsInEnd = ['ALL'];
        syncStateToServer();
        render();
      };
    }

    const btnHideAll = $('btnHideAllTeams');
    if (btnHideAll) {
      btnHideAll.onclick = () => {
        revealedTeamsInEnd = [];
        syncStateToServer();
        render();
      };
    }
  } else {
    if (revealBar) revealBar.classList.add('hidden');
  }
}

function renderAvailableModal() {
  const aList = $('availableListContainer');
  if (!aList) return;
  const availList = players.map((p, i) => ({ p, i })).filter(item => getRawStatus(item.p) === 'AVAILABLE');
  
  if (!availList.length) {
    aList.innerHTML = '<p style="color: var(--muted); text-align: center;">No available players remaining.</p>';
    return;
  }

  aList.innerHTML = availList.map(item => {
    const nm = val(item.p, 'Full Name', 'Name');
    return `<div class="player-list-item">
      <div>
        <strong>${nm}</strong>
        <span style="display:block; font-size:11px; color:var(--muted);">${val(item.p, 'Player Type')} • ${val(item.p, 'Player Style')}</span>
      </div>
      <div>
        <button class="btn-cute-hero primary" onclick="selectPlayerForAuction(${item.i})" style="padding:4px 10px; font-size:10px;">🎯 AUCTION NOW</button>
      </div>
    </div>`;
  }).join('');
}

window.selectPlayerForAuction = selectPlayerForAuction;

function renderSoldModal() {
  const sList = $('soldListContainer');
  if (!sList) return;
  const soldList = players.map((p, i) => ({ p, i })).filter(item => getRawStatus(item.p) === 'SOLD');
  safeSetText('modalSoldTotal', soldList.length);

  if (!soldList.length) {
    sList.innerHTML = '<p style="color: var(--muted); text-align: center;">No players sold yet.</p>';
    return;
  }

  sList.innerHTML = soldList.map(item => {
    const p = item.p;
    const nm = val(p, 'Full Name', 'Name');
    const tm = val(p, 'Team', 'Transferred Team') || 'Assigned';
    const pts = val(p, 'Points', 'Final Points') || '0';
    const tmStamp = val(p, 'Auction Time') || 'Recorded';
    return `<div class="player-list-item">
      <div>
        <strong>${nm}</strong>
        <span style="display:block; font-size:11px; color:var(--muted);">${val(p, 'Player Type')} • ${val(p, 'Player Style')}</span>
      </div>
      <div style="text-align:right;">
        <span style="color:#2563eb; font-weight:800; font-size:13px;">${tm}</span>
        <span style="display:block; font-size:11px; font-weight:700; color:var(--orange);">${pts} Points (${tmStamp})</span>
        <button class="btn-cute-action primary" onclick="openTeamCorrectionModal(${item.i})" style="margin-top:4px; padding:2px 8px; font-size:9px;">✏️ EDIT TEAM</button>
      </div>
    </div>`;
  }).join('');
}

window.openTeamCorrectionModal = function(playerIndex) {
  editingPlayerIndex = playerIndex;
  const p = players[playerIndex];
  const name = val(p, 'Full Name', 'Name');
  const currentTeam = val(p, 'Team', 'Transferred Team') || 'Unassigned';

  safeSetText('editTeamPlayerName', name);
  safeSetText('editTeamCurrentVal', currentTeam);
  safeSetVal('editTeamSelectInput', currentTeam);

  const dlg = $('editTeamDialog');
  if (dlg) dlg.showModal();
};

function renderUnsoldModal() {
  const uList = $('unsoldListContainer');
  if (!uList) return;
  const unsoldList = players.map((p, i) => ({ p, i })).filter(item => getRawStatus(item.p) === 'UNSOLD');
  safeSetText('modalUnsoldTotal', unsoldList.length);

  if (!unsoldList.length) {
    uList.innerHTML = '<p style="color: var(--muted); text-align: center;">No unsold players.</p>';
    return;
  }

  uList.innerHTML = unsoldList.map(item => {
    const nm = val(item.p, 'Full Name', 'Name');
    const rd = getPlayerUnsoldRound(item.p);
    return `<div class="player-list-item">
      <div>
        <strong>${nm} (Round ${rd})</strong>
        <span style="display:block; font-size:11px; color:var(--muted);">${val(item.p, 'Player Type')} • ${val(item.p, 'Player Style')}</span>
      </div>
      <div>
        <button class="btn-reauction" onclick="reAuctionPlayer(${item.i})" style="background:#2563eb; color:#fff; border:0; padding:6px 12px; border-radius:14px; font-weight:800; font-size:11px; cursor:pointer;">🔄 RE-AUCTION</button>
      </div>
    </div>`;
  }).join('');
}

window.broadcastTeamSquad = function(teamName) {
  activeSquadDisplay = teamName;
  const projSquadSelect = $('projectorSquadSelect');
  if (projSquadSelect) projSquadSelect.value = teamName;
  showToast(`📺 Broadcasting ${teamName} squad on Projector!`, 'success');
  addHistory(`Admin set Projector view to display ${teamName} squad.`);
  syncStateToServer();
  render();
};

function renderTeamsModal() {
  const tContainer = $('teamsContainer');
  if (!tContainer) return;
  
  const teamsMap = {};
  players.forEach(p => {
    if (getRawStatus(p) === 'SOLD') {
      const tm = val(p, 'Team', 'Transferred Team') || 'Unassigned Team';
      const pts = parseInt(val(p, 'Points', 'Final Points')) || 0;
      if (!teamsMap[tm]) teamsMap[tm] = { players: [], totalPoints: 0 };
      teamsMap[tm].players.push({ name: val(p, 'Full Name', 'Name'), points: pts, role: val(p, 'Player Type') });
      teamsMap[tm].totalPoints += pts;
    }
  });

  const teamKeys = Object.keys(teamsConfig);
  if (!teamKeys.length) {
    tContainer.innerHTML = '<p style="color: var(--muted); text-align: center;">No teams created yet. Click "Create New Team" above to add a team.</p>';
    return;
  }

  tContainer.innerHTML = teamKeys.map(tmKey => {
    const tData = teamsMap[tmKey] || { players: [], totalPoints: 0 };
    const cfg = teamsConfig[tmKey] || { logoUrl: '', pointLimit: 20000 };
    const rem = cfg.pointLimit - tData.totalPoints;
    const logoHtml = cfg.logoUrl ? 
      `<div class="team-logo-wrapper"><img src="${encodeURI(drivePhoto(cfg.logoUrl)).replace(/"/g, '\\"')}" class="team-logo-preview" alt="${tmKey}"></div>` : 
      `<div class="team-logo-wrapper"><div class="team-logo-preview">${tmKey.slice(0, 2).toUpperCase()}</div></div>`;

    return `<div class="team-card">
      <div class="team-card-header" style="display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; align-items:center; gap:12px; flex-shrink:0;">
          ${logoHtml}
          <strong style="font-size:16px; font-weight:800; color:#0f172a;">🛡️ ${tmKey}</strong>
        </div>
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <span style="font-size:11px; font-weight:800; color:var(--muted);">${tData.players.length} Players</span>
          <span style="font-size:11px; font-weight:900; color:var(--orange); background:rgba(245,158,11,0.1); padding:3px 8px; border-radius:6px;">SPENT: ${tData.totalPoints.toLocaleString()} PTS</span>
          <span style="font-size:11px; font-weight:900; color:#10b981; background:rgba(16,185,129,0.1); padding:3px 8px; border-radius:6px;">REM: ${rem.toLocaleString()} PTS</span>
          <button class="btn-cute-action primary" onclick="broadcastTeamSquad('${tmKey}')" style="padding:4px 10px; font-size:11px; font-weight:800;">📺 Project Squad</button>
          <button class="btn-delete-team" onclick="deleteTeam('${tmKey}')" style="background:#fee2e2; color:#dc2626; border:1px solid #fca5a5; padding:4px 10px; border-radius:12px; font-size:11px; font-weight:800; cursor:pointer;" title="Delete Team">🗑️ Delete</button>
        </div>
      </div>
      <div style="margin-top:6px;">
        ${tData.players.length ? tData.players.map(pl => `
          <div style="display:flex; justify-content:space-between; font-size:12px; padding:3px 0; border-bottom:1px solid #f1f5f9;">
            <span>• ${pl.name} (${pl.role})</span>
            <b style="color:var(--ink);">${pl.points} Points</b>
          </div>
        `).join('') : '<span style="font-size:11px; color:var(--muted);">No players acquired yet.</span>'}
      </div>
    </div>`;
  }).join('');
}

function renderTeamSettingsModal() {
  const container = $('teamSettingsContainer');
  if (!container) return;

  const teamKeys = Object.keys(teamsConfig);
  if (!teamKeys.length) {
    container.innerHTML = '<p style="color: var(--muted); text-align: center;">No teams created yet.</p>';
    return;
  }

  container.innerHTML = teamKeys.map(tm => {
    const cfg = teamsConfig[tm];
    const spent = calculateTeamPointsSpent(tm);
    const rem = cfg.pointLimit - spent;
    const logoHtml = cfg.logoUrl ? 
      `<div class="team-logo-wrapper"><img src="${encodeURI(drivePhoto(cfg.logoUrl)).replace(/"/g, '\\"')}" class="team-logo-preview" alt="${tm}"></div>` : 
      `<div class="team-logo-wrapper"><div class="team-logo-preview">${tm.slice(0, 2).toUpperCase()}</div></div>`;

    return `<div class="team-manage-card">
      <div class="team-manage-header">
        <div style="display:flex; align-items:center; gap:12px; flex:1;">
          ${logoHtml}
          <div>
            <strong style="font-size:15px; display:block;">${tm}</strong>
            <span style="font-size:11px; color:var(--muted);">Spent: ${spent.toLocaleString()} PTS | Remaining: ${rem.toLocaleString()} PTS</span>
          </div>
        </div>
        <button class="btn-delete-team" onclick="deleteTeam('${tm}')" style="background:#fee2e2; color:#dc2626; border:1px solid #fca5a5; padding:4px 10px; border-radius:12px; font-size:11px; font-weight:800; cursor:pointer;">🗑️ Delete Team</button>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:10px;">
        <div>
          <label style="margin:0; font-size:11px;">Upload Logo File:
            <input type="file" accept="image/*" onchange="uploadTeamLogoFile('${tm}', this)" style="margin-top:2px;">
          </label>
        </div>
        <div>
          <label style="margin:0; font-size:11px;">OR Logo URL:
            <input type="url" value="${cfg.logoUrl || ''}" placeholder="Paste URL" onchange="updateTeamLogo('${tm}', this.value)" style="margin-top:2px;">
          </label>
        </div>
        <div>
          <label style="margin:0; font-size:11px;">Point Limit (PTS):
            <input type="number" value="${cfg.pointLimit}" onchange="updateTeamLimit('${tm}', this.value)" style="margin-top:2px;">
          </label>
        </div>
      </div>
    </div>`;
  }).join('');
}

window.uploadTeamLogoFile = function(team, inputEl) {
  const file = inputEl.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    if (!teamsConfig[team]) teamsConfig[team] = { logoUrl: '', pointLimit: 20000, maxPlayers: 11 };
    teamsConfig[team].logoUrl = e.target.result;
    showToast(`🖼️ Updated logo for team "${team}"`, 'success');
    syncStateToServer();
    render();
  };
  reader.readAsDataURL(file);
};

window.updateTeamLogo = function(team, url) {
  if (!teamsConfig[team]) teamsConfig[team] = { logoUrl: '', pointLimit: 20000, maxPlayers: 11 };
  teamsConfig[team].logoUrl = url.trim();
  syncStateToServer();
  render();
};

window.updateTeamLimit = function(team, val) {
  if (!teamsConfig[team]) teamsConfig[team] = { logoUrl: '', pointLimit: 20000, maxPlayers: 11 };
  teamsConfig[team].pointLimit = parseInt(val) || 20000;
  syncStateToServer();
  render();
};

window.deleteTeam = function(team) {
  if (!confirm(`Are you sure you want to delete team "${team}"?`)) return;
  delete teamsConfig[team];
  showToast(`🗑️ Deleted team "${team}"`, 'success');
  addHistory(`Team ${team} deleted by admin.`);
  syncStateToServer();
  render();
};

function renderHistoryModal() {
  const hContainer = $('historyLogContainer');
  if (!hContainer) return;

  if (!historyLog.length) {
    hContainer.innerHTML = '<p style="color: var(--muted); text-align: center;">No auction history recorded yet.</p>';
    return;
  }

  hContainer.innerHTML = historyLog.map(item => `
    <div style="padding: 6px 0; border-bottom: 1px solid #f0f4ee; font-size: 12px;">
      <span style="color: var(--muted); font-family: 'DM Mono'; margin-right: 8px;">${item.time}</span>
      <strong>${item.text}</strong>
    </div>
  `).join('');
}

// ----------------------------------------------------
// Core Auction & Stage Logic
// ----------------------------------------------------

function handleConfirmSale(selectedTeam, finalPoints) {
  const p = players[current];
  if (!p) return false;
  const name = val(p, 'Full Name', 'Name') || 'Player';

  if (getRawStatus(p) === 'SOLD') {
    showToast(`⚠️ PLAYER ALREADY SOLD — ${name} is already assigned to ${val(p, 'Team')}.`, 'error');
    return false;
  }

  const valResult = validateTeamPointLimit(selectedTeam, finalPoints);
  if (!valResult.valid) {
    showToast(valResult.reason, 'error');
    return false;
  }

  saveStateSnapshot();
  p['Team'] = selectedTeam;
  p['Transferred Team'] = selectedTeam;
  p['Points'] = finalPoints;
  p['Status'] = 'SOLD';
  p['Auction Time'] = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (!teamsConfig[selectedTeam]) {
    teamsConfig[selectedTeam] = { logoUrl: '', pointLimit: 20000, maxPlayers: 11 };
  }

  const rawPhoto = val(p, 'Upload Your Picture', 'Picture', 'Photo', 'Image', 'cached_image_url', 'original_image_url') || p.cached_image_url || p.original_image_url;
  const photo = drivePhoto(rawPhoto);
  const teamLogoUrl = (teamsConfig[selectedTeam] && teamsConfig[selectedTeam].logoUrl) ? drivePhoto(teamsConfig[selectedTeam].logoUrl) : '';

  const soldEvent = {
    type: 'SOLD',
    id: val(p, 'CricHeroes Account No', 'CricHeroes ID') || name,
    name,
    photo,
    role: val(p, 'Player Type', 'Role') || 'Player',
    style: val(p, 'Player Style', 'Style') || 'Cricket Player',
    team: selectedTeam,
    teamLogo: teamLogoUrl,
    points: finalPoints,
    timestamp: Date.now()
  };

  showToastWithAction(
    `✓ SOLD TO ${selectedTeam.toUpperCase()} • ${finalPoints.toLocaleString()} PTS`,
    'success',
    'UNDO',
    () => undoLastAction()
  );
  addHistory(`${name} SOLD to ${selectedTeam} for ${finalPoints} Points.`);

  // Automatically select a new random player for next bid
  const availableItems = players.map((pl, idx) => ({ pl, idx })).filter(item => matchesActiveRole(item.pl));
  if (availableItems.length > 0) {
    const randomChoice = availableItems[Math.floor(Math.random() * availableItems.length)];
    const nextIdx = randomChoice.idx;
    const nextP = players[nextIdx];
    if (nextP) {
      const nextRawPhoto = val(nextP, 'Upload Your Picture', 'Picture', 'Photo', 'Image', 'cached_image_url', 'original_image_url');
      preloadImage(drivePhoto(nextRawPhoto));
    }
    current = nextIdx;
    players[current]['Status'] = 'LIVE';
    biddingPoints = defaultBasePoints || 1000;
    highestTeam = '';
  }

  syncStateToServer(soldEvent);
  render();
  return true;
}

function pickRandomPlayer() {
  const pool = players.map((pl, idx) => ({ pl, idx })).filter(item => matchesActiveRole(item.pl));

  if (!pool.length) {
    const label = activeRoleFilter.startsWith('UNSOLD') ? activeRoleFilter : activeRoleFilter;
    alert(`No ${label} players remaining in the pool!`);
    return;
  }

  saveStateSnapshot();
  const randomChoice = pool[Math.floor(Math.random() * pool.length)];
  current = randomChoice.idx;
  activeSquadDisplay = null;
  broadcastOverlay = null;
  activeSoldEvent = null;
  activeUnsoldEvent = null;
  auctionPhase = 'LIVE_AUCTION';
  players[current]['Status'] = 'LIVE';
  biddingPoints = defaultBasePoints || 1000;
  highestTeam = '';

  const name = val(players[current], 'Full Name', 'Name');
  const roleLabel = activeRoleFilter;
  addHistory(`${name} randomly selected for LIVE AUCTION (${roleLabel}).`);
  showToast(`🔴 LIVE AUCTION — ${name} on the block!`, 'success');
  syncStateToServer();
  render();
}

function markUnsold() {
  const p = players[current];
  if (!p) return;
  const name = val(p, 'Full Name', 'Name') || 'Player';

  if (getRawStatus(p) === 'SOLD') {
    showToast(`⚠️ Cannot mark SOLD player as unsold.`, 'error');
    return;
  }
  if (getRawStatus(p) === 'UNSOLD') {
    return;
  }

  saveStateSnapshot();
  const currentRound = (getPlayerUnsoldRound(p) || 0) + 1;
  p['Status'] = 'UNSOLD';
  p['Team'] = 'Not Assigned';
  p['Transferred Team'] = 'Not Assigned';
  p['Points'] = '—';
  p['unsold_round'] = currentRound;
  p['Auction Time'] = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const rawUnsoldPhoto = val(p, 'Upload Your Picture', 'Picture', 'Photo', 'Image', 'cached_image_url', 'original_image_url') || p.cached_image_url || p.original_image_url;
  const unsoldPhoto = drivePhoto(rawUnsoldPhoto);

  const unsoldEvent = {
    type: 'UNSOLD',
    id: val(p, 'CricHeroes Account No', 'CricHeroes ID') || name,
    name,
    photo: unsoldPhoto,
    role: val(p, 'Player Type', 'Role') || 'Player',
    style: val(p, 'Player Style', 'Style') || 'Cricket Player',
    unsoldRound: currentRound,
    timestamp: Date.now()
  };

  showToastWithAction(
    `❌ MARKED AS UNSOLD (Round ${currentRound})`,
    'warning',
    'UNDO',
    () => undoLastAction()
  );
  addHistory(`${name} marked as UNSOLD (Round ${currentRound}).`);

  // Automatically select a new random player for next bid
  const availableItems = players.map((pl, idx) => ({ pl, idx })).filter(item => matchesActiveRole(item.pl));
  if (availableItems.length > 0) {
    const randomChoice = availableItems[Math.floor(Math.random() * availableItems.length)];
    const nextIdx = randomChoice.idx;
    const nextP = players[nextIdx];
    if (nextP) {
      const nextRawPhoto = val(nextP, 'Upload Your Picture', 'Picture', 'Photo', 'Image', 'cached_image_url', 'original_image_url');
      preloadImage(drivePhoto(nextRawPhoto));
    }
    current = nextIdx;
    players[current]['Status'] = 'LIVE';
    biddingPoints = defaultBasePoints || 1000;
    highestTeam = '';
  }

  syncStateToServer(unsoldEvent);
  render();
}

window.reAuctionPlayer = function(index) {
  const p = players[index];
  const name = val(p, 'Full Name', 'Name') || 'Player';

  if (getRawStatus(p) === 'SOLD') {
    showToast(`⚠️ SOLD players cannot be re-auctioned automatically.`, 'error');
    return;
  }

  saveStateSnapshot();
  p['Status'] = 'AVAILABLE';
  p['Team'] = '';
  p['Points'] = '';

  showToast(`🔄 ${name} returned to AVAILABLE pool`, 'success');
  addHistory(`${name} re-auctioned. Status reset to AVAILABLE.`);
  current = index;
  players[current]['Status'] = 'LIVE';
  biddingPoints = defaultBasePoints || 1000;
  highestTeam = '';
  auctionPhase = 'LIVE_AUCTION';
  closeAllModals();
  syncStateToServer();
  render();
};

let countdownBroadcastTimer = null;

function startCountdownBroadcast(isResume = false) {
  if (countdownBroadcastTimer) { clearTimeout(countdownBroadcastTimer); countdownBroadcastTimer = null; }
  auctionPhase = 'COUNTDOWN';
  broadcastOverlay = {
    type: 'COUNTDOWN',
    isResume,
    timestamp: Date.now()
  };
  showToast(`🎬 Countdown broadcast started!`, 'success');
  addHistory(`Admin triggered ${isResume ? 'resume' : 'start'} countdown broadcast.`);
  syncStateToServer();
  render();

  const stopBtn = document.getElementById('btnStopCountdown');
  const startBtn = document.getElementById('btnStartCountdown');
  if (stopBtn) stopBtn.style.display = '';
  if (startBtn) startBtn.style.display = 'none';

  countdownBroadcastTimer = setTimeout(() => {
    countdownBroadcastTimer = null;
    const sb = document.getElementById('btnStopCountdown');
    const stb = document.getElementById('btnStartCountdown');
    if (sb) sb.style.display = 'none';
    if (stb) stb.style.display = '';
    auctionPhase = 'LIVE_AUCTION';
    broadcastOverlay = null;
    activeSoldEvent = null;
    activeUnsoldEvent = null;
    syncStateToServer();
    render();
  }, 11500);
}

function stopCountdownBroadcast() {
  if (countdownBroadcastTimer) { clearTimeout(countdownBroadcastTimer); countdownBroadcastTimer = null; }
  const stopBtn = document.getElementById('btnStopCountdown');
  const startBtn = document.getElementById('btnStartCountdown');
  if (stopBtn) stopBtn.style.display = 'none';
  if (startBtn) startBtn.style.display = '';
  auctionPhase = 'LIVE_AUCTION';
  broadcastOverlay = null;
  showToast('⏹️ Countdown stopped.', 'info');
  addHistory('Admin stopped the 10s countdown broadcast.');
  syncStateToServer();
  render();
}

function startBreakMode() {
  auctionPhase = 'BREAK';
  // Always reset to 5 minutes when a fresh break is started
  breakSecondsRemaining = 300;
  breakIsRunning = true;
  breakIsNoTimer = false;
  broadcastOverlay = {
    type: 'BREAK',
    timestamp: Date.now()
  };
  showToast(`⏸ Auction placed on BREAK`, 'success');
  addHistory(`Admin placed auction on break.`);

  const m = $('breakModal');
  if (m) m.showModal();

  startBreakTimerInterval();
  syncStateToServer();
  render();
}

function startBreakTimerInterval() {
  if (breakTimerInterval) clearInterval(breakTimerInterval);
  breakTimerInterval = null;
  if (breakIsNoTimer || !breakIsRunning) return; // don't start if no-timer or already stopped
  breakTimerInterval = setInterval(() => {
    if (auctionPhase === 'BREAK' && breakIsRunning && !breakIsNoTimer) {
      if (breakSecondsRemaining > 0) {
        breakSecondsRemaining--;
        updateBreakTimerUI();
        syncStateToServer();
      } else {
        // Timer hit zero — stop
        breakIsRunning = false;
        clearInterval(breakTimerInterval);
        breakTimerInterval = null;
        updateBreakTimerUI();
        syncStateToServer();
      }
    }
  }, 1000);
}

function stopBreakTimer() {
  breakIsRunning = false;
  if (breakTimerInterval) {
    clearInterval(breakTimerInterval);
    breakTimerInterval = null;
  }
  updateBreakTimerUI();
  syncStateToServer();
  render();
}

function resetBreakTimer() {
  breakSecondsRemaining = 300;
  breakIsNoTimer = false;
  breakIsRunning = false;
  if (breakTimerInterval) {
    clearInterval(breakTimerInterval);
    breakTimerInterval = null;
  }
  updateBreakTimerUI();
  syncStateToServer();
  render();
}

function confirmEndAuction() {
  auctionPhase = 'AUCTION_COMPLETED';
  revealedTeamsInEnd = []; // DEFAULT: NO TEAMS SHOWN UNTIL ADMIN REVEALS THEM ONE BY ONE
  broadcastOverlay = {
    type: 'AUCTION_COMPLETED',
    timestamp: Date.now()
  };
  showToast(`⏹ PDJ TROPHY 2026 AUCTION COMPLETED!`, 'success');
  addHistory(`Admin officially ended the PDJ Trophy 2026 Auction.`);
  
  const dlg = $('endAuctionDialog');
  if (dlg) dlg.close();

  syncStateToServer();
  render();
}

function performFullAuctionReset() {
  saveStateSnapshot();
  
  // 1. Reset all player statuses to AVAILABLE, clear Team & Points, reset unsold_round
  players.forEach(p => {
    p['Status'] = 'AVAILABLE';
    p['Team'] = '';
    p['Points'] = '';
    p['unsold_round'] = 0;
    p['Auction Time'] = '';
  });

  // 2. Reset auction state variables
  current = 0;
  biddingPoints = 2000;
  highestTeam = '';
  activeSquadDisplay = null;
  activeRoleFilter = 'ALL';
  auctionPhase = 'PRE_AUCTION';
  breakSecondsRemaining = 300;
  breakIsRunning = false;
  breakIsNoTimer = false;
  broadcastOverlay = null;
    activeSoldEvent = null;
    activeUnsoldEvent = null;
  revealedTeamsInEnd = [];
  historyLog = [];
  undoStack = [];
  redoStack = [];

  // 3. Clear LocalStorage
  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  } catch (e) {}

  showToast('🗑️ Auction Work Reset Completed! Ready for new work/import.', 'success');
  addHistory('Admin performed full auction reset.');

  // 4. Sync reset state to Supabase database table and server disk file
  syncStateToServer();
  render();

  const dlg = $('resetAuctionDialog');
  if (dlg) dlg.close();
}

function setRoleFilter(newFilter) {
  activeRoleFilter = newFilter;
  let label = newFilter;
  if (newFilter === 'UNSOLD_1') label = 'UNSOLD ROUND 1';
  else if (newFilter === 'UNSOLD_2') label = 'UNSOLD ROUND 2';
  else if (newFilter === 'UNSOLD_3') label = 'UNSOLD ROUND 3';
  else if (newFilter === 'ALL') label = 'ALL ROLES';

  broadcastOverlay = {
    type: 'FILTER_TRANSITION',
    title: label,
    subtitle: newFilter.startsWith('UNSOLD') ? 'UNSOLD ROUND' : 'NOW SELECTING',
    timestamp: Date.now()
  };

  showToast(`🎯 Filter set to ${label}`, 'success');
  addHistory(`Admin set filter to ${label}. Broadcast transition sent.`);
  syncStateToServer();
  render();

  setTimeout(() => {
    if (broadcastOverlay && broadcastOverlay.type === 'FILTER_TRANSITION') {
      broadcastOverlay = null;
    activeSoldEvent = null;
    activeUnsoldEvent = null;
      syncStateToServer();
      render();
    }
  }, 2500);
}

function initEventListeners() {
  const photoFileInput = $('playerPhotoFileInput');
  if (photoFileInput) {
    photoFileInput.onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        saveStateSnapshot();
        const p = players[current];
        p['Upload Your Picture'] = ev.target.result;
        p.cached_image_url = ev.target.result;
        showToast(`📷 Updated photo for ${val(p, 'Full Name')}`, 'success');
        syncStateToServer();
        render();
      };
      reader.readAsDataURL(file);
    };
  }

  const openUrlBtn = $('openPlayerPhotoUrlBtn');
  if (openUrlBtn) {
    openUrlBtn.onclick = () => {
      const p = players[current];
      const currentUrl = val(p, 'Upload Your Picture', 'Picture', 'Photo', 'Image');
      const newUrl = prompt(`Enter Image URL or Google Drive link for ${val(p, 'Full Name')}:`, currentUrl);
      if (newUrl !== null) {
        saveStateSnapshot();
        p['Upload Your Picture'] = newUrl.trim();
        p.cached_image_url = newUrl.trim();
        showToast(`🔗 Updated photo URL for ${val(p, 'Full Name')}`, 'success');
        syncStateToServer();
        render();
      }
    };
  }

  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTheme = btn.dataset.theme || 'green';
      showToast(`🎨 Broadcast Theme set to ${currentTheme.toUpperCase()}`, 'success');
      addHistory(`Auctioneer changed broadcast accent theme to ${currentTheme.toUpperCase()}.`);
      syncStateToServer();
      render();
    };
  });

  const projSquadSelect = $('projectorSquadSelect');
  if (projSquadSelect) {
    projSquadSelect.onchange = e => {
      const team = e.target.value;
      activeSquadDisplay = team || null;
      if (team) {
        showToast(`📺 Broadcasting ${team} squad on Projector!`, 'success');
        addHistory(`Admin set Projector view to display ${team} squad.`);
      } else {
        broadcastOverlay = null;
    activeSoldEvent = null;
    activeUnsoldEvent = null;
        if (auctionPhase === 'PRE_AUCTION') auctionPhase = 'LIVE_AUCTION';
        showToast(`📺 Resumed Live Auction on Projector`, 'success');
        addHistory(`Admin resumed Live Auction view on Projector.`);
      }
      syncStateToServer();
      render();
    };
  }

  const resumeAuctionBtn = $('resumeAuctionBtn');
  if (resumeAuctionBtn) {
    resumeAuctionBtn.onclick = () => {
      activeSquadDisplay = null;
      broadcastOverlay = null;
    activeSoldEvent = null;
    activeUnsoldEvent = null;
      if (auctionPhase === 'PRE_AUCTION') auctionPhase = 'LIVE_AUCTION';
      if (projSquadSelect) projSquadSelect.value = '';
      showToast(`📺 Resumed Live Auction on Projector`, 'success');
      addHistory(`Admin resumed Live Auction view on Projector.`);
      syncStateToServer();
      render();
    };
  }

  // STAGE CONTROL BUTTON HANDLERS
  const btnPreAuction = $('btnPreAuction');
  if (btnPreAuction) {
    btnPreAuction.onclick = () => {
      auctionPhase = 'PRE_AUCTION';
      broadcastOverlay = {
        type: 'PRE_AUCTION',
        timestamp: Date.now()
      };
      showToast('⏳ Switched Projector to Pre-Auction Screen', 'success');
      addHistory('Admin switched projector to Pre-Auction screen.');
      syncStateToServer();
      render();
    };
  }

  const btnStartCountdown = $('btnStartCountdown');
  if (btnStartCountdown) btnStartCountdown.onclick = () => startCountdownBroadcast(false);

  const btnStopCountdown = $('btnStopCountdown');
  if (btnStopCountdown) btnStopCountdown.onclick = () => stopCountdownBroadcast();

  const btnStartBreak = $('btnStartBreak');
  if (btnStartBreak) btnStartBreak.onclick = () => startBreakMode();

  const btnEndAuction = $('btnEndAuction');
  if (btnEndAuction) {
    btnEndAuction.onclick = () => {
      const m = $('endAuctionDialog');
      if (m) m.showModal();
    };
  }

  const btnCancelEndAuction = $('btnCancelEndAuction');
  if (btnCancelEndAuction) {
    btnCancelEndAuction.onclick = () => {
      const m = $('endAuctionDialog');
      if (m) m.close();
    };
  }

  const closeEndAuctionModal = $('closeEndAuctionModal');
  if (closeEndAuctionModal) {
    closeEndAuctionModal.onclick = () => {
      const m = $('endAuctionDialog');
      if (m) m.close();
    };
  }

  const btnConfirmEndAuction = $('btnConfirmEndAuction');
  if (btnConfirmEndAuction) btnConfirmEndAuction.onclick = () => confirmEndAuction();

  // RESET AUCTION DIALOG LISTENERS
  const resetBtn = $('resetAuctionHeaderBtn');
  if (resetBtn) {
    resetBtn.onclick = () => {
      const dlg = $('resetAuctionDialog');
      if (dlg) dlg.showModal();
    };
  }

  const closeResetModal = $('closeResetAuctionModal');
  if (closeResetModal) {
    closeResetModal.onclick = () => {
      const dlg = $('resetAuctionDialog');
      if (dlg) dlg.close();
    };
  }

  const btnCancelReset = $('btnCancelResetAuction');
  if (btnCancelReset) {
    btnCancelReset.onclick = () => {
      const dlg = $('resetAuctionDialog');
      if (dlg) dlg.close();
    };
  }

  const btnConfirmReset = $('btnConfirmResetAuction');
  if (btnConfirmReset) {
    btnConfirmReset.onclick = () => performFullAuctionReset();
  }

  // DELETE ALL DATA DIALOG LISTENERS
  const deleteAllBtn = $('deleteAllDataBtn');
  if (deleteAllBtn) {
    deleteAllBtn.onclick = () => {
      const dlg = $('deleteAllDataModal');
      if (dlg) dlg.showModal();
    };
  }

  const closeDeleteAllModal = $('closeDeleteAllDataModal');
  if (closeDeleteAllModal) {
    closeDeleteAllModal.onclick = () => {
      const dlg = $('deleteAllDataModal');
      if (dlg) dlg.close();
    };
  }

  const btnCancelDeleteAll = $('btnCancelDeleteAllData');
  if (btnCancelDeleteAll) {
    btnCancelDeleteAll.onclick = () => {
      const dlg = $('deleteAllDataModal');
      if (dlg) dlg.close();
    };
  }

  const btnConfirmDeleteAll = $('btnConfirmDeleteAllData');
  if (btnConfirmDeleteAll) {
    btnConfirmDeleteAll.onclick = () => performDeleteAllData();
  }

  // BREAK MODAL ADJUSTMENT BUTTONS
  const closeBreakModal = $('closeBreakModal');
  if (closeBreakModal) {
    closeBreakModal.onclick = () => {
      const m = $('breakModal');
      if (m) m.close();
    };
  }

  const btnBreakSub1 = $('btnBreakSub1');
  if (btnBreakSub1) {
    btnBreakSub1.onclick = () => {
      breakIsNoTimer = false;
      breakSecondsRemaining = Math.max(60, breakSecondsRemaining - 60);
      breakIsRunning = true;
      startBreakTimerInterval();
      updateBreakTimerUI();
      syncStateToServer();
      render();
    };
  }

  const btnBreakAdd1 = $('btnBreakAdd1');
  if (btnBreakAdd1) {
    btnBreakAdd1.onclick = () => {
      breakIsNoTimer = false;
      breakSecondsRemaining += 60;
      breakIsRunning = true;
      startBreakTimerInterval();
      updateBreakTimerUI();
      syncStateToServer();
      render();
    };
  }

  const btnBreakAdd2 = $('btnBreakAdd2');
  if (btnBreakAdd2) {
    btnBreakAdd2.onclick = () => {
      breakIsNoTimer = false;
      breakSecondsRemaining += 120;
      breakIsRunning = true;
      startBreakTimerInterval();
      updateBreakTimerUI();
      syncStateToServer();
      render();
    };
  }

  const btnBreakAdd5 = $('btnBreakAdd5');
  if (btnBreakAdd5) {
    btnBreakAdd5.onclick = () => {
      breakIsNoTimer = false;
      breakSecondsRemaining += 300;
      breakIsRunning = true;
      startBreakTimerInterval();
      updateBreakTimerUI();
      syncStateToServer();
      render();
    };
  }

  const btnBreakNoTimer = $('btnBreakNoTimer');
  if (btnBreakNoTimer) {
    btnBreakNoTimer.onclick = () => {
      breakIsNoTimer = true;
      breakIsRunning = false;
      syncStateToServer();
      render();
    };
  }

  const btnResumeBreakCountdown = $('btnResumeBreakCountdown');
  if (btnResumeBreakCountdown) {
    btnResumeBreakCountdown.onclick = () => {
      const m = $('breakModal');
      if (m) m.close();
      startCountdownBroadcast(true);
    };
  }

  const btnBreakStop = $('btnBreakStop');
  if (btnBreakStop) {
    btnBreakStop.onclick = () => stopBreakTimer();
  }

  const btnBreakReset = $('btnBreakReset');
  if (btnBreakReset) {
    btnBreakReset.onclick = () => resetBreakTimer();
  }

  document.querySelectorAll('.role-filter-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.role-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setRoleFilter(btn.dataset.role);

      const matchingIdx = players.findIndex(p => matchesActiveRole(p));
      if (matchingIdx !== -1) {
        if (soldTransitionTimer) { clearTimeout(soldTransitionTimer); soldTransitionTimer = null; }
        if (unsoldTransitionTimer) { clearTimeout(unsoldTransitionTimer); unsoldTransitionTimer = null; }
        current = matchingIdx;
        activeSquadDisplay = null;
        broadcastOverlay = null;
        activeSoldEvent = null;
        activeUnsoldEvent = null;
        if (auctionPhase === 'PRE_AUCTION') auctionPhase = 'LIVE_AUCTION';
        biddingPoints = defaultBasePoints || 1000;
        highestTeam = '';
      }

      syncStateToServer();
      render();
    };
  });

  const prevBtn = $('prev');
  if (prevBtn) {
    prevBtn.onclick = () => {
      if (soldTransitionTimer) { clearTimeout(soldTransitionTimer); soldTransitionTimer = null; }
      if (unsoldTransitionTimer) { clearTimeout(unsoldTransitionTimer); unsoldTransitionTimer = null; }
      saveStateSnapshot();
      let nextIdx = (current - 1 + players.length) % players.length;
      let count = 0;
      while (count < players.length && !matchesActiveRole(players[nextIdx])) {
        nextIdx = (nextIdx - 1 + players.length) % players.length;
        count++;
      }
      current = nextIdx;
      activeSquadDisplay = null;
      broadcastOverlay = null;
      activeSoldEvent = null;
      activeUnsoldEvent = null;
      if (auctionPhase === 'PRE_AUCTION') auctionPhase = 'LIVE_AUCTION';
      biddingPoints = defaultBasePoints || 1000;
      highestTeam = '';
      syncStateToServer();
      render();
    };
  }

  const nextBtn = $('next');
  if (nextBtn) {
    nextBtn.onclick = () => {
      if (soldTransitionTimer) { clearTimeout(soldTransitionTimer); soldTransitionTimer = null; }
      if (unsoldTransitionTimer) { clearTimeout(unsoldTransitionTimer); unsoldTransitionTimer = null; }
      saveStateSnapshot();
      let nextIdx = (current + 1) % players.length;
      let count = 0;
      while (count < players.length && !matchesActiveRole(players[nextIdx])) {
        nextIdx = (nextIdx + 1) % players.length;
        count++;
      }
      current = nextIdx;
      activeSquadDisplay = null;
      broadcastOverlay = null;
    activeSoldEvent = null;
    activeUnsoldEvent = null;
      if (auctionPhase === 'PRE_AUCTION') auctionPhase = 'LIVE_AUCTION';
      biddingPoints = defaultBasePoints || 1000;
      highestTeam = '';
      syncStateToServer();
      render();
    };
  }

  const randBtn = $('randomPickBtn');
  if (randBtn) randBtn.onclick = () => pickRandomPlayer();

  const searchInput = $('adminPlayerSearchInput');
  if (searchInput) {
    const handleSearchSelect = valText => {
      if (!valText) return;
      const match = valText.match(/\[#(\d+)\]/);
      if (match && match[1]) {
        const targetIdx = parseInt(match[1]) - 1;
        if (targetIdx >= 0 && targetIdx < players.length) {
          selectPlayerForAuction(targetIdx);
          searchInput.value = '';
          return true;
        }
      } else {
        const query = valText.trim().toLowerCase();
        if (query) {
          const foundIdx = players.findIndex(p => {
            const nm = (val(p, 'Full Name', 'Name') || '').toLowerCase();
            const id = (val(p, 'CricHeroes Account No', 'CricHeroes ID') || '').toLowerCase();
            return nm.includes(query) || id.includes(query);
          });
          if (foundIdx !== -1) {
            selectPlayerForAuction(foundIdx);
            searchInput.value = '';
            return true;
          }
        }
      }
      return false;
    };

    searchInput.oninput = e => {
      const v = e.target.value;
      if (v && v.includes('[#')) {
        handleSearchSelect(v);
      }
    };
    searchInput.onchange = e => handleSearchSelect(e.target.value);
    searchInput.onkeydown = e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSearchSelect(e.target.value);
      }
    };
  }

  const unsoldBtn = $('markUnsoldBtn');
  if (unsoldBtn) {
    unsoldBtn.onclick = () => markUnsold();
  }

  const cancelUnsoldDialog = $('cancelUnsoldDialog');
  if (cancelUnsoldDialog) {
    cancelUnsoldDialog.onclick = () => {
      const dlg = $('confirmUnsoldDialog');
      if (dlg) dlg.close();
    };
  }

  const closeUnsoldConfirmDialog = $('closeUnsoldConfirmDialog');
  if (closeUnsoldConfirmDialog) {
    closeUnsoldConfirmDialog.onclick = () => {
      const dlg = $('confirmUnsoldDialog');
      if (dlg) dlg.close();
    };
  }

  const unsoldForm = $('unsoldForm');
  if (unsoldForm) {
    unsoldForm.onsubmit = e => {
      e.preventDefault();
      markUnsold();
      const dlg = $('confirmUnsoldDialog');
      if (dlg) dlg.close();
    };
  }

  function handleBidIncrement(pts) {
    const p = players[current];
    if (!p) return;
    const status = getRawStatus(p);
    if (status !== 'LIVE' && status !== 'AVAILABLE') return;
    saveStateSnapshot();
    biddingPoints = (biddingPoints || defaultBasePoints || 1000) + pts;
    syncStateToServer();
    render();
  }

  function handleSellAction() {
    const p = players[current];
    if (!p) return;
    const status = getRawStatus(p);
    if (status !== 'LIVE' && status !== 'AVAILABLE') return;
    if (!highestTeam) {
      showToast('⚠️ SELECT A TEAM FIRST', 'warning');
      return;
    }
    handleConfirmSale(highestTeam, biddingPoints);
  }

  function handleUnsoldAction() {
    const p = players[current];
    if (!p) return;
    const status = getRawStatus(p);
    if (status === 'SOLD') {
      showToast('⚠️ Cannot mark SOLD player as unsold.', 'error');
      return;
    }
    markUnsold();
  }

  function triggerBidStep(pts) {
    handleBidIncrement(pts);
  }

  function triggerDirectOrModalSell() {
    handleSellAction();
  }

  const sellBtn = $('sellPlayerDirectBtn');
  if (sellBtn) sellBtn.onclick = triggerDirectOrModalSell;

  const cancelSellDialog = $('cancelSellDialog');
  if (cancelSellDialog) {
    cancelSellDialog.onclick = () => {
      const dlg = $('teamDialog');
      if (dlg) dlg.close();
    };
  }

  const undoBtn = $('undoBtn');
  if (undoBtn) undoBtn.onclick = () => undoLastAction();

  const undoBidBtn = $('undoBidBtn');
  if (undoBidBtn) undoBidBtn.onclick = () => undoLastAction();

  const redoBtn = $('redoBtn');
  if (redoBtn) redoBtn.onclick = () => redoNextAction();

  // BASE POINTS SETTING INPUT LISTENERS
  const basePtsInput = $('basePointsSettingInput');
  const saveBasePtsBtn = $('saveBasePointsBtn');

  function updateBasePointsSetting(newVal) {
    const parsed = parseInt(newVal);
    if (isNaN(parsed) || parsed < 0) {
      showToast('⚠️ Invalid Base Points value', 'error');
      return;
    }
    saveStateSnapshot();
    defaultBasePoints = parsed;

    // Only update current bid if player is currently AVAILABLE (not mid-auction live bid)
    const p = players[current];
    if (!p || getRawStatus(p) === 'AVAILABLE') {
      biddingPoints = defaultBasePoints;
    }

    showToast(`⚙️ Auction Base Points updated to ${defaultBasePoints} PTS!`, 'success');
    addHistory(`Admin changed default auction base points to ${defaultBasePoints} PTS.`);
    syncStateToServer();
    render();
  }

  if (saveBasePtsBtn) {
    saveBasePtsBtn.onclick = () => {
      if (basePtsInput) updateBasePointsSetting(basePtsInput.value);
    };
  }
  if (basePtsInput) {
    basePtsInput.onchange = () => {
      updateBasePointsSetting(basePtsInput.value);
    };
  }

  document.querySelectorAll('.bid-btn').forEach(btn => {
    btn.onclick = () => {
      const pts = parseInt(btn.dataset.pts) || 0;
      handleBidIncrement(pts);
    };
  });

  const customPtsInput = $('customPointsInput');
  if (customPtsInput) {
    customPtsInput.onchange = e => {
      const valInput = parseInt(e.target.value);
      if (isNaN(valInput) || valInput <= biddingPoints) {
        showToast(`INVALID BID — Bid must be higher than current points (${biddingPoints} PTS).`, 'error');
        e.target.value = biddingPoints + 100;
        return;
      }
      saveStateSnapshot();
      biddingPoints = valInput;
      syncStateToServer();
      render();
    };
  }

  const openProjBtn = $('openProjectorBtn');
  if (openProjBtn) {
    openProjBtn.onclick = () => window.open('projector.html', '_blank');
  }

  const exportBtn = $('downloadExcelHeaderBtn');
  if (exportBtn) {
    exportBtn.onclick = () => downloadMasterExcel();
  }

  const openCreateTeamModal = () => {
    const dlg = $('createTeamDialog');
    if (dlg) dlg.showModal();
  };

  const openManageTeamsModal = () => {
    const dlg = $('teamSettingsModal');
    if (dlg) dlg.showModal();
  };

  const headerCreateTeamBtn = $('headerCreateTeamBtn');
  if (headerCreateTeamBtn) headerCreateTeamBtn.onclick = openCreateTeamModal;

  const modalCreateTeamBtn = $('modalCreateTeamBtn');
  if (modalCreateTeamBtn) modalCreateTeamBtn.onclick = openCreateTeamModal;

  const modalManageTeamsBtn = $('modalManageTeamsBtn');
  if (modalManageTeamsBtn) modalManageTeamsBtn.onclick = openManageTeamsModal;

  const addTeamBtn = $('addNewTeamBtn');
  if (addTeamBtn) addTeamBtn.onclick = openCreateTeamModal;

  const closeCreateTeam = $('closeCreateTeamDialog');
  if (closeCreateTeam) {
    closeCreateTeam.onclick = () => {
      const dlg = $('createTeamDialog');
      if (dlg) dlg.close();
    };
  }

  const createTeamForm = $('createTeamForm');
  if (createTeamForm) {
    createTeamForm.onsubmit = async e => {
      e.preventDefault();
      const name = $('newTeamName') ? $('newTeamName').value.trim() : '';
      let logoUrl = $('newTeamLogo') ? $('newTeamLogo').value.trim() : '';
      const logoFileInput = $('newTeamLogoFile');
      const limit = parseInt($('newTeamLimit') ? $('newTeamLimit').value : '') || 20000;
      const maxP = parseInt($('newTeamMaxPlayers') ? $('newTeamMaxPlayers').value : '') || 11;

      if (!name) return;

      if (logoFileInput && logoFileInput.files && logoFileInput.files[0]) {
        logoUrl = await new Promise(resolve => {
          const reader = new FileReader();
          reader.onload = ev => resolve(ev.target.result);
          reader.readAsDataURL(logoFileInput.files[0]);
        });
      }

      teamsConfig[name] = { logoUrl, pointLimit: limit, maxPlayers: maxP };
      showToast(`🛡️ Created team "${name}" successfully!`, 'success');
      addHistory(`Created new team ${name} with ${limit} PTS limit.`);
      
      safeSetVal('newTeamName', '');
      safeSetVal('newTeamLogo', '');
      if (logoFileInput) logoFileInput.value = '';
      const dlg = $('createTeamDialog');
      if (dlg) dlg.close();
      
      syncStateToServer();
      render();
    };
  }

  const transferBtn = $('transferBtn');
  if (transferBtn) transferBtn.onclick = triggerDirectOrModalSell;

  const closeTeamDlg = $('closeTeamDialog');
  if (closeTeamDlg) {
    closeTeamDlg.onclick = () => {
      const dlg = $('teamDialog');
      if (dlg) dlg.close();
    };
  }

  const teamForm = $('teamForm');
  if (teamForm) {
    teamForm.onsubmit = e => {
      e.preventDefault();
      const team = $('teamSelect') ? $('teamSelect').value.trim() : '';
      const points = parseInt($('finalPointsInput') ? $('finalPointsInput').value : '') || 2000;

      if (!team) {
        if ($('teamSelect')) $('teamSelect').focus();
        return;
      }

      const ok = handleConfirmSale(team, points);
      if (ok) {
        const dlg = $('teamDialog');
        if (dlg) dlg.close();
      }
    };
  }

  // TEAM CORRECTION FORM SUBMISSION
  const cancelEditTeamDialog = $('cancelEditTeamDialog');
  if (cancelEditTeamDialog) {
    cancelEditTeamDialog.onclick = () => {
      const dlg = $('editTeamDialog');
      if (dlg) dlg.close();
    };
  }

  const closeEditTeamDialog = $('closeEditTeamDialog');
  if (closeEditTeamDialog) {
    closeEditTeamDialog.onclick = () => {
      const dlg = $('editTeamDialog');
      if (dlg) dlg.close();
    };
  }

  const editTeamForm = $('editTeamForm');
  if (editTeamForm) {
    editTeamForm.onsubmit = e => {
      e.preventDefault();
      if (editingPlayerIndex === null || editingPlayerIndex === undefined) return;
      const p = players[editingPlayerIndex];
      const oldTeam = val(p, 'Team', 'Transferred Team');
      const newTeam = $('editTeamSelectInput') ? $('editTeamSelectInput').value.trim() : '';

      if (!newTeam) return;

      saveStateSnapshot();
      p['Team'] = newTeam;
      const name = val(p, 'Full Name', 'Name');
      addHistory(`${name} TEAM CORRECTION: ${oldTeam || 'Unassigned'} → ${newTeam}`);
      showToast(`Team corrected successfully for ${name}`, 'success');

      const dlg = $('editTeamDialog');
      if (dlg) dlg.close();

      syncStateToServer();
      render();
    };
  }

  // TOP NAVIGATION TAB HANDLERS
  const viewDeskBtn = $('viewDeskBtn');
  if (viewDeskBtn) {
    viewDeskBtn.onclick = () => {
      closeAllModals();
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      viewDeskBtn.classList.add('active');
      activeRoleFilter = 'ALL';
      const mainBoard = $('adminControlBoard');
      if (mainBoard) mainBoard.scrollIntoView({ behavior: 'smooth' });
      render();
    };
  }

  const vAvail = $('viewAvailableBtn');
  if (vAvail) {
    vAvail.onclick = () => {
      closeAllModals();
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      vAvail.classList.add('active');
      const m = $('availableModal');
      if (m) m.showModal();
    };
  }

  const vSold = $('viewSoldBtn');
  if (vSold) {
    vSold.onclick = () => {
      closeAllModals();
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      vSold.classList.add('active');
      const m = $('soldModal');
      if (m) m.showModal();
    };
  }

  const vUnsold = $('viewUnsoldBtn');
  if (vUnsold) {
    vUnsold.onclick = () => {
      closeAllModals();
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      vUnsold.classList.add('active');
      const m = $('unsoldModal');
      if (m) m.showModal();
    };
  }

  const vTeams = $('viewTeamsBtn');
  if (vTeams) {
    vTeams.onclick = () => {
      closeAllModals();
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      vTeams.classList.add('active');
      const m = $('teamsModal');
      if (m) m.showModal();
    };
  }

  const vHist = $('viewHistoryBtn');
  if (vHist) {
    vHist.onclick = () => {
      closeAllModals();
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      vHist.classList.add('active');
      const m = $('historyModal');
      if (m) m.showModal();
    };
  }

  const cAvail = $('closeAvailableModal'); if (cAvail) cAvail.onclick = () => { const m = $('availableModal'); if (m) m.close(); };
  const cSold = $('closeSoldModal'); if (cSold) cSold.onclick = () => { const m = $('soldModal'); if (m) m.close(); };
  const cUnsold = $('closeUnsoldModal'); if (cUnsold) cUnsold.onclick = () => { const m = $('unsoldModal'); if (m) m.close(); };
  const cTeams = $('closeTeamsModal'); if (cTeams) cTeams.onclick = () => { const m = $('teamsModal'); if (m) m.close(); };
  const cTeamSet = $('closeTeamSettingsModal'); if (cTeamSet) cTeamSet.onclick = () => { const m = $('teamSettingsModal'); if (m) m.close(); };
  const cHist = $('closeHistoryModal'); if (cHist) cHist.onclick = () => { const m = $('historyModal'); if (m) m.close(); };

  const headerInput = $('fileInputHeader');
  if (headerInput) headerInput.onchange = e => handleFileUpload(e.target.files[0]);

  // FAST AUCTION KEYBOARD SHORTCUT LISTENERS (WINDOW LEVEL)
  window.addEventListener('keydown', e => {
    if (e.repeat) return; // Ignore key repeat to prevent double firing

    const target = e.target;
    const tag = (target && target.tagName ? target.tagName.toUpperCase() : '');
    const isEditable = target && (target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');
    if (isEditable) return; // Do not trigger shortcuts while operator is typing into an input field

    if (e.ctrlKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undoLastAction();
      return;
    } else if (e.ctrlKey && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redoNextAction();
      return;
    }

    const key = e.key;
    if (key === '1') {
      e.preventDefault();
      handleBidIncrement(100);
    } else if (key === '2') {
      e.preventDefault();
      handleBidIncrement(200);
    } else if (key === '3') {
      e.preventDefault();
      handleBidIncrement(500);
    } else if (key === '4') {
      e.preventDefault();
      handleBidIncrement(1000);
    } else if (key === '5') {
      e.preventDefault();
      handleBidIncrement(2000);
    } else if (key.toLowerCase() === 's') {
      e.preventDefault();
      handleSellAction();
    } else if (key.toLowerCase() === 'u') {
      e.preventDefault();
      handleUnsoldAction();
    } else if (key.toLowerCase() === 'z' && !e.ctrlKey) {
      e.preventDefault();
      undoLastAction();
    }
  });
}

function handleFileUpload(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = event => {
    try {
      let rows;
      if (file.name.toLowerCase().endsWith('.csv')) {
        const [header, ...lines] = event.target.result.trim().split(/\r?\n/);
        const keys = header.split(',').map(x => x.trim());
        rows = lines.map(line => Object.fromEntries(line.split(',').map((x, i) => [keys[i], x.trim()])));
      } else {
        if (!window.XLSX) throw Error('Excel reader library unavailable.');
        const book = XLSX.read(event.target.result, { type: 'array' });
        rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: '' });
      }

      if (!rows.length) throw Error('No player rows found in file.');

      players = rows.map(row => ({
        ...row,
        Status: getRawStatus(row),
        Team: val(row, 'Team', 'Transferred Team'),
        Points: val(row, 'Points', 'Final Points'),
        unsold_round: getPlayerUnsoldRound(row)
      }));

      current = 0;
      biddingPoints = 2000;
      highestTeam = '';
      auctionPhase = 'PRE_AUCTION';
      addHistory(`Loaded ${players.length} players from ${file.name}.`);
      showToast(`📥 Successfully imported ${players.length} players!`, 'success');
      syncStateToServer();
      render();
    } catch (err) {
      alert('Could not import file: ' + err.message);
    }
  };

  file.name.toLowerCase().endsWith('.csv') ? reader.readAsText(file) : reader.readAsArrayBuffer(file);
}

// INITIALIZATION LOGIC (SUPABASE, SERVER, & LOCALSTORAGE)
async function initAuctionState() {
  let loaded = false;

  try {
    const res = await fetch('/api/state');
    const data = await res.json();
    if (data && Array.isArray(data.players) && data.players.length > 0) {
      players = data.players;
      current = data.current || 0;
      defaultBasePoints = data.defaultBasePoints || 1000;
      biddingPoints = data.biddingPoints || defaultBasePoints || 1000;
      highestTeam = data.highestTeam || '';
      teamsConfig = data.teamsConfig || teamsConfig;
      historyLog = data.historyLog || [];
      activeSquadDisplay = data.activeSquadDisplay || null;
      currentTheme = data.theme_color || 'green';
      auctionPhase = data.auctionPhase || 'PRE_AUCTION';
      breakSecondsRemaining = data.breakSecondsRemaining || 300;
      breakIsRunning = data.breakIsRunning || false;
      breakIsNoTimer = data.breakIsNoTimer || false;
      broadcastOverlay = data.broadcastOverlay || null;
      loaded = true;
    }
  } catch (e) {
    console.warn('Could not fetch server state, falling back to LocalStorage', e);
  }

  if (!loaded) {
    loaded = loadFromLocalStorage();
  }

  if (!loaded) {
    players = [...sample];
  }

  initEventListeners();
  render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuctionState);
} else {
  initAuctionState();
}
