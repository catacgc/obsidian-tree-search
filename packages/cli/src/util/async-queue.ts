/**
 * Serializes async tasks so they run one at a time.
 * Prevents concurrent SQLite writes when multiple files change simultaneously.
 */
export class AsyncQueue {
  private tail: Promise<void> = Promise.resolve()

  enqueue(fn: () => Promise<void>): void {
    this.tail = this.tail.then(fn).catch(err => {
      console.error("[mdtree] Error in queued task:", err)
    })
  }
}
