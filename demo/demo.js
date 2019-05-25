let regeneratorRuntime = require('regenerator-runtime');
let babelPolyfill = require('@babel/polyfill');

let Decoder = require('./decoder.js');
let StreamFile = require('stream-file');
let YUVToMP4 = require('../lib/yuv-to-mp4.js');

let vid = document.querySelector('#sink');
let source = document.querySelector('#source');
let mediaSource;
let doContinue;

async function pauseThread() {
    await new Promise((resolve, reject) => {
        //setImmediate(resolve);
        setTimeout(resolve, 0);
    });
}

async function doit() {
    if (mediaSource) {
        mediaSource.endOfStream();
    }
    if (doContinue) {
        vid.removeEventListener('timeupdate', doContinue);
        doContinue = undefined;
    }
    mediaSource = new MediaSource();

    vid.src = URL.createObjectURL(mediaSource);
    await new Promise((resolve, _reject) => {
        mediaSource.addEventListener('sourceopen', (e) => {
            URL.revokeObjectURL(vid.src);
            resolve();
        });
    });
    
    let chunkSize = 128 * 1024;
    let chunkDuration = 1.0;

    let stream = new StreamFile({
        url: source.value,
    });
    await stream.load();
    let initialData = await stream.read(chunkSize);

    let decoder = new Decoder(stream);
    await decoder.init(initialData);

    mediaSource.duration = decoder.demuxer.duration;

    let startTime = 0;
    let endTime = 0;

    let decoding = false;
    let vid_mime = 'video/mp4; codecs="avc1.424033"';
    let sourceBuffer = mediaSource.addSourceBuffer(vid_mime);

    sourceBuffer.addEventListener('updateend', (e) => {
        if (!sourceBuffer.updating && mediaSource.readyState == 'open') {
            if (stream.eof) {
                mediaSource.endOfStream();
                console.log('vid decoding at eof');
            }
            doContinue();
        }
    });

    let continueDecoding = async () => {
        if (decoding) {
            // already working on it.
            return;
        }
        if (endTime - vid.currentTime > chunkDuration * 3) {
            // We've got some buffer space, don't bother yet.
            // But do clear out any old stuff
            return;
        }
        decoding = true;
        console.log('continue at ' + startTime);

        // Clear out any old stuff
        if (vid.currentTime > chunkDuration * 3) {
            sourceBuffer.remove(0, vid.currentTime);
        }

        let encoder = new YUVToMP4(decoder.demuxer.videoFormat, startTime);

        while (endTime - startTime < chunkDuration) {
            let {frame, timestamp} = await decoder.decodeFrame();
            if (!frame) {
                if (stream.eof) {
                    break;
                }
                let data = await stream.read(chunkSize);
                await decoder.receiveInput(data);
                continue;
            }
            encoder.appendFrame(frame, timestamp);
            endTime = timestamp;

            await pauseThread(); // hack until workers set up
        }
        let vid_body = encoder.flush();
        console.log('appending at ' + startTime + ' to ' + endTime);

        sourceBuffer.timestampOffset = startTime;
        sourceBuffer.appendBuffer(vid_body);

        startTime = endTime;
        decoding = false;
    };
    doContinue = (_event) => {
        if (!decoding && !sourceBuffer.updating) {
            continueDecoding().then((_result) => {}).catch((error) => {
                console.log('error', error);
            });
        }
    };

    vid.addEventListener('timeupdate', doContinue);
    doContinue();
}

function start() {
    doit().then((_result) => {
        console.log('ready for playback.');
    }).catch((error) => {
        console.log('error', error);
    });
}

source.addEventListener('change', (_event) => {
    start();
});

start();