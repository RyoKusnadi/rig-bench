import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Box } from '@chakra-ui/react'
import 'highlight.js/styles/github-dark.css'
import type { Components } from 'react-markdown'

const components: Components = {
  h1: ({ children }) => (
    <Box
      as="h1"
      fontSize="3xl"
      fontWeight="bold"
      mb={4}
      mt={8}
      borderBottomWidth="1px"
      borderBottomColor="gray.200"
      pb={2}
    >
      {children}
    </Box>
  ),
  h2: ({ children }) => (
    <Box
      as="h2"
      fontSize="2xl"
      fontWeight="bold"
      mb={3}
      mt={6}
      borderBottomWidth="1px"
      borderBottomColor="gray.200"
      pb={2}
    >
      {children}
    </Box>
  ),
  h3: ({ children }) => (
    <Box as="h3" fontSize="xl" fontWeight="bold" mb={2} mt={5}>
      {children}
    </Box>
  ),
  h4: ({ children }) => (
    <Box as="h4" fontSize="lg" fontWeight="semibold" mb={2} mt={4}>
      {children}
    </Box>
  ),
  h5: ({ children }) => (
    <Box as="h5" fontSize="md" fontWeight="semibold" mb={2} mt={3}>
      {children}
    </Box>
  ),
  h6: ({ children }) => (
    <Box as="h6" fontSize="sm" fontWeight="semibold" mb={2} mt={3}>
      {children}
    </Box>
  ),
  p: ({ children }) => (
    <Box as="p" mb={4} lineHeight="tall">
      {children}
    </Box>
  ),
  code: ({ className, children, ...props }) => {
    const isInline = !className
    if (isInline) {
      return (
        <Box
          as="code"
          bg="gray.100"
          rounded="md"
          px={1}
          py={0.5}
          fontSize="sm"
          fontFamily="mono"
          {...props}
        >
          {children}
        </Box>
      )
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    )
  },
  pre: ({ children }) => (
    <Box
      as="pre"
      bg="gray.900"
      rounded="lg"
      overflowX="auto"
      p={4}
      mb={4}
      fontSize="sm"
    >
      {children}
    </Box>
  ),
  a: ({ href, children }) => (
    <a href={href} className="prose-link">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <Box
      as="blockquote"
      borderLeftWidth="4px"
      borderLeftColor="blue.400"
      pl={4}
      mb={4}
      color="gray.600"
      fontStyle="italic"
    >
      {children}
    </Box>
  ),
  ul: ({ children }) => (
    <Box as="ul" pl={6} mb={4} listStyleType="disc">
      {children}
    </Box>
  ),
  ol: ({ children }) => (
    <Box as="ol" pl={6} mb={4} listStyleType="decimal">
      {children}
    </Box>
  ),
  li: ({ children }) => (
    <Box as="li" mb={1} lineHeight="tall">
      {children}
    </Box>
  ),
  table: ({ children }) => (
    <Box overflowX="auto" mb={4}>
      <Box
        as="table"
        w="full"
        borderCollapse="collapse"
        fontSize="sm"
      >
        {children}
      </Box>
    </Box>
  ),
  thead: ({ children }) => (
    <Box as="thead" bg="gray.50">
      {children}
    </Box>
  ),
  th: ({ children }) => (
    <Box
      as="th"
      px={4}
      py={2}
      textAlign="left"
      fontWeight="semibold"
      borderWidth="1px"
      borderColor="gray.200"
    >
      {children}
    </Box>
  ),
  td: ({ children }) => (
    <Box
      as="td"
      px={4}
      py={2}
      borderWidth="1px"
      borderColor="gray.200"
    >
      {children}
    </Box>
  ),
}

interface MarkdownRendererProps {
  content: string
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <Box maxW="800px" mx="auto" color="gray.800">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </Box>
  )
}
