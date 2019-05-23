// wrapper on ogv.js's codecs

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
                return {
                    timestamp: 0,
                    frame: null
                };
            }
        }
        let timestamp = this.demuxer.frameTimestamp;
        let packet = await new Promise((resolve, _reject) => {
            this.demuxer.dequeueVideoPacket(resolve);
        });
        let frame = await new Promise((resolve, reject) => {
            this.decoder.processFrame(packet, (ok) => {
                if (ok) {
                    resolve({
                        timestamp,
                        frame: this.decoder.frameBuffer
                    });
                } else {
                    reject(new Error('Decoder failure'));
                }
            })
        });
        return frame;
    }
}

module.exports = Decoder;
