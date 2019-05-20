let muxjs = require('mux.js');

let OGVDemuxerWebMW = require('ogv/dist/ogv-demuxer-webm-wasm.js');
let OGVDecoderVideoVP9W = require('ogv/dist/ogv-decoder-video-vp9-wasm.js');

function locateFile(url) {
    if (url.slice(0, 5) === 'data:') {
      return url;
    } else {
      return __dirname + '/../node_modules/ogv/dist/' + url;
    }
}

class Decoder {
    construct() {
        this.demuxer = null;
        this.videoDecoder = null;
    }

    async init(initialData) {
        await new Promise((resolve, _reject) => {
            OGVDemuxerWebMW({locateFile}).then((module) => {
                this.demuxer = module;
                resolve();
            });
        });
        await new Promise((resolve, _reject) => {
            this.demuxer.receiveInput(initialData, resolve);
        });
        while (!this.demuxer.loadedMetadata) {
            let more = await new Promise((resolve, _reject) => {
                this.demuxer.process(resolve);
            });
            if (!more) {
                throw new Error('...ended early?');
            }
        }
        await new Promise((resolve, _reject) => {
            let videoFormat = this.demuxer.videoFormat;
            OGVDecoderVideoVP9W({locateFile, videoFormat}).then((module) => {
                this.decoder = module;
                resolve();
            });
        });
        await new Promise((resolve, _reject) => {
            this.decoder.init(resolve);
        });
    }

    async decodeFrame() {
        while (!this.demuxer.frameReady) {
            let more = await new Promise((resolve, _reject) => {
                this.demuxer.process(resolve);
            });
            if (!more) {
                // Out of frames
                return null;
            }
        }
        let packet = await new Promise((resolve, _reject) => {
            this.demuxer.dequeueVideoPacket(resolve);
        });
        let frame = await new Promise((resolve, reject) => {
            this.decoder.processFrame(packet, (ok) => {
                if (ok) {
                    resolve(this.decoder.frameBuffer);
                } else {
                    reject(new Error('Decoder failure'));
                }
            })
        });
        return frame;
    }
}


let YUVToH264 = require('../lib/yuv-to-h264.js');

let fs = require('fs');

async function doit() {
    let filedata = fs.readFileSync('lizard.webm');

    let decoder = new Decoder();
    await decoder.init(filedata);

    let encoder = new YUVToH264(decoder.demuxer.videoFormat);
    let header = encoder.streamHeader();
    process.stdout.write(Buffer(header));
    while (true) {
        let frame = await decoder.decodeFrame();
        if (frame) {
            let buf = encoder.encodeFrame(frame);
            process.stdout.write(Buffer(buf));
        } else {
            break;
        }
    }
}
doit().then(() => {
    process.stdout.end();
    process.exit(0);
}).catch((e) => {
    throw e;
});
