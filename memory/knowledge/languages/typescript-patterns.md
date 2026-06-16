# TypeScript / Next.js Patterns

Conventions for TypeScript and Next.js code. Used by developer, code-reviewer, and refactorer.

---

## Typing

```typescript
// ✅ Explicit return types on public functions
export function getRateLimitConfig(tenantId: string): RateLimitConfig { ... }

// ✅ Narrow types over broad ones
type UserId = string  // better than just string everywhere
type TenantId = string

// ✅ Use unknown over any for external data
function parseApiResponse(raw: unknown): ApiResponse {
    if (!isApiResponse(raw)) throw new Error('Invalid API response shape')
    return raw
}

// ❌ any
function parseApiResponse(raw: any): ApiResponse { ... }
```

---

## Async / await

```typescript
// ✅ Always await — never discard promises
const data = await fetchUserData(userId)

// ✅ Parallel when independent
const [user, config] = await Promise.all([fetchUser(id), fetchConfig(id)])

// ❌ Fire and forget (silent failure)
fetchUserData(userId)  // missing await

// ✅ Error handling in async
try {
    const data = await fetchUserData(userId)
} catch (error) {
    // error is unknown in TS — narrow it
    if (error instanceof ApiError) {
        logger.error('API error', { code: error.code })
    }
    throw error
}
```

---

## Next.js App Router (my-profile)

```typescript
// Server Component (default) — can be async, no 'use client'
export default async function BlogPage() {
    const posts = await getPosts()  // runs on server
    return <PostList posts={posts} />
}

// Client Component — needs interactivity or browser APIs
'use client'
export function ThreeScene() {
    const ref = useRef<HTMLCanvasElement>(null)
    useEffect(() => { /* Three.js setup */ }, [])
    return <canvas ref={ref} />
}
```

GitHub API and Medium RSS are runtime-fetched (not `generateStaticParams`) — mark the components that use them as `'use client'`.

---

## Path alias

```typescript
// ✅ Use the @ alias (mapped to src/)
import { Button } from '@/components/ui/Button'
import { fetchPosts } from '@/lib/medium'

// ❌ Relative paths across many directories
import { Button } from '../../../components/ui/Button'
```

---

## Component patterns

```typescript
// ✅ Props typed with interface
interface ButtonProps {
    label: string
    onClick: () => void
    disabled?: boolean
    variant?: 'primary' | 'secondary'
}

export function Button({ label, onClick, disabled = false, variant = 'primary' }: ButtonProps) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={cn('btn', variant === 'primary' ? 'btn-primary' : 'btn-secondary')}
        >
            {label}
        </button>
    )
}

// ❌ Untyped props
export function Button(props: any) { ... }
```

---

## Common commands

```bash
npx tsc --noEmit          # type check (always first)
npm run lint              # ESLint with project config
npm test                  # Jest / Vitest
npm run build             # production build (catches more errors than tsc alone)
```

---

## Security (Next.js specific)

```typescript
// ❌ XSS via dangerouslySetInnerHTML with user input
<div dangerouslySetInnerHTML={{ __html: userComment }} />

// ✅ Sanitize first (or avoid entirely)
import DOMPurify from 'dompurify'
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userComment) }} />

// ✅ Prefer React's default escaping — just render the string
<div>{userComment}</div>
```

Environment variables:
- `NEXT_PUBLIC_*` — exposed to browser (safe for public config only)
- Non-prefixed — server-side only (API keys, secrets go here, never in `NEXT_PUBLIC_*`)
