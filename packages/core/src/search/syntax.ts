import { IS_VALUES, HAS_VALUES } from "./query.ts"

// A single row in the query-syntax cheat sheet. Entries carrying `insertText`
// are concrete, literally-insertable tokens (the UI renders them as click-to-
// insert launchers); entries without it are grammar templates or free-text
// examples shown for illustration only.
export type QuerySyntaxEntry = {
  syntax: string
  description: string
  insertText?: string
}

export type QuerySyntaxGroup = {
  title: string
  entries: QuerySyntaxEntry[]
}

// Human descriptions for each `is:`/`has:` value. Keyed by the same constants
// the parser validates against so the cheat sheet cannot drift from the grammar
// (a value missing a description is caught by the drift-guard test).
const IS_DESCRIPTIONS: Record<string, string> = {
  page: "notes / pages",
  header: "headings",
  text: "text & list lines",
  folder: "folders",
  attachment: "attachments",
  task: "open tasks",
  subtask: "open tasks nested under a line",
  subtext: "lines nested under a line",
  list: "lines with nested lines",
  completed: "completed tasks",
  undated: "no date",
  archived: "reveal archived (greyed)",
}

const HAS_DESCRIPTIONS: Record<string, string> = {
  emoji: "has an emoji",
  link: "has any link",
  page: "has a page link",
}

// The query language, described for humans. Reusable anywhere the grammar needs
// to explain itself (the plugin's zero-state help panel today; a CLI `--help` or
// README section later).
export function describeQuerySyntax(): QuerySyntaxGroup[] {
  return [
    {
      title: "Text",
      entries: [
        { syntax: "foo", description: "contains “foo”" },
        { syntax: "\"foo bar\"", description: "exact match" },
      ],
    },
    {
      title: "Type — is:",
      entries: IS_VALUES.map(v => ({
        syntax: `is:${v}`,
        description: IS_DESCRIPTIONS[v] ?? v,
        insertText: `is:${v}`,
      })),
    },
    {
      title: "Content — has:",
      entries: HAS_VALUES.map(v => ({
        syntax: `has:${v}`,
        description: HAS_DESCRIPTIONS[v] ?? v,
        insertText: `has:${v}`,
      })),
    },
    {
      title: "Recency — in:",
      entries: [
        { syntax: "in:7d", description: "last 7 days", insertText: "in:7d" },
        { syntax: "in:2w", description: "last 2 weeks", insertText: "in:2w" },
        { syntax: "in:1m", description: "last month", insertText: "in:1m" },
        { syntax: "in:1y", description: "last year", insertText: "in:1y" },
      ],
    },
    {
      title: "Scope — outline:, [[note]]",
      entries: [
        { syntax: "outline:<note>", description: "outline of the latest note matching <note>" },
        { syntax: "outline:\"my note\"", description: "outline of exactly “my note”" },
        { syntax: "[[my note]]", description: "exactly “my note” with all its children, from any note" },
        { syntax: "[[my note#Heading]]", description: "that heading with all its children, from any note" },
        { syntax: "[[name", description: "notes and headings whose name matches; Enter or Tab completes the link" },
      ],
    },
    {
      title: "Combine",
      entries: [
        { syntax: "a b", description: "AND — both" },
        { syntax: "a | b", description: "OR — either" },
        { syntax: "-a", description: "NOT — exclude, with everything under it" },
        { syntax: "(a | b) c", description: "grouping" },
        { syntax: "a . b", description: "stage — find a, then b beneath it" },
      ],
    },
    {
      title: "Shortcuts",
      entries: [
        { syntax: ":page", description: "pages", insertText: ":page" },
        { syntax: ":header", description: "headings", insertText: ":header" },
        { syntax: ":folder", description: "folders", insertText: ":folder" },
        { syntax: ":attachment", description: "attachments", insertText: ":attachment" },
        { syntax: ":task", description: "open tasks", insertText: ":task" },
        { syntax: ":subtask", description: "nested open tasks", insertText: ":subtask" },
        { syntax: ":subtext", description: "nested lines", insertText: ":subtext" },
        { syntax: ":list", description: "lines with nested lines", insertText: ":list" },
        { syntax: ":archived", description: "reveal archived (greyed)", insertText: ":archived" },
        { syntax: ":emoji", description: "has an emoji", insertText: ":emoji" },
        { syntax: ":daily", description: "outline of today's daily note", insertText: ":daily" }
      ],
    },
  ]
}
