import { getRepoTree, getFileContent } from '@/lib/github'
import MarkdownRenderer from '@/components/MarkdownRenderer'
import { notFound } from 'next/navigation'

export async function generateStaticParams() {
  const tree = await getRepoTree()
  return tree
    .filter(n => n.type === 'blob' && /\.md$/i.test(n.path))
    .map(n => ({ slug: n.path.split('/') }))
}

export default async function NotePage({
  params,
}: {
  params: Promise<{ slug: string[] }>
}) {
  const { slug } = await params
  const path = slug.join('/')
  const content = await getFileContent(path)
  if (!content) notFound()
  return <MarkdownRenderer content={content} />
}
