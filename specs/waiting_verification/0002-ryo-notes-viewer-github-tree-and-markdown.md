---
id: "0002"
title: GitHub tree navigation and markdown rendering
status: waiting_verification
depends_on: ["0001"]
source: user-request
---

## Problem

The scaffolded app (spec 0001) has an empty sidebar and a placeholder content area. This spec wires it up to the real `RyoKusnadi/ryo-notes` GitHub repo: fetching the full file tree, rendering a collapsible folder/file navigator in the sidebar, and rendering the selected markdown file beautifully in the content area.

## Acceptance Criteria

- The sidebar shall display the full folder and file tree of `RyoKusnadi/ryo-notes` fetched via the GitHub Trees API, refreshed at most once per hour (ISR / `revalidate: 3600`).
- When a folder node is clicked, the sidebar shall expand or collapse its children without a full page reload.
- When a `.md` or `.MD` file is clicked, the app shall navigate to `/notes/<path>` and render the file's markdown content in the main content area.
- The markdown renderer shall support: headings, paragraphs, bold, italic, inline code, fenced code blocks with syntax highlighting (github-dark theme), blockquotes, ordered/unordered lists, tables, and hyperlinks.
- The root page (`/`) shall render `README.md` from the repo root as the default content.
- On viewports narrower than 768 px, the sidebar shall be hidden behind a hamburger button that opens it as a slide-in drawer.
- If `GITHUB_TOKEN` is set as an environment variable, the app shall include it as a Bearer token on all GitHub API requests.
- If a requested file path does not exist in the repo, the app shall return a Next.js `notFound()` response.
- The active file in the sidebar shall be visually highlighted (distinct background or accent color).
- File names in the sidebar shall be rendered in human-readable form (strip leading numbers/dashes, replace hyphens/underscores with spaces, title-case).

## Out of Scope

- Search across notes
- Edit / create notes from the UI
- Comments or reactions
- Private repo authentication UI (token is env-var only)
- PDF or non-markdown file preview

## Files/Interfaces Touched

```
projects/ryo-notes-viewer/
  src/
    lib/
      github.ts           ← getRepoTree(), getFileContent(), TreeNode type
    components/
      TreeNav.tsx         ← collapsible sidebar tree (client component)
      MarkdownRenderer.tsx ← server component: react-markdown + plugins
      MobileDrawer.tsx    ← hamburger + Chakra Drawer wrapper
    app/
      layout.tsx          ← integrate TreeNav + MobileDrawer into AppShell sidebar slot
      page.tsx            ← fetch + render README.md
      notes/
        [...slug]/
          page.tsx        ← dynamic catch-all: fetch + render any .md file
  .env.local.example      ← GITHUB_TOKEN=your_token_here
```

**New dependencies:**
```
react-markdown
remark-gfm
rehype-highlight
highlight.js
```

## Implementation Notes

### `src/lib/github.ts`

```ts
export type TreeNode = {
  path: string
  type: 'blob' | 'tree'
  sha: string
}

const REPO = 'RyoKusnadi/ryo-notes'
const BASE = 'https://api.github.com'

function headers() {
  return process.env.GITHUB_TOKEN
    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {}
}

export async function getRepoTree(): Promise<TreeNode[]> {
  // GET /repos/{owner}/{repo}/git/trees/HEAD?recursive=1
  // next: { revalidate: 3600 }
  // Filter to .md/.MD blobs + tree nodes
}

export async function getFileContent(path: string): Promise<string> {
  // Fetch raw content: https://raw.githubusercontent.com/RyoKusnadi/ryo-notes/HEAD/{path}
  // next: { revalidate: 3600 }
  // Return text content
}
```

### `src/components/TreeNav.tsx`

- Client component (`"use client"`)
- Accept `tree: TreeNode[]` and `activePath: string` as props
- Build a nested structure from flat paths using path separators
- Use Chakra `Accordion` or custom expand/collapse with `useState`
- Folder icons (▶/▼) + file icons, accent color on active item
- Human-readable label: strip leading `\d+-?`, replace `-`/`_` with space, title-case

### `src/components/MarkdownRenderer.tsx`

- Server component
- Use `ReactMarkdown` with `remarkGfm` + `rehypeHighlight`
- Wrap output in Chakra `Box` with prose styles:
  - `h1`–`h6`: Chakra heading sizes, bottom border on h1/h2
  - `code`: monospace bg, rounded, px
  - `pre > code`: `highlight.js` github-dark theme, rounded-lg, overflow-x scroll
  - `a`: accent color, underline on hover
  - `blockquote`: left border, muted text
  - `table`: Chakra `Table` component or styled HTML table
- Max prose width 800 px

### `src/app/notes/[...slug]/page.tsx`

```ts
export async function generateStaticParams() {
  const tree = await getRepoTree()
  return tree
    .filter(n => n.type === 'blob' && /\.md$/i.test(n.path))
    .map(n => ({ slug: n.path.split('/') }))
}

export default async function NotePage({ params }) {
  const path = params.slug.join('/')
  const content = await getFileContent(path)
  if (!content) notFound()
  return <MarkdownRenderer content={content} />
}
```

### Mobile drawer

- `MobileDrawer.tsx`: Chakra `Drawer` (placement="left"), triggered by a hamburger `IconButton` in the header, visible only on `md` breakpoint and below.
- Header in `layout.tsx` shows hamburger only on mobile using Chakra `Show`/`Hide` or responsive display.

### `.env.local.example`

```
GITHUB_TOKEN=your_token_here
```

## Verification

```bash
cd projects/ryo-notes-viewer
npm install
npm run build
# Must exit 0

# Then start dev server and verify:
npm run dev
# 1. Open http://localhost:3000 — README.md content renders in main area
# 2. Sidebar shows repo folder/file tree
# 3. Click a folder → it expands/collapses
# 4. Click any .md file → navigates to /notes/<path>, renders markdown
# 5. Code blocks have syntax highlighting
# 6. Resize to < 768px → sidebar hidden, hamburger visible, drawer opens on click
```
