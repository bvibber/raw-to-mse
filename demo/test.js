let Decoder = require('./decoder.js');


let YUVToMP4 = require('../lib/yuv-to-mp4.js');

let fs = require('fs');

async function doit(infile) {
    let filedata = fs.readFileSync(infile);

    let decoder = new Decoder();
    await decoder.init(filedata);

    let encoder = new YUVToMP4(decoder.demuxer.videoFormat);
    while (true) {
        let {frame, timestamp} = await decoder.decodeFrame();
        let yuvFrame = frame;
        if (yuvFrame) {
            encoder.appendFrame(yuvFrame, timestamp);
        } else {
            break;
        }
    }

    let data = encoder.flush();
    process.stdout.write(data);
}

let infile = process.argv[2] || 'lizard.webm';

doit(infile).then(() => {
    process.stdout.end();
    process.exit(0);
}).catch((e) => {
    throw e;
});
