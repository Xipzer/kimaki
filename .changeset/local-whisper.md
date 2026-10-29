---
'kimaki': minor
---

**Local Whisper transcription.** Set `KIMAKI_WHISPER_URL` and voice messages go to your own Whisper server instead of a cloud provider:

```bash
KIMAKI_WHISPER_URL=http://127.0.0.1:8000/v1 kimaki
```

Any server with the standard `/v1/audio/transcriptions` API works: speaches, faster-whisper-server, whisper.cpp server, LocalAI. No API key is needed. When the URL is set it is the **only** transcriber: if the server fails, the error shows in Discord and the audio never goes to OpenAI, ChatGPT or Gemini. Optional: `KIMAKI_WHISPER_MODEL` (default `whisper-1`) and `KIMAKI_WHISPER_API_KEY` (sent as a bearer token). Whisper only transcribes, so voice messages are handled like typed messages: queue, chat and agent instructions are ignored.

Fixes #244
Contributed by [@Xipzer](https://github.com/Xipzer) in #248.
