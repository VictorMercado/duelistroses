import { Vector3, type Camera, type Object3D, type Scene } from 'three';

/**
 * Skips drawing whichever face of a card is turned away from the camera.
 *
 * A card is two one-sided faces back to back. The GPU already culls the one
 * turned away, but only after its draw calls are issued; hiding it saves
 * those calls. The choice is made in the scene's onBeforeRender, which three
 * runs after every world matrix is updated for the frame and before it
 * builds the list of things to draw. So it sees the card exactly as it is
 * drawn that frame, however it got there: its own easing, the play-from-hand
 * spin, or an effect turning a parent group (a fusion, a ritual, an overflow).
 * A spin never shows a frame with a face missing.
 *
 * The test is the same one the GPU's culling uses (which side of the face's
 * plane the camera is on), so nothing that was visible before is hidden.
 * Within EDGE of edge-on both faces are kept, for rounding.
 */
interface Faces {
  /** The group the faces turn with; its local +Z is the front face's normal. */
  pivot: Object3D;
  front: Object3D | null;
  back: Object3D | null;
}

const EDGE = 0.02;
const watched = new WeakMap<Scene, Set<Faces>>();
const eye = new Vector3();
const normal = new Vector3();
const toEye = new Vector3();

function cull(faces: Set<Faces>, camera: Camera) {
  if (faces.size === 0) return;
  eye.setFromMatrixPosition(camera.matrixWorld);
  for (const f of faces) {
    const m = f.pivot.matrixWorld;
    normal.setFromMatrixColumn(m, 2).normalize();
    toEye.setFromMatrixPosition(m);
    toEye.subVectors(eye, toEye).normalize();
    const facing = normal.dot(toEye);
    if (f.front) f.front.visible = facing > -EDGE;
    if (f.back) f.back.visible = facing < EDGE;
  }
}

/** Starts hiding the turned-away face of a card in `scene`. Returns the stop, which shows both faces again. */
export function watchFaces(scene: Scene, faces: Faces): () => void {
  let set = watched.get(scene);
  if (!set) {
    const own = new Set<Faces>();
    set = own;
    watched.set(scene, own);
    const previous = scene.onBeforeRender;
    scene.onBeforeRender = function (this: Scene, ...args: Parameters<Scene['onBeforeRender']>) {
      previous.apply(this, args);
      cull(own, args[2]);
    };
  }
  const entry = faces;
  set.add(entry);
  return () => {
    set.delete(entry);
    if (entry.front) entry.front.visible = true;
    if (entry.back) entry.back.visible = true;
  };
}
