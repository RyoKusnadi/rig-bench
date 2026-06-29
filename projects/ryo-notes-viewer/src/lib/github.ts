export type TreeNode = {
  path: string
  type: 'blob' | 'tree'
  sha: string
}

const REPO = 'RyoKusnadi/ryo-notes'

function authHeaders(): HeadersInit {
  return process.env.GITHUB_TOKEN
    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {}
}

export async function getRepoTree(): Promise<TreeNode[]> {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/git/trees/HEAD?recursive=1`,
    { headers: authHeaders(), next: { revalidate: 3600 } }
  )
  const data = await res.json()
  return (data.tree as TreeNode[]).filter(
    n => n.type === 'tree' || /\.md$/i.test(n.path)
  )
}

export async function getFileContent(path: string): Promise<string | null> {
  const res = await fetch(
    `https://raw.githubusercontent.com/${REPO}/HEAD/${path}`,
    { next: { revalidate: 3600 } }
  )
  if (!res.ok) return null
  return res.text()
}
