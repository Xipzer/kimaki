// process.exit() right after process.stdout.write() drops buffered output when
// stdout is a pipe, so large results get cut off. Wait for the write callback.
export function writeStdout(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!text) return resolve()
    process.stdout.write(text, () => resolve())
  })
}

export async function writeStdoutAndExit(text: string, code = 0): Promise<never> {
  await writeStdout(text)
  process.exit(code)
}
