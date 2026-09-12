const broadcastChannel = new BroadcastChannel('scpl_auction_channel');
const $ = id => document.getElementById(id);

let currentState = null;
let lastKnownBidPoints = null;
let lastKnownPlayerId = null;
let lastProcessedTimestamp = 0;
let wasSquadDisplayActive = false;

let countdownTimerInterval = null;
let currentCountdownId = null;
let lastPlayedBeepNumber = null;
let projChannel = null;
let sseConnected = false; // TRUE once SSE onopen fires — prevents Supabase errors downgrading status

// SUPABASE CLIENT INITIALIZATION FOR PROJECTOR REALTIME SYNC
const SUPABASE_URL = "https://irxxmqfpokfbwxmueles.supabase.co";
const SUPABASE_KEY = "sb_publishable_PDDDQPtT2swFOw_8WL3UPQ_B-iF-4DQ";
let supabaseClient = null;

if (window.supabase) {
  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log("⚡ Projector Supabase Client initialized successfully.");
  } catch (e) {
    console.warn("⚠️ Projector Supabase init notice:", e.message);
  }
}

// ----------------------------------------------------
// WEB AUDIO API SYNTHESIZER & AUTOPLAY PERMISSION HANDLER
// ----------------------------------------------------
let audioCtx = null;
let audioEnabled = false;

window.initAudioContext = function() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  audioEnabled = true;
  localStorage.setItem('scpl_projector_audio_enabled', 'true');
  const overlay = $('audioEnableOverlay');
  if (overlay) overlay.classList.add('hidden');
};

function checkAudioAutoplayPermission() {
  const saved = localStorage.getItem('scpl_projector_audio_enabled');
  if (saved === 'true') {
    window.initAudioContext();
  } else {
    const overlay = $('audioEnableOverlay');
    if (overlay) overlay.classList.remove('hidden');
  }

  const enableOnUserInteraction = () => {
    window.initAudioContext();
    window.removeEventListener('click', enableOnUserInteraction);
    window.removeEventListener('keydown', enableOnUserInteraction);
    window.removeEventListener('touchstart', enableOnUserInteraction);
  };
  window.addEventListener('click', enableOnUserInteraction);
  window.addEventListener('keydown', enableOnUserInteraction);
  window.addEventListener('touchstart', enableOnUserInteraction);
}

function playCountdownBeep(number) {
  if (!audioEnabled || !audioCtx) return;
  try {
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;

    if (number > 1) {
      // Short clear countdown beep (800 Hz, 0.1s)
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, now);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (number === 1) {
      // Stronger final 1 beep (1200 Hz -> 600 Hz drop, 0.2s)
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1200, now);
      osc.frequency.exponentialRampToValueAtTime(600, now + 0.2);
      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.22);
    } else if (number === 0) {
      // Energetic "LET'S BEGIN!" C-major chord impact
      const freqs = [523.25, 659.25, 783.99, 1046.50];
      freqs.forEach((freq, idx) => {
        const oscChord = audioCtx.createOscillator();
        const gainChord = audioCtx.createGain();
        oscChord.connect(gainChord);
        gainChord.connect(audioCtx.destination);
        oscChord.type = 'sine';
        oscChord.frequency.setValueAtTime(freq, now + idx * 0.04);
        gainChord.gain.setValueAtTime(0.3 - idx * 0.05, now + idx * 0.04);
        gainChord.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.04 + 0.4);
        oscChord.start(now + idx * 0.04);
        oscChord.stop(now + idx * 0.04 + 0.4);
      });
    }
  } catch (e) {
    console.warn("Audio play notice:", e);
  }
}

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
  if (ts && ts <= lastProcessedTimestamp) return false; // reject older/duplicate states
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
  currentState = state; // Keep local cache updated
  
  const currentPts = parseInt(state.biddingPoints || state.defaultBasePoints || 1000);
  const pCurrentBid = $('pCurrentBid');
  if (pCurrentBid) pCurrentBid.textContent = currentPts.toLocaleString();
  
  if (lastKnownBidPoints !== null && currentPts !== lastKnownBidPoints) {
    triggerBidAnimation();
  }
  lastKnownBidPoints = currentPts;
}

let hasBeenSubscribed = false;

function initSupabaseRealtimeSync() {
  if (!supabaseClient) return;

  try {
    if (projChannel) {
      supabaseClient.removeChannel(projChannel);
    }

    projChannel = supabaseClient.channel('scpl_auction_room');
    
    // 1. BROADCAST EVENT LISTENER
    projChannel.on('broadcast', { event: 'state_update' }, ({ payload }) => {
      if (payload && isNewerState(payload)) {
        if (isOnlyBidUpdate(currentState, payload)) {
          updateLiveBidOnly(payload);
        } else {
          renderState(payload);
        }
        updateConnectionStatus('LIVE');
      }
    });

    // 2. POSTGRES DATABASE CHANGES LISTENER
    projChannel.on('postgres_changes', { event: '*', schema: 'public', table: 'auction_state' }, payload => {
      if (payload && payload.new) {
        if (payload.new.state_data && isNewerState(payload.new.state_data)) {
          const sd = payload.new.state_data;
          if (isOnlyBidUpdate(currentState, sd)) {
            updateLiveBidOnly(sd);
          } else {
            renderState(sd);
          }
          updateConnectionStatus('LIVE');
        } else if (isNewerState(payload.new)) {
          fetchLatestState();
        }
      }
    });

    projChannel.subscribe(status => {
      console.log('[REALTIME] Supabase status:', status);

      if (status === 'SUBSCRIBED') {
        hasBeenSubscribed = true;
        updateConnectionStatus('LIVE');
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[REALTIME] Supabase warning:', status);
        // NEVER downgrade to CONNECTING/OFFLINE if SSE is already live
        if (!sseConnected) {
          updateConnectionStatus(hasBeenSubscribed ? 'RECONNECTING' : 'CONNECTING');
        }
        setTimeout(initSupabaseRealtimeSync, 3000);
      }
    });
  } catch (e) {
    console.error("Supabase Realtime Sync Init Error:", e);
  }
}

async function fetchLatestState() {
  try {
    const res = await fetch('/api/state');
    const data = await res.json();
    if (data && data.players && data.players.length > 0) {
      // Always render on initial load (ignore timestamp gate for first fetch)
      if (!currentState || isNewerState(data)) {
        if (isOnlyBidUpdate(currentState, data)) {
          updateLiveBidOnly(data);
        } else {
          renderState(data);
        }
      }
      updateConnectionStatus('LIVE');
    }
  } catch (e) {
    console.warn('[REALTIME] API state fetch failed:', e.message);
  }
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

const imageCache = new Map();

function preloadImage(url) {
  if (!url || typeof url !== 'string') return Promise.resolve(null);
  const photo = drivePhoto(url);
  if (!photo) return Promise.resolve(null);
  
  if (imageCache.has(photo)) {
    return imageCache.get(photo);
  }

  const promise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(photo);
    img.onerror = () => resolve(null);
    img.src = photo;
  });

  imageCache.set(photo, promise);
  return promise;
}

function preloadUpcomingImages(state) {
  if (!state || !Array.isArray(state.players) || state.players.length === 0) return;
  const currentIdx = state.current || 0;
  
  let preloadedCount = 0;
  for (let i = currentIdx + 1; i < state.players.length && preloadedCount < 3; i++) {
    const player = state.players[i];
    if (player) {
      const st = getRawStatus(player);
      if (st === 'AVAILABLE') {
        const rawPhoto = val(player, 'Upload Your Picture', 'Picture', 'Photo', 'Image', 'cached_image_url', 'original_image_url');
        if (rawPhoto) {
          preloadImage(rawPhoto);
          preloadedCount++;
        }
      }
    }
  }
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function triggerBidAnimation() {
  const container = $('pCurrentBid');
  if (!container) return;
  container.classList.remove('bid-animating');
  void container.offsetWidth; // Force CSS Reflow
  container.classList.add('bid-animating');
}

function triggerPlayerChangeAnimation() {
  const arena = $('playerArena');
  if (!arena) return;
  arena.classList.remove('player-transitioning');
  void arena.offsetWidth; // Force CSS Reflow
  arena.classList.add('player-transitioning');
}

let playedCountdownSeconds = new Set();

function startCountdownAnimation(isResume = false, timestamp = 0) {
  const countdownOverlay = $('countdownOverlay');
  const numEl = $('countdownNumber');
  const labelEl = $('countdownLabel');
  const bannerEl = $('countdownBanner');

  if (!countdownOverlay || !numEl) return;
  countdownOverlay.classList.remove('hidden');

  if (labelEl) labelEl.textContent = isResume ? 'AUCTION RESUMES IN' : 'AUCTION BEGINS IN';

  const startTs = timestamp || Date.now();
  const countdownId = startTs + '_' + (isResume ? 'resume' : 'start');
  if (currentCountdownId === countdownId && countdownTimerInterval) {
    return;
  }
  currentCountdownId = countdownId;
  playedCountdownSeconds.clear();

  if (bannerEl) bannerEl.classList.add('hidden');

  const totalDuration = 10;
  const endTime = startTs + totalDuration * 1000;

  if (countdownTimerInterval) clearInterval(countdownTimerInterval);

  const updateTick = () => {
    const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
    if (!playedCountdownSeconds.has(remaining)) {
      playedCountdownSeconds.add(remaining);
      if (remaining > 0) {
        numEl.textContent = remaining;
        playCountdownBeep(remaining);
      } else {
        numEl.textContent = '0';
        playCountdownBeep(0);
        if (bannerEl) {
          bannerEl.textContent = isResume ? "LET'S CONTINUE!" : "LET'S BEGIN!";
          bannerEl.classList.remove('hidden');
        }
        clearInterval(countdownTimerInterval);
        setTimeout(() => {
          countdownOverlay.classList.add('hidden');
          currentCountdownId = null;
        }, 1800);
      }
    }
  };

  updateTick();
  countdownTimerInterval = setInterval(updateTick, 100);
}

function renderCompletedOverlay(state) {
  const overlay = $('auctionCompletedOverlay');
  if (!overlay) return;

  let totalCount = state.players.length;
  let soldCount = 0;
  let unsoldCount = 0;
  const teamsMap = {};

  state.players.forEach(p => {
    const st = getRawStatus(p);
    if (st === 'SOLD') {
      soldCount++;
      const tm = val(p, 'Team', 'Transferred Team') || 'Assigned';
      const pts = parseInt(val(p, 'Points', 'Final Points')) || 0;
      if (!teamsMap[tm]) teamsMap[tm] = { players: [], totalPoints: 0 };
      teamsMap[tm].players.push({ name: val(p, 'Full Name', 'Name'), points: pts });
      teamsMap[tm].totalPoints += pts;
    } else if (st === 'UNSOLD') {
      unsoldCount++;
    }
  });

  safeSetText('compTotal', totalCount);
  safeSetText('compSold', soldCount);
  safeSetText('compUnsold', unsoldCount);

  const gridEl = $('completedTeamsGrid');
  if (gridEl) {
    const revealed = state.revealedTeamsInEnd || [];
    const isAll = revealed.includes('ALL');
    const teamKeys = Object.keys(state.teamsConfig || {}).filter(tmKey => isAll || revealed.includes(tmKey));

    if (teamKeys.length === 0) {
      gridEl.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 45px; color: #8daaa0; font-size: 18px; font-weight: 800; background: rgba(255, 255, 255, 0.03); border-radius: 20px; border: 1.5px dashed rgba(255, 255, 255, 0.15); letter-spacing: 1.2px;">
        📢 Admin is revealing team squads live... Stand by!
      </div>`;
    } else {
      gridEl.innerHTML = teamKeys.map(tmKey => {
        const tData = teamsMap[tmKey] || { players: [], totalPoints: 0 };
        return `<div class="comp-team-card" style="animation: projSoldPop 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
          <div class="comp-team-header">
            <strong>🛡️ ${tmKey}</strong>
            <span>${tData.players.length} Players • ${tData.totalPoints} PTS</span>
          </div>
          <div class="comp-team-players">
            ${tData.players.map(pl => `<div>• ${pl.name} (${pl.points} PTS)</div>`).join('') || '<div style="color:var(--muted); font-size:11px;">No players acquired.</div>'}
          </div>
        </div>`;
      }).join('');
    }
  }

  overlay.classList.remove('hidden');
}

function renderState(state) {
  if (!state) return;
  currentState = state;

  // 0. ACCENT THEME
  const themeColor = state.theme_color || 'green';
  document.body.setAttribute('data-theme', themeColor);

  // OVERLAY ELEMENTS RESET
  const preOverlay = $('preAuctionOverlay');
  const countOverlay = $('countdownOverlay');
  const transOverlay = $('filterTransitionOverlay');
  const breakOverlay = $('breakOverlay');
  const sqOverlay = $('squadDisplayOverlay');
  const soldOverlay = $('soldOverlay');
  const unsoldOverlay = $('unsoldOverlay');
  const compOverlay = $('auctionCompletedOverlay');

  // PHASE 0: COUNTDOWN OVERLAY
  if (state.broadcastOverlay && state.broadcastOverlay.type === 'COUNTDOWN') {
    startCountdownAnimation(state.broadcastOverlay.isResume, state.broadcastOverlay.timestamp);
    return;
  }

  // PHASE 1: AUCTION COMPLETED
  if (state.auctionPhase === 'AUCTION_COMPLETED') {
    renderCompletedOverlay(state);
    return;
  } else if (compOverlay) compOverlay.classList.add('hidden');

  // PHASE 2: PRE-AUCTION WAITING
  if (state.auctionPhase === 'PRE_AUCTION') {
    if (preOverlay) preOverlay.classList.remove('hidden');
  } else if (preOverlay) {
    preOverlay.classList.add('hidden');
  }

  // PHASE 3: COUNTDOWN
  if (state.auctionPhase === 'COUNTDOWN' && state.broadcastOverlay && state.broadcastOverlay.type === 'COUNTDOWN') {
    startCountdownAnimation(state.broadcastOverlay.isResume);
    return;
  }

  // PHASE 4: BREAK MODE
  if (state.auctionPhase === 'BREAK') {
    if (breakOverlay) {
      breakOverlay.classList.remove('hidden');
      const timerEl = $('breakTimerDisplay');
      const msgEl = $('breakStatusMessage');
      if (timerEl) timerEl.textContent = state.breakIsNoTimer ? 'OPEN BREAK' : formatTime(state.breakSecondsRemaining || 0);
      if (msgEl) msgEl.textContent = state.breakIsNoTimer ? 'Auction will resume shortly' : 'Auction resumes when timer completes';
    }
    return;
  } else if (breakOverlay) breakOverlay.classList.add('hidden');

  // PHASE 5: FILTER & ROUND TRANSITION OVERLAY
  if (state.broadcastOverlay && state.broadcastOverlay.type === 'FILTER_TRANSITION') {
    if (transOverlay) {
      transOverlay.classList.remove('hidden');
      safeSetText('filterTransitionTitle', state.broadcastOverlay.title || 'BATSMEN');
      safeSetText('filterTransitionSubtitle', state.broadcastOverlay.subtitle || 'NOW SELECTING');
    }
    return;
  } else if (transOverlay) transOverlay.classList.add('hidden');

  // PHASE 6: FULL-SCREEN SQUAD SHOWCASE
  if (sqOverlay) {
    if (state.activeSquadDisplay) {
      wasSquadDisplayActive = true;
      const tmName = state.activeSquadDisplay;
      const cfg = (state.teamsConfig && state.teamsConfig[tmName]) || {};
      const logoUrl = cfg.logoUrl ? drivePhoto(cfg.logoUrl) : '';

      safeSetText('sqTeamName', tmName.toUpperCase());
      const sqLogoEl = $('sqLogo');
      if (sqLogoEl) {
        if (logoUrl) {
          sqLogoEl.style.backgroundImage = `url("${encodeURI(logoUrl)}")`;
          sqLogoEl.textContent = '';
        } else {
          sqLogoEl.style.backgroundImage = '';
          sqLogoEl.textContent = tmName.slice(0, 2).toUpperCase();
        }
      }

      const squadPlayers = (state.players || []).filter(p => {
        const st = getRawStatus(p);
        const tm = val(p, 'Team', 'Transferred Team');
        return st === 'SOLD' && tm.trim().toLowerCase() === tmName.trim().toLowerCase();
      });

      let totalPoints = 0;
      const rowsHtml = squadPlayers.map((p, idx) => {
        const nm = val(p, 'Full Name', 'Name') || 'Player ' + (idx + 1);
        const role = val(p, 'Player Type', 'Role') || '—';
        const style = val(p, 'Player Style', 'Style') || '—';
        const age = val(p, 'Age') ? val(p, 'Age') + ' yrs' : '—';
        const prof = val(p, 'Please enter your profession', 'profession', 'job role') || '—';
        const pts = parseInt(val(p, 'Points', 'Final Points')) || 0;
        totalPoints += pts;

        return `<tr>
          <td style="text-align:center; font-weight:800; color:var(--theme-accent);">${idx + 1}</td>
          <td style="font-weight:800; color:#ffffff; font-size:18px;">${nm}</td>
          <td><span class="sq-role-pill">${role}</span></td>
          <td style="color:#d1e0db;">${style}</td>
          <td style="text-align:center; color:#ffffff;">${age}</td>
          <td style="color:#e0f2fe; font-weight:700;">${prof}</td>
          <td style="text-align:right; font-weight:800; color:var(--theme-accent); font-size:18px;">${pts} PTS</td>
        </tr>`;
      }).join('');

      const pointLimit = cfg.pointLimit || 20000;
      const remainingPoints = Math.max(0, pointLimit - totalPoints);

      safeSetText('sqPlayerCount', squadPlayers.length);
      safeSetText('sqSpentPts', `${totalPoints.toLocaleString()} PTS`);
      safeSetText('sqRemainingPts', `${remainingPoints.toLocaleString()} PTS`);
      safeSetText('sqStatsBox', `${squadPlayers.length} PLAYERS • ${totalPoints.toLocaleString()} PTS SPENT • ${remainingPoints.toLocaleString()} PTS REMAINING`);

      const tBody = $('sqTableBody');
      if (tBody) tBody.innerHTML = rowsHtml || '<tr><td colspan="7" style="text-align:center; padding:30px; color:#8daaa0; font-size:16px;">No players acquired yet by this team.</td></tr>';
      
      sqOverlay.classList.remove('hidden');
      return;
    } else {
      if (wasSquadDisplayActive) {
        wasSquadDisplayActive = false;
        lastKnownPlayerId = null;
        lastKnownBidPoints = null;
      }
      sqOverlay.classList.add('hidden');
    }
  }

  // PHASE 7: SOLD & UNSOLD BROADCAST RESULT OVERLAYS
  const currentIdx = typeof state.current === 'number' ? state.current : 0;
  const p = (state.players && state.players[currentIdx]) || (state.players && state.players[0]) || {};
  const status = getRawStatus(p);

  function applySoldOverlay(name, role, style, photoRaw, pts, teamName, logoRaw) {
    safeSetText('soldPlayerName', (name || 'PLAYER NAME').toUpperCase());
    safeSetText('soldPlayerDetails', `${(role || 'PLAYER').toUpperCase()} • ${(style || 'CRICKET').toUpperCase()}`);
    
    const photo = drivePhoto(photoRaw);
    const soldPhotoImg = $('soldPlayerPhotoImg');
    const soldInitials = $('soldPlayerInitials');
    const soldFrame = $('soldPhotoFrame');
    
    if (photo && soldPhotoImg) {
      soldPhotoImg.src = photo;
      soldPhotoImg.classList.remove('hidden');
      if (soldInitials) soldInitials.classList.add('hidden');
      if (soldFrame) soldFrame.classList.add('has-photo');
      soldPhotoImg.onerror = () => {
        soldPhotoImg.classList.add('hidden');
        if (soldInitials) {
          soldInitials.classList.remove('hidden');
          soldInitials.textContent = (name || 'P').slice(0, 2).toUpperCase();
        }
      };
    } else {
      if (soldPhotoImg) soldPhotoImg.classList.add('hidden');
      if (soldInitials) {
        soldInitials.classList.remove('hidden');
        soldInitials.textContent = (name || 'P').slice(0, 2).toUpperCase();
      }
      if (soldFrame) soldFrame.classList.remove('has-photo');
    }

    const ptsNum = parseInt(String(pts || 0).replace(/,/g, '')) || 0;
    safeSetText('soldPointsValue', `${ptsNum.toLocaleString()} POINTS`);
    safeSetText('soldTeamNameBadge', (teamName || 'UNASSIGNED').toUpperCase());

    const logoUrl = drivePhoto(logoRaw) || getTeamLogo(state.teamsConfig, teamName);
    const logoImg = $('soldTeamLogoImg');
    const logoInitials = $('soldTeamLogoInitials');
    if (logoImg && logoInitials) {
      if (logoUrl) {
        logoImg.src = logoUrl;
        logoImg.classList.remove('hidden');
        logoImg.style.display = 'block';
        logoInitials.classList.add('hidden');
        logoInitials.style.display = 'none';
        logoInitials.textContent = '';
        logoImg.onerror = () => {
          logoImg.classList.add('hidden');
          logoImg.style.display = 'none';
          logoInitials.classList.remove('hidden');
          logoInitials.style.display = 'block';
          logoInitials.textContent = (teamName || 'T').slice(0, 2).toUpperCase();
        };
      } else {
        logoImg.classList.add('hidden');
        logoImg.style.display = 'none';
        logoInitials.classList.remove('hidden');
        logoInitials.style.display = 'block';
        logoInitials.textContent = (teamName || 'T').slice(0, 2).toUpperCase();
      }
    }

    if (preOverlay) preOverlay.classList.add('hidden');
    if (countOverlay) countOverlay.classList.add('hidden');
    if (transOverlay) transOverlay.classList.add('hidden');
    if (breakOverlay) breakOverlay.classList.add('hidden');
    if (sqOverlay) sqOverlay.classList.add('hidden');
    if (compOverlay) compOverlay.classList.add('hidden');
    if (soldOverlay) soldOverlay.classList.remove('hidden');
    if (unsoldOverlay) unsoldOverlay.classList.add('hidden');
    
    preloadUpcomingImages(state);
    updateConnectionStatus('LIVE');
  }

  function applyUnsoldOverlay(name, role, style, photoRaw, round) {
    safeSetText('unsoldPlayerName', (name || 'PLAYER NAME').toUpperCase());
    safeSetText('unsoldPlayerDetails', `${(role || 'PLAYER').toUpperCase()} • ${(style || 'CRICKET').toUpperCase()}`);
    safeSetText('unsoldRoundText', `UNSOLD ROUND ${round || 1}`);

    const photo = drivePhoto(photoRaw);
    const unsoldPhotoImg = $('unsoldPlayerPhotoImg');
    const unsoldInitials = $('unsoldPlayerInitials');
    const unsoldFrame = $('unsoldPhotoFrame');

    if (photo && unsoldPhotoImg) {
      unsoldPhotoImg.src = photo;
      unsoldPhotoImg.classList.remove('hidden');
      if (unsoldInitials) unsoldInitials.classList.add('hidden');
      if (unsoldFrame) unsoldFrame.classList.add('has-photo');
      unsoldPhotoImg.onerror = () => {
        unsoldPhotoImg.classList.add('hidden');
        if (unsoldInitials) {
          unsoldInitials.classList.remove('hidden');
          unsoldInitials.textContent = (name || 'P').slice(0, 2).toUpperCase();
        }
      };
    } else {
      if (unsoldPhotoImg) unsoldPhotoImg.classList.add('hidden');
      if (unsoldInitials) {
        unsoldInitials.classList.remove('hidden');
        unsoldInitials.textContent = (name || 'P').slice(0, 2).toUpperCase();
      }
      if (unsoldFrame) unsoldFrame.classList.remove('has-photo');
    }

    if (preOverlay) preOverlay.classList.add('hidden');
    if (countOverlay) countOverlay.classList.add('hidden');
    if (transOverlay) transOverlay.classList.add('hidden');
    if (breakOverlay) breakOverlay.classList.add('hidden');
    if (sqOverlay) sqOverlay.classList.add('hidden');
    if (compOverlay) compOverlay.classList.add('hidden');
    if (unsoldOverlay) unsoldOverlay.classList.remove('hidden');
    if (soldOverlay) soldOverlay.classList.add('hidden');
    
    preloadUpcomingImages(state);
    updateConnectionStatus('LIVE');
  }

  if (state.soldAnimationEvent && (Date.now() - (state.soldAnimationEvent.timestamp || 0) < 3500)) {
    const ev = state.soldAnimationEvent;
    const teamLogo = ev.teamLogo || getTeamLogo(state.teamsConfig, ev.team);
    applySoldOverlay(ev.name, ev.role, ev.style, ev.photo, ev.points || ev.bid, ev.team, teamLogo);
    const remTime = Math.max(100, 3000 - (Date.now() - (ev.timestamp || 0)));
    setTimeout(() => {
      if (currentState && currentState.soldAnimationEvent && (Date.now() - (currentState.soldAnimationEvent.timestamp || 0) >= 3000)) {
        currentState.soldAnimationEvent = null;
        render(currentState);
      }
    }, remTime);
    return;
  } else if (state.unsoldAnimationEvent && (Date.now() - (state.unsoldAnimationEvent.timestamp || 0) < 3500)) {
    const ev = state.unsoldAnimationEvent;
    applyUnsoldOverlay(ev.name, ev.role, ev.style, ev.photo, ev.unsoldRound);
    const remTime = Math.max(100, 3000 - (Date.now() - (ev.timestamp || 0)));
    setTimeout(() => {
      if (currentState && currentState.unsoldAnimationEvent && (Date.now() - (currentState.unsoldAnimationEvent.timestamp || 0) >= 3000)) {
        currentState.unsoldAnimationEvent = null;
        render(currentState);
      }
    }, remTime);
    return;
  } else {
    if (soldOverlay) soldOverlay.classList.add('hidden');
    if (unsoldOverlay) unsoldOverlay.classList.add('hidden');
  }

  // PHASE 8: LIVE IPL-STYLE AUCTION BROADCAST CARD
  const playerId = val(p, 'Full Name', 'Name') + '_' + currentIdx;
  if (lastKnownPlayerId === null || lastKnownPlayerId !== playerId) {
    triggerPlayerChangeAnimation();
  }
  lastKnownPlayerId = playerId;

  const name = val(p, 'Full Name', 'Name', 'Player Name') || 'Unnamed Player';
  const rawPhoto = val(p, 'Upload Your Picture', 'Picture', 'Photo', 'Image', 'cached_image_url', 'original_image_url') || p.cached_image_url || p.original_image_url;
  const photo = drivePhoto(rawPhoto);

  safeSetText('pPosition', `PLAYER ${String(currentIdx + 1).padStart(2, '0')} / ${String(state.players.length).padStart(2, '0')}`);
  
  const nameEl = $('pName');
  if (nameEl) {
    nameEl.textContent = name.toUpperCase();
    if (name.length > 22) {
      nameEl.style.fontSize = 'clamp(36px, 4.8vh, 52px)';
    } else if (name.length > 16) {
      nameEl.style.fontSize = 'clamp(44px, 5.8vh, 64px)';
    } else {
      nameEl.style.fontSize = 'clamp(52px, 7.0vh, 82px)';
    }
  }

  const nameParts = name.trim().split(/\s+/);
  let initText = 'P';
  if (nameParts.length >= 2) {
    initText = (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase();
  } else if (nameParts.length === 1 && nameParts[0].length >= 2) {
    initText = nameParts[0].slice(0, 2).toUpperCase();
  }
  
  safeSetText('pInitials', initText);

  const photoImg = $('pPhotoImage');
  const frameEl = $('pPhotoFrame');

  if (photo) {
    if (photoImg) {
      delete photoImg.dataset.triedFallback;
      photoImg.src = photo;
      photoImg.classList.remove('hidden');
      photoImg.onerror = () => {
        const driveMatch = photo.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (driveMatch && driveMatch[1] && !photoImg.dataset.triedFallback) {
          photoImg.dataset.triedFallback = 'true';
          photoImg.src = `https://drive.google.com/uc?export=view&id=${driveMatch[1]}`;
        } else {
          photoImg.classList.add('hidden');
          if (frameEl) frameEl.classList.remove('has-image');
        }
      };
    }
    if (frameEl) frameEl.classList.add('has-image');
  } else {
    if (photoImg) {
      photoImg.src = '';
      photoImg.classList.add('hidden');
    }
    if (frameEl) frameEl.classList.remove('has-image');
  }

  const type = val(p, 'Player Type', 'Type', 'Role') || 'Player';
  const style = val(p, 'Player Style', 'Style', 'Batting Style') || 'Cricket Player';
  safeSetText('pRole', type.toUpperCase());
  const formattedStyle = formatPlayerStyle(type, style);
  safeSetText('pBatting', formattedStyle.toUpperCase());

  safeSetText('pCategory', type);
  safeSetText('pSpeciality', formattedStyle);
  safeSetText('pProfession', val(p, 'Please enter your profession', 'profession', 'job role') || 'Not provided');
  safeSetText('pAge', val(p, 'Age') ? val(p, 'Age') + ' YEARS' : 'Not provided');
  safeSetText('pPhone', val(p, 'Phone number', 'Phone') || 'Not provided');
  safeSetText('pCricId', val(p, 'CricHeroes Account No', 'CricHeroes ID', 'CricHeroes') || 'Not provided');

  const basePts = parseInt(state.defaultBasePoints || 1000);
  safeSetText('pBasePoints', basePts + ' POINTS');

  const currentPts = parseInt(state.biddingPoints || basePts);
  safeSetText('pCurrentBid', currentPts.toLocaleString());

  if (lastKnownBidPoints !== null && currentPts !== lastKnownBidPoints) {
    triggerBidAnimation();
  }
  lastKnownBidPoints = currentPts;

  // STATS COUNTERS FOOTER
  let availCount = 0, soldCount = 0, unsoldCount = 0;
  state.players.forEach(pl => {
    const st = getRawStatus(pl);
    if (st === 'SOLD') soldCount++;
    else if (st === 'UNSOLD') unsoldCount++;
    else availCount++;
  });

  safeSetText('pTotalStats', state.players.length);
  safeSetText('pAvailStats', availCount);
  safeSetText('pSoldStats', soldCount);
  safeSetText('pUnsoldStats', unsoldCount);

  preloadUpcomingImages(state);

  updateConnectionStatus('LIVE');
}

function safeSetText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function formatPlayerStyle(type, style) {
  if (!style || style === 'undefined' || style === 'null' || style === '—') return type || 'Player';
  return style.trim();
}

function updateConnectionStatus(statusState) {
  const el = $('connStatus');
  const lbl = $('connLabel');
  if (!el || !lbl) return;

  el.classList.remove('live', 'connecting', 'reconnecting', 'offline');

  if (statusState === true || statusState === 'LIVE') {
    hasBeenSubscribed = true;
    el.classList.add('live');
    lbl.textContent = '● LIVE';
  } else if (statusState === 'CONNECTING') {
    el.classList.add('connecting');
    lbl.textContent = '● CONNECTING...';
  } else if (statusState === 'RECONNECTING') {
    el.classList.add('reconnecting');
    lbl.textContent = '● RECONNECTING...';
  } else if (statusState === false || statusState === 'OFFLINE') {
    el.classList.add('offline');
    lbl.textContent = '● OFFLINE';
  }
}

// REAL-TIME COMMUNICATION SUBSCRIBERS
broadcastChannel.onmessage = event => {
  if (event.data && isNewerState(event.data)) {
    renderState(event.data);
  }
};

let sseSource = null;

function initSSE() {
  // Destroy existing connection before creating a new one
  if (sseSource) {
    sseSource.close();
    sseSource = null;
    sseConnected = false;
  }
  const evtSource = new EventSource('/api/stream');
  sseSource = evtSource;
  evtSource.onopen = () => {
    console.log('[REALTIME] SSE CONNECTED ✔');
    sseConnected = true;
    updateConnectionStatus('LIVE');
  };
  evtSource.onmessage = event => {
    try {
      const data = JSON.parse(event.data);
      if (data) {
        sseConnected = true;
        updateConnectionStatus('LIVE');
        if (isNewerState(data)) {
          if (isOnlyBidUpdate(currentState, data)) {
            updateLiveBidOnly(data);
          } else {
            renderState(data);
          }
        }
      }
    } catch (e) {
      console.error('SSE JSON error', e);
    }
  };
  evtSource.onerror = () => {
    console.warn('[REALTIME] SSE ERROR — reconnecting...');
    sseConnected = false;
    updateConnectionStatus('RECONNECTING');
    evtSource.close();
    sseSource = null;
    setTimeout(initSSE, 3000);
  };
}

// INITIAL STARTUP & RECONNECTION HANDLERS
window.addEventListener('online', () => {
  console.log("[REALTIME] Internet reconnected — re-fetching state...");
  fetchLatestState();
  initSSE();
  initSupabaseRealtimeSync();
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkAudioAutoplayPermission);
} else {
  checkAudioAutoplayPermission();
}

fetchLatestState();
initSupabaseRealtimeSync();
initSSE();

// Fallback polling every 10s — only if SSE is not connected
setInterval(() => {
  if (!sseSource || sseSource.readyState === EventSource.CLOSED) {
    fetchLatestState();
  }
}, 10000);
