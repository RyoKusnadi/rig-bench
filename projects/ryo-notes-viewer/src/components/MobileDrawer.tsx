'use client'

import { useState } from 'react'
import { Box, Button } from '@chakra-ui/react'
import {
  DrawerRoot,
  DrawerBackdrop,
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  DrawerCloseTrigger,
  DrawerTitle,
} from '@chakra-ui/react'
import TreeNav from '@/components/TreeNav'
import type { TreeNode } from '@/lib/github'

interface MobileDrawerProps {
  tree: TreeNode[]
  activePath: string
}

export default function MobileDrawer({ tree, activePath }: MobileDrawerProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        px={2}
      >
        ☰
      </Button>

      <DrawerRoot
        open={open}
        onOpenChange={e => setOpen(e.open)}
        placement="start"
      >
        <DrawerBackdrop />
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Navigation</DrawerTitle>
            <DrawerCloseTrigger />
          </DrawerHeader>
          <DrawerBody px={0} py={0}>
            <Box onClick={() => setOpen(false)}>
              <TreeNav tree={tree} activePath={activePath} />
            </Box>
          </DrawerBody>
        </DrawerContent>
      </DrawerRoot>
    </>
  )
}
