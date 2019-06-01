const BitWriter = require('./bit-writer.js');
const crc8 = require('crc/crc8').default;
const crc16 = require('crc/crc16').default;

class PCMToFLAC {
    constructor(format) {
        this.sampleRate = format.rate;
        this.channels = format.channels;
        this.samples = 0;
    }

    streamHeader() {
        // starts with "fLaC"
        // then STREAMINFO block

        let bits = new BitWriter();

        bits.writeBits(8, "f".charCodeAt(0));
        bits.writeBits(8, "L".charCodeAt(0));
        bits.writeBits(8, "a".charCodeAt(0));
        bits.writeBits(8, "C".charCodeAt(0));

        bits.writeBit(1); // last-metadata-block flag
        bits.writeBits(7, 0); // block-type: STREAMINFO
        bits.writeBits(24, 34); // length of STREAMINFO block

        bits.writeBits(16, 16); // minimum block size, in samples
        bits.writeBits(16, 65535); // maximum block size, in samples
        bits.writeBits(24, 0); // min frame size (unknown)
        bits.writeBits(24, 0); // max frame size (unknown)
        bits.writeBits(20, this.sampleRate); // sample rate (Hz)
        bits.writeBits(3, this.channels); // channel count (max 8)
        bits.writeBits(5, 16); // bits per sample
        bits.writeBits(36, 0); // total samples in stream (unknown)
        bits.writeBits(128, 0); // md5 checksum of uncompressed audio (wtf?)

        return bits.collect();
    }

    /**
     * @param {Array<Float32Array>} data 
     * @returns ArrayBuffer
     */
    encodeSamples(data) {
        // Use "Verbatim" method: zero predictor plus residual

        // frame header
        // encoded subframes for each channel
        // zero-padded to byte

        let sampleCount = data[0].length;

        let bits = new BitWriter();
        bits.writeBits(14, 0x3ffe); // sync code
        bits.writeBit(0); // reserved
        bits.writeBit(1); // blocking strategy: variable-size
        bits.writeBits(4, 7); // block size: get 16-bit (blocksize-1) from end of header
        bits.writeBits(4, 0); // sample rate: get from STREAMINFO
        bits.writeBits(4, this.channels - 1); // channel assignments
        bits.writeBits(3, 0); // sample size: get from STREAMINFO
        bits.writeBit(0); // reserved
        bits.writeUTF8(this.samples); // index of current position in samples?
        bits.writeBits(16, sampleCount); // block length in samples
        let headerWithoutCRC = bits.collect();
        let headerCRC8 = crc8(headerWithoutCRC, 0);

        let subframes = [];
        for (let i = 0; i < this.channels; i++) {
            let input = data[i];
            let bits = new BitWriter();
            bits.writeBit(0); // padding
            bits.writeBits(6, 1); // SUBFRAME_VERBATIM
            bits.writeBit(0); // wasted bits per sample flag
            let subframeHeader = bits.collect();

            let samples = new Uint16Array(input.length);
            for (let i = 0; i < sampleCount; i++) {
                // input is 32-bit float
                // output is 16-bit int
                let val = Math.floor((input[i] + 1) * 32767.5);
                if (val > 65535) {
                    val = 65535;
                } else if (val < 0) {
                    val = 0;
                }
                samples[i] = val;
            }
            let byteSamples = new Uint8Array(samples.buffer);

            subframes[i] = new Uint8Array(subframeHeader.length + byteSamples.length);
            subframes[i].set(subframeHeader);
            subframes[i].set(byteSamples, subframeHeader.length);
        }


        let outLength = headerWithoutCRC.length +
            1 + // CRC8
            this.channels * (1 + sampleCount * 2) +
            2 // CRC16;
        let out = new Uint8Array(outLength);
        out.set(headerWithoutCRC);
        out.set(headerCRC8, headerWithoutCRC.length);
        let pos = headerWithoutCRC.length + headerCRC8.length;
        for (let i = 0; i < this.channels; i++) {
            out.set(subframes[i], pos);
            pos += subframes[i].length;
        }
        let footerCRC16 = crc16(out.subarray(0, outLength - 2));
        out.set(footerCRC16, pos);

        this.samples += sampleCount;

        return out.buffer;
    }
}

module.exports = PCMToFLAC;
