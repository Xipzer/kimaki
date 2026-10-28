---
'kimaki': minor
---

**Local Whisper transcription.** Set `KIMAKI_WHISPER_URL` (for example `http://127.0.0.1:8000/v1`) and voice notes are transcribed by any server that speaks the standard `/v1/audio/transcriptions` API (speaches, faster-whisper-server, whisper.cpp, LocalAI), with no API key and no audio leaving the machine. It is the only transcriber by default, so if the server fails the error is shown instead of the audio going to a cloud provider; `KIMAKI_WHISPER_FALLBACK=1` lets the configured cloud transcribers run after it. Optional: `KIMAKI_WHISPER_MODEL` (default `whisper-1`) and `KIMAKI_WHISPER_API_KEY`. Plain Whisper only returns text, so voice notes go to the current thread like a typed message.
