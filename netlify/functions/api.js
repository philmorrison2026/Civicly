const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const CONGRESS_BASE = 'https://api.congress.gov/v3';
const CURRENT_CONGRESS = 119;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function ok(body) {
  return { statusCode: 200, headers: CORS, body: JSON.stringify(body) };
}

function fail(statusCode, message) {
  return { statusCode, headers: CORS, body: JSON.stringify({ error: message }) };
}

// Congress.gov fetch — returns parsed JSON or null on any failure
async function cFetch(path) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${CONGRESS_BASE}${path}${sep}format=json&api_key=${process.env.CONGRESS_API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// FEC fetch — returns parsed JSON or null on any failure
async function fFetch(path) {
  if (!process.env.FEC_API_KEY) return null;
  const sep = path.includes('?') ? '&' : '?';
  const url = `https://api.open.fec.gov/v1${path}${sep}api_key=${process.env.FEC_API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function normalizeParty(raw) {
  if (!raw) return null;
  const c = raw.charAt(0).toUpperCase();
  if (c === 'D') return 'D';
  if (c === 'R') return 'R';
  if (c === 'I') return 'I';
  return raw;
}

// Determine role from WIMR district + office fields.
// WIMR sometimes returns "Senior Senator"/"Junior Senator" in district,
// but often just leaves district empty for senators — use office as fallback.
function classifyRole(district, office) {
  const d = (district || '').toString().toLowerCase();
  const o = (office || '').toString().toLowerCase();
  if (d.includes('senior senator')) return 'Senior Senator';
  if (d.includes('junior senator')) return 'Junior Senator';
  if (d.includes('senator')) return 'Senator';
  if (o.includes('senate')) return 'Senator';
  return 'Representative';
}

// Convert Congress.gov "LAST, FIRST" list-endpoint name → "First Last"
function toDirectOrder(raw) {
  if (!raw) return null;
  const parts = raw.split(',').map(s => s.trim());
  if (parts.length < 2) return raw;
  const last = parts[0].replace(/\b\w/g, c => c.toUpperCase());
  const first = parts.slice(1).join(' ').trim().replace(/\b\w/g, c => c.toUpperCase());
  return first ? `${first} ${last}` : last;
}

// Congress.gov enrichment for a House member (state + numeric district).
// Uses district-level lookup so the current holder is always authoritative —
// WIMR frequently returns members who resigned, retired, or moved chambers.
async function enrichHouse(state, districtNum) {
  const data = await cFetch(
    `/member/congress/${CURRENT_CONGRESS}/${state}/${districtNum}?currentMember=true&limit=5`
  );
  const m = data?.members?.[0];
  if (!m) return null;
  // directOrderName only available on detail endpoint; fall back to inverting list-endpoint name
  return {
    name: m.directOrderName || m.invertedOrderName || toDirectOrder(m.name) || null,
    bioguideId: m.bioguideId || null,
    party: normalizeParty(m.partyName),
    depiction: m.depiction?.imageUrl || null,
    website: m.officialWebsiteUrl || null,
    termsCount: (m.terms || []).length,
  };
}

// Fetch all current senators for a state from Congress.gov.
// Queries both endpoints in parallel and deduplicates, since the congress-specific
// endpoint sometimes returns empty and the base endpoint has inconsistent term structures.
async function fetchCurrentSenators(state) {
  const [primary, fallback] = await Promise.all([
    cFetch(`/member/congress/${CURRENT_CONGRESS}/${state}?currentMember=true&limit=20`),
    cFetch(`/member?stateCode=${state}&currentMember=true&limit=20`),
  ]);

  // Merge and deduplicate by bioguideId
  const all = [...(primary?.members || []), ...(fallback?.members || [])];
  const seen = new Set();
  const members = all.filter(m => {
    if (!m.bioguideId || seen.has(m.bioguideId)) return false;
    seen.add(m.bioguideId);
    return true;
  });

  return members
    .filter(m => {
      const terms = Array.isArray(m.terms) ? m.terms : [];
      return terms.some(t => (t.chamber || '').toLowerCase().includes('senate'));
    })
    .map(m => ({
      name: m.directOrderName || m.invertedOrderName || toDirectOrder(m.name) || null,
      bioguideId: m.bioguideId || null,
      party: normalizeParty(m.partyName),
      depiction: m.depiction?.imageUrl || null,
      website: m.officialWebsiteUrl || null,
      termsCount: (m.terms || []).length,
    }));
}

// ── HANDLER: /api/reps?zip={zip} ─────────────────────────────────────────────
async function handleReps(params) {
  const zip = (params.zip || '').trim();
  if (!/^\d{5}$/.test(zip)) {
    return fail(400, 'A 5-digit ZIP code is required.');
  }

  // Step 1: WIMR lookup → name, state, district, phone, office, website
  let wimrResults;
  try {
    const res = await fetch(
      `https://whoismyrepresentative.com/getall_mems.php?zip=${zip}&output=json`
    );
    if (!res.ok) throw new Error(`WIMR ${res.status}`);
    const body = await res.json();
    wimrResults = body?.results;
  } catch (e) {
    console.error('WIMR error:', e.message);
    return fail(502, 'Could not reach the representative lookup service. Please try again.');
  }

  if (!wimrResults || !wimrResults.length) {
    return fail(404, 'No representatives found for this ZIP code. Please verify and try again.');
  }

  // Step 2: Build initial rep objects
  const reps = wimrResults.map(r => ({
    name: r.name || '',
    state: r.state || '',
    district: r.district || '',
    phone: r.phone || '',
    office: r.office || '',
    website: r.link || r.website || '',
    role: classifyRole(r.district, r.office),
    // Filled by Congress.gov enrichment below
    bioguideId: null,
    party: null,
    depiction: null,
    termsCount: null,
    enriched: false,
  }));

  // Step 3: Congress.gov enrichment — parallel, best-effort
  // House reps: enrich by district (authoritative current holder)
  // Senators: always replace with current Congress.gov senators for the state —
  //   WIMR senator data can be years stale (e.g., shows Harris/Feinstein for CA)
  const houseReps = reps.filter(r => r.role === 'Representative');
  const senatorSlots = reps.filter(r => r.role !== 'Representative');
  const state = reps[0]?.state || '';

  const [, currentSenators] = await Promise.all([
    Promise.all(houseReps.map(async (rep) => {
      try {
        const districtNum = parseInt(rep.district, 10);
        if (!isNaN(districtNum)) {
          const enriched = await enrichHouse(rep.state, districtNum);
          if (enriched) {
            const { name: enrichedName, ...enrichedRest } = enriched;
            Object.assign(rep, enrichedRest, { enriched: true });
            if (enrichedName) rep.name = enrichedName;
          }
        }
      } catch { /* best-effort */ }
    })),
    fetchCurrentSenators(state).catch(() => []),
  ]);

  // Assign current senators to WIMR slots.
  // Strategy: name-match first (handles slots where WIMR has the right person),
  // then fill remaining unmatched slots with unused current senators
  // (handles slots where WIMR has a retired/departed person like Romney or Harris).
  const used = new Set();
  for (const rep of senatorSlots) {
    const lastName = rep.name.trim().split(' ').pop().toLowerCase();
    let matchIdx = currentSenators.findIndex((s, i) =>
      !used.has(i) && (s.name || '').toLowerCase().includes(lastName)
    );
    if (matchIdx === -1) {
      matchIdx = currentSenators.findIndex((_, i) => !used.has(i));
    }
    if (matchIdx >= 0) {
      used.add(matchIdx);
      Object.assign(rep, currentSenators[matchIdx], { enriched: true });
    }
  }

  // Sort: House rep first, then Senior Senator, then Junior Senator
  const roleOrder = { 'Representative': 0, 'Senior Senator': 1, 'Junior Senator': 2, 'Senator': 3 };
  reps.sort((a, b) => (roleOrder[a.role] ?? 4) - (roleOrder[b.role] ?? 4));

  return ok({ zip, state: reps[0]?.state || '', reps, approximate: true });
}

// ── HANDLER: /api/member?bioguideId={id} ─────────────────────────────────────
async function handleMember(params) {
  const bioguideId = (params.bioguideId || '').trim();
  if (!bioguideId) return fail(400, 'bioguideId is required.');

  const [memberData, sponsored, cosponsored, committeeData] = await Promise.all([
    cFetch(`/member/${bioguideId}`),
    cFetch(`/member/${bioguideId}/sponsored-legislation?limit=250`),
    cFetch(`/member/${bioguideId}/cosponsored-legislation?limit=100`),
    cFetch(`/member/${bioguideId}/committee-assignments`),
  ]);

  if (!memberData?.member) return fail(404, 'Member not found.');

  const m = memberData.member;
  const currentParty = m.partyHistory?.[m.partyHistory.length - 1]?.partyAbbreviation
    || m.partyName
    || null;

  // Normalize committee data — Congress.gov may use committeeAssignments or committees key
  const rawCommittees = committeeData?.committeeAssignments || committeeData?.committees || [];
  const committees = rawCommittees
    .map(c => ({
      name: c.name || c.committee?.name || '',
      chamber: c.chamber || '',
      rank: c.rank || c.title || c.rankLabel || null,
      systemCode: c.systemCode || c.committee?.systemCode || null,
    }))
    .filter(c => c.name);

  return ok({
    bioguideId,
    name: m.directOrderName || m.invertedOrderName || '',
    party: normalizeParty(currentParty),
    state: m.state || '',
    district: m.district ?? null,
    website: m.officialWebsiteUrl || '',
    depiction: m.depiction?.imageUrl || null,
    birthYear: m.birthYear || null,
    terms: m.terms || [],
    addressInformation: m.addressInformation || null,
    committees,
    sponsoredLegislation: sponsored?.sponsoredLegislation || [],
    cosponsoredLegislation: cosponsored?.cosponsoredLegislation || [],
  });
}

// ── HANDLER: /api/votes — House Clerk XML + Senate LIS XML ───────────────────

// Generic fetch returning text body or null (with race-based timeout)
async function fetchText(url, ms = 5000) {
  try {
    const req = fetch(url).then(r => r.ok ? r.text() : null).catch(() => null);
    const timer = new Promise(r => setTimeout(() => r(null), ms));
    return await Promise.race([req, timer]);
  } catch { return null; }
}

// Probe multiple roll-call numbers in parallel; return highest that exists
async function probeMax(urls) {
  const results = await Promise.all(
    urls.map(({ n, url, marker }) =>
      fetchText(url, 3000).then(t => (t?.includes(marker) ? n : 0))
    )
  );
  return Math.max(0, ...results);
}

async function findHouseMax(year) {
  return probeMax([500, 350, 200, 100, 50, 20].map(n => ({
    n,
    url: `https://clerk.house.gov/evs/${year}/roll${String(n).padStart(3, '0')}.xml`,
    marker: '<rollcall-vote',
  })));
}

async function findSenateMax(congress, session) {
  return probeMax([500, 350, 200, 100, 50, 20].map(n => ({
    n,
    url: `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${congress}${session}/vote_${congress}_${session}_${String(n).padStart(5, '0')}.xml`,
    marker: '<roll_call_vote',
  })));
}

function parseHouseVote(xml, bioguideId) {
  const m = new RegExp(
    `name-id="${bioguideId}"[^>]*>[^<]*<\\/legislator>\\s*<vote>([^<]+)<\\/vote>`, 'i'
  ).exec(xml);
  if (!m) return null;
  const get = (re) => (re.exec(xml)?.[1] || '').trim();
  return {
    position:  m[1].trim(),
    question:  get(/<vote-desc>([^<]+)<\/vote-desc>/i) || get(/<vote-question>([^<]+)<\/vote-question>/i),
    date:      get(/<action-date[^>]*>([^<]+)<\/action-date>/i),
    result:    get(/<vote-result>([^<]+)<\/vote-result>/i),
    bill:      get(/<legis-num>([^<]+)<\/legis-num>/i),
    yeas:      parseInt(get(/<yea-count>(\d+)<\/yea-count>/i) || '0'),
    nays:      parseInt(get(/<nay-count>(\d+)<\/nay-count>/i) || '0'),
  };
}

function parseSenateVote(xml, lastName) {
  const safe = lastName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(
    `<last_name>${safe}<\\/last_name>[\\s\\S]*?<vote_cast>([^<]+)<\\/vote_cast>`, 'i'
  ).exec(xml);
  if (!m) return null;
  const get = (re) => (re.exec(xml)?.[1] || '').trim();
  return {
    position: m[1].trim(),
    question: get(/<vote_document_text>([^<]+)<\/vote_document_text>/i) || get(/<vote_question_text>([^<]+)<\/vote_question_text>/i),
    date:     get(/<vote_date>([^<]+)<\/vote_date>/i),
    result:   get(/<vote_result>([^<]+)<\/vote_result>/i),
    bill:     '',
    yeas:     parseInt(get(/<yeas>(\d+)<\/yeas>/i) || '0'),
    nays:     parseInt(get(/<nays>(\d+)<\/nays>/i) || '0'),
  };
}

async function fetchHouseVotes(bioguideId) {
  const votes = [];
  for (const year of [2026, 2025]) {
    if (votes.length >= 15) break;
    const max = await findHouseMax(year);
    if (!max) continue;
    const nums = Array.from({ length: Math.min(20, max) }, (_, i) => max - i).filter(n => n > 0);
    for (let i = 0; i < nums.length && votes.length < 15; i += 7) {
      const batch = nums.slice(i, i + 7);
      const texts = await Promise.all(batch.map(n =>
        fetchText(`https://clerk.house.gov/evs/${year}/roll${String(n).padStart(3, '0')}.xml`, 4500)
      ));
      texts.forEach((t, j) => {
        if (!t) return;
        const p = parseHouseVote(t, bioguideId);
        if (p) votes.push({ ...p, chamber: 'House', rollNum: batch[j], year });
      });
    }
  }
  return votes;
}

async function fetchSenateVotes(lastName) {
  const votes = [];
  for (const [congress, session] of [[119, 2], [119, 1]]) {
    if (votes.length >= 15) break;
    const max = await findSenateMax(congress, session);
    if (!max) continue;
    const base = `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${congress}${session}`;
    const nums = Array.from({ length: Math.min(20, max) }, (_, i) => max - i).filter(n => n > 0);
    for (let i = 0; i < nums.length && votes.length < 15; i += 7) {
      const batch = nums.slice(i, i + 7);
      const texts = await Promise.all(batch.map(n =>
        fetchText(`${base}/vote_${congress}_${session}_${String(n).padStart(5, '0')}.xml`, 4500)
      ));
      texts.forEach((t, j) => {
        if (!t) return;
        const p = parseSenateVote(t, lastName);
        if (p) votes.push({ ...p, chamber: 'Senate', rollNum: batch[j], congress, session });
      });
    }
  }
  return votes;
}

async function handleVotes(params) {
  const bioguideId = (params.bioguideId || '').trim();
  const chamber    = (params.chamber   || 'H').trim().toUpperCase();
  const lastName   = (params.lastName  || '').trim();
  if (!bioguideId) return fail(400, 'bioguideId is required.');
  try {
    const votes = chamber === 'S'
      ? await fetchSenateVotes(lastName)
      : await fetchHouseVotes(bioguideId);
    return ok({ source: 'xml', chamber, votes });
  } catch (e) {
    console.error('Vote fetch error:', e.message);
    return ok({ source: 'xml', chamber, votes: [] });
  }
}

// ── HANDLER: POST /api/explain ────────────────────────────────────────────────
async function handleExplain(rawBody) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return fail(503, 'Explanation service is not configured (ANTHROPIC_API_KEY missing).');
  }

  let text, type;
  try {
    ({ text, type } = JSON.parse(rawBody || '{}'));
  } catch {
    return fail(400, 'Invalid JSON body.');
  }
  if (!text) return fail(400, 'text is required.');

  const prompts = {
    bill: `You are a nonpartisan civic education tool. Explain the following bill in plain English in 3-4 sentences that a non-political person would understand. Focus on what it actually does, who it affects, and what problem it's trying to solve. Use all the context provided below — do not say you lack information. If the exact bill details aren't in your training data, reason from the bill number, title, policy area, and congressional actions to give the most useful explanation possible.\n\nBill context:\n${text}`,
    vote: `You are a nonpartisan civic education tool. Explain this congressional vote in plain English in 2-3 sentences. Describe what the bill would do and what voting yes or no means in practice. Do not editorialize.\n\nVote: ${text}`,
    conflict: `You are a nonpartisan civic education tool. Summarize the following sequence of public events in neutral, factual language in 2-3 sentences. Do not draw conclusions — just describe what the public record shows.\n\nEvents: ${text}`,
    term: `Explain this political term in one simple sentence that a first-time voter would understand: ${text}`,
    poke: `You are a civic engagement assistant for an app called Civicly. Write a short, respectful message from a constituent to their representative. The message must be polite, nonpartisan, and specific to the issue and reaction provided. Write in first person as the constituent. Do not mention Civicly. Under 100 words. End with a clear, respectful ask. Do not add a subject line.\n\n${text}\n\nWrite only the message body, starting with the representative's title and last name (e.g. "Senator Lee," or "Representative Maloy,") and ending with "A constituent from [their state or district]."`,
    aiprofile: `You are a nonpartisan civic profile generator. Based on the following data about a U.S. representative, generate a concise factual profile. Return ONLY valid JSON — no markdown, no explanation, just the JSON object.\n\n${text}\n\nReturn exactly this JSON shape:\n{"topIssues":["up to 5 short phrases"],"legislativeFocus":"2-3 sentences on their legislative work based on bills and committees","summary":"2-3 sentences overall at 8th-grade reading level, nonpartisan"}\n\nRules: No accusations. No partisan framing. Focus only on observable legislative activity. Return only the JSON.`,
  };

  const prompt = prompts[type] || prompts.bill;

  let result;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: type === 'aiprofile' ? 600 : 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    result = await res.json();
  } catch {
    return fail(502, 'Explanation service unavailable. Please try again.');
  }

  const explanation = result?.content?.[0]?.text;
  if (!explanation) return fail(502, 'Unexpected response from explanation service.');

  return ok({ explanation });
}

// ── HANDLER: /api/money?name={name}&state={state}&office={H|S}&district={d} ──
async function handleMoney(params) {
  if (!process.env.FEC_API_KEY) {
    return fail(503, 'Campaign finance service is not configured (FEC_API_KEY missing).');
  }

  const name = (params.name || '').trim();
  const state = (params.state || '').trim().toUpperCase();
  const office = (params.office || '').trim().toUpperCase();
  const district = (params.district || '').trim();

  if (!name || !state || !office) {
    return fail(400, 'name, state, and office are required.');
  }

  const lastName = name.split(' ').pop();
  let searchPath = `/candidates/search/?q=${encodeURIComponent(lastName)}&state=${state}&office=${office}&sort=-receipts&per_page=10&has_raised_funds=true`;
  if (office === 'H' && district) {
    searchPath += `&district=${String(parseInt(district, 10) || 0).padStart(2, '0')}`;
  }

  const searchData = await fFetch(searchPath);
  const candidates = searchData?.results || [];
  if (!candidates.length) return ok({ found: false, name, state, office });

  const candidate = candidates[0];
  const candidateId = candidate.candidate_id;

  // /schedules/schedule_a/by_employer/ requires committee_id — candidate_id is silently ignored.
  // Try principal_committees from the search result first; fall back to a dedicated lookup.
  let committeeId = candidate.principal_committees?.[0]?.committee_id || null;
  if (!committeeId) {
    const cData = await fFetch(`/candidate/${candidateId}/committees/?designation=P&per_page=5`);
    committeeId = cData?.results?.[0]?.committee_id || null;
  }

  if (!committeeId) {
    return ok({ found: true, candidateId, name: candidate.name, party: candidate.party, totals: null, topEmployers: [] });
  }

  const [totalsData, emp2024, emp2022, emp2026] = await Promise.all([
    fFetch(`/committee/${committeeId}/totals/?per_page=10`),
    fFetch(`/schedules/schedule_a/by_employer/?committee_id=${committeeId}&cycle=2024&sort=-total&per_page=25`),
    fFetch(`/schedules/schedule_a/by_employer/?committee_id=${committeeId}&cycle=2022&sort=-total&per_page=25`),
    fFetch(`/schedules/schedule_a/by_employer/?committee_id=${committeeId}&cycle=2026&sort=-total&per_page=25`),
  ]);

  // Sort cycles descending in JS; don't rely on FEC sort param
  const allCycleTotals = (totalsData?.results || []).sort((a, b) => (b.cycle || 0) - (a.cycle || 0));
  const bestCycle = allCycleTotals.find(t => (t.receipts || 0) > 50000) || allCycleTotals[0] || null;

  // FEC field is `employer` (not `employer_name`). Filter blanks and FEC noise strings.
  const FEC_NOISE = new Set(['NULL', 'N/A', 'NA', 'NONE', 'NOT EMPLOYED', 'UNEMPLOYED', 'NO EMPLOYER']);
  const namedEmployers = (results) =>
    (results?.results || []).filter(e => {
      const v = (e.employer || '').trim().toUpperCase();
      return v.length > 0 && !FEC_NOISE.has(v);
    });
  const empCandidates = [emp2024, emp2022, emp2026].map(namedEmployers);
  const employers = empCandidates.reduce((best, cur) => cur.length > best.length ? cur : best, []);

  // Fetch top individual itemized donors for the best cycle
  const donorCycle = bestCycle?.cycle || 2024;
  const donorsData = await fFetch(
    `/schedules/schedule_a/?committee_id=${committeeId}&two_year_transaction_period=${donorCycle}` +
    `&entity_type=IND&sort=-contribution_receipt_amount&per_page=20`
  );
  const titleCase = s => (s || '').replace(/\b\w+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  const topDonors = (donorsData?.results || [])
    .filter(d => d.contributor_name && (d.contribution_receipt_amount || 0) > 0)
    .slice(0, 10)
    .map(d => ({
      name: titleCase(d.contributor_name),
      employer: titleCase(d.contributor_employer || ''),
      occupation: titleCase(d.contributor_occupation || ''),
      amount: d.contribution_receipt_amount || 0,
      date: d.contribution_receipt_date || null,
      city: d.contributor_city || null,
      state: d.contributor_state || null,
    }));

  return ok({
    found: true,
    candidateId,
    committeeId,
    name: candidate.name,
    party: candidate.party,
    totals: bestCycle ? {
      cycle: bestCycle.cycle,
      receipts: bestCycle.receipts || 0,
      disbursements: bestCycle.disbursements || 0,
      cashOnHand: bestCycle.cash_on_hand_end_period || 0,
      individualContributions: bestCycle.individual_itemized_contributions || bestCycle.individual_contributions || 0,
      pacContributions: bestCycle.other_political_committee_contributions || 0,
    } : null,
    topEmployers: employers.slice(0, 8).map(e => ({
      employer: e.employer,
      total: e.total || 0,
      count: e.count || 0,
    })),
    topDonors,
  });
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  // netlify.toml redirects /api/* → /.netlify/functions/api (path is the splat after "api")
  // But with functions-based routing the raw path may be /.netlify/functions/api/reps
  const raw = event.path || '';
  const path = raw
    .replace(/^\/.netlify\/functions\/api\/?/, '')
    .replace(/^\/api\/?/, '')
    .replace(/^\//, '');

  const params = event.queryStringParameters || {};

  try {
    if (path === 'reps') return await handleReps(params);
    if (path === 'member') return await handleMember(params);
    if (path === 'money') return await handleMoney(params);
    if (path === 'votes') return await handleVotes(params);
    if (path === 'explain' && event.httpMethod === 'POST') return await handleExplain(event.body);
    return fail(404, `Unknown endpoint: ${path}`);
  } catch (e) {
    console.error('Unhandled error:', e);
    return fail(500, 'An unexpected error occurred.');
  }
};
