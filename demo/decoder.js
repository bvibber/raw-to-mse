// wrapper on ogv.js's codecs

let {OGVLoader} = require('ogv');

require('!!file-loader?name=[name].[ext]?version=[hash]!ogv/dist/ogv-decoder-audio-opus-wasm.js');
require('!!file-loader?name=[name].[ext]?version=[hash]!ogv/dist/ogv-decoder-audio-opus-wasm.wasm');
require('!!file-loader?name=[name].[ext]?version=[hash]!ogv/dist/ogv-decoder-video-vp9-wasm.js');
require('!!file-loader?name=[name].[ext]?version=[hash]!ogv/dist/ogv-decoder-video-vp9-wasm.wasm');
require('!!file-loader?name=[name].[ext]?version=[hash]!ogv/dist/ogv-demuxer-webm-wasm.js');
require('!!file-loader?name=[name].[ext]?version=[hash]!ogv/dist/ogv-demuxer-webm-wasm.wasm');
require('!!file-loader?name=[name].[ext]?version=[hash]!ogv/dist/ogv-worker-audio.js');
require('!!file-loader?name=[name].[ext]?version=[hash]!ogv/dist/ogv-worker-video.js');

class Decoder {
    construct() {
        this.demuxer = null;
        this.decoder = null;
        this.audioDecoder = null;
        this.onseek = null;
    }

    async init(initialData) {
        let OGVDemuxerWebMW;
        let OGVDecoderVideoVP9W;
        let OGVDecoderAudioOpusW;

        await new Promise((resolve, _reject) => {
            OGVLoader.loadClass('OGVDemuxerWebMW', (classWrapper) => {
                OGVDemuxerWebMW = classWrapper;
                resolve();
            });
        });
        await new Promise((resolve, _reject) => {
            OGVLoader.loadClass('OGVDecoderVideoVP9W', (classWrapper) => {
                OGVDecoderVideoVP9W = classWrapper;
                resolve();
            }, {
                worker: true
            });
        });
        await new Promise((resolve, _reject) => {
            OGVLoader.loadClass('OGVDecoderAudioOpusW', (classWrapper) => {
                OGVDecoderAudioOpusW = classWrapper;
                resolve();
            }, {
                worker: true
            });
        });

        await new Promise((resolve, _reject) => {
            OGVDemuxerWebMW().then((module) => {
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
            OGVDecoderVideoVP9W({videoFormat}).then((module) => {
                this.decoder = module;
                resolve();
            });
        });
        await new Promise((resolve, _reject) => {
            this.decoder.init(resolve);
        });
        await new Promise((resolve, _reject) => {
            let audioFormat = this.demuxer.audioFormat;
            OGVDecoderAudioOpusW({audioFormat}).then((module) => {
                this.audioDecoder = module;
                resolve();
            });
        });
        await new Promise((resolve, _reject) => {
            this.audioDecoder.init(resolve);
        });

        this.demuxer.onseek = (offset) => {
            if (this.onseek) {
                this.onseek(offset);
            }
        }
    }

    async receiveInput(data) {
        await new Promise((resolve, _reject) => {
            this.demuxer.receiveInput(data, resolve);
        });
    }

    async nextVideoTimestamp() {
        while (!this.demuxer.frameReady) {
            let more = await new Promise((resolve, _reject) => {
                this.demuxer.process(resolve);
            });
            if (!more) {
                // Out of frames
                return null;
            }
        }
        return this.demuxer.frameTimestamp;
    }

    async decodeFrame() {
        let timestamp = await this.nextVideoTimestamp();
        if (timestamp === null) {
            return {
                timestamp: 0,
                frame: null
            };
        }
        let packet = await new Promise((resolve, _reject) => {
            this.demuxer.dequeueVideoPacket(resolve);
        });
        return await new Promise((resolve, reject) => {
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
    }

    async audioPacket() {
        while (!this.demuxer.audioReady) {
            let more = await new Promise((resolve, _reject) => {
                this.demuxer.process(resolve);
            });
            if (!more) {
                // Out of data?
                return {
                    timestamp: 0,
                    packet: null
                };
            }
        }
        let timestamp = this.demuxer.audioTimestamp;
        let packet = await new Promise((resolve, _reject) => {
            this.demuxer.dequeueAudioPacket(resolve);
        });
        return {
            timestamp,
            packet: await packet
        };
    }

    async decodeAudio() {
        // Opus has a header packet in ogv.js model
        while (!this.audioDecoder.loadedMetadata) {
            let {timestamp, packet} = await this.audioPacket();
            if (!packet) {
                console.log('out of data', this.audioDecoder);
                return {
                    timestamp: 0,
                    samples: null
                };
            }
            await new Promise((resolve, _reject) => {
                this.audioDecoder.processHeader(packet, resolve);
            });
        }

        let {timestamp, packet} = await this.audioPacket();
        if (!packet) {
            console.log('out of data', this.audioDecoder);
            return {
                timestamp: 0,
                samples: null
            };
        }
        return await new Promise((resolve, reject) => {
            this.audioDecoder.processAudio(packet, (ok) => {
                if (ok) {
                    resolve({
                        timestamp,
                        samples: this.audioDecoder.audioBuffer
                    });
                } else {
                    reject(new Error('Decoder failure'));
                }
            })
        });
    }

    flush() {
        this.demuxer.flush(() => {});
        this.decoder.sync(() => {});
    }

    async seek(targetTime) {
        this.flush();
        return await new Promise((resolve, _reject) => {
            this.demuxer.seekToKeypoint(targetTime, resolve);
        });
    }
}

module.exports = Decoder;
