import type { ParsedNode } from "../graph/types.ts"
import { isUndated } from "../graph/boost.ts"

export function isOpenTask(node: ParsedNode): boolean {
  return node.nodeType === "text" && node.isTask && !node.isCompleted
}

/** Open tasks before anything else; among open tasks the oldest first (overdue, today, then future dates, whose
 *  ages are negative), undated ones last. 0 when neither or both are equal, so callers chain their own order. */
export function compareOpenTasks(a: ParsedNode, aAge: number, b: ParsedNode, bAge: number): number {
  const at = isOpenTask(a)
  const bt = isOpenTask(b)
  if (at !== bt) return at ? -1 : 1
  if (!at) return 0
  const au = isUndated(aAge)
  const bu = isUndated(bAge)
  if (au !== bu) return au ? 1 : -1
  return au ? 0 : bAge - aAge
}
