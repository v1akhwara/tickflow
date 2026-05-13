// Generate simple SVG icons for PWA
const fs = require('fs');

function makeSVG(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#6366f1"/>
      <stop offset="100%" style="stop-color:#a78bfa"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${size*0.2}" fill="url(#g)"/>
  <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle"
    font-family="Arial,sans-serif" font-size="${size*0.5}" font-weight="bold" fill="white">&#x2713;</text>
</svg>`;
}

fs.writeFileSync('icon-192.svg', makeSVG(192));
fs.writeFileSync('icon-512.svg', makeSVG(512));
console.log('SVG icons created');
