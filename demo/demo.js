let Decoder = require('./decoder.js');
let StreamFile = require('stream-file');
let YUVToMP4 = require('../lib/yuv-to-mp4');
let PCMToMP4 = require('../lib/pcm-to-mp4');

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
            //URL.revokeObjectURL(vid.src);
            resolve();
        });
    });
    
    let chunkSize = 128 * 1024;
    let chunkDuration = 1; // half second, about 12 frames at 24fps. fits 720p24 chunks in a single 16mb buffer, beyond which Firefox seems to get unhappy
    let numChunks = 4 / chunkDuration; // we need about 3 seconds of video buffered to play reliably

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
    let audioStartTime = 0;
    let audioEndTime = 0;

    let decoding = false;
    let vid_mime = 'video/mp4; codecs="avc1.424033"';
    let aud_mime = 'audio/mp4; codecs="flac"';
    let sourceBuffer = mediaSource.addSourceBuffer(vid_mime);
    let audioBuffer = mediaSource.addSourceBuffer(aud_mime);

    sourceBuffer.addEventListener('updateend', (e) => {
        if (!sourceBuffer.updating && mediaSource.readyState == 'open') {
            console.log('continuing after updateend');
            doContinue();
        } else {
            console.log('not ready to continue');
        }
    });

    let continueDecoding = async () => {
        if (decoding) {
            // already working on it.
            console.log('decoding...');
            return;
        }
        if (sourceBuffer.updating) {
            // wait for it to finish
            console.log('updating...');
            return;
        }
        if (seekTime !== undefined) {
            console.log('seeking to ' + seekTime);
            decoding = true;
            await decoder.seek(seekTime);
            decoding = false;

            startTime = seekTime;
            endTime = seekTime;
            audioStartTime = seekTime;
            audioEndTime = seekTime;

            seekTime = undefined;
            sourceBuffer.timestampOffset = 0;
            sourceBuffer.remove(0, decoder.demuxer.duration);
            audioBuffer.timestampOffset = 0;
            audioBuffer.remove(0, decoder.demuxer.duration);
            // continue after the sourcebuffer update
            return;
        }
        if (endTime - vid.currentTime > chunkDuration * numChunks &&
            audioEndTime - vid.currentTime > chunkDuration * numChunks
        ) {
            console.log('plenty of space');
            // We've got some buffer space, don't bother yet.
            return;
        }

        // Clear out any old stuff
        let now = vid.currentTime;
        let buffered = sourceBuffer.buffered;
        let earliest = buffered.length ? buffered.start(0) : now;
        let target = Math.floor((now - chunkDuration) / chunkDuration) * chunkDuration;
        if (earliest < target) {
            console.log('clearing out older stuff ' + earliest + '-' + target);
            audioBuffer.timestampOffset = 0;
            audioBuffer.remove(0, target);
            sourceBuffer.timestampOffset = 0;
            sourceBuffer.remove(0, target);
            return; // continue when done
        }

        decoding = true;
        console.log('continue at ' + startTime);
        let encoder;
        while (endTime - startTime <= chunkDuration) {
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
            if (!encoder) {
                encoder = new YUVToMP4(decoder.demuxer.videoFormat, startTime);
            }
            //console.log('frame', timestamp, timestamp - endTime);
            encoder.appendFrame(frame, timestamp);
            endTime = timestamp;

            await pauseThread(); // hack until workers set up
        }

        // Catch up on any audio
        let audioEnc = null;
        while (audioEndTime - audioStartTime <= chunkDuration) {
            let {samples, timestamp} = await decoder.decodeAudio();
            if (abortDecoding) {
                break;
            }
            if (!samples) {
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
            if (!audioEnc) {
                // we need to initialize before we get the audioFormat currently
                //audioStartTime = timestamp;
                audioEnc = new PCMToMP4(decoder.audioDecoder.audioFormat, audioStartTime);
            }
            //console.log('audio', timestamp, timestamp - audioEndTime);
            audioEndTime = timestamp + samples[0].length / decoder.audioDecoder.audioFormat.rate;
            console.log('audioStartTime', audioStartTime, 'timestamp', timestamp, 'duration', samples[0].length / decoder.audioDecoder.audioFormat.rate);
            //audioEndTime = timestamp;
            audioEnc.appendSamples(samples, timestamp);
            //console.log(audioStartTime, timestamp, audioEndTime);
            //console.log('audio in progress at ', audStartTime);
            /*
            if (timestamp >= endTime) {
                break;
            }
            if (decoder.demuxer.audioTimestamp >= endTime) {
                break;
            }
            */
        }


        if (abortDecoding) {
            console.log('aborting decode');
            abortDecoding = false;
            decoder.flush();
            decoding = false;
            audioBuffer.timestampOffset = 0;
            audioBuffer.remove(0, decoder.demuxer.duration);
            sourceBuffer.timestampOffset = 0;
            sourceBuffer.remove(0, decoder.demuxer.duration);
            //doContinue();
            return;
        }

        decoding = false;

        function dumpBuffered(x) {
            let b = x.buffered;
            let o = [];
            for (let i = 0; i < b.length; i++) {
                o.push([b.start(i), b.end(i)]);
            }
            console.log(o);
        }

        let vid_body = encoder.flush();
        dumpBuffered(sourceBuffer);
        console.log('video appending at ' + startTime + ' to ' + endTime);
        let vidStartTime = startTime;
        startTime = endTime;
        sourceBuffer.timestampOffset = vidStartTime;
        sourceBuffer.appendBuffer(vid_body);

        let aud_body = audioEnc.flush();
        dumpBuffered(audioBuffer);
        console.log('audio appending at ' + audioStartTime + ' to ' + audioEndTime);
        let audStartTime = audioStartTime;
        audioStartTime = audioEndTime;
        audioBuffer.timestampOffset = audStartTime;
        audioBuffer.appendBuffer(aud_body);

        /*
        if (audStartTime >= 0) {
            console.log('audio start:', audStartTime);
            let aud_body = audioEnc.flush();
            console.log(aud_body);
            audioBuffer.timestampOffset = audStartTime;
            audioBuffer.appendBuffer(aud_body);

            if (temp.getAttribute('href') == '') {
                let hack = [];
                for (let i = 0; i < aud_body.length; i++) {
                    hack[i] = aud_body[i];
                }
                temp.href = 'data:audio/mp4;base64,' +
                    btoa(String.fromCharCode.apply(String, hack));
            }
        }
        */
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