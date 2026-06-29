---
id: "0001"
title: Scaffold ryo-notes-viewer Next.js project
status: waiting_verification
depends_on: []
source: user-request
---

## Problem

There is no project under `projects/ryo-notes-viewer/`. Before the GitHub API integration and markdown rendering can be built, a working Next.js 15 App Router project must exist with Chakra UI wired up, a two-panel layout shell, and a Vercel deployment config.

## Acceptance Criteria

- The `projects/ryo-notes-viewer/` directory shall contain a valid Next.js 15 App Router project with TypeScript.
- The project shall have Chakra UI v3 installed and its `ChakraProvider` wrapping the root layout.
- The root layout shall render a fixed 280 px left sidebar (for future tree navigation) and a scrollable main content area to the right.
- The root layout shall include a top header bar displaying the text "Ryo's Notes".
- The project shall include a `vercel.json` at the root of `projects/ryo-notes-viewer/` configured for Next.js deployment.
- When `npm install && npm run build` is run inside `projects/ryo-notes-viewer/`, the command shall exit with code 0 and produce no TypeScript errors.

## Out of Scope

- GitHub API calls (spec 0002)
- Markdown rendering (spec 0002)
- Sidebar tree navigation content (spec 0002)
- Authentication / private repo access

## Files/Interfaces Touched

```
projects/ryo-notes-viewer/
  package.json
  tsconfig.json
  next.config.ts
  vercel.json
  src/
    app/
      layout.tsx          ← ChakraProvider, two-panel shell, header
      page.tsx            ← placeholder "Select a note" empty state
      globals.css
    components/
      AppShell.tsx        ← sidebar + content layout (client component for Chakra)
    lib/
      chakra-theme.ts     ← optional color/font theme overrides
```

## Implementation Notes

1. Bootstrap with `npx create-next-app@latest ryo-notes-viewer --typescript --app --tailwind=false --eslint --src-dir --import-alias "@/*"` inside `projects/`.
2. Install Chakra UI v3: `npm install @chakra-ui/react @emotion/react`.
3. Wrap root `layout.tsx` with `ChakraProvider`.
4. Build `AppShell.tsx` using Chakra `Flex`/`Box`:
   - Full viewport height (`minH="100vh"`)
   - Sidebar: `w="280px"`, `flexShrink={0}`, `borderRight`, `overflowY="auto"`
   - Content: `flex={1}`, `overflowY="auto"`, `p={8}`, `maxW="800px"` centered
5. Header: `Box as="header"` spanning full width, `h="56px"`, with brand name.
6. `vercel.json`:
   ```json
   {
     "buildCommand": "npm run build",
     "outputDirectory": ".next",
     "framework": "nextjs"
   }
   ```
7. Root `page.tsx`: display a centered empty state with "← Select a note from the sidebar".

## Verification

```bash
cd projects/ryo-notes-viewer
npm install
npm run build
# Must exit 0 with no TypeScript errors
```
