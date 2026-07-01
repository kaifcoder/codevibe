import { NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';

// Lists the signed-in user's own public repositories so the home-screen
// "Import from GitHub" dialog can offer them as one-click import targets.
// Uses the GitHub OAuth token Clerk stores for the user — the same source the
// push/import routes read from.

interface GithubRepo {
  full_name: string;
  name: string;
  description: string | null;
  default_branch: string;
  updated_at: string;
  pushed_at: string | null;
  language: string | null;
  private: boolean;
  fork: boolean;
  archived: boolean;
  html_url: string;
  stargazers_count: number;
}

export interface RepoSummary {
  fullName: string;
  name: string;
  description: string | null;
  defaultBranch: string;
  updatedAt: string;
  language: string | null;
  private: boolean;
  htmlUrl: string;
  stars: number;
}

async function getGithubToken(userId: string): Promise<string | null> {
  try {
    const client = await clerkClient();
    const tokens = await client.users.getUserOauthAccessToken(userId, 'github');
    return tokens.data?.[0]?.token ?? null;
  } catch (err) {
    console.warn('[github/repos] failed to read clerk oauth token:', (err as Error).message);
    return null;
  }
}

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = await getGithubToken(userId);
    if (!token) {
      return NextResponse.json(
        { error: 'No GitHub account connected. Connect GitHub in your account settings.' },
        { status: 412 },
      );
    }

    // Owner-affiliated public repos, most-recently-updated first. Paginate a
    // few pages so users with many repos still see everything, but cap it so
    // the request stays bounded.
    const PER_PAGE = 100;
    const MAX_PAGES = 5;
    const collected: GithubRepo[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await fetch(
        `https://api.github.com/user/repos?visibility=public&affiliation=owner&sort=updated&per_page=${PER_PAGE}&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          cache: 'no-store',
        },
      );

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let message = text;
        try {
          message = JSON.parse(text)?.message || text;
        } catch {}
        return NextResponse.json(
          { error: `GitHub request failed: ${message || res.statusText}` },
          { status: res.status === 401 || res.status === 403 ? 403 : 502 },
        );
      }

      const batch = (await res.json()) as GithubRepo[];
      collected.push(...batch);
      if (batch.length < PER_PAGE) break;
    }

    const repos: RepoSummary[] = collected
      .filter((r) => !r.archived)
      .map((r) => ({
        fullName: r.full_name,
        name: r.name,
        description: r.description,
        defaultBranch: r.default_branch,
        updatedAt: r.pushed_at || r.updated_at,
        language: r.language,
        private: r.private,
        htmlUrl: r.html_url,
        stars: r.stargazers_count,
      }));

    return NextResponse.json({ ok: true, repos });
  } catch (error) {
    console.error('Error listing GitHub repos:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Failed to list repos', details: message }, { status: 500 });
  }
}
