# @hats/avatar-camera

Puts an agent on camera. It renders the agent's avatar with no screen
(`three` on headless OpenGL), lip-syncs it to the agent's speech, and sends
the frames out through ffmpeg:

- `webcam/obs-output.ts`: to the OBS Virtual Camera, which Zoom, Teams or Meet
  can pick as a webcam. This uses a Windows DirectShow device, so it only works
  on a Windows machine, not in a Linux container.
- `media/srt-output.ts`: as an SRT stream, which OBS or another tool can take in.
- `viewer/sdl-viewer.ts`: to a preview window.

Nothing calls it yet. It lives outside the runner because the runner never
loads it, and its dependencies (gl, canvas, SDL, ffmpeg) were most of
the runner image's size. The plan is to run it as one shared service that any
runner can ask to put an agent on camera.

It has its own dependencies, which the runner's install does not fetch:

    cd packages/avatar-camera
    npm install
    npm test

`gl` has no prebuilt binary for every Node version; where it has none it
compiles from source and needs Python and a C++ toolchain.
