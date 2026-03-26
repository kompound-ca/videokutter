// Shared utility functions

export function formatTime(seconds) {
    const hours   = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs    = Math.floor(seconds % 60);
    const ms      = Math.round((seconds % 1) * 10);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${ms}`;
}


export function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function generateKutName(originalName) {
    const words = [
        'apple','banana','cedar','delta','echo','falcon','gizmo','harbor',
        'island','jupiter','kappa','lima','mango','november','omega','pearl',
        'quartz','raven','sierra','tango','umbra','vivid','willow','xeno',
        'yonder','zephyr','fruitybaboon','playingwithmymonkey','otter','bear',
        'lion','tiger','eagle','shark','whale','dolphin','panda','koala',
        'platypus','narwhal','unicorn','dragon','phoenix','griffin',
        'pegasus','hydra','cerberus','minotaur','sphinx','chimera',
        'kompound','ngk','smile','happy','sunny','breezy','cloudy','stormy'
    ];
    const word = words[Math.floor(Math.random() * words.length)];
    const digits = String(Math.floor(10000 + Math.random() * 90000));
    const ext = (originalName && originalName.match(/\.[^.]+$/)?.[0]) || '.mp4';
    return `${word}_${digits}_kut${ext}`;
}
