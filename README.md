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

The fault thresholds are starting points, not a coaching standard. One camera and a general body model can be several degrees off.

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
| `js/draw.js` | Canvas overlay: path, body lines, measurement annotations |
| `vendor/mediapipe/` | Pinned copy of `@mediapipe/tasks-vision` 1.0.1 and the full pose model (Apache 2.0) |

## License

MIT for this project's code. MediaPipe is Apache 2.0; see `vendor/mediapipe/LICENSE`.
