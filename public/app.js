// ── STATE ─────────────────────────────────────────────────────────────────────
const state = {
  zip: '',
  reps: [],           // raw rep objects from /api/reps
  activeRepIdx: 0,    // which rep tab is selected
  topics: [],         // selected topic strings
  memberCache: {},    // bioguideId → detailed member data from /api/member
};

// ── UTILS ─────────────────────────────────────────────────────────────────────
function initials(name) {
  return name.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function partyLabel(code) {
  if (code === 'D') return 'Democrat';
  if (code === 'R') return 'Republican';
  if (code === 'I') return 'Independent';
  return code || '';
}

function partyPillClass(code) {
  if (code === 'D') return 'pill-d';
  if (code === 'R') return 'pill-r';
  return 'pill-tag';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function billTypeLabel(type) {
  const map = { HR: 'H.R.', S: 'S.', HJRES: 'H.J.Res.', SJRES: 'S.J.Res.', HCONRES: 'H.Con.Res.', SCONRES: 'S.Con.Res.', HRES: 'H.Res.', SRES: 'S.Res.' };
  return map[type] || type;
}

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── API ───────────────────────────────────────────────────────────────────────
const API = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? '/.netlify/functions/api'
  : '/api';

async function apiFetch(path) {
  const res = await fetch(`${API}/${path}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

async function apiPost(path, data) {
  const res = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

// ── SCREENS ───────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  const target = document.getElementById(id);
  if (target) {
    target.classList.remove('hidden');
    window.scrollTo(0, 0);
  }
}

// ── ZIP SCREEN ────────────────────────────────────────────────────────────────
const zipInput = document.getElementById('zipInput');
const findBtn = document.getElementById('findRepsBtn');
const zipError = document.getElementById('zipError');

function setZipError(msg) {
  if (zipError) {
    zipError.textContent = msg;
    zipError.classList.toggle('hidden', !msg);
  }
}

function setZipLoading(loading) {
  findBtn.disabled = loading;
  findBtn.textContent = loading ? 'Finding...' : 'Find my reps';
}

async function handleZipSubmit() {
  const zip = zipInput.value.trim();
  if (!/^\d{5}$/.test(zip)) {
    setZipError('Please enter a valid 5-digit ZIP code.');
    zipInput.focus();
    return;
  }
  setZipError('');
  setZipLoading(true);

  try {
    const data = await apiFetch(`reps?zip=${zip}`);
    state.zip = zip;
    state.reps = data.reps || [];
    if (!state.reps.length) {
      setZipError('No representatives found for this ZIP code. Please double-check and try again.');
      return;
    }
    showScreen('screenTopics');
  } catch (e) {
    setZipError(e.message || 'Something went wrong. Please try again.');
  } finally {
    setZipLoading(false);
  }
}

findBtn.addEventListener('click', handleZipSubmit);
zipInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleZipSubmit(); });
zipInput.addEventListener('input', () => setZipError(''));

// ── TOPICS SCREEN ─────────────────────────────────────────────────────────────
const MAX_TOPICS = 3;
const topicCounter = document.getElementById('topicCounter');
const topicContinueBtn = document.getElementById('topicContinueBtn');

document.getElementById('topicGrid').addEventListener('click', e => {
  const chip = e.target.closest('.topic-chip');
  if (!chip) return;

  const topic = chip.dataset.topic;
  if (chip.classList.contains('selected')) {
    state.topics = state.topics.filter(t => t !== topic);
    chip.classList.remove('selected');
  } else {
    if (state.topics.length >= MAX_TOPICS) return;
    state.topics.push(topic);
    chip.classList.add('selected');
  }

  const count = state.topics.length;
  topicCounter.innerHTML = count === MAX_TOPICS
    ? `<strong class="maxed">${count}/${MAX_TOPICS} selected</strong>`
    : `Select up to <strong>${MAX_TOPICS} topics</strong> (${count} selected)`;
  topicContinueBtn.disabled = count === 0;

  // Disable unchosen chips when at max
  document.querySelectorAll('.topic-chip').forEach(c => {
    c.classList.toggle('disabled', count >= MAX_TOPICS && !c.classList.contains('selected'));
  });
});

topicContinueBtn.addEventListener('click', () => {
  state.activeRepIdx = 0;
  renderDashboard();
  showScreen('screenDash');
  if (state.reps[0]?.bioguideId) loadMemberDetail(state.reps[0].bioguideId);
});

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function renderDashboard() {
  renderRepTabs();
  renderRepHero(state.activeRepIdx);
  renderStatRow(state.activeRepIdx);
  renderActivityFeed(state.activeRepIdx);
}

function renderRepTabs() {
  const container = document.getElementById('repTabs');
  container.innerHTML = state.reps.map((rep, i) => {
    const short = rep.role === 'Representative'
      ? `Rep. ${rep.name.split(' ').pop()}`
      : rep.role.replace(' Senator', ' Sen.');
    return `<div class="rep-tab${i === state.activeRepIdx ? ' active' : ''}" data-idx="${i}">
      <div class="tab-av">${esc(initials(rep.name))}</div>
      ${esc(short)}
    </div>`;
  }).join('');

  container.querySelectorAll('.rep-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const idx = parseInt(tab.dataset.idx, 10);
      if (idx === state.activeRepIdx) return;
      state.activeRepIdx = idx;
      renderDashboard();
      const rep = state.reps[idx];
      if (rep?.bioguideId && !state.memberCache[rep.bioguideId]) {
        loadMemberDetail(rep.bioguideId);
      }
    });
  });
}

function renderRepHero(idx) {
  const rep = state.reps[idx];
  if (!rep) return;

  const cached = rep.bioguideId ? state.memberCache[rep.bioguideId] : null;
  const party = cached?.party || rep.party;
  const website = cached?.website || rep.website;
  const depiction = cached?.depiction || rep.depiction;

  const avatarHtml = depiction
    ? `<img class="hero-av" src="${esc(depiction)}" alt="${esc(rep.name)}" style="object-fit:cover;">`
    : `<div class="hero-av">${esc(initials(rep.name))}</div>`;

  const sinceYear = cached?.terms?.length
    ? Math.min(...cached.terms.map(t => t.startYear).filter(Boolean))
    : null;

  document.getElementById('repHero').innerHTML = `
    <div class="rep-hero-inner">
      ${avatarHtml}
      <div>
        <div class="hero-name">${esc(rep.name)}</div>
        <div class="hero-meta">${esc(rep.state)}${rep.role === 'Representative' ? `-${esc(rep.district)}` : ''} · ${esc(rep.role)}</div>
        ${party ? `<span class="pill ${partyPillClass(party)}">${esc(partyLabel(party))}</span>` : ''}
        ${sinceYear ? `<span class="pill pill-tag">Since ${sinceYear}</span>` : ''}
        ${website ? `<a href="${esc(website)}" target="_blank" rel="noopener" style="display:block;font-size:12px;color:var(--blue);margin-top:6px;">Official website ↗</a>` : ''}
      </div>
    </div>`;
}

function renderStatRow(idx) {
  const rep = state.reps[idx];
  if (!rep) return;
  const cached = rep.bioguideId ? state.memberCache[rep.bioguideId] : null;

  const terms = cached?.terms || [];
  const termsCount = cached ? terms.length : (rep.termsCount ?? '—');

  const sinceYear = terms.length
    ? Math.min(...terms.map(t => t.startYear).filter(Boolean))
    : '—';

  const districtLabel = rep.role === 'Representative'
    ? `${rep.state}-${rep.district}`
    : rep.state;

  const billCount = cached?.sponsoredLegislation?.length ?? '—';

  document.getElementById('statRow').innerHTML = `
    <div class="stat"><div class="stat-val">${esc(String(termsCount))}</div><div class="stat-label">Terms</div></div>
    <div class="stat"><div class="stat-val">${esc(String(sinceYear))}</div><div class="stat-label">Since</div></div>
    <div class="stat"><div class="stat-val">${esc(districtLabel)}</div><div class="stat-label">District</div></div>
    <div class="stat"><div class="stat-val">${esc(String(billCount))}</div><div class="stat-label">Bills</div></div>`;
}

function renderActivityFeed(idx) {
  const rep = state.reps[idx];
  if (!rep) return;
  const cached = rep.bioguideId ? state.memberCache[rep.bioguideId] : null;
  const feedEl = document.getElementById('activityFeed');

  if (!cached) {
    feedEl.innerHTML = rep.bioguideId
      ? '<div style="padding:16px;font-size:13px;color:var(--text-muted);">Loading activity…</div>'
      : '<div style="padding:16px;font-size:13px;color:var(--text-muted);">Activity details unavailable without member ID.</div>';
    return;
  }

  const bills = cached.sponsoredLegislation || [];
  if (!bills.length) {
    feedEl.innerHTML = '<div style="padding:16px;font-size:13px;color:var(--text-muted);">No sponsored legislation found.</div>';
    return;
  }

  feedEl.innerHTML = bills.slice(0, 5).map(bill => {
    const label = `${billTypeLabel(bill.type)} ${bill.number}`;
    const date = formatDate(bill.introducedDate);
    const action = bill.latestAction?.text || '';
    const topic = bill.policyArea?.name || '';
    const billText = `${label} — ${bill.title}`;

    return `<div class="feed-card">
      <div class="feed-top">
        <span class="feed-badge badge-vote">Bill</span>
        ${topic ? `<span class="feed-badge badge-money" style="background:var(--teal-bg);color:var(--teal-text);">${esc(topic)}</span>` : ''}
        <span class="feed-date">${esc(date)}</span>
      </div>
      <div class="feed-title">${esc(billText)}</div>
      ${action ? `<div class="feed-desc">${esc(action)}</div>` : ''}
      <div class="feed-action">
        <button class="explain-btn"
          data-text="${esc(billText)}"
          data-type="bill">What does this mean?</button>
      </div>
    </div>`;
  }).join('');

  // Wire up explain buttons
  feedEl.querySelectorAll('.explain-btn').forEach(btn => {
    btn.addEventListener('click', () => openExplainModal(btn.dataset.text, btn.dataset.type, btn.dataset.text));
  });
}

// ── MEMBER DETAIL LOADER ──────────────────────────────────────────────────────
async function loadMemberDetail(bioguideId) {
  if (state.memberCache[bioguideId]) return;

  try {
    const data = await apiFetch(`member?bioguideId=${bioguideId}`);
    state.memberCache[bioguideId] = data;
    // Re-render whichever rep is currently active if it's this one
    const activeRep = state.reps[state.activeRepIdx];
    if (activeRep?.bioguideId === bioguideId) {
      renderRepHero(state.activeRepIdx);
      renderStatRow(state.activeRepIdx);
      renderActivityFeed(state.activeRepIdx);
    }
  } catch (e) {
    console.warn('Member detail fetch failed for', bioguideId, e.message);
    // Store a sentinel so we don't retry indefinitely
    state.memberCache[bioguideId] = { _failed: true, sponsoredLegislation: [], terms: [] };
    const activeRep = state.reps[state.activeRepIdx];
    if (activeRep?.bioguideId === bioguideId) {
      renderActivityFeed(state.activeRepIdx);
    }
  }
}

// ── SAY VS. DO FEED (dashboard preview) ───────────────────────────────────────
// Placeholder — full Say vs. Do data requires additional sources (future work)
function renderSayVsDoPreview() {
  document.getElementById('sayVsDoFeed').innerHTML = `
    <div style="padding:12px 0;font-size:13px;color:var(--text-muted);font-style:italic;">
      Say vs. Do comparisons require additional data sources. Coming soon.
    </div>`;
}

// ── EXPLAIN MODAL ─────────────────────────────────────────────────────────────
const modal = document.getElementById('explainModal');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const modalClose = document.getElementById('modalClose');

function openExplainModal(title, type, text) {
  modalTitle.textContent = title;
  modalBody.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  apiPost('explain', { text, type })
    .then(data => {
      modalBody.textContent = data.explanation;
    })
    .catch(e => {
      modalBody.innerHTML = `<span style="color:var(--red-text);">${esc(e.message || 'Could not load explanation. Please try again.')}</span>`;
    });
}

function closeExplainModal() {
  modal.classList.add('hidden');
  document.body.style.overflow = '';
}

modalClose.addEventListener('click', closeExplainModal);
modal.addEventListener('click', e => { if (e.target === modal) closeExplainModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeExplainModal(); });

// ── NAVIGATION ────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item[data-screen]').forEach(item => {
  item.addEventListener('click', () => {
    const screenId = item.dataset.screen;
    showScreen(screenId);
    // Update active state on all nav bars
    document.querySelectorAll('.nav-item').forEach(n => {
      n.classList.toggle('active', n.dataset.screen === screenId);
    });
    // Lazy-load member detail when switching to deeper screens
    const rep = state.reps[state.activeRepIdx];
    if (rep?.bioguideId && !state.memberCache[rep.bioguideId]) {
      loadMemberDetail(rep.bioguideId);
    }
  });
});

document.querySelectorAll('.back-btn[data-back]').forEach(btn => {
  btn.addEventListener('click', () => showScreen(btn.dataset.back));
});

// See-all link wires
document.getElementById('sayVsDoAll')?.addEventListener('click', () => showScreen('screenSVD'));

// ── VOTES SCREEN ──────────────────────────────────────────────────────────────
function renderVotesScreen() {
  const rep = state.reps[state.activeRepIdx];
  const cached = rep?.bioguideId ? state.memberCache[rep.bioguideId] : null;
  const el = document.getElementById('votesContent');

  if (!rep) return;
  if (!cached) {
    el.innerHTML = '<div style="padding:16px;font-size:13px;color:var(--text-muted);">Loading voting record…</div>';
    return;
  }

  // Congress.gov member/votes endpoint is not yet documented — showing sponsored bills as proxy
  const bills = cached.sponsoredLegislation || [];
  if (!bills.length) {
    el.innerHTML = '<div style="padding:16px;font-size:13px;color:var(--text-muted);">No voting record available.</div>';
    return;
  }

  el.innerHTML = `<div style="padding:0 16px;font-size:12px;color:var(--text-hint);margin-bottom:12px;">
      Showing sponsored legislation. Full voting record data coming soon.
    </div>` +
    bills.map(bill => {
      const label = `${billTypeLabel(bill.type)} ${bill.number} — ${bill.title}`;
      const date = formatDate(bill.introducedDate);
      return `<div class="feed-card" style="margin:0 16px 8px;">
        <div class="feed-top">
          <span class="feed-badge badge-vote">Sponsored</span>
          <span class="feed-date">${esc(date)}</span>
        </div>
        <div class="feed-title">${esc(label)}</div>
        ${bill.latestAction?.text ? `<div class="feed-desc">${esc(bill.latestAction.text)}</div>` : ''}
        <div class="feed-action">
          <button class="explain-btn"
            data-text="${esc(label)}"
            data-type="bill">What does this mean?</button>
        </div>
      </div>`;
    }).join('');

  el.querySelectorAll('.explain-btn').forEach(btn => {
    btn.addEventListener('click', () => openExplainModal(btn.dataset.text, 'bill', btn.dataset.text));
  });
}

// ── MONEY SCREEN ──────────────────────────────────────────────────────────────
function renderMoneyScreen() {
  const el = document.getElementById('moneyContent');
  el.innerHTML = `
    <div class="money-card" style="margin:0 16px;">
      <div style="font-size:13px;font-weight:500;margin-bottom:12px;">Campaign funding sources</div>
      <div style="font-size:12px;color:var(--text-hint);font-style:italic;line-height:1.6;">
        Campaign finance data from FEC and OpenSecrets will be displayed here.
        This feature requires an OpenSecrets API integration — coming soon.
      </div>
    </div>`;
}

// ── SAY VS. DO FULL SCREEN ────────────────────────────────────────────────────
function renderSVDScreen() {
  document.getElementById('svdCards').innerHTML = `
    <div class="svd-card">
      <div style="font-size:13px;color:var(--text-muted);font-style:italic;line-height:1.6;">
        Say vs. Do comparisons match public statements against voting records,
        donor relationships, and stock trades. This feature requires additional
        data sources (Capitol Trades, GDELT, FEC) — coming soon.
      </div>
    </div>`;
}

// ── LEARN SCREEN ──────────────────────────────────────────────────────────────
const LEARN_ITEMS = [
  { title: 'How a bill becomes a law', desc: 'The step-by-step process from introduction to presidential signature.', term: 'How does a bill become a law in the United States Congress?' },
  { title: 'What is a congressional committee?', desc: 'Why most legislative work happens before the floor vote.', term: 'congressional committee' },
  { title: 'Senators vs. Representatives', desc: 'Why Congress has two chambers and how they differ.', term: 'What is the difference between a U.S. Senator and a U.S. House Representative?' },
  { title: 'What is the STOCK Act?', desc: 'The law that requires members of Congress to disclose stock trades.', term: 'STOCK Act' },
  { title: 'What is a PAC?', desc: 'How political action committees raise and spend money.', term: 'political action committee PAC' },
  { title: 'What does "cloture" mean?', desc: 'The Senate procedure used to end debate and force a vote.', term: 'cloture' },
];

function renderLearnScreen() {
  document.getElementById('learnContent').innerHTML = LEARN_ITEMS.map(item =>
    `<div class="learn-card" data-term="${esc(item.term)}" data-title="${esc(item.title)}" style="margin:0 16px 8px;">
      <div class="learn-card-title">${esc(item.title)}</div>
      <div class="learn-card-desc">${esc(item.desc)}</div>
    </div>`
  ).join('');

  document.querySelectorAll('.learn-card').forEach(card => {
    card.addEventListener('click', () =>
      openExplainModal(card.dataset.title, 'term', card.dataset.term)
    );
  });
}

// ── PREMIUM SCREEN ────────────────────────────────────────────────────────────
function renderPremiumScreen() {
  const el = document.getElementById('federalRepList');
  if (!state.reps.length) return;
  el.innerHTML = state.reps.map(rep => {
    const party = rep.party;
    return `<div class="rep-row-card">
      <div class="rep-av-sm">${esc(initials(rep.name))}</div>
      <div>
        <div class="rep-name-sm">${esc(rep.name)}</div>
        <div class="rep-role-sm">${esc(rep.role)} · ${esc(rep.state)}${party ? ` · ${esc(partyLabel(party))}` : ''}</div>
      </div>
    </div>`;
  }).join('');
}

// Wire profile button to premium screen
document.getElementById('profileBtn')?.addEventListener('click', () => {
  renderPremiumScreen();
  showScreen('screenPremium');
});

// ── SCREEN CHANGE HOOKS ───────────────────────────────────────────────────────
// Re-render data-dependent screens when they become visible
const screenRenderMap = {
  screenVotes: renderVotesScreen,
  screenMoney: renderMoneyScreen,
  screenSVD: renderSVDScreen,
  screenLearn: renderLearnScreen,
};

const _origShowScreen = showScreen;
// Override showScreen to trigger screen-specific renders
(function () {
  const original = showScreen;
  // We redefine by wrapping the existing function reference
  window._showScreenWithRender = function (id) {
    original(id);
    if (screenRenderMap[id]) screenRenderMap[id]();
  };
})();

// Patch nav clicks to use the render-aware version
document.querySelectorAll('.nav-item[data-screen]').forEach(item => {
  // Re-wire (the first listener above covers showScreen; we add render here)
  item.addEventListener('click', () => {
    if (screenRenderMap[item.dataset.screen]) screenRenderMap[item.dataset.screen]();
  });
});

// ── INIT ──────────────────────────────────────────────────────────────────────
renderSayVsDoPreview();
renderLearnScreen();
showScreen('screenZip');
