let Decoder = require('./decoder.js');
let StreamFile = require('stream-file');
let YUVToMP4 = require('../lib/yuv-to-mp4.js');

let vid = document.querySelector('#sink');
let source = document.querySelector('#source');
let mediaSource;
let doContinue;
let doSeeking;
let seekTime = undefined;
let abortDecoding = false;

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
        vid.removeEventListener('seeking', doSeeking);
        doContinue = undefined;
        doSeeking = undefined;
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
    let chunkDuration = 0.5; // half second, about 12 frames at 24fps. fits 720p24 chunks in a single 16mb buffer, beyond which Firefox seems to get unhappy
    let numChunks = 3 / chunkDuration; // we need about 3 seconds of video buffered to play reliably

    let stream = new StreamFile({
        url: source.value,
        progressive: false,
    });
    await stream.load();
    let initialData = await stream.read(chunkSize);

    let decoder = new Decoder(stream);
    decoder.onseek = (offset) => {
        //console.log('attempting to seek to ' + offset);
        stream.seek(offset).then(() => {
            //console.log('seeked');
            doContinue();
        });
    }
    await decoder.init(initialData);

    mediaSource.duration = decoder.demuxer.duration;

    let startTime = 0;
    let endTime = 0;

    let decoding = false;
    let vid_mime = 'video/mp4; codecs="avc1.424033"';
    let sourceBuffer = mediaSource.addSourceBuffer(vid_mime);

    sourceBuffer.addEventListener('updateend', (e) => {
        if (!sourceBuffer.updating && mediaSource.readyState == 'open') {
            doContinue();
        }
    });

    let continueDecoding = async () => {
        if (decoding) {
            // already working on it.
            //console.log('already working on it');
            return;
        }
        if (seekTime) {
            //console.log('seeking to ' + seekTime);
            await decoder.seek(seekTime);
            startTime = seekTime;
            endTime = seekTime;
            seekTime = undefined;
        }
        if (endTime - vid.currentTime > chunkDuration * numChunks) {
            //console.log('plenty of space');
            // We've got some buffer space, don't bother yet.
            return;
        }
        decoding = true;
        //console.log('continue at ' + startTime);

        // Clear out any old stuff
        let now = vid.currentTime;
        if (now > chunkDuration) {
            sourceBuffer.timestampOffset = 0;
            sourceBuffer.remove(0, now - chunkDuration);
        }
        let encoder = new YUVToMP4(decoder.demuxer.videoFormat, startTime);

        while (endTime - startTime < chunkDuration) {
            //console.log('attempting to decode at ' + startTime);
            let {frame, timestamp} = await decoder.decodeFrame();
            if (abortDecoding) {
                break;
            }
            if (!frame) {
                if (stream.eof) {
                    break;
                }
                let data = await stream.read(chunkSize);
                if (abortDecoding) {
                    break;
                }
                await decoder.receiveInput(data);
                continue;
            }
            encoder.appendFrame(frame, timestamp);
            endTime = timestamp;

            //await pauseThread(); // hack until workers set up
        }
        if (abortDecoding) {
            //console.log('aborting decode');
            abortDecoding = false;
            decoder.flush();
            sourceBuffer.timestampOffset = 0;
            sourceBuffer.remove(0, decoder.demuxer.duration);
            decoding = false;
            doContinue();
            return;
        }
        let vid_body = encoder.flush();
        console.log('appending at ' + startTime + ' to ' + endTime + '; ' + vid_body.byteLength + ' bytes');

        sourceBuffer.timestampOffset = startTime;
        sourceBuffer.appendBuffer(vid_body);

        startTime = endTime;
        decoding = false;
    };
    doContinue = (_event) => {
        if (sourceBuffer.updating) {
            console.log('updating');
            return;
        }
        continueDecoding().then((_result) => {}).catch((error) => {
            console.log('error', error);
        });
    };

    doSeeking = (event) => {
        let now = vid.currentTime;
        console.log('Seek?', now);
        if (decoding) {
            abortDecoding = true;
        }
        seekTime = now;
        if (!decoding) {
            doContinue();
        }
    };

    vid.addEventListener('timeupdate', doContinue);
    vid.addEventListener('seeking', doSeeking);
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