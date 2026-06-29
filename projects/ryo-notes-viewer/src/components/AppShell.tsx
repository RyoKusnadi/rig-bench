"use client";

import { ChakraProvider, defaultSystem, Box, Flex } from "@chakra-ui/react";
import type { ReactNode } from "react";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
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
        >
          Ryo&apos;s Notes
        </Box>

        {/* Body: sidebar + content */}
        <Flex flex={1} overflow="hidden">
          {/* Sidebar */}
          <Box
            as="aside"
            w="280px"
            flexShrink={0}
            borderRightWidth="1px"
            borderRightColor="gray.200"
            overflowY="auto"
            p={4}
          />

          {/* Main content area */}
          <Box flex={1} overflowY="auto" p={8}>
            <Box maxW="800px" mx="auto">
              {children}
            </Box>
          </Box>
        </Flex>
      </Flex>
    </ChakraProvider>
  );
}
