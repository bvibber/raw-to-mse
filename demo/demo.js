let Decoder = require('./decoder.js');
let StreamFile = require('stream-file');
let YUVToMP4 = require('../lib/yuv-to-mp4.js');

let vid = document.querySelector('#sink');
let mediaSource = new MediaSource();

async function doit() {
    let chunkSize = 128 * 1024;
    let chunkDuration = 1.0;

    let caminandes3 = 'https://upload.wikimedia.org/wikipedia/commons/transcoded/a/ab/Caminandes_3_-_Llamigos_-_Blender_Animated_Short.webm/Caminandes_3_-_Llamigos_-_Blender_Animated_Short.webm.360p.vp9.webm';
    let stream = new StreamFile({
        url: caminandes3,
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

    let doContinue;
    let continueDecoding = async () => {
        if (decoding) {
            // already working on it.
            return;
        }
        if (endTime - vid.currentTime > chunkDuration * 3) {
            // We've got some buffer space, don't bother yet.
            return;
        }
        decoding = true;
        console.log('continue at ' + startTime);
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
        }
        let vid_body = encoder.flush();
        console.log('appending at ' + startTime + ' to ' + endTime);

        sourceBuffer.timestampOffset = startTime;
        sourceBuffer.appendBuffer(vid_body);

        startTime = endTime;
        decoding = false;
    };
    doContinue = () => {
        if (!decoding && !sourceBuffer.updating) {
            continueDecoding().then((_result) => {}).catch((error) => {
                console.log('error', error);
            });
        }
    };

    vid.addEventListener('timeupdate', (_event) => {
        doContinue();
    });
    doContinue();
}

vid.src = URL.createObjectURL(mediaSource);
mediaSource.addEventListener('sourceopen', (e) => {
    URL.revokeObjectURL(vid.src);

    doit().then((_result) => {
        console.log('ready for playback.');
    }).catch((error) => {
        console.log('error', error);
    });
});
