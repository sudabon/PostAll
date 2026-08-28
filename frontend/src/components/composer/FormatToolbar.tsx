import {
  Bold,
  Code,
  Italic,
  Link,
  List,
  ListOrdered,
  SquareCode,
  Strikethrough,
  TextQuote,
  Underline,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { FormatAction } from '@/lib/markdown-format'

type Item = { action: FormatAction; label: string; Icon: typeof Bold }

const groups: Item[][] = [
  [
    { action: 'bold', label: '太字', Icon: Bold },
    { action: 'italic', label: '斜体', Icon: Italic },
    { action: 'underline', label: '下線', Icon: Underline },
    { action: 'strike', label: '取り消し線', Icon: Strikethrough },
  ],
  [
    { action: 'link', label: 'リンク', Icon: Link },
    { action: 'orderedList', label: '数字箇条書き', Icon: ListOrdered },
    { action: 'bulletList', label: '箇条書き', Icon: List },
  ],
  [
    { action: 'quote', label: '引用', Icon: TextQuote },
    { action: 'code', label: 'コード', Icon: Code },
    { action: 'codeBlock', label: 'コードブロック', Icon: SquareCode },
  ],
]

export function FormatToolbar({
  disabled,
  onAction,
}: {
  disabled?: boolean
  onAction: (action: FormatAction) => void
}) {
  return (
    <div
      role="toolbar"
      aria-label="書式"
      data-testid="composer-format-toolbar"
      className="flex flex-wrap items-center gap-0.5 rounded-t-xl border border-b-0 border-input bg-background px-1.5 py-1"
    >
      {groups.map((group, i) => (
        <div key={group[0].action} className="flex items-center gap-0.5">
          {i > 0 ? <span aria-hidden className="mx-1 h-5 w-px bg-border" /> : null}
          {group.map(({ action, label, Icon }) => (
            <Button
              key={action}
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              data-testid={`composer-format-${action}`}
              aria-label={label}
              title={label}
              disabled={disabled}
              // クリックで textarea の選択範囲を失わないようフォーカス移動を止める
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onAction(action)}
            >
              <Icon className="size-4" />
            </Button>
          ))}
        </div>
      ))}
    </div>
  )
}
