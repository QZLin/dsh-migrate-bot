/**
 * An in-memory GitHub REST API for one repository, served through a `fetch`
 * function. It implements only the endpoints this Action calls, with the fields
 * it reads, and records every request.
 */

export interface FakeIssue {
  number: number
  title: string
  body: string
  state: 'open' | 'closed'
  labels: string[]
  comments: Array<{ body: string; user: string; created_at: string }>
}

export interface FakePull {
  number: number
  title: string
  body: string
  state: 'open' | 'closed'
  merged: boolean
  /** Whether the pull request is a draft, as the Action asked for it. */
  draft: boolean
  head: { ref: string; sha: string }
  base: string
  commits: Array<{ login: string; email: string }>
}

export class FakeGitHub {
  readonly requests: Array<{ method: string; path: string; body?: unknown }> = []
  readonly issues = new Map<number, FakeIssue>()
  readonly pulls = new Map<number, FakePull>()
  private next = 1

  constructor(readonly repo = 'acme/plugin') {}

  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const method = input instanceof Request ? input.method : init?.method ?? 'GET'
    const text = input instanceof Request ? await input.text() : typeof init?.body === 'string' ? init.body : ''
    const body: unknown = text === '' ? undefined : JSON.parse(text)
    this.requests.push({ method, path: `${url.pathname}${url.search}`, ...(body === undefined ? {} : { body }) })
    return this.route(method, url, body as Record<string, unknown> | undefined)
  }

  private json(status: number, value: unknown): Response {
    return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
  }

  private issueJson(issue: FakeIssue): unknown {
    return { number: issue.number, html_url: `https://github.com/${this.repo}/issues/${String(issue.number)}`, title: issue.title, body: issue.body, state: issue.state, user: { type: 'Bot' } }
  }

  private pullJson(pull: FakePull): unknown {
    return {
      number: pull.number,
      node_id: `PR_${String(pull.number)}`,
      html_url: `https://github.com/${this.repo}/pull/${String(pull.number)}`,
      title: pull.title,
      body: pull.body,
      state: pull.state,
      merged: pull.merged,
      draft: pull.draft,
      merged_at: pull.merged ? '2026-10-10T01:00:00Z' : null,
      merged_by: pull.merged ? { login: 'maintainer' } : null,
      head: { ref: pull.head.ref, sha: pull.head.sha, repo: { full_name: this.repo } },
    }
  }

  addPull(pull: Partial<FakePull> & { head: FakePull['head'] }): FakePull {
    const number = pull.number ?? this.next++
    const full: FakePull = { number, title: '', body: '', state: 'open', merged: false, draft: false, base: 'main', commits: [], ...pull }
    this.pulls.set(number, full)
    this.next = Math.max(this.next, number + 1)
    return full
  }

  addIssue(issue: Partial<FakeIssue>): FakeIssue {
    const number = issue.number ?? this.next++
    const full: FakeIssue = { number, title: '', body: '', state: 'open', labels: [], comments: [], ...issue }
    this.issues.set(number, full)
    this.next = Math.max(this.next, number + 1)
    return full
  }

  private route(method: string, url: URL, body: Record<string, unknown> | undefined): Response {
    const own = `/repos/${this.repo}`
    const path = url.pathname
    if (path === '/graphql' && method === 'POST') {
      const query = typeof body?.query === 'string' ? body.query : ''
      const variables = body?.variables as { id?: unknown } | undefined
      const draft = query.includes('convertPullRequestToDraft') ? true : query.includes('markPullRequestReadyForReview') ? false : undefined
      const pull = [...this.pulls.values()].find(candidate => `PR_${String(candidate.number)}` === variables?.id)
      if (draft === undefined || pull === undefined || pull.state !== 'open') {
        return this.json(200, { errors: [{ message: 'invalid draft conversion' }] })
      }
      pull.draft = draft
      return this.json(200, { data: { proposal: { pullRequest: { isDraft: pull.draft } } } })
    }
    if (!path.startsWith(own)) return this.json(404, { message: 'Not Found' })
    const rest = path.slice(own.length)
    const segments = rest.split('/').filter(Boolean)
    const [collection, id, sub] = segments
    const number = id === undefined ? undefined : Number(id)

    if (collection === 'issues' && number === undefined) {
      if (method === 'GET') {
        const open = [...this.issues.values()].filter(issue => url.searchParams.get('state') !== 'open' || issue.state === 'open')
        return this.json(200, open.map(issue => this.issueJson(issue)))
      }
      const created = this.addIssue({ title: String(body?.title), body: String(body?.body), labels: (body?.labels as string[] | undefined) ?? [] })
      return this.json(201, this.issueJson(created))
    }
    if (collection === 'issues' && number !== undefined) {
      const issue = this.issues.get(number)
      if (sub === 'comments') {
        if (method === 'GET') return this.json(200, [])
        const target = issue ?? this.addIssue({ number })
        target.comments.push({ body: String(body?.body), user: 'github-actions[bot]', created_at: '2026-10-10T00:00:00Z' })
        return this.json(201, {})
      }
      if (issue === undefined) return this.json(404, { message: 'Not Found' })
      if (method === 'PATCH') Object.assign(issue, { title: body?.title ?? issue.title, body: body?.body ?? issue.body, state: body?.state ?? issue.state })
      return this.json(200, this.issueJson(issue))
    }
    if (collection === 'pulls' && number === undefined) {
      if (method === 'GET') {
        const head = url.searchParams.get('head')
        const pulls = [...this.pulls.values()].filter(pull => pull.state === 'open' && (head === null || head === `${this.repo.split('/')[0] ?? ''}:${pull.head.ref}`))
        return this.json(200, pulls.map(pull => this.pullJson(pull)))
      }
      const created = this.addPull({
        title: String(body?.title),
        body: String(body?.body),
        head: { ref: String(body?.head), sha: 'f'.repeat(40) },
        base: String(body?.base),
        draft: body?.draft === true,
      })
      return this.json(201, this.pullJson(created))
    }
    if (collection === 'pulls' && number !== undefined) {
      const pull = this.pulls.get(number)
      if (pull === undefined) return this.json(404, { message: 'Not Found' })
      if (sub === 'commits') return this.json(200, pull.commits.map(commit => ({ author: { login: commit.login }, commit: { author: { email: commit.email } } })))
      if (sub === 'comments') return this.json(200, [])
      if (method === 'PATCH') {
        if (body !== undefined && 'draft' in body) return this.json(422, { message: 'REST cannot update draft state' })
        Object.assign(pull, {
          title: body?.title ?? pull.title,
          body: body?.body ?? pull.body,
          state: body?.state ?? pull.state,
        })
      }
      return this.json(200, this.pullJson(pull))
    }
    return this.json(404, { message: `no route for ${method} ${path}` })
  }
}
