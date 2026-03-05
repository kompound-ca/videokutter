import { VideoCutterUltra } from '/js/video-cutter-ultra.js';

const cutter = new VideoCutterUltra();
window.cutter = cutter;

window.addEventListener('load', () => {
    document.documentElement.classList.remove('preload');
});

export { cutter };
