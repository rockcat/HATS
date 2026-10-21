# Knowing who you are talking to

An agent can recognise the person in front of it, greet them by name, and ask
a stranger whether they would like to be remembered. This is how that works,
and what you have to supply before it does.

## The one thing that is not in the repo

**A face recognition model.** Everything else is built; this is the piece you
drop in. It is not committed for two reasons: it is a few megabytes of
binary, and more importantly it decides the embedding space every stored face
lives in. Swap the file later and every person already enrolled stops being
recognised, with nothing in the logs to say why.

The default profile expects **MobileFaceNet**: 112×112 input, 192-dimensional
output, RGB, `(pixel − 127.5) / 128`. Put the same `.tflite` file in both
places:

| Where | Path |
| --- | --- |
| Browser (Companion) | `apps/companion/public/models/mobilefacenet.tflite` |
| Phone (Poppy) | `apps/poppyinyourpocket/assets/models/mobilefacenet.tflite` |

Until it is there, nothing breaks: the browser tab and the phone simply do not
declare that they can embed faces, the capability exchange says so honestly,
and the agent is never offered a tool that would always fail. `list_people`
and `forget_person` work regardless.

### If you use a different model

Change the profile in **both** of these, and keep them identical:

- `packages/ui-kit/face-embedding.js` — `MOBILEFACENET`
- `apps/poppyinyourpocket/lib/services/face_embedding.dart` — `mobileFaceNet`

and tell the runner, so the vectors it stores are labelled with the right
space:

```
FACE_MODEL_NAME=your-model-id
FACE_MODEL_DIMENSIONS=512
```

A mismatch between any of these three is the failure this whole design tries
hardest to make visible. Vectors from two models are not comparable, so the
runner refuses a vector whose length is wrong rather than filing it — but if
the lengths happen to match and only the *preprocessing* differs, nothing
will complain and nobody will ever be recognised. Both test suites assert the
constants explicitly for that reason.

## How a recognition actually happens

```
agent: identify_person            (no arguments — it does not know what a vector is)
   runner: who is embodying this agent? → a browser tab, or a phone
      device: take a still, find the largest face, crop it, run the model
      device: → 192 floats, on the `data` channel
   runner: compare against the project's register
agent: "This is Paul (confidence 0.87). They are your main user."
```

Two things worth noticing:

**The face never leaves the device.** The model runs where the camera is, and
only the vector crosses the network. This is why on-device embedding is the
preferred path rather than a fallback.

**The agent never sees the vector.** 192 floats cost about two kilobytes of
context, arrive as prose, get retyped wrong, and tell a language model
nothing it can use. The device bridge has a separate `data` channel for
results the runner wants and the agent must not read.

## Where it runs

| | Detection | Embedding |
| --- | --- | --- |
| Browser (Companion) | MediaPipe FaceDetector | LiteRT.js — WebGPU, falling back to WebAssembly |
| Phone (Poppy) | ML Kit | `flutter_litert` |
| Flutter web | ML Kit | `flutter_litert` web runtime |
| Runner (Node) | — | Not implemented — see below |

LiteRT is what TensorFlow Lite is called now, and the same `.tflite` file runs
in all of these.

### The runner's own embedding is deliberately a stub

`decodeToSquareRgb` in `server/src/people/embedder.ts` throws rather than
guessing. Decoding a JPEG is easy; matching the crop, channel order and
normalisation the model was trained with is not, and getting it wrong
produces vectors that look entirely reasonable and match nobody. It wants an
image library chosen alongside the model, and it is the least useful of the
three paths anyway — a device that can embed should, and one that cannot is
better told so than quietly handing over photographs.

## Consent

`remember_person` refuses without `consent: true`, and the refusal is not
advisory — nothing is written. The tool description tells the agent to ask
out loud first. `forget_person` deletes the person and their face entirely
and is described to the agent as something to do whenever asked, without
argument.

The register lives in the project (`people.json`), not in the runner, and is
dropped when the project changes — one project's faces do not follow the team
into the next.
