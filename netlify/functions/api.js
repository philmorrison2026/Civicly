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

// Congress.gov enrichment for a House member (state + numeric district)
async function enrichHouse(state, districtNum) {
  const data = await cFetch(
    `/member/congress/${CURRENT_CONGRESS}/${state}/${districtNum}?currentMember=true&limit=5`
  );
  const m = data?.members?.[0];
  if (!m) return null;
  return {
    bioguideId: m.bioguideId || null,
    party: normalizeParty(m.partyName),
    depiction: m.depiction?.imageUrl || null,
    website: m.officialWebsiteUrl || null,
    termsCount: (m.terms || []).length,
  };
}

// Congress.gov enrichment for a Senator — fetches all state members for this congress,
// filters to Senate-chamber members, matches by last name from the WIMR name string
async function enrichSenator(state, wimrName) {
  const data = await cFetch(
    `/member/congress/${CURRENT_CONGRESS}/${state}?currentMember=true&limit=20`
  );
  const members = data?.members || [];
  if (!members.length) return null;

  const senators = members.filter(m =>
    (m.terms || []).some(t => t.chamber === 'Senate')
  );

  const lastName = wimrName.trim().split(' ').pop().toLowerCase();
  const match = senators.find(m => {
    const govName = `${m.name || ''} ${m.invertedOrderName || ''}`.toLowerCase();
    return govName.includes(lastName);
  });

  if (!match) return null;
  return {
    bioguideId: match.bioguideId || null,
    party: normalizeParty(match.partyName),
    depiction: match.depiction?.imageUrl || null,
    website: match.officialWebsiteUrl || null,
    termsCount: (match.terms || []).length,
  };
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
  await Promise.all(reps.map(async (rep) => {
    try {
      let enriched = null;
      if (rep.role === 'Representative') {
        const districtNum = parseInt(rep.district, 10);
        if (!isNaN(districtNum)) {
          enriched = await enrichHouse(rep.state, districtNum);
        }
      } else {
        enriched = await enrichSenator(rep.state, rep.name);
      }
      if (enriched) Object.assign(rep, enriched, { enriched: true });
    } catch {
      // enrichment is best-effort; WIMR data alone is still usable
    }
  }));

  // Sort: House rep first, then Senior Senator, then Junior Senator
  const roleOrder = { 'Representative': 0, 'Senior Senator': 1, 'Junior Senator': 2, 'Senator': 3 };
  reps.sort((a, b) => (roleOrder[a.role] ?? 4) - (roleOrder[b.role] ?? 4));

  return ok({ zip, state: reps[0]?.state || '', reps, approximate: true });
}

// ── HANDLER: /api/member?bioguideId={id} ─────────────────────────────────────
async function handleMember(params) {
  const bioguideId = (params.bioguideId || '').trim();
  if (!bioguideId) return fail(400, 'bioguideId is required.');

  const [memberData, sponsored, cosponsored] = await Promise.all([
    cFetch(`/member/${bioguideId}`),
    cFetch(`/member/${bioguideId}/sponsored-legislation?limit=20`),
    cFetch(`/member/${bioguideId}/cosponsored-legislation?limit=10`),
  ]);

  if (!memberData?.member) {
    return fail(404, 'Member not found.');
  }

  const m = memberData.member;
  const currentParty = m.partyHistory?.[m.partyHistory.length - 1]?.partyAbbreviation
    || m.partyName
    || null;

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
    sponsoredLegislation: sponsored?.sponsoredLegislation || [],
    cosponsoredLegislation: cosponsored?.cosponsoredLegislation || [],
  });
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
    bill: `You are a nonpartisan civic education tool. Explain the following in plain English in 3-4 sentences that a non-political person would understand. Focus on what it actually does and who it affects. Do not editorialize or express any political opinion.\n\nTopic: ${text}`,
    vote: `You are a nonpartisan civic education tool. Explain this congressional vote in plain English in 2-3 sentences. Describe what the bill would do and what voting yes or no means in practice. Do not editorialize.\n\nVote: ${text}`,
    conflict: `You are a nonpartisan civic education tool. Summarize the following sequence of public events in neutral, factual language in 2-3 sentences. Do not draw conclusions — just describe what the public record shows.\n\nEvents: ${text}`,
    term: `Explain this political term in one simple sentence that a first-time voter would understand: ${text}`,
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
        max_tokens: 300,
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
    if (path === 'explain' && event.httpMethod === 'POST') return await handleExplain(event.body);
    return fail(404, `Unknown endpoint: ${path}`);
  } catch (e) {
    console.error('Unhandled error:', e);
    return fail(500, 'An unexpected error occurred.');
  }
};
