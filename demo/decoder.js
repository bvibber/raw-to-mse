// wrapper on ogv.js's codecs

let {OGVLoader} = require('ogv');

require('!!file-loader?name=[name].[ext]?version=[hash]!ogv/dist/ogv-decoder-video-vp9.js');
require('!!file-loader?name=[name].[ext]?version=[hash]!ogv/dist/ogv-decoder-video-vp9-wasm.js');
require('!!file-loader?name=[name].[ext]?version=[hash]!ogv/dist/ogv-decoder-video-vp9-wasm.wasm');
require('!!file-loader?name=[name].[ext]?version=[hash]!ogv/dist/ogv-demuxer-webm.js');
require('!!file-loader?name=[name].[ext]?version=[hash]!ogv/dist/ogv-demuxer-webm-wasm.js');
require('!!file-loader?name=[name].[ext]?version=[hash]!ogv/dist/ogv-demuxer-webm-wasm.wasm');
require('!!file-loader?name=[name].[ext]?version=[hash]!ogv/dist/ogv-worker-audio.js');
require('!!file-loader?name=[name].[ext]?version=[hash]!ogv/dist/ogv-worker-video.js');

class Decoder {
    construct() {
        this.demuxer = null;
        this.videoDecoder = null;
    }

    async init(initialData) {
        let demuxerFactory;
        let decoderFactory;
        let w = (typeof WebAssembly == 'object') ? 'W' : '';

        await new Promise((resolve, _reject) => {
            OGVLoader.loadClass('OGVDemuxerWebM' + w, (classWrapper) => {
                demuxerFactory = classWrapper;
                resolve();
            });
        });
        await new Promise((resolve, _reject) => {
            OGVLoader.loadClass('OGVDecoderVideoVP9' + w, (classWrapper) => {
                decoderFactory = classWrapper;
                resolve();
            }, {
                worker: true
            });
        });

        await new Promise((resolve, _reject) => {
            demuxerFactory().then((module) => {
                this.demuxer = module;
                resolve();
            });
        });
        await this.receiveInput(initialData);
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
            decoderFactory({videoFormat}).then((module) => {
                this.decoder = module;
                resolve();
            });
        });
        await new Promise((resolve, _reject) => {
            this.decoder.init(resolve);
        });
    }

    async receiveInput(data) {
        await new Promise((resolve, _reject) => {
            this.demuxer.receiveInput(data, resolve);
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
