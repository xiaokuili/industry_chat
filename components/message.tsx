'use client'

import { IconOpenAI, IconUser } from '@/components/ui/icons'
import { cn } from '@/lib/utils'
import { spinner } from '@/components/spinner'
import { CodeBlock } from '@/components/ui/codeblock'
import { MemoizedReactMarkdown } from '@/components/markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { StreamableValue, useStreamableValue } from 'ai/rsc'
import rehypeKatex from 'rehype-katex'

import rehypeExternalLinks from 'rehype-external-links'

// Different types of message bubbles.

export function UserMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="group relative flex items-start md:-ml-12">
      <div className="flex size-[25px] shrink-0 select-none items-center justify-center rounded-md border bg-background shadow-sm">
        <IconUser />
      </div>
      <div className="ml-4 flex-1 space-y-2 overflow-hidden pl-2">
        {children}
      </div>
    </div>
  )
}

export function BotMessage({
  content,
  className
}: {
  content: string | StreamableValue<string>
  className?: string
}) {
  const [data, error, pending] = useStreamableValue(content)
  const containsLaTeX = /\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)/.test(data || '')
  const processedData = preprocessLaTeX(data || '')

  return (
    <div className={cn('group relative flex items-start md:-ml-12', className)}>
      <div className="flex size-[24px] shrink-0 select-none items-center justify-center rounded-md border bg-primary text-primary-foreground shadow-sm">
        <IconOpenAI />
      </div>
      {containsLaTeX ? (
        <MemoizedReactMarkdown
          rehypePlugins={[[rehypeExternalLinks, { target: '_blank' }]]}
          remarkPlugins={[remarkGfm, remarkMath]}
          className="prose-sm prose-neutral prose-a:text-accent-foreground/50"
        >
          {processedData}
        </MemoizedReactMarkdown>
      ) : (
        <div className="ml-4 flex-1 space-y-2 overflow-hidden px-1">
          <MemoizedReactMarkdown
            rehypePlugins={[[rehypeExternalLinks, { target: '_blank' }]]}
            remarkPlugins={[remarkGfm]}
            className="prose-sm prose-neutral prose-a:text-accent-foreground/50"
          >
            {data || ''}
          </MemoizedReactMarkdown>
        </div>
      )}
    </div>
  )
}
// Preprocess LaTeX equations to be rendered by KaTeX
// ref: https://github.com/remarkjs/react-markdown/issues/785
const preprocessLaTeX = (content: string) => {
  const blockProcessedContent = content.replace(
    /\\\[([\s\S]*?)\\\]/g,
    (_, equation) => `$$${equation}$$`
  )
  const inlineProcessedContent = blockProcessedContent.replace(
    /\\\(([\s\S]*?)\\\)/g,
    (_, equation) => `$${equation}$`
  )
  return inlineProcessedContent
}

export function BotCard({
  children,
  showAvatar = true
}: {
  children: React.ReactNode
  showAvatar?: boolean
}) {
  return (
    <div className="group relative flex items-start md:-ml-12">
      <div
        className={cn(
          'flex size-[24px] shrink-0 select-none items-center justify-center rounded-md border bg-primary text-primary-foreground shadow-sm',
          !showAvatar && 'invisible'
        )}
      >
        <IconOpenAI />
      </div>
      <div className="ml-4 flex-1 pl-2">{children}</div>
    </div>
  )
}

export function SystemMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={
        'mt-2 flex items-center justify-center gap-2 text-xs text-gray-500'
      }
    >
      <div className={'max-w-[600px] flex-initial p-2'}>{children}</div>
    </div>
  )
}

export function SpinnerMessage() {
  return (
    <div className="group relative flex items-start md:-ml-12">
      <div className="flex size-[24px] shrink-0 select-none items-center justify-center rounded-md border bg-primary text-primary-foreground shadow-sm">
        <IconOpenAI />
      </div>
      <div className="ml-4 h-[24px] flex flex-row items-center flex-1 space-y-2 overflow-hidden px-1">
        {spinner}
      </div>
    </div>
  )
}
