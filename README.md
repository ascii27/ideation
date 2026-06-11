# Ideation

A voice-driven WebXR brainstorming space. Open it on a Quest headset, talk to an
"ideation companion" agent, and (in later phases) have it spawn and manipulate
objects, images, and notes in the 3D space.

- **Frontend:** React + TypeScript, React Three Fiber + `@react-three/xr`, zustand.
- **Backend:** a long-running Node/Express server that serves the frontend and the
  `/api` routes from one HTTPS origin.
- **Voice/agent (Phase 1+):** OpenAI Realtime API (speech-to-speech) over WebRTC.

## Where it runs

The single testing environment is the exe.dev VM **`armchair-sparkle`**, reachable
at **https://armchair-sparkle.exe.xyz/** (automatic HTTPS — required for WebXR).
The VM is private, so the first visit redirects to an exe.dev login. There is no
local-laptop acceptance testing; deploy and test on the VM.

## Deploy

```bash
./scripts/deploy.sh
```

This rsyncs the source to the VM, runs `npm install && npm run build`, and restarts
the `ideation` systemd service. Then open https://armchair-sparkle.exe.xyz/.

### One-time VM setup

Node 22 is installed on the VM. Install the systemd service once:

```bash
scp deploy/ideation.service armchair-sparkle.exe.xyz:/tmp/
ssh armchair-sparkle.exe.xyz \
  'sudo mv /tmp/ideation.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable ideation'
# Put the OpenAI key on the VM (Phase 1+):
ssh armchair-sparkle.exe.xyz 'echo "OPENAI_API_KEY=sk-..." > /home/exedev/ideation/.env'
```

## Test on the Quest

1. Deploy (above).
2. In the Quest Browser open https://armchair-sparkle.exe.xyz/ and log into exe.dev.
3. Press **Enter VR** and look around the room.

Desktop Chrome at the same URL renders the scene flat — useful for verifying the
voice path before putting on the headset.

## Project layout

```
server/index.ts     Express server (Vite middleware in dev, static dist/ in prod)
src/main.tsx        React entry
src/App.tsx         Canvas + XR store + Enter VR button
src/xr/Scene.tsx    The blank VR room
scripts/deploy.sh   rsync + build + restart on the VM
deploy/ideation.service  systemd unit
```
