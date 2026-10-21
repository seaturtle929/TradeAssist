import { Monitor, Phone } from "lucide-react";

export function MacCallSetup() {
  return <details className="mac-call-setup" aria-label="Call from your Mac with your existing number">
    <summary>Set up Mac calls &amp; company caller ID</summary>
    <div className="mac-call-heading"><Monitor size={19}/><div><strong>Call from your Mac. Keep your AT&T number.</strong><p>FaceTime relays a normal cellular call through your iPhone. Trade Assist listens to the Mac’s playback audio.</p></div></div>
    <ol>
      <li><strong>Connect your iPhone.</strong> Use the same Apple Account and Wi-Fi on both devices. On iPhone: Settings → Apps → Phone → Calls on Other Devices → Allow Calls on Other Devices → enable your Mac. On older iOS, Phone is directly under Settings.</li>
      <li><strong>Dial on the Mac.</strong> In FaceTime → Settings, enable Calls from iPhone. Enter the buyer’s phone number and choose the cellular call using iPhone. Use a headset for your conversation. <a href="https://support.apple.com/en-us/102405" target="_blank" rel="noreferrer">Apple setup instructions ↗</a></li>
      <li><strong>Connect the buyer’s audio.</strong> Open this local app in an up-to-date Google Chrome. Click Test computer audio, choose Entire Screen and turn on Share system audio. Allow Chrome’s screen and audio access if asked. If no audio toggle appears, use a supported browser; a selected window alone may have no audio. Watch the meter while the other person speaks.</li>
      <li><strong>Start the assistant.</strong> The local test ends after 10 seconds. Start live assistant and share the audio again. Only audio goes to the AI; screen frames are never sent or saved. This mode does not hear your microphone—add any important words you say using the “You” message option.</li>
    </ol>
    <p className="computer-audio-note">Computer audio can include other apps and notifications. Close unrelated audio sources. Browser support varies; this app checks for an audio track and will not silently switch to the room microphone.</p>
    <details><summary><Phone size={15}/> Show your company name on outgoing calls</summary><p>For a regular monthly AT&T wireless plan: account profile → Settings → expand your line → Edit Caller ID → enter your authorized company name → Save. If AT&T rejects a business name, ask AT&T to register the outbound caller name for this line. Updates can take up to 72 hours.</p><p>The caller name belongs to your phone number. Selecting a manufacturer here does not change it. Receiving carriers and saved contacts control the final display, so a company name cannot be guaranteed on every phone.</p><a href="https://www.att.com/support/article/wireless/KM1002271/" target="_blank" rel="noreferrer">AT&T caller-ID instructions ↗</a></details>
  </details>;
}
