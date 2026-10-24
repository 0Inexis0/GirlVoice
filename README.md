![GirlVoice: Your voice. A new sound.](.github/repo-header-en.svg)

# GirlVoice

Transform your microphone audio with ElevenLabs and send the result to headphones or a virtual microphone. Built for Windows and Linux.

[Setup](#setup-and-reference) · [Source](src/) · [Build workflow](.github/workflows/)

## At a glance

- **Direct voice conversion.** Microphone → ElevenLabs Voice Changer → your selected audio device.
- **Listen and control.** Voice selection, separate headphone monitoring, instant output stop and local usage limits.
- **Virtual microphone.** VB-CABLE on Windows; PulseAudio or PipeWire with `pactl` on Linux.

## Get started

Use Node.js 22 or newer. To run from source:

```sh
npm ci
npm start
```

Alternatively, run **start.bat** on Windows or **sh start.sh** on Linux. These scripts prefer an existing packaged build. Add your own ElevenLabs key in the app, select a microphone and voice, then test with headphones first.

> **Good to know:** Speech is sent to ElevenLabs in chunks. Network and model latency are audible, and API requests consume provider allowance. Live audio and Linux behavior need verification on the target system.

**Stack:** Electron · React · Vite · ElevenLabs

## Setup and reference

<details>
<summary>Full guide: audio routing, privacy, costs and builds</summary>

## Launching

GirlVoice offers direct speech conversion: microphone → ElevenLabs Voice Changer → selected audio device. The alternative text mode uses Scribe Realtime and Flash v2.5. Features include monitoring, voice selection, immediate output stop, local usage limits and encrypted key storage.

On Windows, double-click **start.bat**. On Linux, run **sh start.sh**, or run `chmod +x start.sh` once and then `./start.sh`. These scripts prefer an existing package in `release`; without one, they install dependencies if needed and run from source. To develop changes, explicitly use `npm start` so an older package is not launched.

Development requires Node.js 22 or newer:

```sh
npm ci
npm start
```

`npm run pack:win` creates the Windows application in `release`. On Linux, `npm run pack:linux` produces an AppImage and tar.gz archive. Packaged applications do not require Node.js. Build Linux packages on Linux and Windows packages on Windows. A GitHub Actions workflow builds both platforms.

Extract the Linux archive and run `sh start.sh` inside it. The included script sets executable permissions when needed. A Linux archive packaged on Windows should be treated as a test build until it has run on Linux.

## Configuration

1. Add your own ElevenLabs API key in Settings. Required permissions: reading voices and Voice Changer / Speech to Speech. Optional text mode also needs Text to Speech and Speech to Text. Reading user information is required for the allowance display. Restricted allowance-read permissions do not block voice features.
2. Use the refresh button beside your setup to allow microphone access and load devices. This brief discovery access stops immediately and is not uploaded.
3. Select an input microphone, output device and voice. Voices marked as female appear first. Appearing in the account list does not guarantee API availability on a free plan.
4. Select headphones as output first. In direct Voice Changer mode, record a five-second test and speak after the prompt. The microphone then closes and the recording is converted. Tests consume allowance. Stopping output cancels recording and playback. Keep monitoring disabled when headphones are the main output.
5. Select the virtual output device, choose it as the input in Discord or your game, and start the microphone.

### Monitoring

Choose headphones under Monitoring and enable listening. The generated voice plays through the virtual microphone and headphones simultaneously. The volume control changes monitoring only, not Discord output. Monitoring can be toggled during a session and uses the same generated audio without extra ElevenLabs requests. Your original voice is not passed through. Preferences are saved. Choose two different devices for separate outputs; disconnecting headphones only disables monitoring.

### Direct Voice Changer

Direct mode is selected by default, including when older settings have no saved mode. It uses `eleven_multilingual_sts_v2` with PCM input at 16 kHz, mono, 16-bit and streamed PCM output at 24 kHz. Your delivery provides the reference; there is no transcript or parallel Scribe/TTS request.

Local level detection collects speech in chunks. A chunk is sent after the selected pause or after four seconds at the latest. Conversion adds network and model latency; it is not a zero-latency live connection. Continuous sentences can be audibly interrupted at chunk boundaries. Use headphones in a quiet environment; very quiet whispers may be missed. A short pre-roll protects word beginnings. A full queue visibly stops the session.

The maximum-audio-seconds setting limits submitted recordings per direct session, defaulting to 180 seconds. Included pauses and requests already submitted before cancellation count. Starting the microphone or a recording test resets this local counter. It is not a definitive provider-credit or cost meter. Select speech → text → voice in the setup to use the previous pipeline.

### Windows

Install [VB-CABLE](https://vb-audio.com/Cable/) and restart if needed. Set GirlVoice output to **CABLE Input** and the Discord microphone to **CABLE Output**. Keep normal headphones as Discord speakers. The physical microphone is not passed directly into the cable.

### Linux

Requirements: PulseAudio or PipeWire with `pipewire-pulse`, plus `pactl`, often provided by `pulseaudio-utils`. Use the virtual-microphone setup control in Settings. No root access is required. Select **GirlVoice_Output** as output and **GirlVoice_Microphone** in Discord. Refresh devices or reopen Discord if they do not appear.

The app creates a null sink and a microphone source derived from its monitor. On normal exit, it removes only modules it created and does not change default devices. Devices left after a crash are reused. Restarting the audio server removes temporary devices; set them up again afterwards. Do not select the virtual microphone as the app's input.

Persistent key storage requires a secure system keyring such as GNOME Keyring or KWallet. Without one, GirlVoice refuses unencrypted storage and offers session-only storage. Use the tar.gz archive if AppImage has FUSE problems. Do not disable Chromium's sandbox.

## Costs and limitations

ElevenLabs offers free allowances, but API access, voices and allowances depend on the account. The [provider dashboard](https://elevenlabs.io/app/settings/subscription) is authoritative, not this app's character display. The app does not automatically purchase subscriptions or credits. Usage-based billing already configured with the provider also applies to this app.

- In text mode, Scribe transmits pauses during an active session too. Stopping the microphone closes the cloud connection. Direct mode sends locally detected audio chunks.
- The TTS character limit counts requested characters even if a response is cancelled. It does not limit transcription costs. Starting the microphone resets the session counter. Voice tests count too.
- The allowance display shows provider values from the last connection refresh. These may represent credits or character allowances, not money.
- Stopping output discards queued and active TTS output. Audio already transmitted into Discord cannot be recalled. Subsequent confirmed speech segments are spoken again. Stopping the microphone stops everything.
- Text mode only speaks confirmed transcripts. Short pauses improve response time. Tone, laughter, whispers and sarcasm can be lost in the text step. Direct mode uses the recording as reference, but quality still depends on the recording and target voice.
- The latency display estimates time from speech onset to locally scheduled output. It excludes downstream virtual-driver and Discord delays and is not a guaranteed end-to-end measurement.
- Network errors, quota errors and full queues stop the session instead of automatically repeating paid requests. There is no automatic fallback to your original voice.
- Global push-to-talk is not included.

## Privacy

The API key stays in the Electron main process. The UI uses Context Isolation and sandboxing. Windows uses DPAPI through Electron safeStorage; Linux uses the available keyring. Keys are not stored in the repository or browser storage. Preferences live in GirlVoice's user-data directory. Speech is sent directly to ElevenLabs. The app does not save audio or transcript files; ElevenLabs retention depends on the account and provider terms.

## Checks and builds

```sh
npm test
npm run build
npm run test:desktop
npm run pack:win
```

`test:desktop` launches the actual app with a temporary user profile and checks the UI, preferences and AudioWorklet using a locally generated test signal. It uses neither a microphone nor an API key. Screenshots are saved outside the project in a temporary directory. `npm run dev` is only a browser preview and cannot access desktop or cloud features.

API references: [Voice Changer Streaming](https://elevenlabs.io/docs/api-reference/speech-to-speech/stream), [Scribe Realtime](https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime), [TTS Streaming](https://elevenlabs.io/docs/api-reference/text-to-speech/stream), [Pricing](https://elevenlabs.io/pricing/api).


</details>
