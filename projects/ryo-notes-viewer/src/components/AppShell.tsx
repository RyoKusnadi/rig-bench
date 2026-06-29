'use client'

import { ChakraProvider, defaultSystem, Box, Flex } from '@chakra-ui/react'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import TreeNav from '@/components/TreeNav'
import MobileDrawer from '@/components/MobileDrawer'
import type { TreeNode } from '@/lib/github'

interface AppShellProps {
  children: ReactNode
  tree: TreeNode[]
}

export function AppShell({ children, tree }: AppShellProps) {
  const rawPath = usePathname()
  // Derive active path from URL: /notes/some/path.md -> some/path.md
  const activePath = rawPath.startsWith('/notes/')
    ? rawPath.slice('/notes/'.length)
    : ''

  return (
    <ChakraProvider value={defaultSystem}>
      <Flex direction="column" minH="100vh">
        {/* Header bar */}
        <Box
          as="header"
          h="56px"
          borderBottomWidth="1px"
          borderBottomColor="gray.200"
          display="flex"
          alignItems="center"
          px={6}
          fontWeight="semibold"
          fontSize="lg"
          flexShrink={0}
          gap={3}
        >
          {/* Hamburger button — mobile only */}
          <Box display={{ base: 'flex', md: 'none' }} alignItems="center">
            <MobileDrawer tree={tree} activePath={activePath} />
          </Box>
          Ryo&apos;s Notes
        </Box>

        {/* Body: sidebar + content */}
        <Flex flex={1} overflow="hidden">
          {/* Sidebar — desktop only */}
          <Box
            as="aside"
            w="280px"
            flexShrink={0}
            borderRightWidth="1px"
            borderRightColor="gray.200"
            overflowY="auto"
            display={{ base: 'none', md: 'block' }}
          >
            <TreeNav tree={tree} activePath={activePath} />
          </Box>

          {/* Main content area */}
          <Box flex={1} overflowY="auto" p={8}>
            <Box maxW="800px" mx="auto">
              {children}
            </Box>
          </Box>
        </Flex>
      </Flex>
    </ChakraProvider>
  )
}
