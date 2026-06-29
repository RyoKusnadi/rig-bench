import { getFileContent } from '@/lib/github'
import MarkdownRenderer from '@/components/MarkdownRenderer'
import { notFound } from 'next/navigation'

export default async function Home() {
  const content = await getFileContent('README.md')
  if (!content) notFound()
  return <MarkdownRenderer content={content} />
}
