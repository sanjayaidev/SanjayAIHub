// lib/github.js
// Thin wrapper around the GitHub REST API used for OAuth + repo listing.

const GITHUB_API = 'https://api.github.com';

/**
 * Exchange an OAuth "code" for an access token.
 * `redirectUri` must be byte-for-byte identical to the one used in the
 * authorize step (see routes/auth.js's getRedirectUri) — GitHub rejects
 * the exchange otherwise.
 */
export async function exchangeCodeForToken(code, redirectUri) {
  console.log('[GitHub OAuth] Exchanging code for token...');
  console.log('[GitHub OAuth] Client ID present:', !!process.env.GITHUB_CLIENT_ID);
  console.log('[GitHub OAuth] Client Secret present:', !!process.env.GITHUB_CLIENT_SECRET);
  console.log('[GitHub OAuth] Redirect URI:', redirectUri);
  
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });

  console.log('[GitHub OAuth] Response status:', res.status);
  const data = await res.json();
  console.log('[GitHub OAuth] Response data:', JSON.stringify({ ...data, access_token: data.access_token ? '[REDACTED]' : undefined }));
  
  if (data.error) {
    throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`);
  }
  if (!data.access_token) {
    throw new Error('GitHub OAuth did not return an access token');
  }
  return data.access_token;
}

/**
 * Fetch the authenticated user's profile.
 */
export async function getGithubUser(token) {
  console.log('[GitHub OAuth] Fetching user info from GitHub API');
  const res = await fetch(`${GITHUB_API}/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  console.log('[GitHub OAuth] User API response status:', res.status);
  if (!res.ok) {
    const errorText = await res.text();
    console.error('[GitHub OAuth] User API error:', errorText);
    throw new Error(`GitHub /user failed: ${res.status} ${errorText}`);
  }
  return res.json();
}

/**
 * List repos the authenticated user has access to (owned, collaborator, org member).
 * Paginates up to `maxPages` pages of 100.
 */
export async function listGithubRepos(token, { maxPages = 3 } = {}) {
  const repos = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(
      `${GITHUB_API}/user/repos?sort=updated&per_page=100&page=${page}&affiliation=owner,collaborator,organization_member`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      }
    );
    if (!res.ok) {
      throw new Error(`GitHub /user/repos failed: ${res.status} ${await res.text()}`);
    }
    const batch = await res.json();
    repos.push(...batch);
    if (batch.length < 100) break; // last page
  }

  return repos.map(r => ({
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    owner: r.owner?.login,
    private: r.private,
    defaultBranch: r.default_branch,
    cloneUrl: r.clone_url,
    htmlUrl: r.html_url,
    updatedAt: r.updated_at,
  }));
}

/**
 * Open a pull request from `head` into `base` on the given repo.
 */
export async function createPullRequest(token, { fullName, title, body, head, base }) {
  const res = await fetch(`${GITHUB_API}/repos/${fullName}/pulls`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, body, head, base }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`GitHub PR create failed: ${res.status} ${data.message || JSON.stringify(data)}`);
  }
  return { number: data.number, url: data.html_url };
}
