// ========================================================
// overlay.js - PDJ Trophy 2026 YouTube Lower-Third Overlay
// ========================================================

const SUPABASE_URL = "https://irxxmqfpokfbwxmueles.supabase.co";
const SUPABASE_KEY = "sb_publishable_PDDDQPtT2swFOw_8WL3UPQ_B-iF-4DQ";

let supabaseClient = null;
let projChannel = null;
let lastUpdateTimestamp = 0;
let isDebug = false;

// Caches for preloaded images
const imageCache = new Map();

// DOM Elements
const lowerThird = document.getElementById('lower-third');
const waitingState = document.getElementById('waiting-state');

// Cards
const biddingCard = document.getElementById('bidding-card');
const soldCard = document.getElementById('sold-card');
const unsoldCard = document.getElementById('unsold-card');

// Helper: Get DOM element
const $ = id => document.getElementById(id);

// ----------------------------------------------------
// INITIALIZATION
// ----------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  if (window.supabase) {
    try {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      console.log("📺 Overlay Supabase Client initialized.");
      initSupabaseRealtimeSync();
    } catch (e) {
      console.error("Supabase init error:", e);
    }
  }

  // Debug toggle
  document.addEventListener('keydown', e => {
    if (e.key.toLowerCase() === 'd') {
      isDebug = !isDebug;
      $('debug-panel').style.display = isDebug ? 'block' : 'none';
    }
  });

  // Fetch initial state via REST fallback
  fetchInitialState();
});

function updateDebug(state, conn) {
  if (state) $('dbg-state').innerText = state;
  if (conn) $('dbg-conn').innerText = conn;
  $('dbg-time').innerText = new Date().toLocaleTimeString();
}

async function fetchInitialState() {
  try {
    const res = await fetch('/api/state');
    if (res.ok) {
      const data = await res.json();
      if (isNewerState(data)) {
        renderOverlay(data);
      }
    } else if (supabaseClient) {
      // Fallback to Supabase
      const { data, error } = await supabaseClient.from('auction_state').select('*').eq('id', 1).single();
      if (data && data.state_data && isNewerState(data.state_data)) {
        renderOverlay(data.state_data);
      }
    }
  } catch (e) {
    console.warn("Initial fetch failed:", e);
  }
}

// ----------------------------------------------------
// SUPABASE REALTIME SYNC (SINGLE STABLE SUBSCRIPTION)
// ----------------------------------------------------
function initSupabaseRealtimeSync() {
  if (!supabaseClient) return;

  try {
    if (projChannel) {
      supabaseClient.removeChannel(projChannel);
    }
    projChannel = supabaseClient.channel('scpl_auction_room');
    
    // 1. BROADCAST EVENT LISTENER (Instant updates)
    projChannel.on('broadcast', { event: 'state_update' }, ({ payload }) => {
      if (payload && isNewerState(payload)) {
        if (isOnlyBidUpdate(currentState, payload)) {
          updateLiveBidOnly(payload);
        } else {
          renderOverlay(payload);
        }
        updateDebug(null, 'LIVE (Broadcast)');
      }
    });

    // 2. POSTGRES CHANGES LISTENER (Persistence)
    projChannel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'auction_state' }, payload => {
      if (payload && payload.new) {
        if (payload.new.state_data && isNewerState(payload.new.state_data)) {
          const sd = payload.new.state_data;
          if (isOnlyBidUpdate(currentState, sd)) {
            updateLiveBidOnly(sd);
          } else {
            renderOverlay(sd);
          }
          updateDebug(null, 'LIVE (Postgres)');
        }
      }
    });

    projChannel.subscribe((status, err) => {
      console.log('Overlay Realtime Status:', status);
      if (status === 'SUBSCRIBED') {
        updateDebug(null, 'CONNECTED');
      } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED' || status === 'TIMED_OUT') {
        updateDebug(null, 'DISCONNECTED - Reconnecting...');
        setTimeout(() => {
          supabaseClient.removeChannel(projChannel);
          initSupabaseRealtimeSync();
        }, 5000);
      }
    });
  } catch (e) {
    console.warn("Realtime init failed:", e);
  }
}

let lastProcessedTimestamp = 0;
let currentState = null;

function isNewerState(newState) {
  if (!newState) return false;
  if (!currentState) return true;
  
  // If the admin selected a different player or changed bidding/phase, ALWAYS accept immediately!
  if (
    currentState.current !== newState.current ||
    currentState.biddingPoints !== newState.biddingPoints ||
    currentState.highestTeam !== newState.highestTeam ||
    currentState.auctionPhase !== newState.auctionPhase ||
    currentState.soldAnimationEvent !== newState.soldAnimationEvent ||
    currentState.unsoldAnimationEvent !== newState.unsoldAnimationEvent ||
    currentState.broadcastOverlay !== newState.broadcastOverlay ||
    currentState.activeSquadDisplay !== newState.activeSquadDisplay
  ) {
    const ts = newState.lastUpdated || newState.timestamp || (newState.last_updated ? new Date(newState.last_updated).getTime() : 0);
    if (ts) lastProcessedTimestamp = ts;
    return true;
  }

  const ts = newState.lastUpdated || newState.timestamp || (newState.last_updated ? new Date(newState.last_updated).getTime() : 0);
  if (ts && ts <= lastProcessedTimestamp) return false;
  if (ts) lastProcessedTimestamp = ts;
  return true;
}

function isOnlyBidUpdate(oldState, newState) {
  if (!oldState || !newState) return false;
  if (oldState.current !== newState.current) return false;
  if (oldState.soldAnimationEvent !== newState.soldAnimationEvent) return false;
  if (oldState.unsoldAnimationEvent !== newState.unsoldAnimationEvent) return false;
  if (oldState.auctionPhase !== newState.auctionPhase) return false;
  if (oldState.broadcastOverlay !== newState.broadcastOverlay) return false;
  if (oldState.activeSquadDisplay !== newState.activeSquadDisplay) return false;
  return oldState.biddingPoints !== newState.biddingPoints;
}

function updateLiveBidOnly(state) {
  if (!state) return;
  currentState = state;
  const currentPts = state.biddingPoints || state.defaultBasePoints || 1000;
  
  if (lastBidValue !== currentPts) {
    const bidEl = $('bidding-points');
    if (bidEl) {
      const boxEl = bidEl.parentElement;
      bidEl.innerText = Number(currentPts).toLocaleString() + ' PTS';
      
      // Animate flash
      boxEl.classList.remove('flash');
      void boxEl.offsetWidth; // trigger reflow
      boxEl.classList.add('flash');
    }
    lastBidValue = currentPts;
  }
}

// ----------------------------------------------------
// UTILITIES (Imported from existing system)
// ----------------------------------------------------
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

function getTeamLogo(teamsConfig, teamName) {
  if (!teamsConfig || !teamName) return '';
  const trimmed = teamName.trim().toLowerCase();
  if (teamsConfig[teamName] && teamsConfig[teamName].logoUrl) return drivePhoto(teamsConfig[teamName].logoUrl);
  const match = Object.entries(teamsConfig).find(([k]) => k.trim().toLowerCase() === trimmed);
  return (match && match[1] && match[1].logoUrl) ? drivePhoto(match[1].logoUrl) : '';
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

function preloadImage(url) {
  if (!url || imageCache.has(url)) return;
  const img = new Image();
  img.src = url;
  imageCache.set(url, true);
}

// ----------------------------------------------------
// RENDERING LOGIC
// ----------------------------------------------------
let currentActiveCard = null;

let countdownTimerInterval = null;
let currentCountdownId = null;

function startCountdownAnimation(isResume = false, timestamp = 0) {
  const countdownOverlay = $('countdown-overlay');
  const numEl = $('countdown-number');
  const labelEl = $('countdown-title');
  const bannerEl = $('countdown-banner');

  if (!countdownOverlay || !numEl) return;
  
  if (labelEl) labelEl.textContent = isResume ? 'AUCTION RESUMES IN' : 'AUCTION BEGINS IN';

  const startTs = timestamp || Date.now();
  const countdownId = startTs + '_' + (isResume ? 'resume' : 'start');
  if (currentCountdownId === countdownId && countdownTimerInterval) {
    return;
  }
  currentCountdownId = countdownId;

  if (bannerEl) bannerEl.style.display = 'none';

  const totalDuration = 10;
  const endTime = startTs + totalDuration * 1000;

  if (countdownTimerInterval) clearInterval(countdownTimerInterval);

  const updateTick = () => {
    const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
    if (remaining > 0) {
      numEl.textContent = remaining;
    } else {
      numEl.textContent = '0';
      if (bannerEl) {
        bannerEl.textContent = isResume ? "LET'S CONTINUE!" : "LET'S BEGIN!";
        bannerEl.style.display = 'block';
      }
      clearInterval(countdownTimerInterval);
      setTimeout(() => {
        countdownOverlay.style.display = 'none';
        currentCountdownId = null;
      }, 1800);
    }
  };

  updateTick();
  countdownTimerInterval = setInterval(updateTick, 100);
}

function renderOverlay(state) {
  if (!state) return;
  currentState = state;

  const phase = state.auctionPhase || 'PRE_AUCTION';
  const players = state.players || [];
  const current = state.current || 0;
  
  updateDebug(phase, null);

  // Status Overlays
  const breakOverlay = $('break-overlay');
  const countdownOverlay = $('countdown-overlay');
  const completedOverlay = $('completed-overlay');
  
  breakOverlay.style.display = 'none';
  countdownOverlay.style.display = 'none';
  completedOverlay.style.display = 'none';
  waitingState.style.display = 'none';
  const showcaseOverlay = $('showcase-overlay');
  if (showcaseOverlay) showcaseOverlay.style.display = 'none';

  if (state.activeSquadDisplay) {
    lowerThird.classList.remove('visible');
    if (showcaseOverlay) {
      showcaseOverlay.style.display = 'flex';
      const teamName = state.activeSquadDisplay;
      const cfg = (state.teamsConfig && state.teamsConfig[teamName]) || {};
      const logoUrl = cfg.logoUrl ? drivePhoto(cfg.logoUrl) : '';
      const scTitle = $('showcase-title');
      if (scTitle) scTitle.innerText = teamName.toUpperCase() + ' SQUAD';
      const scLogo = $('showcase-logo');
      if (scLogo) {
        if (logoUrl) {
          scLogo.src = logoUrl;
          scLogo.style.display = 'block';
        } else {
          scLogo.style.display = 'none';
        }
      }
    }
    return;
  }

  // Check state priority matching Projector
  if (state.broadcastOverlay && state.broadcastOverlay.type === 'COUNTDOWN') {
    lowerThird.classList.remove('visible');
    countdownOverlay.style.display = 'flex';
    startCountdownAnimation(state.broadcastOverlay.isResume, state.broadcastOverlay.timestamp);
    return;
  }

  if (phase === 'AUCTION_COMPLETED') {
    lowerThird.classList.remove('visible');
    completedOverlay.style.display = 'flex';
    return;
  }

  if (phase === 'BREAK') {
    lowerThird.classList.remove('visible');
    breakOverlay.style.display = 'flex';
    const timerEl = $('break-timer');
    const msgEl = $('break-message');
    if (state.breakIsNoTimer) {
      timerEl.innerText = 'OPEN BREAK';
      msgEl.innerText = 'AUCTION WILL RESUME SHORTLY';
    } else {
      const seconds = state.breakSecondsRemaining || 0;
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      timerEl.innerText = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      msgEl.innerText = 'AUCTION RESUMES WHEN TIMER COMPLETES';
    }
    return;
  }

  if (phase === 'PRE_AUCTION') {
    lowerThird.classList.remove('visible');
    waitingState.style.display = 'block';
    return;
  }

  // 1. Check for frozen immutable SOLD/UNSOLD snapshots first!
  // (These take absolute priority and must ignore state.current)
  if (state.soldAnimationEvent && (Date.now() - (state.soldAnimationEvent.timestamp || 0) < 3500)) {
    renderSoldSnapshot(state.soldAnimationEvent);
    const remTime = Math.max(100, 3000 - (Date.now() - (state.soldAnimationEvent.timestamp || 0)));
    setTimeout(() => {
      if (currentState && currentState.soldAnimationEvent && (Date.now() - (currentState.soldAnimationEvent.timestamp || 0) >= 3000)) {
        currentState.soldAnimationEvent = null;
        render(currentState);
      }
    }, remTime);
    return;
  }

  if (state.unsoldAnimationEvent && (Date.now() - (state.unsoldAnimationEvent.timestamp || 0) < 3500)) {
    renderUnsoldSnapshot(state.unsoldAnimationEvent);
    const remTime = Math.max(100, 3000 - (Date.now() - (state.unsoldAnimationEvent.timestamp || 0)));
    setTimeout(() => {
      if (currentState && currentState.unsoldAnimationEvent && (Date.now() - (currentState.unsoldAnimationEvent.timestamp || 0) >= 3000)) {
        currentState.unsoldAnimationEvent = null;
        render(currentState);
      }
    }, remTime);
    return;
  }

  // 2. If no animation event, render normal bidding view
  if (players.length > 0 && current >= 0 && current < players.length) {
    const player = players[current];
    const status = getRawStatus(player);
    
    if (status === 'SOLD') {
      renderStaticSoldCard(player);
    } else if (status === 'UNSOLD') {
      renderStaticUnsoldCard(player);
    } else if (status === 'AVAILABLE' || status === 'LIVE') {
      renderBiddingCard(player, state.biddingPoints || 1000);
      
      // Preload next player image safely
      if (current + 1 < players.length) {
        const nextP = players[current + 1];
        const nextRaw = val(nextP, 'Upload Your Picture', 'Picture', 'Photo', 'Image', 'cached_image_url', 'original_image_url') || nextP.cached_image_url || nextP.original_image_url;
        preloadImage(drivePhoto(nextRaw));
      }
    } else {
      // If the player is already sold/unsold but there is no animation event, hide lower third
      lowerThird.classList.remove('visible');
    }
  } else {
    lowerThird.classList.remove('visible');
  }
}

// ----------------------------------------------------
// RENDER SPECIFIC CARDS
// ----------------------------------------------------
function switchCard(cardElement) {
  biddingCard.classList.remove('active');
  soldCard.classList.remove('active');
  unsoldCard.classList.remove('active');
  
  cardElement.classList.add('active');
  currentActiveCard = cardElement;
  lowerThird.classList.add('visible');
}

function handleImageFallback(imgElement, url) {
  if (url) {
    // Prevent setting the same src again if already loaded to avoid flickering
    if (imgElement.src !== url) {
      imgElement.src = url;
    }
    imgElement.style.opacity = '1';
    imgElement.onerror = () => {
      // Fallback if Google Drive link fails
      const driveMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (driveMatch && driveMatch[1] && !imgElement.dataset.triedFallback) {
        imgElement.dataset.triedFallback = 'true';
        imgElement.src = `https://drive.google.com/uc?export=view&id=${driveMatch[1]}`;
      } else {
        imgElement.style.opacity = '0';
      }
    };
  } else {
    imgElement.src = '';
    imgElement.style.opacity = '0';
  }
}

// ============================================
// STATE: NORMAL BIDDING (TEAM INFO MASKED)
// ============================================
let lastBidValue = -1;

function renderBiddingCard(p, currentBid) {
  switchCard(biddingCard);
  
  const rawPhoto = val(p, 'Upload Your Picture', 'Picture', 'Photo', 'Image', 'cached_image_url', 'original_image_url') || p.cached_image_url || p.original_image_url;
  handleImageFallback($('bidding-photo'), drivePhoto(rawPhoto));
  
  $('bidding-name').innerText = val(p, 'Full Name', 'Name') || 'PLAYER';
  
  const role = val(p, 'Player Type', 'Role');
  const style = val(p, 'Player Style', 'Style');
  $('bidding-meta').innerText = [role, style].filter(Boolean).join(' • ');

  // Update Bid with flash animation
  if (lastBidValue !== currentBid) {
    const bidEl = $('bidding-points');
    const boxEl = bidEl.parentElement;
    bidEl.innerText = Number(currentBid).toLocaleString() + ' PTS';
    
    // Animate flash
    boxEl.classList.remove('flash');
    void boxEl.offsetWidth; // trigger reflow
    boxEl.classList.add('flash');
    
    lastBidValue = currentBid;
  }
}

// ============================================
// STATE: IMMUTABLE SOLD SNAPSHOT
// ============================================
function renderSoldSnapshot(event) {
  switchCard(soldCard);
  
  handleImageFallback($('sold-photo'), drivePhoto(event.photo));
  $('sold-name').innerText = (event.name || 'PLAYER').toUpperCase();
  
  const meta = [event.role, event.style].filter(Boolean).join(' • ');
  $('sold-meta').innerText = meta.toUpperCase();
  
  $('sold-team-name').innerText = (event.team || 'TEAM').toUpperCase();
  
  const logoEl = $('sold-team-logo');
  const teamLogo = event.teamLogo || getTeamLogo(currentState && currentState.teamsConfig, event.team);
  if (teamLogo) {
    logoEl.src = teamLogo;
    logoEl.style.display = 'block';
  } else {
    logoEl.style.display = 'none';
  }
  
  const ptsNum = parseInt(String(event.points || 0).replace(/,/g, '')) || 0;
  $('sold-points-val').innerText = ptsNum.toLocaleString() + ' PTS';
  lastBidValue = -1; // reset bid tracker
}

// ============================================
// STATE: IMMUTABLE UNSOLD SNAPSHOT
// ============================================
function renderUnsoldSnapshot(event) {
  switchCard(unsoldCard);
  
  handleImageFallback($('unsold-photo'), drivePhoto(event.photo));
  $('unsold-name').innerText = (event.name || 'PLAYER').toUpperCase();
  
  const meta = [event.role, event.style].filter(Boolean).join(' • ');
  $('unsold-meta').innerText = meta.toUpperCase();
  
  lastBidValue = -1;
}

// ============================================
// STATE: STATIC PAST CARDS
// ============================================
function renderStaticSoldCard(p) {
  switchCard(soldCard);
  
  const rawPhoto = val(p, 'Upload Your Picture', 'Picture', 'Photo', 'Image', 'cached_image_url', 'original_image_url') || p.cached_image_url || p.original_image_url;
  handleImageFallback($('sold-photo'), drivePhoto(rawPhoto));
  $('sold-name').innerText = (val(p, 'Full Name', 'Name') || 'PLAYER').toUpperCase();
  
  const role = val(p, 'Player Type', 'Role');
  const style = val(p, 'Player Style', 'Style');
  $('sold-meta').innerText = [role, style].filter(Boolean).join(' • ').toUpperCase();
  
  const team = val(p, 'Team', 'Transferred Team') || 'ASSIGNED';
  $('sold-team-name').innerText = team.toUpperCase();
  
  const rawPts = val(p, 'Points', 'Final Points') || 0;
  const ptsNum = parseInt(String(rawPts).replace(/,/g, '')) || 0;
  $('sold-points-val').innerText = ptsNum.toLocaleString() + ' PTS';
  
  const logoEl = $('sold-team-logo');
  const teamLogo = getTeamLogo(currentState && currentState.teamsConfig, team);
  if (teamLogo) {
    logoEl.src = teamLogo;
    logoEl.style.display = 'block';
  } else {
    logoEl.style.display = 'none';
  }
  
  lastBidValue = -1;
}

function renderStaticUnsoldCard(p) {
  switchCard(unsoldCard);
  
  const rawPhoto = val(p, 'Upload Your Picture', 'Picture', 'Photo', 'Image', 'cached_image_url', 'original_image_url') || p.cached_image_url || p.original_image_url;
  handleImageFallback($('unsold-photo'), drivePhoto(rawPhoto));
  $('unsold-name').innerText = (val(p, 'Full Name', 'Name') || 'PLAYER').toUpperCase();
  
  const role = val(p, 'Player Type', 'Role');
  const style = val(p, 'Player Style', 'Style');
  $('unsold-meta').innerText = [role, style].filter(Boolean).join(' • ').toUpperCase();
  
  lastBidValue = -1;
}

// ============================================
// SSE — SERVER-SENT EVENTS (PRIMARY REALTIME)
// Gives overlay instant updates from /api/state
// POST without needing Supabase Broadcast
// ============================================
let sseSource = null;

function initSSE() {
  if (sseSource) {
    sseSource.close();
    sseSource = null;
  }
  const evtSource = new EventSource('/api/stream');
  sseSource = evtSource;

  evtSource.onopen = () => {
    console.log('[OVERLAY REALTIME] SSE CONNECTED');
    updateDebug(null, 'SSE CONNECTED');
  };

  evtSource.onmessage = event => {
    try {
      const data = JSON.parse(event.data);
      if (data && isNewerState(data)) {
        if (isOnlyBidUpdate(currentState, data)) {
          updateLiveBidOnly(data);
        } else {
          renderOverlay(data);
        }
        updateDebug(null, 'LIVE (SSE)');
      }
    } catch (e) {
      console.error('[OVERLAY] SSE parse error', e);
    }
  };

  evtSource.onerror = () => {
    console.warn('[OVERLAY REALTIME] SSE error — reconnecting...');
    updateDebug(null, 'RECONNECTING...');
    evtSource.close();
    sseSource = null;
    setTimeout(initSSE, 3000);
  };
}

// Start SSE on load immediately
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSSE);
} else {
  initSSE();
}

// Also subscribe SSE on BroadcastChannel (for same-device Admin tab sync)
const overlayBroadcastChannel = new BroadcastChannel('scpl_auction_channel');
overlayBroadcastChannel.onmessage = event => {
  if (event.data && isNewerState(event.data)) {
    if (isOnlyBidUpdate(currentState, event.data)) {
      updateLiveBidOnly(event.data);
    } else {
      renderOverlay(event.data);
    }
  }
};
