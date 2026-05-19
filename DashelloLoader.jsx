import React from 'react';

const keyframes = `
@keyframes dashPop1 {
  0%   { transform: scale(0); opacity: 0; }
  10%  { transform: scale(0); opacity: 0; }
  25%  { transform: scale(1.12); opacity: 1; }
  35%  { transform: scale(1); opacity: 1; }
  95%  { transform: scale(1); opacity: 1; }
  96%  { transform: scale(0); opacity: 0; }
  100% { transform: scale(0); opacity: 0; }
}
@keyframes dashPop2 {
  0%   { transform: scale(0); opacity: 0; }
  22%  { transform: scale(0); opacity: 0; }
  37%  { transform: scale(1.12); opacity: 1; }
  47%  { transform: scale(1); opacity: 1; }
  95%  { transform: scale(1); opacity: 1; }
  96%  { transform: scale(0); opacity: 0; }
  100% { transform: scale(0); opacity: 0; }
}
@keyframes dashPop3 {
  0%   { transform: scale(0); opacity: 0; }
  34%  { transform: scale(0); opacity: 0; }
  49%  { transform: scale(1.12); opacity: 1; }
  59%  { transform: scale(1); opacity: 1; }
  95%  { transform: scale(1); opacity: 1; }
  96%  { transform: scale(0); opacity: 0; }
  100% { transform: scale(0); opacity: 0; }
}
`;

// Pixel-perfect dot definitions from the Dashello logo (321x321 source).
// cx/cy = center coordinates in source image, rx/ry = ellipse radii.
// The logo has a natural rising-diagonal composition: small dot bottom-left,
// large dot upper-right. This is intentional and must be preserved.
const DOT_DEFS = [
  { cx: 47.5,  cy: 191.5, rx: 32.5, ry: 30.5 },
  { cx: 132.0, cy: 171.5, rx: 46.0, ry: 50.5 },
  { cx: 245.0, cy: 153.5, rx: 57.0, ry: 68.5 },
];

const GAP_PX = [0, 5, 9]; // gaps between dots at base scale (321px source)
const BASE_SIZE = 321;
const ANIM_DURATION = '2.4s';
const ANIM_TIMING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const ANIM_NAMES = ['dashPop1', 'dashPop2', 'dashPop3'];

export function DashelloLoader({ color = '#4D9DE0', size = 80 }) {
  const scale = size / BASE_SIZE;

  // Container sized to the original bounding box of all dots in the logo
  const minCY = Math.min(...DOT_DEFS.map(d => d.cy - d.ry)); // topmost pixel
  const maxCY = Math.max(...DOT_DEFS.map(d => d.cy + d.ry)); // bottommost pixel
  const minCX = DOT_DEFS[0].cx - DOT_DEFS[0].rx;             // leftmost pixel
  const maxCX = DOT_DEFS[2].cx + DOT_DEFS[2].rx;             // rightmost pixel

  const containerW = (maxCX - minCX) * scale;
  const containerH = (maxCY - minCY) * scale;

  return (
    <>
      <style>{keyframes}</style>
      <div
        style={{
          display: 'inline-block',
          position: 'relative',
          width: containerW,
          height: containerH,
          background: 'transparent',
        }}
      >
        {DOT_DEFS.map((dot, i) => {
          const w = dot.rx * 2 * scale;
          const h = dot.ry * 2 * scale;
          // Position each dot absolutely using its original center coords,
          // offset relative to the container's top-left corner
          const left = (dot.cx - dot.rx - minCX) * scale;
          const top  = (dot.cy - dot.ry - minCY) * scale;

          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: left,
                top: top,
                width: w,
                height: h,
                borderRadius: '50%',
                background: color,
                animation: `${ANIM_NAMES[i]} ${ANIM_DURATION} ${ANIM_TIMING} infinite`,
                transformOrigin: 'center center',
              }}
            />
          );
        })}
      </div>
    </>
  );
}

export default DashelloLoader;
