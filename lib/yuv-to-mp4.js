let YUVToH264 = require('./yuv-to-h264.js');

let mp4 = require('mux.js/lib/mp4/mp4-generator.js');
let h264 = require('mux.js/lib/codecs/h264.js');
let transmuxer = require('mux.js/lib/mp4/transmuxer.js');

class YUVToMP4 {
    constructor(format, startTimestamp=0) {
        this.encoder = new YUVToH264(format);
        this.sps = this.encoder.sps();
        this.pps = this.encoder.pps();
    
        this.timeBase = 90000;
        this.startTimestamp = startTimestamp;
        let pts = (startTimestamp * this.timeBase) | 0;

        this.track = {
            duration: 0,
            id: 1,
            codec: 'avc',
            width: this.encoder.width,
            height: this.encoder.height,
            baseMediaDecodeTime: pts,
            type: 'video',
            timelineStartInfo: {
                pts: pts,
                dts: pts,
            },
        };
    
        this._stream = new h264.H264Stream();
        this._vsstream = new transmuxer.VideoSegmentStream(this.track, {
            keepOriginalTimestamps: true
        });
        this._stream.pipe(this._vsstream);
    }

    appendFrame(frame, timestamp) {
        let buf = this.encoder.encodeFrame(frame);
        let pts = (timestamp * this.timeBase) | 0;

        // Annex B style
        this._stream.push({
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
        this._stream.push({
            trackId: 1,
            type: 'video',
            pts: pts,
            dts: pts,
            data: this.sps,
        });
        this._stream.push({
            trackId: 1,
            type: 'video',
            pts: pts,
            dts: pts,
            data: this.pps,
        });
        this._stream.push({
            trackId: 1,
            type: 'video',
            pts: pts,
            dts: pts,
            data: new Uint8Array(buf),
        });
    }

    /**
     * @returns {Uint8Array} completed fragmented MP4 data
     */
    flush() {
        let out;
        this._vsstream.on('data', (event) => {
            if (this.startTimestamp > 0) {
                out = event.boxes;
            } else {
                let init = mp4.initSegment([this.track]);
                out = new Uint8Array(init.length + event.boxes.length);
                out.set(init);
                out.set(event.boxes, init.length);
            }
        });

        this._stream.flush();
        return out;
    }
}

module.exports = YUVToMP4;
