# Trade Assist

Private English sales copilot for manufacturer representatives. Live audio produces word-for-word text replies; you do the talking.

## Start on this Mac

Double-click **Start Trade Assist.command**. It runs in the background and opens **http://127.0.0.1:5173/**. Terminal may be closed. Use `node scripts/stop-local.mjs` to stop it. Use Node 22.13+ or the bundled runtime.

1. Add a manufacturer and product categories in **Company knowledge**.
2. Paste an anyone-with-the-link Google Drive file or folder link. Read the preview, then choose **Save to company memory**. Linked sources retain their original URL and read date. **Refresh** reads the original again and shows a preview before replacing saved text. Manual text and PDF uploads remain available.
3. Enter the buyer company and website in **Know your buyer**, then research before calling. Facts include source links. Possible pain points are hypotheses to explore, not established problems. Research uses a dedicated GPT-4.1 model for business purchasing context; live replies keep their existing Realtime model. Each possible need points to an actual cited fact, and its question is phrased for you to ask the buyer.
4. In **Connection & audio**, choose your tone, preferences, example replies and phrases to avoid. Settings save automatically. **Edit wording & teach my voice** saves a preferred reply as a style example; examples never establish company facts. Restart the assistant to apply changed voice settings.
5. Choose **Computer call audio · Mac / browser** to capture call playback directly. With your AT&T iPhone, enable **Calls on Other Devices**, then **Calls from iPhone** in FaceTime on the Mac. Dial the buyer's ordinary phone number through the iPhone cellular line using FaceTime. This keeps your carrier number. In an up-to-date Chrome, test computer audio and choose **Entire Screen → Share system audio**. The app rejects a share without audio. After the local 10-second test, start the assistant and share audio again. Speakerphone and headset microphone modes remain available.
6. Save the call for transcript, notes, buyer brief, estimated AI cost, recap and editable follow-up. It never sends email.

## Knowledge and imports

- Public Google Docs text, Sheets/Slides PDF exports, and supported Drive PDF/text files are supported. Google sign-in-only files are rejected by this link importer.
- Import limits: 8 MB/file, 20 files, two nested folder levels and 400,000 imported characters. Folder listings may be incomplete and always show a warning; skipped files and limits are shown. Import individual file links for anything missing.
- Manufacturer memory supports 500,000 characters. It is saved in browser storage. Live and verified replies select relevant original excerpts; live mode can search the remaining library through a knowledge lookup. This is searchable saved memory, not permanent model training.
- PDF extraction is AI-assisted. Review quantities, units, prices, certification wording and commercial conditions. Sheets/Slides are read through PDF exports, so nonprinting/hidden content may be absent.
- Company claims require supplied source support. Ordinary small talk and stable general knowledge are allowed. Current external facts require verification. Buyer research does not establish supplier capabilities.
- The sales playbook draws on cited communication research; it does not guarantee trust or conversion. Live replies are drafts, not independently fact-checked. **Get a verified answer** runs additional source and claim checks.

## Mac calls and company caller name

Computer audio uses the browser's system-audio sharing picker. macOS 14.2+ and a recent supported Chrome are the starting point; browser capabilities and system permissions determine availability. The in-app browser may not offer this feature. Video capture permission is needed for the picker, but screen frames are never sent, displayed or saved by Trade Assist. Only the processed audio track is added to the AI connection. All original capture tracks are stopped when the test/session stops or the page closes. Local playback remains audible to you. Close unrelated audio sources because system audio can include notifications and other apps.

This mode receives playback without your microphone; the remote buyer's words are heard directly rather than through a room speaker. Add any important words you actually say using the typed **You** option; while live, these are also added to the ongoing AI conversation without requesting a reply. Transcript audio labels use **Call audio** because other playback or phone menus can be present. Test a real call before relying on this setup; this update has not placed a call or verified FaceTime relay on the user's devices.

For regular monthly AT&T wireless, [AT&T's caller-ID instructions](https://www.att.com/support/article/wireless/KM1002271/) are **account profile → Settings → line → Edit Caller ID → enter display name → Save**. Try your authorized company name; confirm with AT&T if the account doesn't accept it. Allow up to 72 hours. AT&T Prepaid always displays Wireless Caller. Recipient carriers and saved contacts control the final appearance. A manufacturer selection in Trade Assist cannot change the registered caller name per call. No carrier settings are changed by this app. [Apple's Mac calling setup](https://support.apple.com/en-us/102405) covers the iPhone relay; this does not require signing up for a separate dialer provider.

## Spending

Default estimated limits are **$3 per call and $50 per calendar month**, editable or disableable in **Connection & audio → Spending & limits**. The meter uses reported token usage and published rates; repeated events are deduplicated. It includes research, document extraction, verified guidance and live/transcription usage recorded by this browser.

At a reached limit the app blocks new AI requests and disconnects the live assistant; your separate phone call can continue. Requests already in progress can still add cost. This is a local estimate guard, not an OpenAI account-wide cap. Other browsers/apps, activity before tracking was added, missing usage reports, taxes and phone charges are excluded. Search and unknown-model estimates can include conservative allowances. OpenAI Platform remains the final billing record.

## Data and connection

Profiles, imported text, voice preferences, buyer briefs, transcripts, call history and usage persist in this browser. They do not sync between `localhost`, `127.0.0.1` or the private hosted entry. Use `127.0.0.1` consistently. Export a backup in settings; imports merge records and usage, restore voice/limits, and recover the draft and buyer brief when no current draft is active.

The API key stays in ignored `.env.local` on the server. Never commit/share it. Relevant company materials and conversation are sent to OpenAI for requested AI work; buyer research uses public web search. Live audio is sent only while listening; raw audio is not saved by this app. Audio tests stay local. Microphone modes mix speakers and initially use **Call audio** labels, which can be corrected. Sessions stop after 55 minutes. Response timing varies with speech detection, network, context and any knowledge lookup.

The hosted private URL is an entry to the connected local app; no API secret is deployed there. Keep using this Mac’s launcher for live calling.

## Validation

`node node_modules/typescript/bin/tsc --noEmit` and `npm run build` check the app. Pure scripts `costs-smoke.mjs`, `drive-import-smoke.mjs`, `research-smoke.mjs` and `computer-audio-smoke.mjs` cover accounting, limits, import validation, citation safety, capture settings, missing-audio cleanup and permission errors. API smoke scripts use fictional inputs or public examples and are billable; they never capture a real microphone. Speakerphone pickup still depends on your hardware and placement; computer audio requires compatible browser capture and a working call relay.
