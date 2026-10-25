---
'kimaki': patch
---

Stop a stuck voice transcription from blocking the thread. Messages of a thread are handled in Discord order, so a text sent while a voice message is transcribed waits for it and reaches the model second. A transcription now gives up after 2 minutes (all providers and retries together) and attachment downloads after 1 minute, then shows the error, and later messages go on. Before, a transcription request that never answered held every later message of that thread.
