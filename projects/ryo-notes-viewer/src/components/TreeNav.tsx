'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Box, Text } from '@chakra-ui/react'
import type { TreeNode } from '@/lib/github'

interface TreeNavProps {
  tree: TreeNode[]
  activePath: string
}

interface FolderNode {
  name: string
  path: string
  type: 'tree'
  children: TreeEntry[]
}

interface FileNode {
  name: string
  path: string
  type: 'blob'
}

type TreeEntry = FolderNode | FileNode

function toHumanReadable(name: string): string {
  // Strip leading digits and dashes (e.g. "01-intro" -> "intro")
  const stripped = name.replace(/^\d+[-_]?/, '')
  // Replace hyphens and underscores with spaces
  const spaced = stripped.replace(/[-_]/g, ' ')
  // Title-case
  return spaced.replace(/\b\w/g, c => c.toUpperCase())
}

function buildTree(nodes: TreeNode[]): TreeEntry[] {
  const root: FolderNode = { name: '', path: '', type: 'tree', children: [] }

  for (const node of nodes) {
    const parts = node.path.split('/')
    let current = root

    if (node.type === 'tree') {
      // Ensure the folder exists
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        let child = current.children.find(
          c => c.type === 'tree' && c.name === part
        ) as FolderNode | undefined

        if (!child) {
          child = {
            name: part,
            path: parts.slice(0, i + 1).join('/'),
            type: 'tree',
            children: [],
          }
          current.children.push(child)
        }
        current = child
      }
    } else {
      // blob: navigate to the parent folder node and add file there
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i]
        let child = current.children.find(
          c => c.type === 'tree' && c.name === part
        ) as FolderNode | undefined

        if (!child) {
          child = {
            name: part,
            path: parts.slice(0, i + 1).join('/'),
            type: 'tree',
            children: [],
          }
          current.children.push(child)
        }
        current = child
      }

      current.children.push({
        name: parts[parts.length - 1],
        path: node.path,
        type: 'blob',
      })
    }
  }

  return root.children
}

function FolderItem({
  node,
  activePath,
  depth,
}: {
  node: FolderNode
  activePath: string
  depth: number
}) {
  const [open, setOpen] = useState(true)

  return (
    <Box>
      <Box
        as="button"
        w="full"
        textAlign="left"
        display="flex"
        alignItems="center"
        gap={1}
        py={1}
        px={2}
        pl={`${depth * 12 + 8}px`}
        borderRadius="md"
        fontSize="sm"
        fontWeight="medium"
        color="gray.600"
        _hover={{ bg: 'gray.100' }}
        onClick={() => setOpen(o => !o)}
        cursor="pointer"
      >
        <Text as="span" fontSize="xs" mr={1}>
          {open ? '▼' : '▶'}
        </Text>
        {toHumanReadable(node.name)}
      </Box>
      {open && (
        <Box>
          {node.children.map(child =>
            child.type === 'tree' ? (
              <FolderItem
                key={child.path}
                node={child}
                activePath={activePath}
                depth={depth + 1}
              />
            ) : (
              <FileItem
                key={child.path}
                node={child}
                activePath={activePath}
                depth={depth + 1}
              />
            )
          )}
        </Box>
      )}
    </Box>
  )
}

function FileItem({
  node,
  activePath,
  depth,
}: {
  node: FileNode
  activePath: string
  depth: number
}) {
  const isActive = node.path === activePath
  const href = `/notes/${node.path}`

  return (
    <Link
      href={href}
      style={{
        display: 'block',
        textDecoration: 'none',
        paddingTop: '4px',
        paddingBottom: '4px',
        paddingRight: '8px',
        paddingLeft: `${depth * 12 + 8}px`,
        borderRadius: '6px',
        fontSize: '14px',
        color: isActive ? '#2563eb' : '#374151',
        backgroundColor: isActive ? '#eff6ff' : 'transparent',
        fontWeight: isActive ? '600' : '400',
      }}
      className={`tree-nav-file${isActive ? ' active' : ''}`}
    >
      {toHumanReadable(node.name.replace(/\.md$/i, ''))}
    </Link>
  )
}

export default function TreeNav({ tree, activePath }: TreeNavProps) {
  const entries = buildTree(tree)

  return (
    <Box py={2}>
      {entries.map(entry =>
        entry.type === 'tree' ? (
          <FolderItem
            key={entry.path}
            node={entry}
            activePath={activePath}
            depth={0}
          />
        ) : (
          <FileItem
            key={entry.path}
            node={entry}
            activePath={activePath}
            depth={0}
          />
        )
      )}
    </Box>
  )
}
