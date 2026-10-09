// Where the garage's preview camera stands for a car class: a three-quarter view from the front right, far enough back that the
// whole car fits the box (both its width and its height), whatever the class's size.
//   az   degrees round the car from the nose towards its right side; el is the height angle
//   dx   how far the body is moved along the car (CarView.hull.position.x), so the camera looks at the middle of the body
// Returns the camera's position and the point it looks at.

export const PREVIEW_AZ = 35, PREVIEW_EL = 13, PREVIEW_FOV = 32;

export function previewFrame(cfg, aspect, az = PREVIEW_AZ, dx = 0) {
  const L = cfg.length, W = cfg.width, H = cfg.height, a = az * Math.PI / 180, e = PREVIEW_EL * Math.PI / 180;
  const across = L * Math.sin(a) + W * Math.cos(a), depth = L * Math.cos(a) + W * Math.sin(a), tall = H * Math.cos(e) + depth * Math.sin(e);
  const tanV = Math.tan(PREVIEW_FOV * Math.PI / 360), tanH = tanV * aspect;
  const d = Math.max(across / 2 / tanH, tall / 2 / tanV) * 1.15 + depth / 2;
  const ty = H * 0.4;
  return { x: dx + Math.cos(a) * Math.cos(e) * d, y: ty + Math.sin(e) * d, z: Math.sin(a) * Math.cos(e) * d, target: [dx, ty, 0] };
}
