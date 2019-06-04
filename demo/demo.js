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
        //mediaSource.endOfStream();
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

    // for the file read/demuxing
    let chunkSize = 128 * 1024;

    // for the decoded output we send into source buffers
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
    let audioStartTime = 0;
    let audioEndTime = 0;
    let lastClear = 0;

    let decoding = false;
    let vid_mime = 'video/mp4; codecs="avc1.424033"';
    let aud_mime = 'audio/mp4; codecs="flac"';
    let sourceBuffer = mediaSource.addSourceBuffer(vid_mime);
    let audioBuffer;
    if (!MediaSource.isTypeSupported('audio/mp4; codecs="alac"')) {
        // safari currently breaks, will need alac
        audioBuffer = mediaSource.addSourceBuffer(aud_mime);
    }

    let onupdateend = (e) => {
        if (!sourceBuffer.updating && !(audioBuffer && audioBuffer.updating) && mediaSource.readyState == 'open') {
            console.log('continuing after updateend');
            doContinue();
        } else {
            console.log('not ready to continue');
        }
    };
    sourceBuffer.addEventListener('updateend', onupdateend);
    if (audioBuffer) {
        audioBuffer.addEventListener('updateend', onupdateend);
    }

    let continueDecoding = async () => {
        if (decoding) {
            // already working on it.
            console.log('decoding...');
            return;
        }
        if (sourceBuffer.updating || (audioBuffer && audioBuffer.updating)) {
            // wait for it to finish
            console.log('updating...');
            return;
        }
        if (seekTime !== undefined) {
            console.log('seeking to ' + seekTime);
            decoding = true;
            seekTime = await decoder.seek(seekTime);
            decoding = false;

            startTime = seekTime;
            endTime = seekTime;
            audioStartTime = seekTime;
            audioEndTime = seekTime;

            seekTime = undefined;
            lastClear = 0;
            sourceBuffer.timestampOffset = 0;
            sourceBuffer.remove(0, decoder.demuxer.duration);
            if (audioBuffer) {
                audioBuffer.timestampOffset = 0;
                audioBuffer.remove(0, decoder.demuxer.duration);
            }
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
        let target = Math.floor(now / chunkDuration) * chunkDuration;
        //console.log('target', target, 'now', now);
        if (target - lastClear >= chunkDuration) {
            console.log('clearing out older stuff ' + lastClear + '-' + target + ' (now is ' + now + ')');
            lastClear = target;
            if (audioBuffer) {
                audioBuffer.timestampOffset = 0;
                audioBuffer.remove(0, target);
            }
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
            //console.log('audioStartTime', audioStartTime, 'timestamp', timestamp, 'duration', samples[0].length / decoder.audioDecoder.audioFormat.rate);
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
            lastClear = 0;
            if (audioBuffer) {
                audioBuffer.timestampOffset = 0;
                audioBuffer.remove(0, decoder.demuxer.duration);
            }
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

        if (encoder) {
            let vid_body = encoder.flush();
            //dumpBuffered(sourceBuffer);
            //console.log('video appending at ' + startTime + ' to ' + endTime);
            let vidStartTime = startTime;
            startTime = endTime;
            sourceBuffer.timestampOffset = vidStartTime;
            try {
                sourceBuffer.appendBuffer(vid_body);
            } catch (e) {
                // Usually means buffer is full, despite our efforts
                console.log('Error during append', e);
                console.log(vid_body);
            }
            if (tempv.getAttribute('href') == '') {
                let hack = "";
                for (let i = 0; i < vid_body.length; i++) {
                    hack += String.fromCharCode(vid_body[i]);
                }
                tempv.href = 'data:video/mp4;base64,' + btoa(hack);
            }
        }

        if (audioEnc) {
            let aud_body = audioEnc.flush();
            //dumpBuffered(audioBuffer);
            //console.log('audio appending at ' + audioStartTime + ' to ' + audioEndTime);
            let audStartTime = audioStartTime;
            audioStartTime = audioEndTime;
            if (audioBuffer) {
                audioBuffer.timestampOffset = audStartTime;
                try {
                    audioBuffer.appendBuffer(aud_body);
                } catch (e) {
                    // Usually means buffer is full, despite our efforts
                    console.log('Error during append', e);
                    console.log(aud_body);
                }
            }
    
            if (tempa.getAttribute('href') == '') {
                let hack = "";
                for (let i = 0; i < aud_body.length; i++) {
                    hack += String.fromCharCode(aud_body[i]);
                }
                tempa.href = 'data:audio/mp4;base64,' + btoa(hack);
            }
        }
    };
    doContinue = (_event) => {
        if (sourceBuffer.updating || (audioBuffer && audioBuffer.updating)) {
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