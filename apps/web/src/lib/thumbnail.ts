/** Captures a small preview image of the 3D view (registered by the viewport). */
let capture: (() => Promise<Blob | null>) | null = null;

export const registerThumbnailCapture = (fn: (() => Promise<Blob | null>) | null) => {
  capture = fn;
};

export const captureThumbnail = () => (capture ? capture() : Promise.resolve(null));
