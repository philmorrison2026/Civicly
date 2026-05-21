const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const path = event.path.replace('/.netlify/functions/api/', '').replace('/.netlify/functions/api', '');
  const params = event.queryStringParameters || {};

  try {
    if (path === 'reps') {
      const zip = params.zip;
      if (!zip) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Zip code required' }) };
      const res = await fetch(
        https://api.congress.gov/v3/member?zip=&limit=10&api_key=
      );
      const data = await res.json();
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    if (path === 'votes') {
      const memberId = params.memberId;
      const res = await fetch(
        https://api.congress.gov/v3/member//votes?limit=20&api_key=
      );
      const data = await res.json();
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    if (path === 'explain') {
      const { text, type } = JSON.parse(event.body || '{}');
      const prompts = {
        bill: You are a nonpartisan civic education tool. Explain this in plain English in 3-4 sentences a non-political person would understand. Focus on what it actually does and who it affects. Do not editorialize. Topic: ,
        conflict: You are a nonpartisan civic education tool. Summarize this sequence of public events in neutral, factual language in 2-3 sentences. Do not draw conclusions — just describe what the public record shows and when. Events: ,
        term: Explain this political term in one simple sentence a first-time voter would understand: 
      };
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 300,
          messages: [{ role: 'user', content: prompts[type] || prompts.bill }]
        })
      });
      const data = await res.json();
      return { statusCode: 200, headers, body: JSON.stringify({ explanation: data.content[0].text }) };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Unknown endpoint' }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
