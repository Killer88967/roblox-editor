/**
 * Small bridge so non-3D code (the store, the toolbar) can ask the viewport things.
 * The viewport replaces these when it mounts.
 */
export const viewportApi = {
  /** Where new parts should go: the point the camera orbits around. */
  focusPoint: (): [number, number, number] => [0, 0, 0],
};
