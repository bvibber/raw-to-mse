let PCMToFLAC = require('./pcm-to-flac');

let mp4 = require('mux.js/lib/mp4/mp4-generator');
let transmuxer = require('mux.js/lib/mp4/transmuxer');

class PCMToMP4 {
    constructor(format, startTimestamp) {
        this.encoder = new PCMToFLAC(format);
        this.streamHeader = this.encoder.streamHeader();
    
        this.timeBase = 90000;
        this.startTimestamp = startTimestamp;
        let pts = (startTimestamp * this.timeBase) | 0;

        this.track = {
            duration: 0,
            id: 1,
            codec: 'fLaC',
            type: 'audio',

            audioobjecttype: 0, // ???
            channelcount: format.channels,
            samplerate: format.rate,
            samplingfrequencyindex: 0, // ???
            samplesize: 16,

            // FLAC-specific
            metadata: this.streamHeader,

            baseMediaDecodeTime: pts,
            timelineStartInfo: {
                pts: pts,
                dts: pts,
            },
        };
    
        this._stream = new transmuxer.AudioSegmentStream(this.track, {
            keepOriginalTimestamps: true
        });

    }

    appendSamples(data, timestamp) {
        let buf = this.encoder.encodeSamples(data, timestamp);
        let pts = (timestamp * this.timeBase) | 0;

        this._stream.push({
            trackId: 1,
            type: 'audio',
            pts: pts,
            dts: pts,
            duration: data[0].length,
            data: new Uint8Array(buf)
        });
        // hack: restore these manually, they are currently broken
        // by AudioSegmentStream
        this.track.channelcount = this.encoder.channels;
        this.track.samplerate = this.encoder.sampleRate;
        this.track.samplesize = 16;
    }

    /**
     * @returns {Uint8Array} completed fragmented MP4 data
     */
    flush() {
        let out = new Uint8Array();
        this._stream.on('data', (event) => {
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

module.exports = PCMToMP4;
