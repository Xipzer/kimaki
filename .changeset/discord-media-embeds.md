---
'kimaki': patch
---

Bot messages that contain a Discord media link (`https://cdn.discordapp.com/...` or `https://media.discordapp.net/...`, for example an image uploaded in another thread) now show the image or video preview. Kimaki still hides link previews for every other message. A tool line with a Discord media link is never merged with other lines, so their links stay without preview.
