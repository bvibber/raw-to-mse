let Decoder = require('./decoder.js');


let YUVToH264 = require('../lib/yuv-to-h264.js');

let fs = require('fs');

let mp4 = require('mux.js/lib/mp4/mp4-generator.js');
let h264 = require('mux.js/lib/codecs/h264.js');
let transmuxer = require('mux.js/lib/mp4/transmuxer.js');

async function doit(infile) {
    let filedata = fs.readFileSync(infile);

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

    let stream = new h264.H264Stream();
    let vsstream = new transmuxer.VideoSegmentStream(track, {
        keepOriginalTimestamps: true
    });
    stream.pipe(vsstream);
    while (true) {
        let {frame, timestamp} = await decoder.decodeFrame();
        let yuvFrame = frame;
        if (yuvFrame) {
            let buf = encoder.encodeFrame(yuvFrame);
            let pts = timestamp * timeBase;

            // Annex B style
            stream.push({
                trackId: 1,
                type: 'video',
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
                type: 'video',
                pts: pts,
                dts: pts,
            });
            stream.push({
                trackId: 1,
                type: 'video',
                data: pps,
                pts: pts,
                dts: pts,
            });
        
            stream.push({
                trackId: 1,
                type: 'video',
                data: new Uint8Array(buf),
                pts: pts,
                dts: pts,
            });
        } else {
            break;
        }
    }

    vsstream.on('data', (out) => {
        let init = mp4.initSegment(tracks);
        process.stdout.write(init);
        process.stdout.write(out.boxes);
    });

    stream.flush();
}

let infile = process.argv[2] || 'lizard.webm';

doit(infile).then(() => {
    process.stdout.end();
    process.exit(0);
}).catch((e) => {
    throw e;
});
