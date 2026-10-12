// Small additions to three.js's built-in material shaders (onBeforeCompile), stacked so several can sit on one material: the wet
// road (src/environment.js), the road's rubber and wear (src/roadDetail.js) and the floodlight light at night (src/nightLight.js)
// each add their own, in the order they are added, and the program cache key names all of them so two materials with different
// stacks never share a compiled program.

// Adds `fn(shader, renderer)` to the material's onBeforeCompile, once per `key`. Returns the material.
export function chainShader(m, key, fn) {
  const done = m.userData.shaderPatches || (m.userData.shaderPatches = []);
  if (done.includes(key)) return m;
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey();
  m.onBeforeCompile = function (sh, r) { prev.call(this, sh, r); fn(sh, r); };
  m.customProgramCacheKey = () => `${prevKey}|${key}`;
  done.push(key);
  m.needsUpdate = true;
  return m;
}

// The same, for a shader string: the text after a chunk include, keeping the include.
export const after = (src, chunk, text) => src.replace(`#include <${chunk}>`, `#include <${chunk}>\n${text}`);
