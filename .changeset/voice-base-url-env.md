---
'kimaki': minor
---

**Voice transcription and `kimaki tts` honour `OPENAI_BASE_URL` and `GEMINI_BASE_URL`.** Point them at an OpenAI- or Gemini-compatible server, for example a local Whisper proxy on `http://127.0.0.1:7070/v1`, and voice notes stop going to the official endpoints. Unset or empty values keep the defaults.
