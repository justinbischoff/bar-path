# Bar Path

Bar Path tracks the end of the barbell through a snatch, clean or clean & jerk. It draws the bar's path against a vertical line and checks the lift for common technique faults. Everything runs in the browser, and videos never leave your device.

**Live app:** https://justinbischoff.github.io/bar-path/

## How it works

1. **Load a lift.** Use a side-on video with the camera still and level with the bar. Pick the lift type.
2. **Mark the bar end.** Click the centre of the sleeve on the first frame, then drag to the plate rim. A 450 mm bumper plate sets the scale for measurements in centimetres.
3. **Track.** The bar end is followed frame by frame using normalised cross-correlation template matching, with sub-pixel refinement.
4. **Check technique.** [MediaPipe Pose](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) finds the lifter's joints on each tracked frame. The app then checks:
   - **First pull:** shoulders over the bar, hips rising early, the bar drifting away, heels rising early.
   - **Second pull:** early arm bend, incomplete extension, the bar swinging away at the hips.
   - **Catch:** jumping forward or back, the bar landing off mid-foot.
   - **Jerk:** a forward dip, a forward drive, press-outs.

5. **Save and compare.** The Library tab saves each lift in this browser's IndexedDB. A save keeps:
   - the path, the readout and the findings
   - stills of the key positions (lift-off, bar at knee, extension, catch, jerk lockout)
   - the video too, if you choose to keep it.

   From the Library you can:
   - **Compare:** overlay up to five saved paths on one chart.
   - **Ghost:** lay a saved path over the current video.
   - **Back up:** export everything to a JSON file and import it on another device. Backups leave videos out.

   Nothing is uploaded.

The fault thresholds are starting points, not a coaching standard. One camera and a general body model can be several degrees off.

## Offline and install

Bar Path is an installable web app. Use **Install app** in Chrome or Edge, or **Share → Add to Home Screen** in Safari. A service worker (`sw.js`) caches the app so it opens with no connection:
- **App files:** fetched from the network first so updates arrive, falling back to the cache when offline.
- **Pinned MediaPipe files and fonts:** served from the cache.
- **Pose model and runtime (about 21 MB):** cached the first time body tracking runs, so a first visit never downloads them unasked.

On iPhone, adding the app to the Home Screen also stops Safari from clearing saved lifts after a week without a visit.

## Run locally

It uses ES modules, so serve the folder instead of opening the file directly:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

There is no build step.

## Layout

| Path | What's in it |
| --- | --- |
| `index.html`, `css/app.css` | Page and styles |
| `js/app.js` | UI, transport, tracking and analysis orchestration |
| `js/sources.js` | Video loading, frame-rate detection, synthetic sample clip |
| `js/tracker.js` | Template matching for the bar end |
| `js/path.js` | Path smoothing, lift phases (lift-off, peak, catch, jerk), readout figures |
| `js/pose.js` | MediaPipe loading, joint lookup and angles |
| `js/checks.js` | Technique fault checks |
| `js/draw.js` | Canvas overlay: path, body lines, measurement annotations, ghost path, comparison chart |
| `js/storage.js` | IndexedDB storage for saved lifts, images and videos; backup export and import |
| `js/library.js` | Save form, library list, opening saved lifts, ghost, compare |
| `js/pwa.js`, `sw.js`, `manifest.webmanifest`, `icons/` | Offline cache, install button, app manifest and icons |
| `vendor/mediapipe/` | Pinned copy of `@mediapipe/tasks-vision` 1.0.1 and the full pose model (Apache 2.0) |

## License

MIT for this project's code. MediaPipe is Apache 2.0; see `vendor/mediapipe/LICENSE`.
