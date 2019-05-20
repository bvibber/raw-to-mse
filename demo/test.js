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


let YUVToH264 = require('../lib/yuv-to-h264.js');

let fs = require('fs');


let mp4 = require('mux.js/lib/mp4/mp4-generator.js');
let frameUtils = require('mux.js/lib/mp4/frame-utils.js');
let trackDecodeInfo = require('mux.js/lib/mp4/track-decode-info.js');
let transmuxer = require('mux.js/lib/mp4/transmuxer.js');

async function doit() {
    let filedata = fs.readFileSync('lizard.webm');

    let decoder = new Decoder();
    await decoder.init(filedata);

    let encoder = new YUVToH264(decoder.demuxer.videoFormat);
    let sps = encoder.sps();
    let pps = encoder.pps();

    let timeBase = 90000;
    let track = {
        duration: 0,
        id: 1,
        codec: 'avc',
        width: encoder.width,
        height: encoder.height,
        baseMediaDecodeTime: 0,
        type: 'video',
        timelineStartInfo: {
            pts: 0,
            dts: 0,
        },
    };
    let tracks = [track];

    let stream = new transmuxer.VideoSegmentStream(track, {
        keepOriginalTimestamps: true
    });
    while (true) {
        let {frame, timestamp} = await decoder.decodeFrame();
        let yuvFrame = frame;
        if (yuvFrame) {
            let buf = encoder.encodeFrame(yuvFrame);
            let pts = timestamp * timeBase;

            // Annex B style
            stream.push({
                trackId: 1,
                nalUnitType: 'access_unit_delimiter_rbsp',
                pts: pts,
                dts: pts,
                data: new Uint8Array([
                    0x00, 0x00, 0x00, 0x01,
                    0x09, // AUD NAL type
                    0x00, // payload == I-frame
                ]),
            });

            stream.push({
                trackId: 1,
                nalUnitType: 'seq_parameter_set_rbsp',
                data: sps,
                config: {
                    width: encoder.width,
                    height: encoder.height,
                    profileIdc: 66, // baseline
                    levelIdc: 10, // 1.0
                    profileCompatibility: 0,
                },
                pts: pts,
                dts: pts,
            });
            stream.push({
                trackId: 1,
                nalUnitType: 'pic_parameter_set_rbsp',
                data: pps,
                pts: pts,
                dts: pts,
            });
        
            stream.push({
                trackId: 1,
                nalUnitType: 'slice_layer_without_partitioning_rbsp_idr',
                data: new Uint8Array(buf),
                pts: pts,
                dts: pts,
            });
        } else {
            break;
        }
    }

    stream.on('data', (out) => {
        let init = mp4.initSegment(tracks);
        process.stdout.write(init);
        process.stdout.write(out.boxes);
    });

    stream.flush();
}

doit().then(() => {
    process.stdout.end();
    process.exit(0);
}).catch((e) => {
    throw e;
});
